from __future__ import annotations

import os

import psycopg


class DatabaseUrlMissing(RuntimeError):
    pass


def resolve_db_url(explicit: str | None = None) -> str:
    if explicit:
        return explicit
    url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
    if not url:
        raise DatabaseUrlMissing(
            "DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set. "
            "Set it in your environment or pass --db-url."
        )
    return url


def get_conn(db_url: str | None = None) -> psycopg.Connection:
    return psycopg.connect(resolve_db_url(db_url), autocommit=False)
