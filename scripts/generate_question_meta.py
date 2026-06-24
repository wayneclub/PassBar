#!/usr/bin/env python3
"""
generate_question_meta.py

Read enriched question JSON, ask Gemini to analyze each question from the English
question stem, answer choices, correct answer, and English explanation, then write
standardized metadata back into the same enriched JSON file.

This script intentionally does not read from or PATCH Supabase. The enriched JSON
is the canonical source; import_questions_to_supabase.mjs imports the saved meta.

Usage:
  python3 scripts/generate_question_meta.py --enriched-file path/to/foo_enriched.json
  python3 scripts/generate_question_meta.py --enriched-file path/to/foo_enriched.json --limit 5
  python3 scripts/generate_question_meta.py --enriched-file path/to/foo_enriched.json --dry-run
  python3 scripts/generate_question_meta.py --enriched-file path/to/foo_enriched.json --refill
"""

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cli_ai
import cursor_api

from ai_prompts import load_prompt

META_PROMPT = load_prompt("meta_analysis")


def _load_env_file() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    candidates = [
        os.path.join(project_root, ".env.tools.local"),
        os.path.join(project_root, ".env.local"),
    ]
    seen: set[str] = set()
    for env_path in candidates:
        real = os.path.realpath(env_path)
        if real in seen or not os.path.exists(env_path):
            continue
        seen.add(real)
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value


_load_env_file()

GEMINI_MODEL = os.environ.get("GEMINI_META_MODEL", "gemini-3.5-flash")
OPENAI_MODEL = os.environ.get("OPENAI_META_MODEL", "gpt-4.1-mini")
RATE_LIMIT_DELAY = 3
MAX_RETRIES = 3

# Runtime provider state (changed via set_meta_provider)
_META_PROVIDER: str = "gemini"
_META_MODEL: str = GEMINI_MODEL
LAST_META_USAGE: dict[str, Any] | None = None


def set_meta_provider(provider: str, model: str | None = None) -> None:
    """Switch meta generation to 'gemini', 'gpt', or a supported local CLI."""
    global _META_PROVIDER, _META_MODEL
    _META_PROVIDER = provider
    if provider == "gpt":
        _META_MODEL = model or OPENAI_MODEL
    elif provider == "codex-cli":
        _META_MODEL = model or os.environ.get("CODEX_CLI_MODEL", "")
    elif provider == "antigravity-cli":
        _META_MODEL = model or os.environ.get("ANTIGRAVITY_CLI_MODEL", "")
    elif provider == "claude-cli":
        _META_MODEL = model or os.environ.get("CLAUDE_CLI_MODEL", "claude-sonnet-4-6")
    elif provider == "cursor-cli":
        _META_MODEL = model or os.environ.get("CURSOR_CLI_MODEL", "composer-2.5")
    elif provider == "cursor-api":
        _META_MODEL = model or os.environ.get(
            "CURSOR_API_MODEL",
            os.environ.get("CURSOR_CLI_MODEL", "composer-2.5"),
        )
    else:
        _META_MODEL = model or GEMINI_MODEL


def clear_last_meta_usage() -> None:
    global LAST_META_USAGE
    LAST_META_USAGE = None


def get_last_meta_usage() -> dict[str, Any] | None:
    return dict(LAST_META_USAGE) if LAST_META_USAGE else None

TRAP_TYPES = [
    "Rule Exception Overlooked",
    "Element Missing",
    "Temporal Sequence Confusion",
    "Procedural Posture Confusion",
    "Jurisdiction Scope Confusion",
    "Standard of Review Confusion",
    "Burden Allocation Confusion",
    "Party Status Confusion",
    "Remedy vs Liability Confusion",
    "Similar Rule Swap",
    "Overbroad General Rule",
    "Irrelevant Fact Attraction",
    "Answer Polarity Misread",
    "Causation Scope Confusion",
    "Constitutional Scrutiny Mismatch",
    "Hearsay Purpose Confusion",
    "Property Interest Classification",
    "Contract Formation Timing",
    "Criminal Intent Level Confusion",
    "Evidence Admissibility Purpose",
    "No Clear Trap",
]

GEMINI_API_KEYS: list[str] = [
    key for key in [
        os.environ.get(f"GEMINI_API_KEY_{i}") for i in range(1, 20)
    ] if key
]
if not GEMINI_API_KEYS and os.environ.get("GEMINI_API_KEY"):
    GEMINI_API_KEYS = [os.environ["GEMINI_API_KEY"]]

key_index = 0


class RateLimitedError(Exception):
    pass


class NonTextGeminiResponseError(Exception):
    """Gemini returned a billable response but no text payload to consume."""


def set_last_meta_usage(
    provider: str,
    model: str,
    input_tokens: object,
    output_tokens: object,
    total_tokens: object,
    max_output_tokens: object = "",
) -> None:
    global LAST_META_USAGE
    LAST_META_USAGE = {
        "provider": provider,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "max_output_tokens": max_output_tokens,
        "image_detail": "",
    }


def print_gemini_usage(data: dict[str, Any], model: str) -> None:
    usage = data.get("usageMetadata")
    if not isinstance(usage, dict):
        return
    prompt_tokens = usage.get("promptTokenCount", "?")
    output_tokens = usage.get("candidatesTokenCount")
    total_tokens = usage.get("totalTokenCount", "?")
    if output_tokens is None and isinstance(prompt_tokens, int) and isinstance(total_tokens, int):
        output_tokens = max(0, total_tokens - prompt_tokens)
    if output_tokens is None:
        output_tokens = "?"
    set_last_meta_usage("gemini", model, prompt_tokens, output_tokens, total_tokens, 12000)
    print(
        f"    Gemini meta usage: input={prompt_tokens} output={output_tokens} total={total_tokens}",
        flush=True,
    )


def extract_gemini_text(data: dict[str, Any]) -> str:
    candidates = data.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise NonTextGeminiResponseError(f"Gemini response has no candidates: {str(data)[:500]}")

    candidate = candidates[0]
    content = candidate.get("content") if isinstance(candidate, dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    if isinstance(parts, list):
        text = "".join(str(part.get("text") or "") for part in parts if isinstance(part, dict))
        if text.strip():
            return text

    finish_reason = candidate.get("finishReason") if isinstance(candidate, dict) else None
    safety = candidate.get("safetyRatings") if isinstance(candidate, dict) else None
    raise NonTextGeminiResponseError(
        "Gemini response had usage but no text "
        f"(finishReason={finish_reason or 'unknown'}, safetyRatings={safety or 'none'}). "
        "Not retrying across API keys because the call was already charged and the prompt likely needs adjustment."
    )


def next_api_key() -> str:
    global key_index
    if not GEMINI_API_KEYS:
        raise RuntimeError(
            "No GEMINI_API_KEY_1 ~ GEMINI_API_KEY_N or GEMINI_API_KEY found. "
            "Add GEMINI_API_KEY_1=your_key_here to .env.tools.local, or use --provider gpt/codex-cli."
        )
    key = GEMINI_API_KEYS[key_index % len(GEMINI_API_KEYS)]
    key_index += 1
    return key


_LOCALIZED_TEXT_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "en":      {"type": "STRING"},
        "zh":      {"type": "STRING"},
    },
    "required": ["en", "zh"],
}

_KEYWORD_ITEM_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "text":       {"type": "STRING"},
        "label":      _LOCALIZED_TEXT_SCHEMA,
        "kind":       {"type": "STRING"},
        "reason":     _LOCALIZED_TEXT_SCHEMA,
        "importance": {"type": "STRING"},
    },
    "required": ["text", "label", "kind", "reason", "importance"],
}

_HIGHLIGHT_ITEM_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "id":         {"type": "STRING"},
        "text":       {"type": "STRING"},
        "kind":       {"type": "STRING"},
        "label":      _LOCALIZED_TEXT_SCHEMA,
        "reason":     _LOCALIZED_TEXT_SCHEMA,
        "importance": {"type": "STRING"},
    },
    "required": ["id", "text", "kind", "label", "reason", "importance"],
}

_OPENAI_LOCALIZED_TEXT_SCHEMA = {
    "type": "object",
    "properties": {
        "en": {"type": "string"},
        "zh": {"type": "string"},
    },
    "required": ["en", "zh"],
    "additionalProperties": False,
}

_OPENAI_KEYWORD_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "text":       {"type": "string"},
        "label":      _OPENAI_LOCALIZED_TEXT_SCHEMA,
        "kind":       {"type": "string"},
        "reason":     _OPENAI_LOCALIZED_TEXT_SCHEMA,
        "importance": {"type": "string"},
    },
    "required": ["text", "label", "kind", "reason", "importance"],
    "additionalProperties": False,
}

_OPENAI_HIGHLIGHT_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "id":         {"type": "string"},
        "text":       {"type": "string"},
        "kind":       {"type": "string"},
        "label":      _OPENAI_LOCALIZED_TEXT_SCHEMA,
        "reason":     _OPENAI_LOCALIZED_TEXT_SCHEMA,
        "importance": {"type": "string"},
    },
    "required": ["id", "text", "kind", "label", "reason", "importance"],
    "additionalProperties": False,
}

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "micro_concept":    {"type": "STRING"},
        "trap_type":        {"type": "STRING"},
        "trap_type_is_new": {"type": "BOOLEAN"},
        "skill_tested":     {"type": "STRING"},
        "question_keyword_meta": {
            "type": "OBJECT",
            "properties": {
                "keywords": {"type": "ARRAY", "items": _KEYWORD_ITEM_SCHEMA},
            },
            "required": ["keywords"],
        },
        "choice_keyword_meta": {
            "type": "OBJECT",
            "properties": {
                "choices": {
                    "type": "OBJECT",
                    "properties": {
                        "A": {"type": "ARRAY", "items": _KEYWORD_ITEM_SCHEMA},
                        "B": {"type": "ARRAY", "items": _KEYWORD_ITEM_SCHEMA},
                        "C": {"type": "ARRAY", "items": _KEYWORD_ITEM_SCHEMA},
                        "D": {"type": "ARRAY", "items": _KEYWORD_ITEM_SCHEMA},
                    },
                },
            },
            "required": ["choices"],
        },
        "question_highlight_meta": {
            "type": "OBJECT",
            "properties": {
                "highlights": {"type": "ARRAY", "items": _HIGHLIGHT_ITEM_SCHEMA},
            },
            "required": ["highlights"],
        },
    },
    "required": [
        "micro_concept", "trap_type", "trap_type_is_new", "skill_tested",
        "question_keyword_meta", "choice_keyword_meta", "question_highlight_meta",
    ],
}


def call_gemini_json(prompt: str) -> dict[str, Any]:
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.15,
            "maxOutputTokens": 12000,
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }).encode()

    last_error: Exception | None = None
    n_keys = len(GEMINI_API_KEYS)

    for round_num in range(1, MAX_RETRIES + 1):
        all_rate_limited = True

        for _ in range(n_keys):
            api_key = next_api_key()
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{_META_MODEL}:generateContent?key={api_key}"
            )
            try:
                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read())
                raw_text = extract_gemini_text(data)
                print_gemini_usage(data, _META_MODEL)
                cleaned = re.sub(r"^```json\s*", "", raw_text.strip(), flags=re.IGNORECASE)
                cleaned = re.sub(r"\s*```$", "", cleaned)
                try:
                    return json.loads(cleaned)
                except json.JSONDecodeError as json_err:
                    # AI returned malformed JSON — retry the same key, don't rotate
                    print(f"    JSON parse error ({json_err}), retrying...")
                    last_error = json_err
                    all_rate_limited = False
                    time.sleep(3)
                    continue
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors="replace")
                last_error = Exception(f"HTTP {e.code} (key ...{api_key[-6:]}): {body[:240]}")
                if e.code == 429:
                    print(f"    Rate limited (key ...{api_key[-6:]}), trying next key...")
                elif e.code >= 500:
                    all_rate_limited = False
                    time.sleep(10)
                else:
                    raise
            except NonTextGeminiResponseError:
                raise
            except Exception as exc:
                last_error = exc
                all_rate_limited = False
                time.sleep(5)

        if all_rate_limited:
            raise RateLimitedError(f"All keys rate limited (round {round_num}), skipping")

    raise RuntimeError(f"All API keys exhausted after {MAX_RETRIES} rounds. Last: {last_error}")


def call_openai_json(prompt: str) -> dict[str, Any]:
    """Call OpenAI with JSON mode and return parsed dict."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("No OPENAI_API_KEY found in environment or .env file.")

    payload = json.dumps({
        "model": _META_MODEL,
        "input": [{"role": "user", "content": prompt}],
        "store": False,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "meta_output",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "micro_concept":    {"type": "string"},
                        "trap_type":        {"type": "string"},
                        "trap_type_is_new": {"type": "boolean"},
                        "skill_tested":     {"type": "string"},
                        "question_keyword_meta": {
                            "type": "object",
                            "properties": {
                                "keywords": {
                                    "type": "array",
                                    "items": _OPENAI_KEYWORD_ITEM_SCHEMA,
                                },
                            },
                            "required": ["keywords"],
                            "additionalProperties": False,
                        },
                        "choice_keyword_meta": {
                            "type": "object",
                            "properties": {
                                "choices": {
                                    "type": "object",
                                    "properties": {
                                        "A": {"type": "array", "items": _OPENAI_KEYWORD_ITEM_SCHEMA},
                                        "B": {"type": "array", "items": _OPENAI_KEYWORD_ITEM_SCHEMA},
                                        "C": {"type": "array", "items": _OPENAI_KEYWORD_ITEM_SCHEMA},
                                        "D": {"type": "array", "items": _OPENAI_KEYWORD_ITEM_SCHEMA},
                                    },
                                    "required": ["A", "B", "C", "D"],
                                    "additionalProperties": False,
                                },
                            },
                            "required": ["choices"],
                            "additionalProperties": False,
                        },
                        "question_highlight_meta": {
                            "type": "object",
                            "properties": {
                                "highlights": {
                                    "type": "array",
                                    "items": _OPENAI_HIGHLIGHT_ITEM_SCHEMA,
                                },
                            },
                            "required": ["highlights"],
                            "additionalProperties": False,
                        },
                    },
                    "required": [
                        "micro_concept", "trap_type", "trap_type_is_new", "skill_tested",
                        "question_keyword_meta", "choice_keyword_meta", "question_highlight_meta",
                    ],
                    "additionalProperties": False,
                },
            },
        },
    }).encode()

    req = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
            usage = data.get("usage")
            if isinstance(usage, dict):
                set_last_meta_usage(
                    "gpt",
                    _META_MODEL,
                    usage.get("input_tokens", "?"),
                    usage.get("output_tokens", "?"),
                    usage.get("total_tokens", "?"),
                    "",
                )
                print(
                    "    OpenAI meta usage: "
                    f"input={usage.get('input_tokens', '?')} "
                    f"output={usage.get('output_tokens', '?')} "
                    f"total={usage.get('total_tokens', '?')}",
                    flush=True,
                )
            if data.get("status") == "incomplete":
                details = data.get("incomplete_details")
                reason = details.get("reason") if isinstance(details, dict) else ""
                if reason == "max_output_tokens":
                    raise RuntimeError(
                        "OpenAI meta response was truncated by max_output_tokens. "
                        "Increase the OpenAI output limit and rerun this item."
                    )
                raise RuntimeError(f"OpenAI meta response was incomplete: {details or data.get('status')}")
            text = data["output"][0]["content"][0]["text"]
            return json.loads(text)
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            last_error = RuntimeError(f"OpenAI HTTP {e.code}: {body[:300]}")
            if e.code == 429:
                wait = 30 * attempt
                print(f"    OpenAI rate limited, waiting {wait}s...")
                time.sleep(wait)
            elif e.code >= 500:
                wait = 10 * attempt
                print(f"    OpenAI {e.code}, retrying in {wait}s (attempt {attempt}/{MAX_RETRIES})...")
                time.sleep(wait)
            else:
                raise RuntimeError(f"OpenAI HTTP {e.code}: {body[:300]}")
        except Exception as exc:
            last_error = exc
            print(f"    OpenAI error: {exc}, retrying in 10s (attempt {attempt}/{MAX_RETRIES})...")
            time.sleep(10)
    raise RuntimeError(f"OpenAI failed after {MAX_RETRIES} attempts. Last: {last_error}")


def _extract_json_from_text(text: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```json\s*", "", text.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            return json.loads(match.group(0))
        raise


def call_cli_json(prompt: str) -> dict[str, Any]:
    raw = cli_ai.call_cli_ai(
        _META_PROVIDER,
        prompt,
        None,
        _META_MODEL or None,
        expected="one JSON object matching the requested schema",
    )
    set_last_meta_usage(_META_PROVIDER, _META_MODEL or "(default)", "", "", "", "")
    return _extract_json_from_text(raw)


def call_cursor_api_json(prompt: str) -> dict[str, Any]:
    raw = cursor_api.call_cursor_api(
        prompt,
        None,
        _META_MODEL or None,
        expected="one JSON object matching the requested schema",
    )
    set_last_meta_usage("cursor-api", _META_MODEL or "(default)", "", "", "", "")
    return _extract_json_from_text(raw)


def call_meta_json(prompt: str) -> dict[str, Any]:
    """Unified entry — delegates to Gemini or OpenAI based on _META_PROVIDER."""
    if _META_PROVIDER == "gpt":
        return call_openai_json(prompt)
    if _META_PROVIDER == "cursor-api":
        return call_cursor_api_json(prompt)
    if _META_PROVIDER in {"codex-cli", "antigravity-cli", "claude-cli", "cursor-cli"}:
        return call_cli_json(prompt)
    return call_gemini_json(prompt)



def html_to_text(html: str | None) -> str:
    if not html:
        return ""
    text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def taxonomy_list(values: list[str]) -> str:
    return "\n".join(f"- {value}" for value in values)


def canonical_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def canonical_taxonomy_value(value: Any, allowed: list[str], fallback: str | None = None) -> str | None:
    if value is None:
        return fallback
    lookup = {canonical_key(item): item for item in allowed}
    normalized = canonical_key(value)
    if normalized in lookup:
        return lookup[normalized]
    return fallback


def normalize_localized_text(value: Any, source_text: str = "", fallback_en: str = "") -> dict[str, str]:
    if isinstance(value, dict):
        en = str(value.get("en") or fallback_en or source_text or "").strip()
        zh = str(value.get("zh") or "").strip()
        return {"en": en, "zh": zh}

    cleaned = str(value or "").strip()
    if not cleaned:
        return {"en": fallback_en or source_text, "zh": ""}

    if "/" in cleaned:
        left, _, right = cleaned.partition("/")
        en = left.strip()
        if re.fullmatch(r"(?i)english", en):
            en = fallback_en or source_text
        return {"en": en or fallback_en or source_text, "zh": right.strip()}

    return {"en": fallback_en or source_text, "zh": cleaned}


def parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "yes", "1"}
    return False


def normalize_choices(choices_raw: Any) -> dict[str, str]:
    if isinstance(choices_raw, dict):
        return {
            str(key).upper(): str(value)
            for key, value in choices_raw.items()
            if str(key).upper() in {"A", "B", "C", "D"}
        }

    choices: dict[str, str] = {}
    if isinstance(choices_raw, list):
        for item in choices_raw:
            text = str(item)
            match = re.match(r"^([A-D])\.\s*", text)
            if match:
                choices[match.group(1)] = re.sub(r"^[A-D]\.\s*", "", text)
    return choices


def parse_enriched_document(raw: Any) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)], None
    if isinstance(raw, dict) and isinstance(raw.get("questions"), list):
        return [item for item in raw["questions"] if isinstance(item, dict)], raw.get("meta")
    raise ValueError("Unsupported enriched JSON shape. Expected an array or an object with questions[].")


def build_prompt(item: dict[str, Any], document_meta: dict[str, Any] | None) -> str:
    choices = normalize_choices(item.get("choices") or item.get("options") or {})
    choices_lines = "\n".join(f"{key}. {value}" for key, value in sorted(choices.items()))
    answer = (
        item.get("answer")
        or item.get("correct_answer")
        or item.get("correctAnswer")
        or item.get("source_correct_answer")
        or ""
    )
    explanation_html = (
        item.get("en-explanation")
        or item.get("en_explanation_html")
        or item.get("explanation")
        or ""
    )
    subject = item.get("subject") or (document_meta or {}).get("subject") or ""
    topic = item.get("topic") or item.get("chapter") or (document_meta or {}).get("chapter") or ""

    return (
        META_PROMPT
        .replace("__TRAP_TYPES__", taxonomy_list(TRAP_TYPES))
        .replace("__SUBJECT__", str(subject))
        .replace("__TOPIC__", str(topic))
        .replace("__QUESTION__", str(item.get("question") or item.get("question_text") or "").strip())
        .replace("__CHOICES__", choices_lines)
        .replace("__CORRECT_ANSWER__", str(answer).strip().upper()[:1])
        .replace("__EXPLANATION__", html_to_text(str(explanation_html))[:3500])
    )


def normalize_analysis_meta(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        value = {}

    highlight_meta = value.get("question_highlight_meta")
    if not isinstance(highlight_meta, dict):
        highlight_meta = {}
    highlights = highlight_meta.get("highlights")
    if not isinstance(highlights, list):
        highlights = []

    valid_kinds = {"key_sentence", "keyword", "issue", "rule_trigger", "fact_trigger"}
    valid_keyword_kinds = {
        "legal_term",
        "fact_trigger",
        "procedural_posture",
        "party_role",
        "time_marker",
        "trap_phrase",
        "remedy_or_relief",
    }
    valid_importance = {"high", "medium", "low"}

    def clean_keyword(item: Any, index: int) -> dict[str, Any] | None:
        if not isinstance(item, dict):
            return None
        text = str(item.get("text") or "").strip()
        if not text:
            return None
        kind = str(item.get("kind") or "legal_term")
        importance = str(item.get("importance") or "medium")
        return {
            "id": str(item.get("id") or f"k{index}"),
            "text": text,
            "label": normalize_localized_text(item.get("label"), text, text),
            "kind": kind if kind in valid_keyword_kinds else "legal_term",
            "reason": normalize_localized_text(item.get("reason")),
            "importance": importance if importance in valid_importance else "medium",
        }

    question_keyword_meta = value.get("question_keyword_meta")
    question_keywords_raw = (
        question_keyword_meta.get("keywords")
        if isinstance(question_keyword_meta, dict)
        else []
    )
    if not isinstance(question_keywords_raw, list):
        question_keywords_raw = []
    question_keywords = [
        keyword
        for index, item in enumerate(question_keywords_raw, 1)
        if (keyword := clean_keyword(item, index))
    ]

    choice_keyword_meta = value.get("choice_keyword_meta")
    choices_raw = (
        choice_keyword_meta.get("choices")
        if isinstance(choice_keyword_meta, dict)
        else {}
    )
    if not isinstance(choices_raw, dict):
        choices_raw = {}
    choice_keywords: dict[str, list[dict[str, Any]]] = {}
    for choice in ("A", "B", "C", "D"):
        raw_items = choices_raw.get(choice) or choices_raw.get(choice.lower()) or []
        if not isinstance(raw_items, list):
            raw_items = []
        choice_keywords[choice] = [
            keyword
            for index, item in enumerate(raw_items, 1)
            if (keyword := clean_keyword(item, index))
        ]

    cleaned_highlights: list[dict[str, Any]] = []

    for index, highlight in enumerate(highlights, 1):
        if not isinstance(highlight, dict):
            continue
        text = str(highlight.get("text") or "").strip()
        if not text:
            continue
        kind = str(highlight.get("kind") or "keyword")
        importance = str(highlight.get("importance") or "medium")
        cleaned_highlights.append({
            "id": str(highlight.get("id") or f"h{index}"),
            "text": text,
            "kind": kind if kind in valid_kinds else "keyword",
            "label": normalize_localized_text(highlight.get("label"), text, text),
            "reason": normalize_localized_text(highlight.get("reason")),
            "importance": importance if importance in valid_importance else "medium",
        })

    raw_trap_type = str(value.get("trap_type") or "").strip()
    canonical_trap_type = canonical_taxonomy_value(raw_trap_type, TRAP_TYPES)
    trap_type_is_new = parse_bool(value.get("trap_type_is_new"))
    if canonical_trap_type:
        trap_type = canonical_trap_type
        trap_type_is_new = False
    elif raw_trap_type:
        trap_type = raw_trap_type
        trap_type_is_new = raw_trap_type != "No Clear Trap"
    else:
        trap_type = "No Clear Trap"
        trap_type_is_new = False

    return {
        "micro_concept": str(value.get("micro_concept") or "").strip() or None,
        "trap_type": trap_type,
        "trap_type_is_new": trap_type_is_new,
        "skill_tested": str(value.get("skill_tested") or "").strip() or None,
        "question_keyword_meta": {
            "keywords": question_keywords,
        },
        "choice_keyword_meta": {
            "choices": choice_keywords,
        },
        "question_highlight_meta": {
            "highlights": cleaned_highlights,
        },
    }


def get_existing_analysis_meta(item: dict[str, Any]) -> dict[str, Any] | None:
    meta = item.get("meta")
    if isinstance(meta, dict) and isinstance(meta.get("question_analysis"), dict):
        return meta["question_analysis"]
    if isinstance(item.get("question_analysis_meta"), dict):
        return item["question_analysis_meta"]
    if isinstance(item.get("question_highlight_meta"), dict):
        return {
            "micro_concept": item.get("micro_concept"),
            "trap_type": item.get("trap_type"),
            "trap_type_is_new": item.get("trap_type_is_new"),
            "skill_tested": item.get("skill_tested"),
            "question_keyword_meta": item.get("question_keyword_meta"),
            "choice_keyword_meta": item.get("choice_keyword_meta"),
            "question_highlight_meta": item.get("question_highlight_meta"),
        }
    return None


def has_complete_meta(item: dict[str, Any]) -> bool:
    meta = normalize_analysis_meta(get_existing_analysis_meta(item))
    highlights = meta["question_highlight_meta"]["highlights"]
    question_keywords = meta["question_keyword_meta"]["keywords"]
    return bool(meta["micro_concept"] and meta["skill_tested"] and highlights and question_keywords)


def save_analysis_meta(item: dict[str, Any], generated: dict[str, Any]) -> dict[str, Any]:
    analysis_meta = normalize_analysis_meta(generated)
    if not analysis_meta["micro_concept"] or not analysis_meta["skill_tested"]:
        raise ValueError("AI response missing required micro_concept or skill_tested")

    existing_meta = item.get("meta") if isinstance(item.get("meta"), dict) else {}
    item["meta"] = {
        **existing_meta,
        "question_analysis": {
            **analysis_meta,
            "generated_by": "generate_question_meta.py",
            "generated_model": _META_MODEL or _META_PROVIDER,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    return item["meta"]["question_analysis"]


def process_enriched_file(path: Path, limit: int | None, refill: bool, dry_run: bool) -> tuple[int, int, int]:
    document = json.loads(path.read_text(encoding="utf-8"))
    items, document_meta = parse_enriched_document(document)
    candidates = [item for item in items if refill or not has_complete_meta(item)]
    if limit:
        candidates = candidates[:limit]

    print(f"Loaded {len(items)} item(s) from {path}")
    print(f"Found {len(candidates)} item(s) to tag.\n")

    ok = skipped = failed = 0
    changed = False

    for i, item in enumerate(candidates, 1):
        label = item.get("id") or item.get("question_id") or f"index-{item.get('index', '')}"
        print(f"[{i}/{len(candidates)}] {label}")

        if dry_run:
            question = str(item.get("question") or item.get("question_text") or "")
            print(f"  -> DRY RUN: would analyze: {question[:90]}...")
            ok += 1
            continue

        try:
            generated = call_meta_json(build_prompt(item, document_meta))
            meta = save_analysis_meta(item, generated)
            highlight_count = len(meta["question_highlight_meta"]["highlights"])
            print(f"  micro_concept : {meta['micro_concept']}")
            print(f"  trap_type     : {meta['trap_type'] or '(none)'}")
            print(f"  skill_tested  : {meta['skill_tested']}")
            print(f"  highlights    : {highlight_count}")
            print("  ✓ saved to item.meta.question_analysis")
            changed = True
            ok += 1
            time.sleep(RATE_LIMIT_DELAY)
        except RateLimitedError as exc:
            print(f"  SKIPPED: {exc}")
            skipped += 1
        except Exception as exc:
            print(f"  ERROR: {exc}")
            failed += 1

    if changed and not dry_run:
        path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\nSaved: {path}")

    return ok, skipped, failed


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate standardized meta for enriched JSON questions")
    parser.add_argument("--enriched-file", type=Path, required=True, help="Path to enriched JSON file")
    parser.add_argument("--limit", type=int, help="Max questions to process")
    parser.add_argument("--dry-run", action="store_true", help="Print plan, no API calls or writes")
    parser.add_argument("--refill", action="store_true", help="Regenerate meta even if complete meta exists")
    parser.add_argument(
        "--provider",
        choices=("gemini", "gpt", "codex-cli", "antigravity-cli", "claude-cli", "cursor-cli", "cursor-api"),
        default="gemini",
        help="AI provider (default: gemini)",
    )
    parser.add_argument("--model", default="", help="Override model name")
    args = parser.parse_args()

    set_meta_provider(args.provider, args.model or None)
    ok, skipped, failed = process_enriched_file(args.enriched_file, args.limit, args.refill, args.dry_run)
    print(f"\nDone. ✓ {ok}  - {skipped} skipped  - {failed} failed")


if __name__ == "__main__":
    cursor_api.maybe_reexec_with_venv()
    main()
