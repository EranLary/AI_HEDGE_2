from __future__ import annotations

import logging
from pathlib import Path
from re import compile as re_compile
from typing import Any, Dict

from telegram import LabeledPrice, ReplyKeyboardMarkup, Update
from telegram.ext import CommandHandler, ContextTypes, MessageHandler, PreCheckoutQueryHandler, filters

from .billing import BillingConfig, build_invoice_payload
from .jobs import AnalysisMode, JobRecord, JobStore
from .worker import AnalysisWorker

TICKER_REGEX = re_compile(r"^[A-Z0-9\.\-]{1,10}$")

BOT_DATA_JOB_STORE = "job_store"
BOT_DATA_WORKER = "worker"
BOT_DATA_LOGGER = "logger"
BOT_DATA_BILLING = "billing"
PROGRESS_FILE_NAME = "_progress.log"


def _valid_ticker(text: str) -> bool:
    return bool(TICKER_REGEX.fullmatch((text or "").strip().upper()))


def _normalize_mode(text: str) -> AnalysisMode | None:
    value = (text or "").strip().lower()
    if value.startswith("valuation"):
        return "valuation"
    if value.startswith("sec"):
        return "sec"
    return None


def _mode_button_label(mode: AnalysisMode, billing: BillingConfig) -> str:
    return f"{_mode_label(mode).title()} ({billing.price_for_mode(mode)} Stars)"


def _mode_keyboard(billing: BillingConfig) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [[_mode_button_label("valuation", billing), _mode_button_label("sec", billing)]],
        resize_keyboard=True,
    )


def _mode_label(mode: str) -> str:
    if mode == "valuation":
        return "VALUATION"
    if mode == "sec":
        return "SEC"
    return mode.replace("_", " ").upper()


def _fmt_money(value: Any) -> str:
    try:
        return f"${float(value):,.2f}"
    except Exception:
        return "N/A"


def _fmt_thousands(value: Any) -> str:
    try:
        if value is None:
            return "N/A"
        return _fmt_money(float(value) / 1000.0)
    except Exception:
        return "N/A"


def _f_score_for_telegram(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text.replace(": Yes", ": ✅").replace(": No", ": ❌")


def _progress_with_ticker(message: str, ticker: str) -> str:
    text = str(message or "").strip()
    tk = str(ticker or "").strip().upper()
    if not text:
        return f"Update for {tk}"
    if tk and tk in text.upper():
        return text
    return f"{text} for {tk}" if tk else text


async def _send_job_progress_updates(app, job_store: JobStore, job) -> None:
    progress_file = Path(job.output_dir) / PROGRESS_FILE_NAME
    if not progress_file.exists():
        return
    try:
        lines = [ln.strip() for ln in progress_file.read_text(encoding="utf-8").splitlines() if ln.strip()]
    except Exception:
        return
    cursor = job_store.get_progress_cursor(job.job_id)
    if cursor >= len(lines):
        return
    for msg in lines[cursor:]:
        await app.bot.send_message(chat_id=job.chat_id, text=_progress_with_ticker(msg, job.ticker))
    job_store.set_progress_cursor(job.job_id, len(lines))


async def _send_start_prompt(update: Update, job_store: JobStore, billing: BillingConfig) -> None:
    if update.message is None:
        return
    user_id = update.effective_user.id if update.effective_user else 0
    current_mode = job_store.get_user_mode(user_id)
    mode_text = _mode_label(current_mode) if current_mode else "NOT SELECTED"
    free_retries = job_store.get_free_valuation_retries(user_id)
    free_run_credits = job_store.get_free_run_credits(user_id)
    pricing_text = (
        f"Pricing: Valuation {billing.price_for_mode('valuation')} Stars, "
        f"SEC {billing.price_for_mode('sec')} Stars."
    )
    retry_text = f"Free valuation retries available: {free_retries}."
    free_mode_text = f"Password unlock credits (one-time free runs): {free_run_credits}."
    await update.message.reply_text(
        (
            f"Choose analysis mode (current: {mode_text}), then send a ticker like AAPL or NVDA.\n"
            f"{pricing_text}\n{retry_text}\n{free_mode_text}"
        ),
        reply_markup=_mode_keyboard(billing),
    )


async def _submit_created_job(
    *,
    message,
    job_store: JobStore,
    worker: AnalysisWorker,
    logger: logging.Logger,
    job: JobRecord,
    notice: str = "",
) -> None:
    if message is None:
        return
    status_lines = []
    if notice:
        status_lines.append(notice)
    status_lines.append(f"Running {_mode_label(job.mode)} analysis for {job.ticker}...")
    status_lines.append("This may take a minute.")
    status_lines.append(f"Job ID: {job.job_id}")
    await message.reply_text("\n".join(status_lines))
    try:
        job_store.set_status(job.job_id, "running")
        worker.submit(job_id=job.job_id, ticker=job.ticker, output_dir=job.output_dir, mode=job.mode)
        # Enforce explicit mode selection for each new ticker/job.
        job_store.clear_user_mode(job.user_id)
    except Exception as exc:
        logger.error("Failed to submit job id=%s error=%s", job.job_id, exc)
        job_store.set_status(job.job_id, "failed")
        job_store.set_error(job.job_id, str(exc))
        retry_text = ""
        if job.mode == "valuation":
            retries_total = job_store.grant_free_valuation_retry(job.user_id)
            retry_text = (
                f"\nYour next valuation attempt is free. "
                f"(Retry credits: {retries_total})"
            )
        await message.reply_text(f"Failed to start analysis for {job.ticker}. Please try again.{retry_text}")


async def _send_invoice_for_job(
    *,
    message,
    job_store: JobStore,
    billing: BillingConfig,
    logger: logging.Logger,
    job: JobRecord,
) -> None:
    if message is None:
        return
    amount_stars = billing.price_for_mode(job.mode)
    payload = build_invoice_payload(
        user_id=job.user_id,
        mode=job.mode,
        ticker=job.ticker,
        nonce=job.job_id,
    )
    job_store.set_pending_payment(
        payload=payload,
        job_id=job.job_id,
        user_id=job.user_id,
        chat_id=job.chat_id,
        mode=job.mode,
        ticker=job.ticker,
        amount_stars=amount_stars,
    )

    logger.info(
        "Pending payment created payload=%s job_id=%s user=%s mode=%s amount=%s",
        payload,
        job.job_id,
        job.user_id,
        job.mode,
        amount_stars,
    )
    await message.reply_invoice(
        title=f"{_mode_label(job.mode)} analysis",
        description=f"{_mode_label(job.mode)} analysis for {job.ticker}",
        payload=payload,
        currency=billing.currency,
        provider_token="",
        prices=[LabeledPrice(label=f"{_mode_label(job.mode)} report", amount=amount_stars)],
    )


async def _create_and_dispatch_job(
    *,
    update: Update,
    job_store: JobStore,
    worker: AnalysisWorker,
    billing: BillingConfig,
    logger: logging.Logger,
    ticker: str,
    mode: AnalysisMode,
) -> None:
    if update.message is None:
        return
    chat_id = update.effective_chat.id if update.effective_chat else 0
    user_id = update.effective_user.id if update.effective_user else 0
    job = job_store.create_job(user_id=user_id, chat_id=chat_id, ticker=ticker, mode=mode)
    logger.info(
        "Job created id=%s user=%s ticker=%s mode=%s output_dir=%s",
        job.job_id,
        user_id,
        ticker,
        mode,
        job.output_dir,
    )

    if job_store.consume_free_run_credit(user_id):
        credits_left = job_store.get_free_run_credits(user_id)
        await _submit_created_job(
            message=update.message,
            job_store=job_store,
            worker=worker,
            logger=logger,
            job=job,
            notice=f"Password unlock applied: this run is free. Remaining unlock credits: {credits_left}.",
        )
        return

    if mode == "valuation" and job_store.consume_free_valuation_retry(user_id):
        retries_left = job_store.get_free_valuation_retries(user_id)
        await _submit_created_job(
            message=update.message,
            job_store=job_store,
            worker=worker,
            logger=logger,
            job=job,
            notice=f"Using your free valuation retry. Remaining retry credits: {retries_left}.",
        )
        return

    await _send_invoice_for_job(
        message=update.message,
        job_store=job_store,
        billing=billing,
        logger=logger,
        job=job,
    )


async def free_access_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    job_store: JobStore = context.application.bot_data[BOT_DATA_JOB_STORE]
    billing: BillingConfig = context.application.bot_data[BOT_DATA_BILLING]
    user_id = update.effective_user.id if update.effective_user else 0

    if not billing.has_free_password():
        await update.message.reply_text("Free access password is not configured on this bot.")
        return

    if not context.args:
        await update.message.reply_text("Usage: /free <password>")
        return

    provided = " ".join(context.args).strip()
    if billing.is_valid_free_password(provided):
        credits = job_store.grant_free_run_credit(user_id, 1)
        await update.message.reply_text(
            f"Password accepted. You got 1 free run credit.\nAvailable unlock credits: {credits}."
        )
        return

    await update.message.reply_text("Invalid password.")


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    job_store: JobStore = context.application.bot_data[BOT_DATA_JOB_STORE]
    billing: BillingConfig = context.application.bot_data[BOT_DATA_BILLING]
    await _send_start_prompt(update, job_store, billing)


async def ticker_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return

    logger: logging.Logger = context.application.bot_data[BOT_DATA_LOGGER]
    job_store: JobStore = context.application.bot_data[BOT_DATA_JOB_STORE]
    worker: AnalysisWorker = context.application.bot_data[BOT_DATA_WORKER]
    billing: BillingConfig = context.application.bot_data[BOT_DATA_BILLING]

    raw_text = (update.message.text or "").strip()
    text = raw_text.upper()
    user_id = update.effective_user.id if update.effective_user else 0
    logger.info("Incoming message user=%s text=%s", update.effective_user.id if update.effective_user else None, text)

    if text == "START":
        await _send_start_prompt(update, job_store, billing)
        return

    if billing.has_free_password() and raw_text == billing.free_password:
        credits = job_store.grant_free_run_credit(user_id, 1)
        await update.message.reply_text(
            f"Password accepted. You got 1 free run credit.\nAvailable unlock credits: {credits}."
        )
        return

    requested_mode = _normalize_mode(text)
    if requested_mode is not None:
        job_store.set_user_mode(user_id, requested_mode)
        pending_ticker = job_store.pop_pending_ticker(user_id)
        if pending_ticker:
            await update.message.reply_text(
                f"Mode set to {_mode_label(requested_mode)}. Running {pending_ticker} now.",
                reply_markup=_mode_keyboard(billing),
            )
            await _create_and_dispatch_job(
                update=update,
                job_store=job_store,
                worker=worker,
                billing=billing,
                logger=logger,
                ticker=pending_ticker,
                mode=requested_mode,
            )
        else:
            await update.message.reply_text(
                f"Mode set to {_mode_label(requested_mode)}. Now send a ticker symbol.",
                reply_markup=_mode_keyboard(billing),
            )
        return

    if not _valid_ticker(text):
        await update.message.reply_text(
            "Invalid ticker format.\nPlease send a valid ticker like AAPL or NVDA."
        )
        return

    mode = job_store.get_user_mode(user_id)
    if mode is None:
        job_store.set_pending_ticker(user_id, text)
        valuation_label = _mode_button_label("valuation", billing)
        sec_label = _mode_button_label("sec", billing)
        await update.message.reply_text(
            (
                f"Select mode first: {valuation_label} or {sec_label}.\n"
                "I saved your ticker and will run it right after you choose."
            ),
            reply_markup=_mode_keyboard(billing),
        )
        return

    await _create_and_dispatch_job(
        update=update,
        job_store=job_store,
        worker=worker,
        billing=billing,
        logger=logger,
        ticker=text,
        mode=mode,
    )


async def pre_checkout_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.pre_checkout_query
    if query is None:
        return
    job_store: JobStore = context.application.bot_data[BOT_DATA_JOB_STORE]
    billing: BillingConfig = context.application.bot_data[BOT_DATA_BILLING]

    pending = job_store.get_pending_payment(query.invoice_payload)
    if pending is None:
        await query.answer(ok=False, error_message="Unknown or expired payment request.")
        return
    if int(query.from_user.id) != int(pending.user_id):
        await query.answer(ok=False, error_message="Payment user does not match request.")
        return
    if (query.currency or "").strip().upper() != billing.currency.upper():
        await query.answer(ok=False, error_message="Unsupported currency for this invoice.")
        return
    if int(query.total_amount) != int(pending.amount_stars):
        await query.answer(ok=False, error_message="Unexpected payment amount.")
        return

    await query.answer(ok=True)


async def successful_payment_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.message
    if message is None or message.successful_payment is None:
        return

    logger: logging.Logger = context.application.bot_data[BOT_DATA_LOGGER]
    job_store: JobStore = context.application.bot_data[BOT_DATA_JOB_STORE]
    worker: AnalysisWorker = context.application.bot_data[BOT_DATA_WORKER]
    payment = message.successful_payment

    pending = job_store.pop_pending_payment(payment.invoice_payload)
    if pending is None:
        await message.reply_text("Payment received, but I could not match it to a pending job.")
        return

    job = job_store.get(pending.job_id)
    if job is None:
        await message.reply_text("Payment received, but the job was not found. Please contact support.")
        return
    if int(job.user_id) != int(pending.user_id):
        await message.reply_text("Payment user mismatch. Please contact support.")
        return
    if int(payment.total_amount) != int(pending.amount_stars):
        await message.reply_text("Payment amount mismatch. Please contact support.")
        return

    logger.info(
        "Payment confirmed user=%s job_id=%s mode=%s amount=%s",
        pending.user_id,
        pending.job_id,
        pending.mode,
        pending.amount_stars,
    )
    await _submit_created_job(
        message=message,
        job_store=job_store,
        worker=worker,
        logger=logger,
        job=job,
        notice=f"Payment received: {pending.amount_stars} Stars.",
    )


async def poll_worker_handler(context: ContextTypes.DEFAULT_TYPE) -> None:
    app = context.application
    logger: logging.Logger = app.bot_data[BOT_DATA_LOGGER]
    job_store: JobStore = app.bot_data[BOT_DATA_JOB_STORE]
    worker: AnalysisWorker = app.bot_data[BOT_DATA_WORKER]

    for running_job in job_store.list_running_jobs():
        await _send_job_progress_updates(app, job_store, running_job)

    for job_id, result, error in worker.poll_completed():
        job = job_store.get(job_id)
        if job is None:
            continue

        await _send_job_progress_updates(app, job_store, job)

        if error is not None:
            job_store.set_status(job_id, "failed")
            job_store.set_error(job_id, str(error))
            logger.error("Job failed id=%s ticker=%s error=%s", job_id, job.ticker, error)
            retry_text = ""
            if job.mode == "valuation":
                retries_total = job_store.grant_free_valuation_retry(job.user_id)
                retry_text = (
                    f"\nYour next valuation attempt is free. "
                    f"(Retry credits: {retries_total})"
                )
            await app.bot.send_message(
                chat_id=job.chat_id,
                text=f"Analysis failed for {job.ticker}.\nPlease try again later.{retry_text}",
            )
            continue

        payload: Dict[str, Any] = result or {}
        status = str(payload.get("status", "failed"))
        errors = payload.get("errors", [])
        if status in {"success", "partial_success"}:
            job_store.set_status(job_id, "completed")
            job_store.set_result(job_id, payload)
        else:
            job_store.set_status(job_id, "failed")
            job_store.set_result(job_id, payload)

        logger.info("Job completed id=%s ticker=%s mode=%s status=%s", job_id, job.ticker, job.mode, status)
        await _send_completion(app, job.chat_id, job.ticker, job.mode, payload, errors)
        if status not in {"success", "partial_success"} and job.mode == "valuation":
            retries_total = job_store.grant_free_valuation_retry(job.user_id)
            await app.bot.send_message(
                chat_id=job.chat_id,
                text=(
                    "Your next valuation attempt is free because this valuation failed.\n"
                    f"Retry credits: {retries_total}."
                ),
            )


async def _send_completion(
    app,
    chat_id: int,
    ticker: str,
    mode: str,
    payload: Dict[str, Any],
    errors: Any,
) -> None:
    status = str(payload.get("status", "failed"))
    chart_path = str(payload.get("chart_path", ""))
    pdf_path = str(payload.get("pdf_path", ""))
    prices_explain_pdf_path = str(payload.get("prices_explain_pdf", ""))

    if status == "success":
        await app.bot.send_message(chat_id=chat_id, text=f"{_mode_label(mode)} analysis complete for {ticker}.")
    elif status == "partial_success":
        await app.bot.send_message(
            chat_id=chat_id,
            text=f"{_mode_label(mode)} analysis completed with partial output for {ticker}.",
        )
    else:
        await app.bot.send_message(
            chat_id=chat_id,
            text=f"{_mode_label(mode)} analysis failed for {ticker}.",
        )

    current_revenue = payload.get("current_revenue")
    target_revenue = payload.get("target_revenue")
    current_earnings = payload.get("current_earnings")
    target_earnings = payload.get("target_earnings")
    f_score_text = _f_score_for_telegram(payload.get("f_score_text", ""))
    sec_fallback_used = bool(payload.get("sec_fallback_used", False))
    sec_fallback_message = str(payload.get("sec_fallback_message", "") or "").strip()

    if sec_fallback_used:
        await app.bot.send_message(
            chat_id=chat_id,
            text=sec_fallback_message or "SEC download failed, continuing without SEC context.",
        )

    if current_revenue is not None or target_revenue is not None:
        await app.bot.send_message(
            chat_id=chat_id,
            text=(
                f"Current Revenue in Thousands: {_fmt_thousands(current_revenue)}\n"
                f"Target Revenue in Thousands: {_fmt_thousands(target_revenue)}"
            ),
        )

    if current_earnings is not None or target_earnings is not None:
        await app.bot.send_message(
            chat_id=chat_id,
            text=(
                f"Current Earnings in Thousands: {_fmt_thousands(current_earnings)}\n"
                f"Target Earnings in Thousands: {_fmt_thousands(target_earnings)}"
            ),
        )

    if mode == "valuation" and f_score_text:
        await app.bot.send_message(chat_id=chat_id, text=f"Piotroski F-Score:\n{f_score_text}")

    chart_file = Path(chart_path) if chart_path else None
    if chart_file and chart_file.exists():
        with chart_file.open("rb") as fh:
            await app.bot.send_photo(chat_id=chat_id, photo=fh)

    if mode == "valuation":
        pdf_file = Path(pdf_path) if pdf_path else None
        if pdf_file and pdf_file.exists():
            with pdf_file.open("rb") as fh:
                await app.bot.send_document(chat_id=chat_id, document=fh)

        prices_explain_pdf_file = Path(prices_explain_pdf_path) if prices_explain_pdf_path else None
        if prices_explain_pdf_file and prices_explain_pdf_file.exists():
            with prices_explain_pdf_file.open("rb") as fh:
                await app.bot.send_document(chat_id=chat_id, document=fh)
    else:
        pdf_file = Path(pdf_path) if pdf_path else None
        if pdf_file and pdf_file.exists():
            with pdf_file.open("rb") as fh:
                await app.bot.send_document(chat_id=chat_id, document=fh)

    if errors:
        joined = "\n".join(str(e) for e in errors[:3])
        await app.bot.send_message(chat_id=chat_id, text=f"Notes:\n{joined}")


def register_handlers(app) -> None:
    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(CommandHandler("free", free_access_handler))
    app.add_handler(PreCheckoutQueryHandler(pre_checkout_handler))
    app.add_handler(MessageHandler(filters.SUCCESSFUL_PAYMENT, successful_payment_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, ticker_handler))
