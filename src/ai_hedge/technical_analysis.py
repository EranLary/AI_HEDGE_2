from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import yfinance as yf


def _safe_json_dict(text: str) -> Dict[str, Any]:
    src = str(text or "").strip()
    if not src:
        return {}
    src = re.sub(r"```(?:json)?", "", src, flags=re.IGNORECASE).strip()
    if src.startswith("{") and src.endswith("}"):
        try:
            parsed = json.loads(src)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    match = re.search(r"\{.*\}", src, re.DOTALL)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return {}
    return {}


def _clean_value(value: Any) -> Any:
    if pd.isna(value):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    return value


def _ensure_ohlcv_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if isinstance(out.columns, pd.MultiIndex):
        out.columns = out.columns.get_level_values(0)
    if "Close" not in out.columns and "Adj Close" in out.columns:
        out["Close"] = out["Adj Close"]
    if "High" not in out.columns and "Close" in out.columns:
        out["High"] = out["Close"]
    if "Low" not in out.columns and "Close" in out.columns:
        out["Low"] = out["Close"]
    if "Volume" not in out.columns:
        out["Volume"] = 0.0
    return out


def add_indicators(df: pd.DataFrame, include_sma150: bool = True) -> pd.DataFrame:
    out = _ensure_ohlcv_columns(df).copy()
    if "Close" not in out.columns:
        return out
    out = out.dropna(subset=["Close"])
    if out.empty:
        return out

    close = out["Close"]
    high = out["High"]
    low = out["Low"]
    volume = out["Volume"]

    out["RET"] = close.pct_change()
    out["LOG_RET"] = np.log(close / close.shift(1))
    out["SMA20"] = close.rolling(20).mean()
    out["SMA50"] = close.rolling(50).mean()
    if include_sma150:
        out["SMA150"] = close.rolling(150).mean()

    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / 14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / 14, adjust=False).mean()
    rs = avg_gain / avg_loss
    out["RSI14"] = 100 - (100 / (1 + rs))

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    out["MACD"] = ema12 - ema26
    out["MACD_SIGNAL"] = out["MACD"].ewm(span=9, adjust=False).mean()
    out["MACD_HIST"] = out["MACD"] - out["MACD_SIGNAL"]

    direction = np.sign(close.diff()).fillna(0)
    out["OBV"] = (direction * volume).cumsum()

    range_span = (high - low).replace(0, np.nan)
    money_flow_multiplier = ((close - low) - (high - close)) / range_span
    money_flow_multiplier = money_flow_multiplier.replace([np.inf, -np.inf], np.nan).fillna(0)
    money_flow_volume = money_flow_multiplier * volume
    out["CMF20"] = money_flow_volume.rolling(20).sum() / volume.rolling(20).sum()

    return out


def _download_data(ticker: str) -> Dict[str, pd.DataFrame]:
    end = datetime.now(timezone.utc)
    start_365 = end - timedelta(days=365)

    daily_365 = yf.download(
        ticker,
        start=start_365.date(),
        end=end.date(),
        interval="1d",
        auto_adjust=False,
        progress=False,
    )
    weekly_all = yf.download(
        ticker,
        period="max",
        interval="1wk",
        auto_adjust=False,
        progress=False,
    )
    daily_2mo = yf.download(
        ticker,
        period="2mo",
        interval="1d",
        auto_adjust=False,
        progress=False,
    )

    return {
        "DAILY_365": add_indicators(daily_365, include_sma150=True),
        "WEEKLY_ALL": add_indicators(weekly_all, include_sma150=False),
        "DAILY_2MO": add_indicators(daily_2mo, include_sma150=True),
    }


def _df_to_records(df: pd.DataFrame, tail_rows: int) -> List[Dict[str, Any]]:
    if df.empty:
        return []
    tmp = df.tail(tail_rows).copy().reset_index()
    records: List[Dict[str, Any]] = []
    for row in tmp.to_dict(orient="records"):
        records.append({k: _clean_value(v) for k, v in row.items()})
    return records


def _support_resistance_candidates(df: pd.DataFrame, window: int = 5, max_levels: int = 8) -> Dict[str, Any]:
    temp = df.copy().dropna(subset=["High", "Low", "Close"])
    if temp.empty:
        return {"support_candidates": [], "resistance_candidates": []}

    swing_highs = temp[temp["High"] == temp["High"].rolling(window * 2 + 1, center=True).max()]
    swing_lows = temp[temp["Low"] == temp["Low"].rolling(window * 2 + 1, center=True).min()]

    resistance_levels = (
        swing_highs[["High"]].tail(max_levels).reset_index().rename(columns={"High": "price"})
    )
    support_levels = (
        swing_lows[["Low"]].tail(max_levels).reset_index().rename(columns={"Low": "price"})
    )

    return {
        "support_candidates": [
            {k: _clean_value(v) for k, v in row.items()} for row in support_levels.to_dict(orient="records")
        ],
        "resistance_candidates": [
            {k: _clean_value(v) for k, v in row.items()} for row in resistance_levels.to_dict(orient="records")
        ],
    }


def _prepare_for_llm(df: pd.DataFrame, name: str, tail_rows: int = 60) -> Dict[str, Any]:
    temp = df.copy().dropna(subset=["Close"]) if "Close" in df.columns else pd.DataFrame()
    if temp.empty:
        return {
            "summary": {
                "dataset": name,
                "start_date": None,
                "end_date": None,
                "rows": 0,
            },
            "support_resistance_candidates": {"support_candidates": [], "resistance_candidates": []},
            "top_5_positive_returns": [],
            "top_5_negative_returns": [],
            "top_5_volume_spikes": [],
            "recent_rows": [],
        }

    latest = temp.iloc[-1]
    sma150_value = latest["SMA150"] if "SMA150" in temp.columns else None
    avg_volume = temp["Volume"].mean() if "Volume" in temp.columns else np.nan

    summary = {
        "dataset": name,
        "start_date": str(temp.index.min().date()),
        "end_date": str(temp.index.max().date()),
        "rows": int(len(temp)),
        "latest_close": _clean_value(latest.get("Close")),
        "latest_return": _clean_value(latest.get("RET")),
        "latest_rsi14": _clean_value(latest.get("RSI14")),
        "latest_macd": _clean_value(latest.get("MACD")),
        "latest_macd_signal": _clean_value(latest.get("MACD_SIGNAL")),
        "latest_macd_hist": _clean_value(latest.get("MACD_HIST")),
        "latest_obv": _clean_value(latest.get("OBV")),
        "latest_cmf20": _clean_value(latest.get("CMF20")),
        "close_vs_sma20_pct": _clean_value((latest["Close"] / latest["SMA20"] - 1) * 100) if pd.notna(latest.get("SMA20")) else None,
        "close_vs_sma50_pct": _clean_value((latest["Close"] / latest["SMA50"] - 1) * 100) if pd.notna(latest.get("SMA50")) else None,
        "close_vs_sma150_pct": _clean_value((latest["Close"] / sma150_value - 1) * 100)
        if sma150_value is not None and pd.notna(sma150_value)
        else None,
        "period_return_pct": _clean_value((temp["Close"].iloc[-1] / temp["Close"].iloc[0] - 1) * 100),
        "max_close": _clean_value(temp["Close"].max()),
        "min_close": _clean_value(temp["Close"].min()),
        "avg_volume": _clean_value(avg_volume),
        "latest_volume": _clean_value(latest.get("Volume")),
        "latest_volume_vs_avg_pct": _clean_value((latest["Volume"] / avg_volume - 1) * 100) if pd.notna(avg_volume) and avg_volume else None,
    }

    top_positive_returns = temp["RET"].dropna().nlargest(5).reset_index().to_dict(orient="records") if "RET" in temp.columns else []
    top_negative_returns = temp["RET"].dropna().nsmallest(5).reset_index().to_dict(orient="records") if "RET" in temp.columns else []
    volume_spikes = (
        temp.assign(VOLUME_VS_AVG=temp["Volume"] / temp["Volume"].rolling(20).mean())
        .dropna(subset=["VOLUME_VS_AVG"])
        .nlargest(5, "VOLUME_VS_AVG")
        .reset_index()
        .to_dict(orient="records")
    )

    return {
        "summary": summary,
        "support_resistance_candidates": _support_resistance_candidates(temp),
        "top_5_positive_returns": [{k: _clean_value(v) for k, v in row.items()} for row in top_positive_returns],
        "top_5_negative_returns": [{k: _clean_value(v) for k, v in row.items()} for row in top_negative_returns],
        "top_5_volume_spikes": [{k: _clean_value(v) for k, v in row.items()} for row in volume_spikes],
        "recent_rows": _df_to_records(temp, tail_rows),
    }


def build_llm_payload(ticker: str, data: Dict[str, pd.DataFrame]) -> Dict[str, Any]:
    return {
        "ticker": ticker.upper(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "datasets": {
            "DAILY_365": _prepare_for_llm(data.get("DAILY_365", pd.DataFrame()), "DAILY_365", tail_rows=80),
            "WEEKLY_ALL": _prepare_for_llm(data.get("WEEKLY_ALL", pd.DataFrame()), "WEEKLY_ALL", tail_rows=100),
            "DAILY_2MO": _prepare_for_llm(data.get("DAILY_2MO", pd.DataFrame()), "DAILY_2MO", tail_rows=45),
        },
    }


def build_system_prompt() -> str:
    return """
You are a technical market analyst.

Return ONLY valid JSON.
Do not use markdown.
Do not add text outside the JSON.

Important:
- This is not financial advice.
- Do not make unsupported predictions.
- Any target prices must be technical levels derived from the provided data.
- Use only the provided data.
- If a level is uncertain, mark confidence as "low".
- Separate observations from conclusions.
- Compare weekly, daily 365-day, and recent daily 2-month datasets.
- Highlight agreement and disagreement between timeframes.

Additional requirements:
- Estimate bullish and bearish probabilities based on the strength of signals.
- Probabilities must sum to 1.0 (or 100%).
- Base probabilities on trend, momentum, volume, and multi-timeframe alignment.
- Do not guess randomly — justify internally from the data.
- If probabilities are close (difference < 0.1), set final_decision to "neutral".

Return this exact JSON structure:

{
  "ticker": "string",
  "analysis_date": "YYYY-MM-DD",
  "step_by_step_analysis": [
    {
      "step": 1,
      "title": "Long-term weekly context",
      "bullets": ["string"]
    },
    {
      "step": 2,
      "title": "Medium-term daily context",
      "bullets": ["string"]
    },
    {
      "step": 3,
      "title": "Short-term setup",
      "bullets": ["string"]
    },
    {
      "step": 4,
      "title": "Cross-timeframe conclusion",
      "bullets": ["string"]
    }
  ],
  "key_points": ["string"],
  "bullish_points": ["string"],
  "bearish_points": ["string"],
  "contradictions_or_divergences": ["string"],
  "volume_insights": ["string"],
  "momentum_insights": ["string"],
  "risk_signals": ["string"],
  "target_price_levels": {
    "support_levels": [
      {
        "price": 0,
        "reason": "string",
        "confidence": "low"
      }
    ],
    "resistance_levels": [
      {
        "price": 0,
        "reason": "string",
        "confidence": "low"
      }
    ],
    "bullish_targets": [
      {
        "price": 0,
        "reason": "string",
        "timeframe": "short",
        "confidence": "low"
      }
    ],
    "bearish_targets": [
      {
        "price": 0,
        "reason": "string",
        "timeframe": "short",
        "confidence": "low"
      }
    ]
  },
  "scenario_analysis": {
    "bullish_case": {
      "summary": "string",
      "conditions": ["string"],
      "target_zone": {
        "low": 0,
        "high": 0
      }
    },
    "base_case": {
      "summary": "string",
      "conditions": ["string"],
      "target_zone": {
        "low": 0,
        "high": 0
      }
    },
    "bearish_case": {
      "summary": "string",
      "conditions": ["string"],
      "target_zone": {
        "low": 0,
        "high": 0
      }
    }
  },
  "what_to_watch_next": ["string"],
  "confidence_score": 0,
  "bullish_probability": 0.0,
  "bearish_probability": 0.0,
  "final_decision": "bullish | bearish | neutral",
  "confidence_explanation": "string explaining why these probabilities were chosen based on the data"
}
""".strip()


def _as_list_text(value: Any, limit: int = 12) -> List[str]:
    if not isinstance(value, list):
        return []
    out: List[str] = []
    for item in value[:limit]:
        txt = str(item or "").strip()
        if txt:
            out.append(txt)
    return out


def technical_analysis_to_markdown(analysis: Dict[str, Any]) -> str:
    if not isinstance(analysis, dict) or not analysis:
        return "## Technical Analysis\n\nTechnical analysis data is not available for this run.\n"

    lines: List[str] = ["## Technical Analysis"]
    date_txt = str(analysis.get("analysis_date") or "").strip()
    confidence = analysis.get("confidence_score")
    bullish_probability = analysis.get("bullish_probability")
    bearish_probability = analysis.get("bearish_probability")
    final_decision = str(analysis.get("final_decision") or "").strip()
    confidence_explanation = str(analysis.get("confidence_explanation") or "").strip()
    if date_txt:
        lines.append(f"- Analysis Date: {date_txt}")
    if isinstance(confidence, (int, float)):
        lines.append(f"- Confidence Score: {float(confidence):.2f}")
    if isinstance(bullish_probability, (int, float)):
        lines.append(f"- Bullish Probability: {float(bullish_probability):.2%}")
    if isinstance(bearish_probability, (int, float)):
        lines.append(f"- Bearish Probability: {float(bearish_probability):.2%}")
    if final_decision:
        lines.append(f"- Final Decision: {final_decision.title()}")
    lines.append("")

    if confidence_explanation:
        lines.append("### Probability Decision")
        lines.append(confidence_explanation)
        lines.append("")

    steps = analysis.get("step_by_step_analysis")
    if isinstance(steps, list) and steps:
        lines.append("### Step-by-Step")
        for step_item in steps:
            if not isinstance(step_item, dict):
                continue
            title = str(step_item.get("title") or "").strip() or "Step"
            step_no = step_item.get("step")
            prefix = f"{step_no}. " if isinstance(step_no, (int, float)) else ""
            lines.append(f"#### {prefix}{title}")
            for bullet in _as_list_text(step_item.get("bullets"), limit=10):
                lines.append(f"- {bullet}")
            lines.append("")

    list_sections = [
        ("Key Points", "key_points"),
        ("Bullish Points", "bullish_points"),
        ("Bearish Points", "bearish_points"),
        ("Contradictions or Divergences", "contradictions_or_divergences"),
        ("Volume Insights", "volume_insights"),
        ("Momentum Insights", "momentum_insights"),
        ("Risk Signals", "risk_signals"),
        ("What to Watch Next", "what_to_watch_next"),
    ]
    for title, key in list_sections:
        items = _as_list_text(analysis.get(key), limit=10)
        if not items:
            continue
        lines.append(f"### {title}")
        for item in items:
            lines.append(f"- {item}")
        lines.append("")

    targets = analysis.get("target_price_levels")
    if isinstance(targets, dict):
        lines.append("### Target Price Levels")
        for block_title, key in [
            ("Support Levels", "support_levels"),
            ("Resistance Levels", "resistance_levels"),
            ("Bullish Targets", "bullish_targets"),
            ("Bearish Targets", "bearish_targets"),
        ]:
            rows = targets.get(key)
            if not isinstance(rows, list) or not rows:
                continue
            lines.append(f"#### {block_title}")
            for row in rows[:8]:
                if not isinstance(row, dict):
                    continue
                price = row.get("price")
                reason = str(row.get("reason") or "").strip()
                confidence_txt = str(row.get("confidence") or "").strip()
                timeframe_txt = str(row.get("timeframe") or "").strip()
                bits: List[str] = []
                if isinstance(price, (int, float)):
                    bits.append(f"Price: {float(price):,.2f}")
                if timeframe_txt:
                    bits.append(f"Timeframe: {timeframe_txt}")
                if confidence_txt:
                    bits.append(f"Confidence: {confidence_txt}")
                if reason:
                    bits.append(f"Reason: {reason}")
                if bits:
                    lines.append(f"- {' | '.join(bits)}")
            lines.append("")

    scenarios = analysis.get("scenario_analysis")
    if isinstance(scenarios, dict):
        lines.append("### Scenario Analysis")
        for case_name in ["bullish_case", "base_case", "bearish_case"]:
            payload = scenarios.get(case_name)
            if not isinstance(payload, dict):
                continue
            title = case_name.replace("_", " ").title()
            lines.append(f"#### {title}")
            summary = str(payload.get("summary") or "").strip()
            if summary:
                lines.append(f"- Summary: {summary}")
            target_zone = payload.get("target_zone")
            if isinstance(target_zone, dict):
                low = target_zone.get("low")
                high = target_zone.get("high")
                if isinstance(low, (int, float)) and isinstance(high, (int, float)):
                    lines.append(f"- Target Zone: {float(low):,.2f} to {float(high):,.2f}")
            for cond in _as_list_text(payload.get("conditions"), limit=8):
                lines.append(f"- Condition: {cond}")
            lines.append("")

    return "\n".join(lines).strip() + "\n"


def _coerce_probability(value: Any) -> Optional[float]:
    try:
        num = float(value)
    except Exception:
        return None
    if not np.isfinite(num):
        return None
    if num < 0:
        num = 0.0
    if num > 1:
        num = num / 100.0
    return max(0.0, min(1.0, float(num)))


def _normalize_probability_fields(analysis: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(analysis, dict):
        return {}
    normalized = dict(analysis)
    bullish = _coerce_probability(analysis.get("bullish_probability"))
    bearish = _coerce_probability(analysis.get("bearish_probability"))

    if bullish is None and bearish is None:
        bullish = 0.5
        bearish = 0.5
    elif bullish is None and bearish is not None:
        bullish = max(0.0, min(1.0, 1.0 - bearish))
    elif bearish is None and bullish is not None:
        bearish = max(0.0, min(1.0, 1.0 - bullish))

    if bullish is None:
        bullish = 0.5
    if bearish is None:
        bearish = 0.5

    total = bullish + bearish
    if total <= 1e-9:
        bullish = 0.5
        bearish = 0.5
    else:
        bullish = bullish / total
        bearish = bearish / total

    decision_raw = str(analysis.get("final_decision") or "").strip().lower()
    if abs(bullish - bearish) < 0.1:
        decision_raw = "neutral"
    elif decision_raw not in {"bullish", "bearish", "neutral"}:
        decision_raw = "bullish" if bullish > bearish else "bearish"

    if not str(analysis.get("confidence_explanation") or "").strip():
        normalized["confidence_explanation"] = (
            "Probabilities reflect trend strength, momentum condition, volume confirmation, "
            "and alignment across weekly and daily timeframes."
        )

    normalized["bullish_probability"] = round(float(bullish), 4)
    normalized["bearish_probability"] = round(float(bearish), 4)
    normalized["final_decision"] = decision_raw
    return normalized


def run_full_analysis(
    ticker: str,
    *,
    api_key: str,
    model: str = "deepseek-chat",
    temperature: float = 0.1,
) -> Dict[str, Any]:
    if not api_key:
        raise RuntimeError("Missing DEEPSEEK_API_KEY for technical analysis.")

    data = _download_data(ticker)
    payload = build_llm_payload(ticker, data)

    from . import legacy_port as legacy

    prompt = (
        f"{build_system_prompt()}\n\n"
        "Technical dataset payload (JSON):\n"
        f"{json.dumps(payload, ensure_ascii=False)}"
    )
    raw_response = legacy.deepseek_simple_text(
        api_key=api_key,
        prompt=prompt,
        model=model,
        temperature=temperature,
        short_answer=False,
    )
    analysis = _safe_json_dict(raw_response)
    if not analysis:
        raise RuntimeError("Technical analysis model response was not valid JSON.")
    analysis = _normalize_probability_fields(analysis)
    analysis["ticker"] = str(analysis.get("ticker") or ticker).upper()
    if not analysis.get("analysis_date"):
        analysis["analysis_date"] = datetime.now(timezone.utc).date().isoformat()
    return {
        "ticker": ticker.upper(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model": model,
        "temperature": float(temperature),
        "llm_payload": payload,
        "analysis": analysis,
        "raw_response": raw_response,
    }
