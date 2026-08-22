from __future__ import annotations

import argparse
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from . import __version__
from .control_client import ControlClient, ControlPlaneError
from .dpapi_store import ConfigStore
from .engine import ExecutionCancelledError, ExecutionEngine
from .instance_lock import SingleInstanceLock
from .journal import LocalJournal
from .reporter import ControlReporter


DEFAULT_CONFIG = Path(os.environ.get("LOCALAPPDATA", ".")) / "HedgeInABox" / "ibkr-executor.dpapi"
DEFAULT_STATE_DIR = Path(os.environ.get("LOCALAPPDATA", ".")) / "HedgeInABox"
DEFAULT_LOCK = Path(os.environ.get("LOCALAPPDATA", ".")) / "HedgeInABox" / "ibkr-executor.lock"


def pair(args: argparse.Namespace) -> int:
    account_id = args.account.strip().upper()
    if not account_id or args.mode != "paper":
        raise SystemExit("Only a non-empty IBKR Paper account may be paired in v1.")
    client = ControlClient(args.site)
    response = client.pair(code=args.code, account_id=account_id, executor_version=__version__)
    ConfigStore(args.config).save({
        "site": args.site.rstrip("/"),
        "connection_id": response["connection_id"],
        "device_secret": response["device_secret"],
        "account_id": account_id,
        "mode": "paper",
        "executor_instance_id": str(uuid4()),
    })
    print(f"Paired {response['account_masked']} in Paper mode. Secret saved with Windows DPAPI at {args.config}.")
    return 0


def run(args: argparse.Namespace) -> int:
    store = ConfigStore(args.config)
    config = store.load()
    if not config.get("executor_instance_id"):
        config["executor_instance_id"] = str(uuid4())
        store.save(config)
    if config.get("mode") != "paper":
        raise SystemExit("This executor build refuses Live connections.")
    if args.host not in {"127.0.0.1", "localhost"}:
        raise SystemExit("IB Gateway host must be localhost; never expose the socket to a network.")
    if args.port != 4002:
        raise SystemExit("Paper mode requires IB Gateway port 4002.")
    from .ib_gateway import IbGateway

    instance_lock = SingleInstanceLock(args.lock)
    instance_lock.__enter__()
    journal_path = args.journal or DEFAULT_STATE_DIR / f"ibkr-executor-{config['connection_id']}.sqlite3"
    journal = LocalJournal(journal_path)
    client = ControlClient(config["site"], config["connection_id"], config["device_secret"])
    reporter = ControlReporter(client, journal)
    lease_payload = {
        "account_id": config["account_id"], "mode": "paper",
        "executor_version": __version__, "gateway_connected": False,
        "gateway_authenticated": False, "account_type": "UNKNOWN",
        "error": "", "executor_instance_id": config["executor_instance_id"],
        "lease_only": True,
    }
    try:
        client.sync(lease_payload)
    except ControlPlaneError as error:
        journal.close()
        instance_lock.__exit__(None, None, None)
        raise SystemExit(f"Could not acquire the server executor lease before connecting to IB Gateway: {error}") from error

    def submission_guard(plan_id: str) -> None:
        response = client.sync(lease_payload)
        cancelled = {str(value) for value in response.get("cancel_requested_plan_ids", [])}
        if plan_id in cancelled:
            raise ExecutionCancelledError("remote kill switch requested cancellation")

    gateway = IbGateway(
        host=args.host, port=args.port, client_id=args.client_id,
        expected_account=config["account_id"], journal=journal,
        submission_guard=submission_guard,
    )
    engine = ExecutionEngine(
        gateway, reporter, account_id=config["account_id"],
        execution_enabled=os.environ.get("IBKR_EXECUTION_ENABLED", "").lower() in {"1", "true", "yes", "on"},
    )
    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        while not stopping:
            gateway_ready = False
            gateway_error = ""
            try:
                gateway.connect_and_start()
                snapshot = gateway.reconcile()
                reporter.recover(snapshot)
                gateway_ready = True
            except Exception as error:
                gateway_error = str(error)
                gateway.close()
            try:
                reporter.flush()
                response = client.sync({
                    "account_id": config["account_id"], "mode": "paper",
                    "executor_version": __version__, "gateway_connected": gateway_ready,
                    "gateway_authenticated": gateway_ready,
                    "account_type": snapshot.account_type if gateway_ready else "UNKNOWN",
                    "error": gateway_error,
                    "executor_instance_id": config["executor_instance_id"],
                })
                if gateway_ready:
                    for command in response.get("commands", []):
                        engine.handle(command, now=datetime.now(timezone.utc))
            except ControlPlaneError as error:
                print(f"[{datetime.now(timezone.utc).isoformat()}] {error}", file=sys.stderr)
            deadline = time.monotonic() + args.poll_seconds
            while not stopping and time.monotonic() < deadline:
                time.sleep(min(1, max(0, deadline - time.monotonic())))
    finally:
        gateway.close()
        journal.close()
        instance_lock.__exit__(None, None, None)
    return 0


def status(args: argparse.Namespace) -> int:
    config = ConfigStore(args.config).load()
    print(f"Site: {config['site']}")
    print(f"Connection: {config['connection_id']}")
    print(f"Account: {config['account_id'][0]}***{config['account_id'][-4:]}")
    print(f"Mode: {config['mode']}")
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Hedge in a Box IBKR Paper executor")
    result.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    subparsers = result.add_subparsers(dest="command", required=True)
    pair_parser = subparsers.add_parser("pair")
    pair_parser.add_argument("--site", default="https://hedge-in-a-box.com")
    pair_parser.add_argument("--code", required=True)
    pair_parser.add_argument("--account", required=True)
    pair_parser.add_argument("--mode", default="paper", choices=["paper"])
    pair_parser.set_defaults(handler=pair)
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--host", default="127.0.0.1")
    run_parser.add_argument("--port", type=int, default=4002)
    run_parser.add_argument("--client-id", type=int, default=71)
    run_parser.add_argument("--poll-seconds", type=int, default=30)
    run_parser.add_argument("--journal", type=Path)
    run_parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    run_parser.set_defaults(handler=run)
    status_parser = subparsers.add_parser("status")
    status_parser.set_defaults(handler=status)
    return result


def main() -> int:
    args = parser().parse_args()
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
