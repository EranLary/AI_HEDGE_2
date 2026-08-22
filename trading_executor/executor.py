from __future__ import annotations

import argparse
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from . import __version__
from .control_client import ControlClient, ControlPlaneError
from .dpapi_store import ConfigStore
from .engine import ExecutionEngine
from .reporter import ControlReporter


DEFAULT_CONFIG = Path(os.environ.get("LOCALAPPDATA", ".")) / "HedgeInABox" / "ibkr-executor.dpapi"


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
    })
    print(f"Paired {response['account_masked']} in Paper mode. Secret saved with Windows DPAPI at {args.config}.")
    return 0


def run(args: argparse.Namespace) -> int:
    config = ConfigStore(args.config).load()
    if config.get("mode") != "paper":
        raise SystemExit("This executor build refuses Live connections.")
    if args.host not in {"127.0.0.1", "localhost"}:
        raise SystemExit("IB Gateway host must be localhost; never expose the socket to a network.")
    if args.port != 4002:
        raise SystemExit("Paper mode requires IB Gateway port 4002.")
    from .ib_gateway import IbGateway

    client = ControlClient(config["site"], config["connection_id"], config["device_secret"])
    reporter = ControlReporter(client)
    gateway = IbGateway(
        host=args.host, port=args.port, client_id=args.client_id,
        expected_account=config["account_id"],
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
                response = client.sync({
                    "account_id": config["account_id"], "mode": "paper",
                    "executor_version": __version__, "gateway_connected": gateway_ready,
                    "gateway_authenticated": gateway_ready,
                    "account_type": snapshot.account_type if gateway_ready else "UNKNOWN",
                    "error": gateway_error,
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
    run_parser.set_defaults(handler=run)
    status_parser = subparsers.add_parser("status")
    status_parser.set_defaults(handler=status)
    return result


def main() -> int:
    args = parser().parse_args()
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
