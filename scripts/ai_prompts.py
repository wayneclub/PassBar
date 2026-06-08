#!/usr/bin/env python3
"""Load AI prompt templates from scripts/prompts/*.txt."""

from __future__ import annotations

from pathlib import Path

_PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
_cache: dict[str, str] = {}


def prompts_dir() -> Path:
    return _PROMPTS_DIR


def load_prompt(name: str, *, reload: bool = False) -> str:
    """Load a prompt template by file stem (without .txt)."""
    if reload or name not in _cache:
        path = _PROMPTS_DIR / f"{name}.txt"
        if not path.is_file():
            raise FileNotFoundError(f"Prompt template not found: {path}")
        _cache[name] = path.read_text(encoding="utf-8")
    return _cache[name]


def format_prompt(name: str, **kwargs: str) -> str:
    """Load and str.format a prompt template."""
    return load_prompt(name).format(**kwargs)
