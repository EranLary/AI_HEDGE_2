from __future__ import annotations

from typing import Any, Dict, Mapping


METHOD_NAME_RENAMES: Dict[str, str] = {
    "DCF": "Intrinsic DCF",
    "Net Income & P/E": "Earnings Multiple",
    "Revenue & EV/S": "Revenue Multiple",
    "Dream Team": "Dream Team",
    "BBB Target": "Target Scenario",
    "BBB NI & P/E": "Earnings Scenario",
    "Lary's Logic": "Composite Logic",
}

CANONICAL_METHOD_ORDER = [
    METHOD_NAME_RENAMES["DCF"],
    METHOD_NAME_RENAMES["Net Income & P/E"],
    METHOD_NAME_RENAMES["Revenue & EV/S"],
    METHOD_NAME_RENAMES["Dream Team"],
    METHOD_NAME_RENAMES["BBB Target"],
    METHOD_NAME_RENAMES["BBB NI & P/E"],
    METHOD_NAME_RENAMES["Lary's Logic"],
]

_METHOD_ALIAS_TO_CANONICAL: Dict[str, str] = {}
for _legacy, _canonical in METHOD_NAME_RENAMES.items():
    _METHOD_ALIAS_TO_CANONICAL[_legacy] = _canonical
    _METHOD_ALIAS_TO_CANONICAL[_canonical] = _canonical


def canonical_method_name(name: Any) -> str:
    key = str(name or "").strip()
    if not key:
        return ""
    return _METHOD_ALIAS_TO_CANONICAL.get(key, key)


def canonicalize_method_dict(data: Mapping[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for raw_key, value in (data or {}).items():
        canonical_key = canonical_method_name(raw_key)
        if not canonical_key:
            canonical_key = str(raw_key or "").strip()
        if canonical_key in out and isinstance(out[canonical_key], list) and isinstance(value, list):
            out[canonical_key].extend(value)
            continue
        out[canonical_key] = value
    return out
