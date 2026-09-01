"""Audit and remove legacy full-report PDFs after HTML-first reports are deployed.

The command is intentionally audit-only by default. Destructive mode requires
both ``--delete`` and ``--yes`` and aborts unless every active database report
can be rendered from its stored Markdown or structured valuation payload.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

PDF_KINDS = ("analysis-pdf", "prices-explain-pdf", "combined-pdf")


@dataclass
class AuditResult:
    active_reports: int
    recoverable_reports: int
    unrecoverable_reports: list[dict[str, str]]
    r2_pdf_objects: int
    r2_pdf_bytes: int | None
    local_pdf_files: int
    local_pdf_bytes: int


def _load_env() -> None:
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def has_structured_valuation(dashboard: Any) -> bool:
    prices = _as_dict(_as_dict(dashboard).get("valuation_hub")).get("prices")
    prices = _as_dict(prices)
    try:
        float(prices.get("Current"))
    except (TypeError, ValueError):
        return False
    overall = prices.get("Overall")
    if not isinstance(overall, list):
        return False
    for value in overall:
        try:
            float(value)
            return True
        except (TypeError, ValueError):
            continue
    return False


def report_is_recoverable(row: dict[str, Any]) -> tuple[bool, str]:
    if not str(row.get("analysis_md") or "").strip():
        return False, "missing analysis Markdown"
    if str(row.get("prices_explain_md") or "").strip():
        return True, "native valuation Markdown"
    if has_structured_valuation(row.get("dashboard")):
        return True, "structured historical valuation"
    return False, "missing valuation Markdown and structured valuation"


def _database_url() -> str:
    value = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
    if not str(value or "").strip():
        raise RuntimeError("DATABASE_URL_UNPOOLED or DATABASE_URL is required")
    return str(value)


def _fetch_rows() -> list[dict[str, Any]]:
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id::text AS report_id,
                       r.ticker,
                       r.workspace,
                       r.deleted_at,
                       a.analysis_md,
                       a.prices_explain_md,
                       a.dashboard,
                       a.r2_keys
                  FROM reports r
                  JOIN report_artifacts a ON a.report_id = r.id
                 ORDER BY r.generated_at, r.id
                """
            )
            return list(cur.fetchall())


def _r2_client() -> tuple[Any, str] | None:
    required = {
        "endpoint_url": os.environ.get("R2_ENDPOINT_URL"),
        "aws_access_key_id": os.environ.get("R2_ACCESS_KEY_ID"),
        "aws_secret_access_key": os.environ.get("R2_SECRET_ACCESS_KEY"),
    }
    bucket = str(os.environ.get("R2_BUCKET") or "").strip()
    if not bucket or any(not str(value or "").strip() for value in required.values()):
        return None
    import boto3

    client = boto3.client(
        "s3",
        **required,
        region_name=str(os.environ.get("R2_REGION") or "auto").strip(),
    )
    return client, bucket


def _r2_entries(rows: list[dict[str, Any]]) -> list[tuple[str, str, str]]:
    entries: list[tuple[str, str, str]] = []
    for row in rows:
        keys = _as_dict(row.get("r2_keys"))
        for kind in PDF_KINDS:
            key = str(keys.get(kind) or "").strip().lstrip("/")
            if key:
                entries.append((str(row["report_id"]), kind, key))
    return entries


def _safe_outputs_root(raw_root: str | None) -> Path | None:
    if not raw_root:
        return None
    root = Path(raw_root).expanduser().resolve()
    forbidden = {Path(root.anchor).resolve(), Path.home().resolve(), Path.cwd().resolve()}
    if root in forbidden:
        raise RuntimeError(f"Refusing broad outputs root: {root}")
    if not root.is_dir():
        raise RuntimeError(f"Outputs root does not exist: {root}")
    return root


def _local_pdf_files(root: Path | None) -> list[Path]:
    if root is None:
        return []
    candidates: set[Path] = set()
    for suffix in ("_prices_explain.pdf", "_combined.pdf"):
        candidates.update(path.resolve() for path in root.rglob(f"*{suffix}") if path.is_file())
    for analysis_pdf in root.rglob("*_analysis.pdf"):
        if not analysis_pdf.is_file():
            continue
        prefix = analysis_pdf.name[: -len("_analysis.pdf")]
        siblings = (
            analysis_pdf.with_name(f"{prefix}_dashboard.json"),
            analysis_pdf.with_name(f"{prefix}_prices_explain.pdf"),
            analysis_pdf.with_name(f"{prefix}_combined.pdf"),
        )
        if any(path.exists() for path in siblings):
            candidates.add(analysis_pdf.resolve())
    safe: list[Path] = []
    for path in sorted(candidates):
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise RuntimeError(f"Resolved PDF escaped outputs root: {path}") from exc
        safe.append(path)
    return safe


def audit(rows: list[dict[str, Any]], outputs_root: Path | None) -> AuditResult:
    active = [row for row in rows if row.get("deleted_at") is None]
    unrecoverable: list[dict[str, str]] = []
    for row in active:
        recoverable, reason = report_is_recoverable(row)
        if not recoverable:
            unrecoverable.append(
                {
                    "report_id": str(row["report_id"]),
                    "ticker": str(row["ticker"]),
                    "workspace": str(row["workspace"]),
                    "reason": reason,
                }
            )

    r2 = _r2_client()
    r2_bytes: int | None = None
    entries = _r2_entries(rows)
    if r2:
        client, bucket = r2
        r2_bytes = 0
        for _report_id, _kind, key in entries:
            try:
                r2_bytes += int(client.head_object(Bucket=bucket, Key=key).get("ContentLength") or 0)
            except client.exceptions.ClientError as exc:
                code = str(exc.response.get("Error", {}).get("Code", ""))
                if code not in {"404", "NoSuchKey", "NotFound"}:
                    raise

    local_files = _local_pdf_files(outputs_root)
    return AuditResult(
        active_reports=len(active),
        recoverable_reports=len(active) - len(unrecoverable),
        unrecoverable_reports=unrecoverable,
        r2_pdf_objects=len(entries),
        r2_pdf_bytes=r2_bytes,
        local_pdf_files=len(local_files),
        local_pdf_bytes=sum(path.stat().st_size for path in local_files),
    )


def _delete_r2(rows: list[dict[str, Any]]) -> int:
    r2 = _r2_client()
    entries = _r2_entries(rows)
    if entries and not r2:
        raise RuntimeError("R2 credentials are required to delete stored PDF objects")
    if not entries:
        return 0
    assert r2 is not None
    client, bucket = r2
    deleted = 0
    for _report_id, _kind, key in entries:
        client.delete_object(Bucket=bucket, Key=key)
        deleted += 1

    import psycopg

    with psycopg.connect(_database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE report_artifacts
                   SET r2_keys = NULLIF(
                       COALESCE(r2_keys, '{}'::jsonb) - %s::text[],
                       '{}'::jsonb
                   )
                 WHERE r2_keys ?| %s::text[]
                """,
                (list(PDF_KINDS), list(PDF_KINDS)),
            )
        conn.commit()
    return deleted


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outputs-root", help="Optional full-analysis outputs tree to audit/delete")
    parser.add_argument("--manifest", help="Optional path for the JSON audit/deletion manifest")
    parser.add_argument("--delete", action="store_true", help="Delete audited legacy PDFs")
    parser.add_argument("--yes", action="store_true", help="Required confirmation for --delete")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    _load_env()
    if args.delete and not args.yes:
        raise SystemExit("Refusing deletion without both --delete and --yes")

    outputs_root = _safe_outputs_root(args.outputs_root)
    rows = _fetch_rows()
    result = audit(rows, outputs_root)
    manifest: dict[str, Any] = {"mode": "delete" if args.delete else "audit", **asdict(result)}

    if args.delete:
        if result.unrecoverable_reports:
            raise SystemExit(
                f"Refusing deletion: {len(result.unrecoverable_reports)} active reports are not recoverable"
            )
        local_files = _local_pdf_files(outputs_root)
        manifest["deleted_r2_objects"] = _delete_r2(rows)
        for path in local_files:
            path.unlink()
        manifest["deleted_local_files"] = len(local_files)

    rendered = json.dumps(manifest, indent=2, sort_keys=True)
    print(rendered)
    if args.manifest:
        manifest_path = Path(args.manifest).expanduser().resolve()
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(rendered + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
