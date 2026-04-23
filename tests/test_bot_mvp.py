from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from bot.jobs import JobStore
from bot.billing import BillingConfig, build_invoice_payload, parse_invoice_payload
from bot.handlers import _f_score_for_telegram
from ai_hedge.runner import run_ticker_valuation
from ai_hedge.legacy_port import (
    REQUIRED_F_SCORE_KEYS,
    _split_regular_sec_iterations,
    extract_f_score_json_and_total,
    f_score_result_to_text,
    vote_f_score_results,
)
from ai_hedge.service import (
    _format_short_sec_output,
    build_sec_short_analysis_text,
    is_valid_ticker,
    run_full_analysis,
    run_sec_analysis,
    run_sec_analysis_short,
)


class BotMvpTests(unittest.TestCase):
    def test_extract_f_score_normalizes_missing_and_ignores_extra(self) -> None:
        raw = '{"positive_net_income": 1, "unexpected": 1}'
        out = extract_f_score_json_and_total(raw)
        self.assertFalse(out["valid_keys"])
        self.assertEqual(set(out["f_score_json"].keys()), set(REQUIRED_F_SCORE_KEYS))
        self.assertEqual(out["f_score_json"]["positive_net_income"], 1)
        self.assertEqual(out["f_score_json"]["positive_operating_cash_flow"], 0)
        self.assertEqual(out["f_score_total"], 1)

    def test_vote_f_score_results_majority_and_tie(self) -> None:
        base = {k: 0 for k in REQUIRED_F_SCORE_KEYS}

        r1 = {"f_score_json": dict(base, positive_net_income=1, improving_roa=1), "valid_keys": True}
        r2 = {"f_score_json": dict(base, positive_net_income=1, improving_roa=0), "valid_keys": True}
        r3 = {"f_score_json": dict(base, positive_net_income=0, improving_roa=1), "valid_keys": True}
        r4 = {"f_score_json": dict(base, positive_net_income=0, improving_roa=0), "valid_keys": True}

        voted = vote_f_score_results([r1, r2, r3, r4])
        self.assertEqual(voted["f_score_json"]["positive_net_income"], 0)  # tie -> 0
        self.assertEqual(voted["f_score_json"]["improving_roa"], 0)  # tie -> 0
        self.assertEqual(voted["f_score_total"], 0)

    def test_f_score_result_text_uses_yes_no_not_emoji(self) -> None:
        base = {k: 0 for k in REQUIRED_F_SCORE_KEYS}
        result = {
            "f_score_json": dict(base, positive_net_income=1),
            "f_score_total": 1,
            "valid_keys": True,
        }
        text = f_score_result_to_text(result)
        self.assertIn("Piotroski F-Score of 1 out of 9", text)
        self.assertIn("Positive net income: Yes", text)
        self.assertIn("Positive operating cash flow: No", text)
        self.assertNotIn("✅", text)
        self.assertNotIn("❌", text)

    def test_telegram_f_score_formatter_uses_emojis(self) -> None:
        raw = "Positive net income: Yes\nPositive operating cash flow: No"
        formatted = _f_score_for_telegram(raw)
        self.assertIn("Positive net income: ✅", formatted)
        self.assertIn("Positive operating cash flow: ❌", formatted)

    @patch("ai_hedge.legacy_port.deepseek_simple_text")
    def test_f_score_single_reasoner_run(self, mock_deepseek_simple_text) -> None:
        from ai_hedge import legacy_port as legacy

        def _full_json(pni: int, ocf: int) -> str:
            payload = {k: 0 for k in REQUIRED_F_SCORE_KEYS}
            payload["positive_net_income"] = pni
            payload["positive_operating_cash_flow"] = ocf
            return json.dumps(payload)

        mock_deepseek_simple_text.return_value = _full_json(1, 1)

        out = legacy.f_score(
            info_dict={"info": {}, "financials": {}},
            financial_dict={"All Reports": {}},
            n_runs=3,
            sleep_seconds=0,
        )
        self.assertIn("Piotroski F-Score of 2 out of 9", out)
        self.assertIn("Positive net income: Yes", out)
        self.assertIn("Positive operating cash flow: Yes", out)
        self.assertEqual(mock_deepseek_simple_text.call_count, 1)

        call_kwargs = mock_deepseek_simple_text.call_args.kwargs
        self.assertEqual(call_kwargs.get("model"), "deepseek-reasoner")
        self.assertEqual(call_kwargs.get("temperature"), 0.0)
        self.assertEqual(call_kwargs.get("short_answer"), False)

    @patch("ai_hedge.legacy_port.deepseek_simple_text")
    def test_llm_parallel_reasoner_forces_zero_temperature(self, mock_deepseek_simple_text) -> None:
        from ai_hedge import legacy_port as legacy

        mock_deepseek_simple_text.return_value = "{}"
        out = legacy.llm_n_answers_parallel(
            api_key="k",
            prompt="p",
            n=3,
            max_workers=2,
            model="deepseek-reasoner",
        )

        self.assertEqual(len(out), 3)
        self.assertEqual(mock_deepseek_simple_text.call_count, 3)
        for c in mock_deepseek_simple_text.call_args_list:
            self.assertEqual(c.kwargs.get("model"), "deepseek-reasoner")
            self.assertEqual(c.kwargs.get("temperature"), 0.0)
            self.assertEqual(c.kwargs.get("short_answer"), False)

    @patch("ai_hedge.legacy_port.deepseek_simple_text")
    def test_regular_text_maker_uses_chat_035(self, mock_deepseek_simple_text) -> None:
        from ai_hedge import legacy_port as legacy

        mock_deepseek_simple_text.return_value = "ok"
        header, body = legacy.what_it_does_insights_result({"info": {}})
        self.assertTrue(header)
        self.assertEqual(body, "ok")

        call_kwargs = mock_deepseek_simple_text.call_args.kwargs
        self.assertEqual(call_kwargs.get("model"), "deepseek-chat")
        self.assertEqual(call_kwargs.get("temperature"), 0.35)
        self.assertEqual(call_kwargs.get("short_answer"), True)

    @patch("ai_hedge.service._ensure_deepseek_api_key")
    @patch("ai_hedge.legacy_port.deepseek_simple_text")
    def test_sec_short_maker_uses_chat_035(
        self,
        mock_deepseek_simple_text,
        _mock_require_key,
    ) -> None:
        mock_deepseek_simple_text.side_effect = ["part-1", "part-2"]
        out = build_sec_short_analysis_text(
            ticker="AAPL",
            info_dict={"info": {"longName": "Apple Inc."}},
            files_dict={"10-K": {"date": "2025-10-31", "text": "Annual filing text"}},
            financial_dict={"All Reports": "financial reports text"},
        )
        self.assertEqual(out.get("status"), "success")
        self.assertEqual(mock_deepseek_simple_text.call_count, 2)
        for c in mock_deepseek_simple_text.call_args_list:
            self.assertEqual(c.kwargs.get("model"), "deepseek-chat")
            self.assertEqual(c.kwargs.get("temperature"), 0.35)
            self.assertEqual(c.kwargs.get("short_answer"), False)

    @patch("ai_hedge.legacy_port.yf.Ticker")
    def test_rate_calculator_uses_10_days_without_tnx_scale_conversion(self, mock_ticker) -> None:
        from ai_hedge.legacy_port import get_10_day_avg_risk_free_rate

        mock_ticker.return_value.history.return_value = pd.DataFrame(
            {"Close": [41.0, 42.0, 43.0, 44.0, 45.0, 46.0, 47.0, 48.0, 49.0, 50.0, 51.0, 52.0]}
        )

        rate = get_10_day_avg_risk_free_rate()

        # Tail-10 values are 43..52, mean is 47.5; keep raw value (no /10 scaling conversion).
        self.assertAlmostEqual(rate, 47.5, places=6)

    def test_build_prompt_includes_rate_and_fallback_when_missing(self) -> None:
        from ai_hedge.legacy_port import build_prompt

        financial_dict_with_rate = {
            "All Reports": "reports",
            "info": {"longName": "Test Co"},
            "currency_statement": "currency note",
            "info_financials": {"marketCap": 1000},
            "f_score": "Piotroski F-Score: 7/9",
            "rate": 4.75,
        }

        prompt_with_rate = build_prompt(
            ticker="TEST",
            financial_dict=financial_dict_with_rate,
            instruction="Output JSON only.",
            text="analysis text",
        )
        self.assertIn("The 10-Day Average Risk-Free Rate (10Y Treasury) is: 4.7500%", prompt_with_rate)

        financial_dict_without_rate = dict(financial_dict_with_rate)
        financial_dict_without_rate.pop("rate")

        prompt_without_rate = build_prompt(
            ticker="TEST",
            financial_dict=financial_dict_without_rate,
            instruction="Output JSON only.",
            text="analysis text",
        )
        self.assertIn(
            "The 10-Day Average Risk-Free Rate (10Y Treasury) is not available.",
            prompt_without_rate,
        )

    def test_ticker_validation(self) -> None:
        self.assertTrue(is_valid_ticker("AAPL"))
        self.assertTrue(is_valid_ticker("BRK.B"))
        self.assertFalse(is_valid_ticker("bad ticker"))
        self.assertFalse(is_valid_ticker("TOO_LONG_TICKER_123"))

    def test_short_sec_formatter_separates_bullets(self) -> None:
        raw = "1) First point\nSecond line for first\n\u2022 Second point\nThird point without marker"
        formatted = _format_short_sec_output(raw)
        self.assertIn("- First point Second line for first", formatted)
        self.assertIn("- Second point", formatted)
        self.assertIn("- Third point without marker", formatted)
        self.assertIn("\n\n- ", formatted)

    def test_short_sec_formatter_preserves_markdown_table(self) -> None:
        raw = (
            "- 12) Major Strategic Events\n"
            "| Event | Date | Strategic Impact |\n"
            "| :--- | :--- | :--- |\n"
            "| Acquisition | 2025 | Expanded platform |\n"
        )
        formatted = _format_short_sec_output(raw)
        self.assertIn("- 12) Major Strategic Events", formatted)
        self.assertIn("| Event | Date | Strategic Impact |", formatted)
        self.assertIn("| :--- | :--- | :--- |", formatted)
        self.assertIn("| Acquisition | 2025 | Expanded platform |", formatted)
        self.assertNotIn("- | Event | Date | Strategic Impact |", formatted)

    def test_iteration_split_logic(self) -> None:
        self.assertEqual(_split_regular_sec_iterations(1, "sec"), (1, 0))
        self.assertEqual(_split_regular_sec_iterations(2, "sec"), (1, 1))
        self.assertEqual(_split_regular_sec_iterations(3, "sec"), (2, 1))
        self.assertEqual(_split_regular_sec_iterations(3, ""), (3, 0))

    def test_job_store_creates_isolated_output_dirs(self) -> None:
        with TemporaryDirectory() as tmp:
            store = JobStore(output_root=tmp)
            job1 = store.create_job(user_id=1, chat_id=10, ticker="AAPL", mode="valuation")
            job2 = store.create_job(user_id=2, chat_id=20, ticker="NVDA", mode="sec")
            self.assertNotEqual(job1.job_id, job2.job_id)
            self.assertNotEqual(job1.output_dir, job2.output_dir)
            self.assertTrue(Path(job1.output_dir).exists())
            self.assertTrue(Path(job2.output_dir).exists())

    def test_job_store_mode_selection(self) -> None:
        with TemporaryDirectory() as tmp:
            store = JobStore(output_root=tmp)
            self.assertIsNone(store.get_user_mode(42))
            with self.assertRaises(ValueError):
                store.create_job(user_id=42, chat_id=99, ticker="MSFT")
            store.set_user_mode(42, "valuation")
            self.assertEqual(store.get_user_mode(42), "valuation")
            val_job = store.create_job(user_id=42, chat_id=99, ticker="NVDA")
            self.assertEqual(val_job.mode, "valuation")
            store.set_user_mode(42, "sec")
            self.assertEqual(store.get_user_mode(42), "sec")
            sec_job = store.create_job(user_id=42, chat_id=99, ticker="AAPL")
            self.assertEqual(sec_job.mode, "sec")

    def test_job_store_pending_ticker(self) -> None:
        with TemporaryDirectory() as tmp:
            store = JobStore(output_root=tmp)
            store.set_pending_ticker(7, "NVDA")
            self.assertEqual(store.get_pending_ticker(7), "NVDA")
            self.assertEqual(store.pop_pending_ticker(7), "NVDA")
            self.assertIsNone(store.get_pending_ticker(7))

    def test_job_store_free_retry_credit(self) -> None:
        with TemporaryDirectory() as tmp:
            store = JobStore(output_root=tmp)
            self.assertEqual(store.get_free_valuation_retries(55), 0)
            self.assertFalse(store.consume_free_valuation_retry(55))

            store.grant_free_valuation_retry(55)
            self.assertEqual(store.get_free_valuation_retries(55), 1)
            self.assertTrue(store.consume_free_valuation_retry(55))
            self.assertEqual(store.get_free_valuation_retries(55), 0)

    def test_job_store_free_run_credit(self) -> None:
        with TemporaryDirectory() as tmp:
            store = JobStore(output_root=tmp)
            self.assertEqual(store.get_free_run_credits(77), 0)
            self.assertFalse(store.consume_free_run_credit(77))
            store.grant_free_run_credit(77)
            self.assertEqual(store.get_free_run_credits(77), 1)
            self.assertTrue(store.consume_free_run_credit(77))
            self.assertEqual(store.get_free_run_credits(77), 0)

    def test_job_store_pending_payment_roundtrip(self) -> None:
        with TemporaryDirectory() as tmp:
            store = JobStore(output_root=tmp)
            rec = store.set_pending_payment(
                payload="p1",
                job_id="job123",
                user_id=1,
                chat_id=2,
                mode="valuation",
                ticker="AAPL",
                amount_stars=50,
            )
            self.assertEqual(rec.job_id, "job123")
            self.assertIsNotNone(store.get_pending_payment("p1"))
            popped = store.pop_pending_payment("p1")
            self.assertIsNotNone(popped)
            self.assertEqual(popped.amount_stars, 50)
            self.assertIsNone(store.get_pending_payment("p1"))

    def test_billing_payload_roundtrip(self) -> None:
        payload = build_invoice_payload(user_id=42, mode="valuation", ticker="NVDA", nonce="abc123")
        parsed = parse_invoice_payload(payload)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["user_id"], 42)
        self.assertEqual(parsed["mode"], "valuation")
        self.assertEqual(parsed["ticker"], "NVDA")

    def test_billing_config_price_map(self) -> None:
        cfg = BillingConfig(valuation_price_stars=50, sec_price_stars=25, free_password="secret")
        self.assertEqual(cfg.price_for_mode("valuation"), 50)
        self.assertEqual(cfg.price_for_mode("sec"), 25)
        self.assertTrue(cfg.has_free_password())
        self.assertTrue(cfg.is_valid_free_password("secret"))
        self.assertFalse(cfg.is_valid_free_password("wrong"))

    @patch("ai_hedge.runner.run_ticker_valuation")
    def test_service_success_contract(self, mock_run_ticker_valuation) -> None:
        with TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "job123"
            ticker = "AAPL"
            ticker_dir = output_dir / ticker
            ticker_dir.mkdir(parents=True, exist_ok=True)

            analysis = ticker_dir / f"{ticker}_analysis.txt"
            chart = ticker_dir / f"{ticker}_prices_valuation.png"
            pdf = ticker_dir / f"{ticker}_analysis.pdf"
            prices_explain_txt = ticker_dir / f"{ticker}_prices_explain.txt"
            prices_explain_pdf = ticker_dir / f"{ticker}_prices_explain.pdf"
            analysis.write_text("ok", encoding="utf-8")
            chart.write_text("png", encoding="utf-8")
            pdf.write_text("pdf", encoding="utf-8")
            prices_explain_txt.write_text("explain", encoding="utf-8")
            prices_explain_pdf.write_text("pdf", encoding="utf-8")

            mock_run_ticker_valuation.return_value = {
                "analysis_txt": str(analysis),
                "analysis_pdf": str(pdf),
                "prices_plot": str(chart),
                "prices_explain_txt": str(prices_explain_txt),
                "prices_explain_pdf": str(prices_explain_pdf),
            }

            result = run_full_analysis(ticker=ticker, output_dir=str(output_dir))
            self.assertEqual(result["status"], "success")
            self.assertEqual(result["ticker"], ticker)
            self.assertTrue(Path(str(result["analysis_txt"])).exists())
            self.assertTrue(Path(str(result["chart_path"])).exists())
            self.assertTrue(Path(str(result["pdf_path"])).exists())
            self.assertTrue(Path(str(result["prices_explain_txt"])).exists())
            self.assertTrue(Path(str(result["prices_explain_pdf"])).exists())
            self.assertEqual(result["errors"], [])

    @patch("ai_hedge.text_to_pdf_check.convert_text_to_pdf")
    @patch("ai_hedge.legacy_port.deepseek_simple_text")
    @patch("ai_hedge.legacy_port.get_dicts")
    def test_service_sec_success_contract(
        self,
        mock_get_dicts,
        mock_deepseek_simple_text,
        mock_convert_text_to_pdf,
    ) -> None:
        with TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "jobsec"
            ticker = "AAPL"

            files_dict = {
                "10-K": {
                    "url": "https://example.com/10k",
                    "date": "2025-10-31",
                    "text": "Annual filing text",
                    "tables": [{"index": ["Revenue"], "columns": ["2025"], "values": [[100.0]]}],
                },
                "10-Q": {
                    "url": "https://example.com/10q",
                    "date": "2025-12-31",
                    "text": "Quarterly filing text",
                    "tables": [{"index": ["Revenue"], "columns": ["Q4-2025"], "values": [[30.0]]}],
                },
            }
            mock_get_dicts.return_value = (
                {"info": {"longName": "Apple Inc."}},
                files_dict,
                {"All Reports": "financial reports text"},
                {},
            )
            mock_deepseek_simple_text.side_effect = ["SEC-part-1", "SEC-part-2"]

            def _fake_pdf(input_txt, output_pdf, output_html=None):
                Path(output_pdf).write_bytes(b"%PDF-1.4\n")

            mock_convert_text_to_pdf.side_effect = _fake_pdf

            result = run_sec_analysis(ticker=ticker, output_dir=str(output_dir))
            self.assertEqual(result["status"], "success")
            self.assertEqual(result["ticker"], ticker)
            self.assertTrue(Path(str(result["analysis_txt"])).exists())
            self.assertTrue(Path(str(result["pdf_path"])).exists())
            self.assertEqual(result["chart_path"], "")
            self.assertEqual(mock_deepseek_simple_text.call_count, 2)

    @patch("ai_hedge.text_to_pdf_check.convert_text_to_pdf")
    @patch("ai_hedge.legacy_port.deepseek_simple_text")
    @patch("ai_hedge.legacy_port.get_dicts")
    def test_service_sec_short_success_contract(
        self,
        mock_get_dicts,
        mock_deepseek_simple_text,
        mock_convert_text_to_pdf,
    ) -> None:
        with TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "jobsecshort"
            ticker = "AAPL"

            mock_get_dicts.return_value = (
                {"info": {"longName": "Apple Inc."}},
                {"10-K": {"date": "2025-10-31", "text": "Annual filing text"}},
                {"all_reports": "financial reports text"},
                {},
            )
            mock_deepseek_simple_text.side_effect = ["short-part-1", "short-part-2"]

            def _fake_pdf(input_txt, output_pdf, output_html=None):
                Path(output_pdf).write_bytes(b"%PDF-1.4\n")

            mock_convert_text_to_pdf.side_effect = _fake_pdf

            result = run_sec_analysis_short(ticker=ticker, output_dir=str(output_dir))
            self.assertEqual(result["status"], "success")
            self.assertTrue(str(result["analysis_txt"]).endswith("_sec_short_analysis.txt"))
            self.assertTrue(Path(str(result["pdf_path"])).exists())

    @patch("ai_hedge.legacy_port.forest_logic_full")
    @patch("ai_hedge.legacy_port.bbb_ni_pe_full")
    @patch("ai_hedge.legacy_port.bbb_tp_full")
    @patch("ai_hedge.legacy_port.dream_valuation_full")
    @patch("ai_hedge.legacy_port.revenue_ps_range_full")
    @patch("ai_hedge.legacy_port.profit_pe_range_full")
    @patch("ai_hedge.legacy_port.dcf_range_full")
    def test_run_valuations_uses_single_combined_reasoner_context(
        self,
        mock_dcf,
        mock_pe,
        mock_ps,
        mock_dream,
        mock_bbb_tp,
        mock_bbb_ni_pe,
        mock_forest,
    ) -> None:
        from ai_hedge import legacy_port as legacy

        mock_dcf.return_value = ([], ("\nNo results\n\n", "DCF Range Price Valuation"))
        mock_pe.return_value = ([], [], [], ("\nNo results\n\n", "P/E & Earnings Range Price Valuation"))
        mock_ps.return_value = ([], [], [], ("\nNo results\n\n", "Revenue & EV/S Range Price Valuation"))
        mock_bbb_tp.return_value = ([], ("\nNo results\n\n", "Bull Base Bear Target Price Valuation"))
        mock_bbb_ni_pe.return_value = ([], [], [], ("\nNo results\n\n", "Bull Base Bear Net Income & P/E Valuation"))
        mock_forest.return_value = ([], [], [], [], ("\nNo results\n\n", "Forest Logic Valuation"))
        mock_dream.return_value = ([30.0], ("combined", "Dream Team Target Price Valuation"))

        info_dict = {"short_name": "Apple"}
        financial_dict = {}
        variables_dict = {
            "price_currency": 1,
            "financial_currency": 1,
            "price": 100.0,
            "revenue": 1000.0,
            "net_income": 100.0,
            "market_cap": 1_000_000.0,
        }

        out = legacy.run_valuations(
            "AAPL",
            info_dict,
            financial_dict,
            variables_dict,
            "regular analysis text",
            n=1,
            llm_workers_each_block=1,
            blocks_workers=1,
            add_text=False,
            valuation_contexts=[
                "regular analysis text",
                "sec short text",
                "regular analysis text\n\n# SEC Short Analysis Context:\nsec short text",
            ],
        )

        self.assertIn("Prices", out)
        self.assertIn("Dream Team", out["Prices"])
        self.assertEqual(mock_dream.call_count, 1)
        self.assertIn("# SEC Short Analysis Context:", mock_dream.call_args_list[0].args[1])
        self.assertEqual(mock_dcf.call_count, 1)
        self.assertIn("# SEC Short Analysis Context:", mock_dcf.call_args_list[0].args[1])
        self.assertEqual(mock_dcf.call_args_list[0].kwargs["model"], "deepseek-reasoner")
        self.assertEqual(mock_dcf.call_args_list[0].kwargs["num_iterations"], 1)

    @patch("ai_hedge.runner._require_api_key")
    @patch("ai_hedge.legacy_port.print_overall_valuations")
    @patch("ai_hedge.legacy_port.plot_all_three")
    @patch("ai_hedge.legacy_port.run_valuations")
    @patch("ai_hedge.legacy_port.append_text_to_file")
    @patch("ai_hedge.service.build_sec_short_analysis_text")
    @patch("ai_hedge.legacy_port.load_text_from_file")
    @patch("ai_hedge.legacy_port.make_analysis_file")
    def test_runner_builds_sec_short_and_passes_to_valuations(
        self,
        mock_make_analysis_file,
        mock_load_text,
        mock_build_sec_short,
        mock_append_text,
        mock_run_valuations,
        _mock_plot_all_three,
        _mock_print_overall,
        _mock_require_api_key,
    ) -> None:
        with TemporaryDirectory() as tmp:
            mock_make_analysis_file.return_value = (
                {"short_name": "Apple", "info": {}},
                {"10-K": {"text": "sec filing"}},
                {"All Reports": "reports"},
                {
                    "price_currency": 1,
                    "financial_currency": 1,
                    "price": 100.0,
                    "revenue": 1000.0,
                    "net_income": 100.0,
                    "market_cap": 1_000_000.0,
                },
            )
            mock_load_text.return_value = "regular analysis text"
            mock_build_sec_short.return_value = {
                "status": "success",
                "ticker": "AAPL",
                "text": "sec short context text",
                "errors": [],
            }
            mock_run_valuations.return_value = {
                "Prices": {"Overall": [100, 90, 110], "Current": 100},
                "Revenue": {"Overall": [1000, 900, 1100], "Current": 1000},
                "Net Income": {"Overall": [100, 90, 110], "Current": 100},
                "P/E": {"Overall": [20, 15, 25], "Current": 20},
            }

            run_ticker_valuation(
                "AAPL",
                output_root=tmp,
                save_pdf=False,
                show_plots=False,
                valuation_iterations=3,
            )

            self.assertEqual(mock_build_sec_short.call_count, 1)
            self.assertTrue(mock_append_text.called)
            self.assertIn("valuation_contexts", mock_run_valuations.call_args.kwargs)
            contexts = mock_run_valuations.call_args.kwargs["valuation_contexts"]
            self.assertEqual(len(contexts), 1)
            self.assertIn("# SEC Short Analysis Context:", contexts[0])
            self.assertEqual(mock_run_valuations.call_args.kwargs["n"], 1)

    @patch("ai_hedge.runner._require_api_key")
    @patch("ai_hedge.legacy_port.print_overall_valuations")
    @patch("ai_hedge.legacy_port.plot_all_three")
    @patch("ai_hedge.legacy_port.run_valuations")
    @patch("ai_hedge.legacy_port.append_text_to_file")
    @patch("ai_hedge.service.build_sec_short_analysis_text")
    @patch("ai_hedge.legacy_port.load_text_from_file")
    @patch("ai_hedge.legacy_port.make_analysis_file")
    def test_runner_sec_failure_fallback_notes_and_contexts(
        self,
        mock_make_analysis_file,
        mock_load_text,
        mock_build_sec_short,
        _mock_append_text,
        mock_run_valuations,
        _mock_plot_all_three,
        _mock_print_overall,
        _mock_require_api_key,
    ) -> None:
        with TemporaryDirectory() as tmp:
            mock_make_analysis_file.return_value = (
                {"short_name": "Apple", "info": {}},
                {"10-K": {"text": "sec filing"}},
                {"All Reports": "reports"},
                {
                    "price_currency": 1,
                    "financial_currency": 1,
                    "price": 100.0,
                    "revenue": 1000.0,
                    "net_income": 100.0,
                    "market_cap": 1_000_000.0,
                },
            )
            mock_load_text.return_value = "regular analysis text"
            mock_build_sec_short.return_value = {
                "status": "failed",
                "ticker": "AAPL",
                "text": "",
                "errors": ["sec parsing failed"],
            }
            mock_run_valuations.return_value = {
                "Prices": {"Overall": [100, 90, 110], "Current": 100},
                "Revenue": {"Overall": [1000, 900, 1100], "Current": 1000},
                "Net Income": {"Overall": [100, 90, 110], "Current": 100},
                "P/E": {"Overall": [20, 15, 25], "Current": 20},
            }

            out = run_ticker_valuation(
                "AAPL",
                output_root=tmp,
                save_pdf=False,
                show_plots=False,
                valuation_iterations=3,
            )

            contexts = mock_run_valuations.call_args.kwargs["valuation_contexts"]
            self.assertEqual(len(contexts), 1)
            self.assertEqual(contexts[0], "regular analysis text")
            self.assertIn("notes", out)
            self.assertTrue(any("fallback applied" in str(x).lower() for x in out["notes"]))

    @patch("ai_hedge.service._ensure_deepseek_api_key")
    @patch("ai_hedge.runner.run_ticker_valuation")
    def test_service_full_propagates_runner_notes(self, mock_run_ticker_valuation, _mock_require_key) -> None:
        with TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "jobfull"
            ticker = "AAPL"
            ticker_dir = output_dir / ticker
            ticker_dir.mkdir(parents=True, exist_ok=True)

            analysis = ticker_dir / f"{ticker}_analysis.txt"
            chart = ticker_dir / f"{ticker}_prices_valuation.png"
            pdf = ticker_dir / f"{ticker}_analysis.pdf"
            prices_explain_txt = ticker_dir / f"{ticker}_prices_explain.txt"
            prices_explain_pdf = ticker_dir / f"{ticker}_prices_explain.pdf"
            analysis.write_text("ok", encoding="utf-8")
            chart.write_text("png", encoding="utf-8")
            pdf.write_text("pdf", encoding="utf-8")
            prices_explain_txt.write_text("explain", encoding="utf-8")
            prices_explain_pdf.write_text("pdf", encoding="utf-8")

            mock_run_ticker_valuation.return_value = {
                "analysis_txt": str(analysis),
                "analysis_pdf": str(pdf),
                "prices_plot": str(chart),
                "prices_explain_txt": str(prices_explain_txt),
                "prices_explain_pdf": str(prices_explain_pdf),
                "notes": ["SEC fallback applied due to SEC parse failure"],
            }

            result = run_full_analysis(ticker=ticker, output_dir=str(output_dir))
            self.assertEqual(result["status"], "success")
            self.assertTrue(any("fallback" in str(x).lower() for x in result["errors"]))


if __name__ == "__main__":
    unittest.main()
