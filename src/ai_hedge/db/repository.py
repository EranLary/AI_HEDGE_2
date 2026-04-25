from __future__ import annotations

from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

_DROP_SQL = """
DROP TRIGGER IF EXISTS reports_after_change ON reports;
DROP FUNCTION IF EXISTS trg_reports_after_change();
DROP TABLE IF EXISTS report_artifacts;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS tickers;
"""


def apply_schema(conn: psycopg.Connection, *, reset: bool = False) -> None:
    with conn.cursor() as cur:
        if reset:
            cur.execute(_DROP_SQL)
        cur.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.commit()


_UPSERT_TICKER_SQL = """
INSERT INTO tickers (symbol, company_name, exchange, currency)
VALUES (%(symbol)s, %(company_name)s, %(exchange)s, %(currency)s)
ON CONFLICT (symbol) DO UPDATE SET
    company_name = coalesce(EXCLUDED.company_name, tickers.company_name),
    exchange     = coalesce(EXCLUDED.exchange,     tickers.exchange),
    currency     = coalesce(EXCLUDED.currency,     tickers.currency);
"""


def upsert_ticker(conn: psycopg.Connection, ticker_row: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(_UPSERT_TICKER_SQL, ticker_row)


_INSERT_REPORT_SQL = """
INSERT INTO reports (
    ticker, user_id, generated_at, dashboard_version,
    company_name, current_price, market_cap, currency,
    recommendation, mean_target_price,
    visibility, source, source_run_id, origin_path
) VALUES (
    %(ticker)s, %(user_id)s, %(generated_at)s, %(dashboard_version)s,
    %(company_name)s, %(current_price)s, %(market_cap)s, %(currency)s,
    %(recommendation)s, %(mean_target_price)s,
    %(visibility)s, %(source)s, %(source_run_id)s, %(origin_path)s
)
ON CONFLICT ((coalesce(user_id::text, '')), ticker, generated_at) DO NOTHING
RETURNING id;
"""

_SELECT_EXISTING_REPORT_ID_SQL = """
SELECT id FROM reports
 WHERE coalesce(user_id::text, '') = coalesce(%(user_id)s::text, '')
   AND ticker = %(ticker)s
   AND generated_at = %(generated_at)s
 LIMIT 1;
"""

_INSERT_ARTIFACT_SQL = """
INSERT INTO report_artifacts (
    report_id, dashboard, analysis_md, prices_explain_md, analysis_md_source
) VALUES (
    %(report_id)s, %(dashboard)s, %(analysis_md)s, %(prices_explain_md)s, %(analysis_md_source)s
);
"""


def insert_report(
    conn: psycopg.Connection, report_row: dict, artifact_row: dict
) -> tuple[str, bool]:
    """
    Insert a report + its artifacts in a single transaction step.
    Returns (report_id, was_inserted). On dedup conflict, returns
    (existing_id, False) without touching report_artifacts.
    Caller owns the surrounding commit.
    """
    with conn.cursor() as cur:
        cur.execute(_INSERT_REPORT_SQL, report_row)
        result = cur.fetchone()
        if result is None:
            cur.execute(_SELECT_EXISTING_REPORT_ID_SQL, {
                "user_id": report_row["user_id"],
                "ticker": report_row["ticker"],
                "generated_at": report_row["generated_at"],
            })
            existing = cur.fetchone()
            return (str(existing[0]) if existing else "", False)

        new_id = str(result[0])
        artifact_payload = dict(artifact_row)
        artifact_payload["dashboard"] = Jsonb(artifact_payload["dashboard"])
        artifact_payload["report_id"] = new_id
        cur.execute(_INSERT_ARTIFACT_SQL, artifact_payload)
        return (new_id, True)


def get_latest_by_ticker(
    conn: psycopg.Connection, ticker: str
) -> dict | None:
    sql = """
    SELECT r.id, r.ticker, r.generated_at, r.dashboard_version,
           r.company_name, r.current_price, r.market_cap, r.currency,
           r.recommendation, r.mean_target_price,
           r.visibility, r.source, r.source_run_id, r.origin_path,
           r.created_at,
           a.dashboard, a.analysis_md, a.prices_explain_md, a.analysis_md_source
      FROM reports r
      JOIN report_artifacts a ON a.report_id = r.id
     WHERE r.ticker = %s AND r.deleted_at IS NULL
     ORDER BY r.generated_at DESC
     LIMIT 1;
    """
    with conn.cursor() as cur:
        cur.execute(sql, (ticker,))
        row = cur.fetchone()
        if row is None:
            return None
        cols = [d.name for d in cur.description]
    return dict(zip(cols, row))


def count_reports(conn: psycopg.Connection) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                (SELECT count(*) FROM tickers)          AS tickers,
                (SELECT count(*) FROM reports
                  WHERE deleted_at IS NULL)             AS reports,
                (SELECT count(*) FROM report_artifacts) AS artifacts;
            """
        )
        row = cur.fetchone()
        cols = [d.name for d in cur.description]
    return dict(zip(cols, row))


def total_size_bytes(conn: psycopg.Connection) -> dict:
    sql = """
    SELECT
        pg_total_relation_size('tickers')          AS tickers_bytes,
        pg_total_relation_size('reports')          AS reports_bytes,
        pg_total_relation_size('report_artifacts') AS artifacts_bytes,
        coalesce(avg(pg_column_size(a.dashboard)), 0)::bigint        AS avg_dashboard,
        coalesce(avg(pg_column_size(a.analysis_md)), 0)::bigint      AS avg_analysis,
        coalesce(avg(pg_column_size(a.prices_explain_md)), 0)::bigint AS avg_prices_explain
      FROM report_artifacts a;
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        row = cur.fetchone()
        cols = [d.name for d in cur.description]
    return dict(zip(cols, row))


def md_source_distribution(conn: psycopg.Connection) -> list[tuple[str, int]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT analysis_md_source, count(*)
              FROM report_artifacts
             GROUP BY analysis_md_source
             ORDER BY 2 DESC;
            """
        )
        return [(str(r[0]), int(r[1])) for r in cur.fetchall()]
