"""Build frontend/public/data/tickers.json from public sources.

Sources:
- SEC company tickers: https://www.sec.gov/files/company_tickers.json (US issuers w/ CIK)
- NASDAQ Trader nasdaqlisted.txt + otherlisted.txt (full US listings, ETF flag, exchange)
- Curated TASE supplement (most-traded Tel Aviv tickers; suffixed with .TA for yfinance)

Output shape (one row per ticker, single-letter keys to keep payload small):
    { "s": "NVDA", "n": "NVIDIA Corporation", "e": "NASDAQ", "t": "stock" }

Run:
    python scripts/build_tickers.py            # minified
    python scripts/build_tickers.py --pretty   # readable for diffing
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path
from typing import Iterable
from urllib.error import URLError
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPO_ROOT / "frontend" / "public" / "data" / "tickers.json"

UA = "AI-Hedge-Fund-Tickers-Builder/1.0 (contact: yonash8@gmail.com)"

SEC_URL = "https://www.sec.gov/files/company_tickers.json"
NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"

EXCHANGE_MAP = {
    "Q": "NASDAQ",
    "N": "NYSE",
    "A": "NYSE American",
    "P": "NYSE Arca",
    "Z": "BATS",
    "V": "IEX",
}

TASE_SEED: list[tuple[str, str]] = [
    ("TEVA.TA", "Teva Pharmaceutical Industries Ltd"),
    ("POLI.TA", "Bank Hapoalim B.M."),
    ("LUMI.TA", "Bank Leumi Le-Israel B.M."),
    ("DSCT.TA", "Israel Discount Bank Ltd"),
    ("MZTF.TA", "Mizrahi Tefahot Bank Ltd"),
    ("FIBI.TA", "First International Bank of Israel Ltd"),
    ("ICL.TA", "ICL Group Ltd"),
    ("NICE.TA", "NICE Ltd"),
    ("ESLT.TA", "Elbit Systems Ltd"),
    ("CEL.TA", "Cellcom Israel Ltd"),
    ("PTNR.TA", "Partner Communications Co Ltd"),
    ("BEZQ.TA", "Bezeq The Israeli Telecommunication Corp Ltd"),
    ("AZRG.TA", "Azrieli Group Ltd"),
    ("MGDL.TA", "Migdal Insurance and Financial Holdings Ltd"),
    ("HARL.TA", "Harel Insurance Investments and Financial Services Ltd"),
    ("PHOE.TA", "The Phoenix Holdings Ltd"),
    ("CLIS.TA", "Clal Insurance Enterprises Holdings Ltd"),
    ("DLEKG.TA", "Delek Group Ltd"),
    ("ORL.TA", "Bazan Ltd"),
    ("PAZ.TA", "Paz Oil Company Ltd"),
    ("RATI.TA", "Ratio Oil Exploration"),
    ("ELRN.TA", "Electra Ltd"),
    ("SHOM.TA", "Shufersal Ltd"),
    ("STRS.TA", "Strauss Group Ltd"),
    ("OSEM.TA", "Osem Investments Ltd"),
    ("CRSR.TA", "Carasso Motors Ltd"),
    ("KMDA.TA", "Kamada Ltd"),
    ("CMER.TA", "Camtek Ltd"),
    ("NXVT.TA", "Nova Ltd"),
    ("ORA.TA", "Ormat Technologies Inc"),
    ("ENLT.TA", "Enlight Renewable Energy Ltd"),
    ("ENRG.TA", "Energean Plc"),
    ("ALHE.TA", "Alony Hetz Properties & Investments Ltd"),
    ("AMOT.TA", "Amot Investments Ltd"),
    ("BIG.TA", "BIG Shopping Centers Ltd"),
    ("MLSR.TA", "Melisron Ltd"),
    ("AZRG.TA", "Azrieli Group Ltd"),
    ("ISRA.TA", "Isras Investment Co Ltd"),
    ("ISCD.TA", "Isracard Ltd"),
    ("BCOM.TA", "B Communications Ltd"),
    ("IES.TA", "Israel Electric Corp Ltd"),
    ("MNRV.TA", "Menora Mivtachim Holdings Ltd"),
    ("DLKN.TA", "Delek Drilling LP"),
    ("AVNR.TA", "Avner Oil and Gas LP"),
    ("PRGO.TA", "Perrigo Company plc"),
    ("MMHD.TA", "MMHD-Plus Ltd"),
    ("ALMG.TA", "Alumog Ltd"),
    ("FORTY.TA", "Forty Ltd"),
    ("NVMI.TA", "Nova Ltd"),
    ("CMPNY.TA", "Compugen Ltd"),
]


def _fetch(url: str, timeout: float = 30.0) -> bytes:
    req = Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_sec_tickers() -> dict[str, str]:
    """Returns { ticker -> company_name } from SEC company_tickers.json."""
    raw = _fetch(SEC_URL)
    data = json.loads(raw.decode("utf-8"))
    out: dict[str, str] = {}
    # SEC payload is { "0": {"cik_str":..., "ticker":"AAPL", "title":"Apple Inc."}, ... }
    for entry in data.values():
        ticker = str(entry.get("ticker") or "").strip().upper()
        title = str(entry.get("title") or "").strip()
        if ticker and title:
            out.setdefault(ticker, title)
    return out


def parse_pipe_table(text: str) -> list[dict[str, str]]:
    """NASDAQ trader files use a `|`-delimited header + rows; trailing 'File Creation Time' line."""
    rows: list[dict[str, str]] = []
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return rows
    header = [h.strip() for h in lines[0].split("|")]
    for ln in lines[1:]:
        if ln.startswith("File Creation Time"):
            continue
        parts = ln.split("|")
        if len(parts) != len(header):
            continue
        rows.append({k: v.strip() for k, v in zip(header, parts)})
    return rows


def fetch_nasdaq_listed() -> list[dict[str, str]]:
    """nasdaqlisted.txt: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares"""
    text = _fetch(NASDAQ_LISTED_URL).decode("latin-1")
    rows = parse_pipe_table(text)
    out: list[dict[str, str]] = []
    for r in rows:
        sym = r.get("Symbol", "").strip().upper()
        name = r.get("Security Name", "").strip()
        if not sym or not name or r.get("Test Issue", "").strip().upper() == "Y":
            continue
        is_etf = r.get("ETF", "").strip().upper() == "Y"
        out.append({"s": sym, "n": name, "e": "NASDAQ", "t": "etf" if is_etf else "stock"})
    return out


def fetch_other_listed() -> list[dict[str, str]]:
    """otherlisted.txt: ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol"""
    text = _fetch(OTHER_LISTED_URL).decode("latin-1")
    rows = parse_pipe_table(text)
    out: list[dict[str, str]] = []
    for r in rows:
        sym = r.get("ACT Symbol", "").strip().upper()
        name = r.get("Security Name", "").strip()
        if not sym or not name or r.get("Test Issue", "").strip().upper() == "Y":
            continue
        ex_code = r.get("Exchange", "").strip().upper()
        exchange = EXCHANGE_MAP.get(ex_code, ex_code or "OTHER")
        is_etf = r.get("ETF", "").strip().upper() == "Y"
        out.append({"s": sym, "n": name, "e": exchange, "t": "etf" if is_etf else "stock"})
    return out


def merge_entries(
    nasdaq: list[dict[str, str]],
    other: list[dict[str, str]],
    sec_names: dict[str, str],
    tase: Iterable[tuple[str, str]],
) -> list[dict[str, str]]:
    """De-dupe by symbol; prefer NASDAQ row, then otherlisted, then SEC-only."""
    by_symbol: dict[str, dict[str, str]] = {}
    for row in nasdaq:
        by_symbol[row["s"]] = row
    for row in other:
        by_symbol.setdefault(row["s"], row)

    # Prefer SEC long-form name when it exists (e.g. "Apple Inc." vs "APPLE INC. - COMMON STOCK")
    for sym, row in by_symbol.items():
        sec_name = sec_names.get(sym)
        if sec_name and len(sec_name) >= 3:
            row["n"] = sec_name

    # Add SEC-only tickers (rare — usually OTC/transitional)
    for sym, name in sec_names.items():
        if sym not in by_symbol:
            by_symbol[sym] = {"s": sym, "n": name, "e": "SEC", "t": "stock"}

    # TASE supplement (manual list, dedup by symbol)
    for sym, name in tase:
        sym_u = sym.upper()
        if sym_u not in by_symbol:
            by_symbol[sym_u] = {"s": sym_u, "n": name, "e": "TASE", "t": "stock"}

    return sorted(by_symbol.values(), key=lambda r: r["s"])


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--pretty", action="store_true", help="Write indented JSON instead of minified.")
    p.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = p.parse_args()

    print(f"[build_tickers] SEC ... ", end="", flush=True)
    try:
        sec = fetch_sec_tickers()
    except URLError as e:
        print(f"FAILED ({e}). Continuing without SEC.")
        sec = {}
    else:
        print(f"{len(sec)} tickers")

    print(f"[build_tickers] NASDAQ listed ... ", end="", flush=True)
    nasdaq = fetch_nasdaq_listed()
    print(f"{len(nasdaq)} tickers")

    print(f"[build_tickers] Other listed ... ", end="", flush=True)
    other = fetch_other_listed()
    print(f"{len(other)} tickers")

    merged = merge_entries(nasdaq, other, sec, TASE_SEED)
    print(f"[build_tickers] Merged total: {len(merged)} (incl. {len(TASE_SEED)} TASE seed)")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.pretty:
        text = json.dumps(merged, indent=2, ensure_ascii=False)
    else:
        text = json.dumps(merged, separators=(",", ":"), ensure_ascii=False)
    args.output.write_text(text, encoding="utf-8")
    size_kb = args.output.stat().st_size / 1024
    print(f"[build_tickers] Wrote {args.output} ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
