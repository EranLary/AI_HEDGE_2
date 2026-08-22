from __future__ import annotations

import ctypes
import json
from ctypes import wintypes
from pathlib import Path
from typing import Any


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _blob(data: bytes) -> tuple[DATA_BLOB, ctypes.Array[ctypes.c_char]]:
    buffer = ctypes.create_string_buffer(data)
    return DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))), buffer


def protect(data: bytes) -> bytes:
    if not hasattr(ctypes, "windll"):
        raise RuntimeError("Windows DPAPI is required for executor secrets.")
    source, source_buffer = _blob(data)
    output = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(source), "HedgeInABox IBKR Executor", None, None, None, 0, ctypes.byref(output)
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)
        del source_buffer


def unprotect(data: bytes) -> bytes:
    if not hasattr(ctypes, "windll"):
        raise RuntimeError("Windows DPAPI is required for executor secrets.")
    source, source_buffer = _blob(data)
    output = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(source), None, None, None, None, 0, ctypes.byref(output)
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)
        del source_buffer


class ConfigStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def save(self, payload: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        encrypted = protect(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        self.path.write_bytes(encrypted)

    def load(self) -> dict[str, Any]:
        return json.loads(unprotect(self.path.read_bytes()).decode("utf-8"))
