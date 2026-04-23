from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from telegram.ext import ApplicationBuilder


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except Exception:
        return default


def _configure_logging(logs_dir: Path) -> logging.Logger:
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = logs_dir / "bot.log"

    logger = logging.getLogger("ai_hedge_bot")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] %(message)s"
    )

    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)

    return logger


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

    from bot.handlers import (
        BOT_DATA_BILLING,
        BOT_DATA_JOB_STORE,
        BOT_DATA_LOGGER,
        BOT_DATA_WORKER,
        poll_worker_handler,
        register_handlers,
    )
    from bot.billing import BillingConfig
    from bot.jobs import JobStore
    from bot.worker import AnalysisWorker

    load_dotenv(root / ".env")

    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise RuntimeError("Missing TELEGRAM_BOT_TOKEN in environment/.env")

    logger = _configure_logging(root / "logs")
    outputs_root = root / "outputs"
    outputs_root.mkdir(parents=True, exist_ok=True)

    max_workers = _env_int("BOT_MAX_WORKERS", 2)
    worker = AnalysisWorker(max_workers=max_workers)
    job_store = JobStore(output_root=str(outputs_root))
    billing = BillingConfig.from_env()

    app = ApplicationBuilder().token(token).build()
    app.bot_data[BOT_DATA_LOGGER] = logger
    app.bot_data[BOT_DATA_WORKER] = worker
    app.bot_data[BOT_DATA_JOB_STORE] = job_store
    app.bot_data[BOT_DATA_BILLING] = billing

    register_handlers(app)
    if app.job_queue is None:
        raise RuntimeError(
            "python-telegram-bot JobQueue is unavailable. "
            'Install with: pip install "python-telegram-bot[job-queue]>=21.0"'
        )
    app.job_queue.run_repeating(poll_worker_handler, interval=2.0, first=1.0)

    logger.info(
        "Starting Telegram bot with max_workers=%s valuation_price=%s sec_price=%s currency=%s",
        max_workers,
        billing.valuation_price_stars,
        billing.sec_price_stars,
        billing.currency,
    )
    try:
        app.run_polling(drop_pending_updates=True)
    finally:
        worker.shutdown()
        logger.info("Bot stopped")


if __name__ == "__main__":
    main()
