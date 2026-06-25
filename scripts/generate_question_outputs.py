#!/usr/bin/env python3
"""
Unified generator for PassBar enriched question outputs.

Single entry point for the whole pipeline — no more castudy dependency:

  --mode build      Sync out/{subject}/{chapter}/{subject}_{chapter}_enriched.json
                     from the latest scrape under questions/{subject}/{chapter}_*/*.json.
                     Never touches fields already present for an existing index;
                     only adds questions/fields that are missing.
  --mode translate  AI-translate zh-question / zh-choices for questions missing them.
  --mode zh-html    AI-generate zh-explanation HTML.
  --mode en-html    AI-generate explanation (English) HTML.
  --mode meta       AI-generate question_analysis meta.
  --mode all        translate + zh-html + meta + en-html

It reads and writes the enriched JSON file directly.
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import re
import shutil
import sys
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cli_ai
import cursor_api
from ai_prompts import format_prompt, load_prompt

VALID_MODES = {"build", "translate", "zh-html", "en-html", "meta", "all"}
DEFAULT_ALL_MODES = ["translate", "zh-html", "meta", "en-html"]
RUN_ID = time.strftime("%Y%m%d-%H%M%S")
_BACKED_UP_FILES: set[Path] = set()
USAGE_CSV_COLUMNS = [
    "timestamp",
    "run_id",
    "started_at",
    "finished_at",
    "duration_seconds",
    "enriched_file",
    "subject",
    "chapter",
    "index",
    "question_label",
    "mode",
    "generated_field",
    "provider",
    "model",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "configured_max_output_tokens",
    "recommended_max_output_tokens_20pct",
    "output_token_headroom",
    "output_token_utilization",
    "image_detail",
    "output_chars",
    "output_bytes",
    "status",        # "ok" | "error"
    "generated_summary",
]


# ─────────────────────────────────────────────────────────────────────────────
# Env / provider setup
# ─────────────────────────────────────────────────────────────────────────────

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

GEMINI_TRANSLATE_TEMPLATE = load_prompt("zh_translate")
GEMINI_PROMPT_TEMPLATE = load_prompt("zh_explanation")
META_PROMPT = load_prompt("meta_analysis")

GEMINI_MODEL = "gemini-3.5-flash"
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.4-mini")
OPENAI_MAX_OUTPUT_TOKENS = int(os.environ.get("OPENAI_MAX_OUTPUT_TOKENS", "65536"))
HTML_MAX_OUTPUT_TOKENS = int(os.environ.get("HTML_MAX_OUTPUT_TOKENS", "10000"))
OPENAI_HTML_MAX_OUTPUT_TOKENS = int(
    os.environ.get("OPENAI_HTML_MAX_OUTPUT_TOKENS", str(HTML_MAX_OUTPUT_TOKENS))
)
GEMINI_DEFAULT_MAX_OUTPUT_TOKENS = int(
    os.environ.get("GEMINI_DEFAULT_MAX_OUTPUT_TOKENS", "65536")
)
OPENAI_IMAGE_DETAIL = os.environ.get("OPENAI_IMAGE_DETAIL", "high")
AI_PROVIDER = "gemini"
AI_MODEL = GEMINI_MODEL
AI_HTML_MODEL = GEMINI_MODEL
GEMINI_REST_HTML_MODEL = GEMINI_MODEL
META_MODEL = GEMINI_MODEL
RATE_LIMIT_DELAY = 5
MAX_RETRIES = 3
LAST_AI_USAGE: dict[str, Any] | None = None

_GEMINI_API_KEYS: list[str] = [
    k for k in [os.environ.get(f"GEMINI_API_KEY_{i}") for i in range(1, 20)] if k
]
_key_index = 0


class RateLimitedError(Exception):
    pass


class NonTextGeminiResponseError(Exception):
    """Gemini returned a billable response but no text payload to consume."""


def set_ai_provider(provider: str, model: str | None = None, html_model: str | None = None) -> None:
    """Set provider/model for translate, zh-html, en-html, and meta."""
    global AI_PROVIDER, AI_MODEL, AI_HTML_MODEL, GEMINI_REST_HTML_MODEL, META_MODEL
    AI_PROVIDER = provider
    GEMINI_REST_HTML_MODEL = os.environ.get("GEMINI_HTML_MODEL", GEMINI_MODEL)
    if provider == "gpt":
        AI_MODEL = model or OPENAI_MODEL
        AI_HTML_MODEL = html_model or AI_MODEL
    elif provider == "codex-cli":
        AI_MODEL = model or os.environ.get("CODEX_CLI_MODEL", "")
        AI_HTML_MODEL = html_model or os.environ.get("CODEX_CLI_HTML_MODEL", AI_MODEL)
    elif provider == "antigravity-cli":
        AI_MODEL = model or os.environ.get("ANTIGRAVITY_CLI_MODEL", "")
        AI_HTML_MODEL = html_model or os.environ.get("ANTIGRAVITY_CLI_HTML_MODEL", AI_MODEL)
    elif provider == "claude-cli":
        AI_MODEL = model or os.environ.get("CLAUDE_CLI_MODEL", "claude-sonnet-4-6")
        AI_HTML_MODEL = html_model or os.environ.get("CLAUDE_CLI_HTML_MODEL", "claude-sonnet-4-6")
    elif provider == "cursor-cli":
        AI_MODEL = model or os.environ.get("CURSOR_CLI_MODEL", "composer-2.5")
        AI_HTML_MODEL = html_model or os.environ.get("CURSOR_CLI_HTML_MODEL", AI_MODEL)
    elif provider == "cursor-api":
        default_model = os.environ.get("CURSOR_API_MODEL", os.environ.get("CURSOR_CLI_MODEL", "composer-2.5"))
        default_html = os.environ.get(
            "CURSOR_API_HTML_MODEL",
            os.environ.get("CURSOR_CLI_HTML_MODEL", "gpt-5.4-mini"),
        )
        AI_MODEL = model or default_model
        AI_HTML_MODEL = html_model or default_html
    else:
        AI_MODEL = model or GEMINI_MODEL
        AI_HTML_MODEL = html_model or GEMINI_REST_HTML_MODEL
    META_MODEL = AI_MODEL


def clear_last_ai_usage() -> None:
    global LAST_AI_USAGE
    LAST_AI_USAGE = None


def get_last_ai_usage() -> dict | None:
    return dict(LAST_AI_USAGE) if LAST_AI_USAGE else None


def next_api_key() -> str:
    global _key_index
    if not _GEMINI_API_KEYS:
        raise RuntimeError(
            "No GEMINI_API_KEY_1 ~ GEMINI_API_KEY_N found in environment or .env file."
        )
    key = _GEMINI_API_KEYS[_key_index % len(_GEMINI_API_KEYS)]
    _key_index += 1
    return key


def _set_last_ai_usage(
    provider: str,
    model: str,
    input_tokens: object,
    output_tokens: object,
    total_tokens: object,
    max_output_tokens: object = "",
    image_detail: object = "",
) -> None:
    global LAST_AI_USAGE
    LAST_AI_USAGE = {
        "provider": provider,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "max_output_tokens": max_output_tokens,
        "image_detail": image_detail,
    }


def _print_gemini_usage(data: dict, model: str, configured_max_output: int) -> None:
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
    _set_last_ai_usage("gemini", model, prompt_tokens, output_tokens, total_tokens, configured_max_output, "")
    print(f"    Gemini usage: input={prompt_tokens} output={output_tokens} total={total_tokens}", flush=True)


def _extract_gemini_text(data: dict) -> str:
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


def call_gemini_rest(
    prompt_text: str,
    image_paths: list[str] | str | None = None,
    model: str | None = None,
    max_output_tokens: int | None = None,
) -> str:
    """Call Gemini REST API with text + optional images. Rotates API keys on 429."""
    parts: list[dict] = []
    if isinstance(image_paths, str):
        image_paths = [image_paths]
    for img_path in (image_paths or []):
        if img_path and os.path.exists(img_path):
            with open(img_path, "rb") as f:
                img_bytes = f.read()
            ext = os.path.splitext(img_path)[1].lower().lstrip(".")
            mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
            parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(img_bytes).decode()}})
    parts.append({"text": prompt_text})

    configured_max_output = max_output_tokens or GEMINI_DEFAULT_MAX_OUTPUT_TOKENS
    payload = json.dumps({
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": configured_max_output},
    }).encode()

    last_error: Exception | None = None
    n_keys = len(_GEMINI_API_KEYS)

    for round_num in range(1, MAX_RETRIES + 1):
        all_rate_limited = True
        for _ in range(n_keys):
            api_key = next_api_key()
            model_name = model or AI_MODEL
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
            try:
                req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=180) as resp:
                    data = json.loads(resp.read())
                text = _extract_gemini_text(data)
                _print_gemini_usage(data, model_name, configured_max_output)
                return text
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors="replace")
                last_error = Exception(f"HTTP {e.code} (key …{api_key[-6:]}): {body[:200]}")
                if e.code == 429:
                    print(f"    Rate limited (key …{api_key[-6:]}), trying next key …")
                elif e.code >= 500:
                    all_rate_limited = False
                    time.sleep(10)
                else:
                    raise
            except NonTextGeminiResponseError as e:
                if "RECITATION" in str(e):
                    raise RuntimeError("Gemini refused (RECITATION): prompt likely contains copyrighted text. Skipping.") from e
                raise
            except Exception as exc:
                last_error = exc
                all_rate_limited = False
                time.sleep(5)

        if all_rate_limited:
            raise RateLimitedError(f"All keys rate limited (round {round_num}), skipping question")

    raise RuntimeError(f"All API keys exhausted after {MAX_RETRIES} rounds. Last error: {last_error}")


def _mime_type_for_image(path: str) -> str:
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    if ext in ("jpg", "jpeg"):
        return "image/jpeg"
    if ext == "png":
        return "image/png"
    if ext == "webp":
        return "image/webp"
    return f"image/{ext or 'jpeg'}"


def _extract_openai_text(data: dict) -> str:
    output_text = data.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text
    chunks: list[str] = []
    for item in data.get("output", []) or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []) or []:
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str):
                chunks.append(text)
    if chunks:
        return "\n".join(chunks)
    raise RuntimeError(f"OpenAI response did not include text output: {str(data)[:500]}")


def _print_openai_usage(data: dict, model: str, configured_max_output: int) -> None:
    usage = data.get("usage")
    if not isinstance(usage, dict):
        return
    input_tokens = usage.get("input_tokens", "?")
    output_tokens = usage.get("output_tokens", "?")
    total_tokens = usage.get("total_tokens", "?")
    _set_last_ai_usage("gpt", model, input_tokens, output_tokens, total_tokens, configured_max_output, OPENAI_IMAGE_DETAIL)
    print(f"    OpenAI usage: input={input_tokens} output={output_tokens} total={total_tokens}", flush=True)


def _raise_if_openai_incomplete(data: dict) -> None:
    status = data.get("status")
    details = data.get("incomplete_details")
    if status == "incomplete":
        reason = str(details.get("reason") or "") if isinstance(details, dict) else ""
        if reason == "max_output_tokens":
            raise RuntimeError(
                "OpenAI response was truncated by max_output_tokens. "
                "Increase OPENAI_MAX_OUTPUT_TOKENS or OPENAI_HTML_MAX_OUTPUT_TOKENS and rerun this item."
            )
        raise RuntimeError(f"OpenAI response was incomplete: {details or status}")


def call_openai_responses(
    prompt_text: str,
    image_paths: list[str] | str | None = None,
    max_output_tokens: int | None = None,
) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("No OPENAI_API_KEY found in environment or .env file. Add OPENAI_API_KEY=your_key_here.")
    if isinstance(image_paths, str):
        image_paths = [image_paths]

    content: list[dict] = []
    for img_path in (image_paths or []):
        if img_path and os.path.exists(img_path):
            with open(img_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode()
            content.append({
                "type": "input_image",
                "image_url": f"data:{_mime_type_for_image(img_path)};base64,{encoded}",
                "detail": OPENAI_IMAGE_DETAIL,
            })
    content.append({"type": "input_text", "text": prompt_text})

    configured_max_output = max_output_tokens or OPENAI_MAX_OUTPUT_TOKENS
    payload = json.dumps({
        "model": AI_MODEL,
        "input": [{"role": "user", "content": content}],
        "max_output_tokens": configured_max_output,
        "store": False,
    }).encode()

    last_error: Exception | None = None
    for round_num in range(1, MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(
                "https://api.openai.com/v1/responses",
                data=payload,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.loads(resp.read())
                _print_openai_usage(data, AI_MODEL, configured_max_output)
                _raise_if_openai_incomplete(data)
                return _extract_openai_text(data)
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            last_error = Exception(f"HTTP {e.code}: {body[:500]}")
            if e.code == 429:
                raise RateLimitedError(f"OpenAI rate limited (round {round_num}), skipping question")
            if e.code >= 500:
                time.sleep(10)
                continue
            raise
        except Exception as exc:
            last_error = exc
            time.sleep(5)

    raise RuntimeError(f"OpenAI API failed after {MAX_RETRIES} rounds. Last error: {last_error}")


def call_ai_rest(
    prompt_text: str,
    image_paths: list[str] | str | None = None,
    expected: str = "one complete HTML document",
    use_html_model: bool = False,
) -> str:
    if AI_PROVIDER == "gpt":
        max_out = OPENAI_HTML_MAX_OUTPUT_TOKENS if use_html_model else OPENAI_MAX_OUTPUT_TOKENS
        return call_openai_responses(prompt_text, image_paths, max_output_tokens=max_out)
    if AI_PROVIDER == "cursor-api":
        model = (AI_HTML_MODEL if use_html_model else AI_MODEL) or None
        raw = cursor_api.call_cursor_api(prompt_text, image_paths, model, expected=expected)
        _set_last_ai_usage("cursor-api", model or "(default)", "", "", "", "", "")
        return raw
    if AI_PROVIDER in {"codex-cli", "antigravity-cli", "claude-cli", "cursor-cli"}:
        model = (AI_HTML_MODEL if use_html_model else AI_MODEL) or None
        raw = cli_ai.call_cli_ai(AI_PROVIDER, prompt_text, image_paths, model, expected=expected)
        _set_last_ai_usage(AI_PROVIDER, model or "(default)", "", "", "", "", "")
        return raw
    model = (AI_HTML_MODEL if use_html_model else AI_MODEL) or None
    max_out = HTML_MAX_OUTPUT_TOKENS if use_html_model else GEMINI_DEFAULT_MAX_OUTPUT_TOKENS
    return call_gemini_rest(prompt_text, image_paths, model=model, max_output_tokens=max_out)


def ai_label() -> str:
    labels = {
        "gpt": "GPT",
        "gemini": "Gemini",
        "codex-cli": "Codex CLI",
        "antigravity-cli": "Antigravity CLI",
        "claude-cli": "Claude CLI",
        "cursor-cli": "Cursor CLI",
        "cursor-api": "Cursor API",
    }
    return labels.get(AI_PROVIDER, AI_PROVIDER)


# ─────────────────────────────────────────────────────────────────────────────
# HTML helpers
# ─────────────────────────────────────────────────────────────────────────────

_COPYRIGHT_PATTERN = re.compile(
    r"(?:©\s*MBE(?:\s*Study\s*Aid)?|MBE\s*Study\s*Aid|MBE\s*备考助手|MBE\s*备考)[^<\n]*",
    re.IGNORECASE,
)
_COPYRIGHT_BLOCK_RE = re.compile(
    r'<(footer|div|p|small|span|section)[^>]*>'
    r'(?:[^<]|<(?!\1))*?'
    r'(?:©\s*MBE(?:\s*Study\s*Aid)?|MBE\s*Study\s*Aid|MBE\s*备考助手|MBE\s*备考|仅供学习参考|仅供参考)'
    r'[^<]*?</\1>',
    re.IGNORECASE | re.DOTALL,
)


def strip_copyright_footers(html: str) -> str:
    if not html:
        return html
    prev = None
    while prev != html:
        prev = html
        html = _COPYRIGHT_BLOCK_RE.sub('', html)
    html = _COPYRIGHT_PATTERN.sub('', html)
    html = re.sub(r'\n{3,}', '\n\n', html)
    return html.strip()


def html_to_prompt_text(html: str) -> str:
    """Convert source explanation HTML into compact plain text for AI prompts."""
    if not html:
        return ""
    text = re.sub(r"(?is)<(script|style)\b[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|li|tr|h[1-6]|section|article|table)>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    return re.sub(r"[ \t\r\f\v]+", " ", text).strip()[:6000]


_TOPIC_COMMENT_RE = re.compile(r"<!--\s*pbx-topic:\s*(.*?)\s*-->", re.IGNORECASE)


def resolve_zh_html_topic(item: dict, document_meta: dict | None = None, explanation_html: str = "") -> str:
    topic = str(item.get("topic") or "").strip()
    if topic:
        return topic
    html = explanation_html or str(item.get("explanation") or "")
    m = _TOPIC_COMMENT_RE.search(html)
    if m and m.group(1).strip():
        return m.group(1).strip()
    return str(item.get("chapter") or (document_meta or {}).get("chapter") or "").strip()


def extract_html_from_response(text: str) -> str:
    m = re.search(r"```html\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if m:
        return strip_copyright_footers(m.group(1).strip())
    m = re.search(r"(<!DOCTYPE\s+html[\s\S]*)", text, re.IGNORECASE)
    if m:
        html = m.group(1).strip()
        html = re.sub(r"\s*```\s*$", "", html).strip()
        return strip_copyright_footers(html)
    return strip_copyright_footers(text.strip())


def parse_choices_from_json(choices_raw: dict | list) -> dict[str, str]:
    if isinstance(choices_raw, dict):
        return {k.upper(): v for k, v in choices_raw.items()}
    result: dict[str, str] = {}
    for item in choices_raw or []:
        m = re.match(r"^([A-D])\.\s*", item)
        if m:
            result[m.group(1)] = item
    return result


def format_choices_for_prompt(choices: dict[str, str]) -> str:
    return "\n".join(f"{key}. {choices[key]}" for key in sorted(choices.keys()))


def build_english_explanation_prompt(en_options: dict[str, str], correct_answer: str) -> str:
    context = "\n".join(f"{key}. {value}" for key, value in sorted(en_options.items()))
    wrong_answers = [k for k in sorted(en_options.keys()) if k != correct_answer]
    return (
        load_prompt("en_explanation_restore")
        + "\n\n"
        + format_prompt(
            "en_explanation_choice_context",
            correct_answer=correct_answer or "(unknown)",
            wrong_answers=", ".join(wrong_answers) or "(unknown)",
            choices=context or "(No answer choices available)",
        )
        + "\n"
        + load_prompt("en_explanation_choice_color_rules")
    )


def call_ai_translate(subject: str, chapter: str, en_question: str, en_options: dict[str, str]) -> tuple[str, dict[str, str]]:
    """AI-translate an English question + choices into Simplified Chinese."""
    prompt = GEMINI_TRANSLATE_TEMPLATE.format(
        subject=subject,
        chapter=chapter,
        question=en_question,
        choices=format_choices_for_prompt(en_options),
    )
    raw = call_ai_rest(prompt, expected="one JSON object")
    m = re.search(r"```json\s*([\s\S]*?)\s*```", raw, re.IGNORECASE)
    json_text = m.group(1) if m else raw.strip()
    try:
        parsed = json.loads(json_text)
        zh_q = parsed.get("zh_question", "")
        zh_c = {k.upper(): v for k, v in parsed.get("zh_choices", {}).items()}
        return zh_q, zh_c
    except Exception:
        return "", {}


# ─────────────────────────────────────────────────────────────────────────────
# Meta (question_analysis) generation
# ─────────────────────────────────────────────────────────────────────────────

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

_LOCALIZED_TEXT_SCHEMA = {"type": "OBJECT", "properties": {"en": {"type": "STRING"}, "zh": {"type": "STRING"}}, "required": ["en", "zh"]}
_KEYWORD_ITEM_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "text": {"type": "STRING"},
        "label": _LOCALIZED_TEXT_SCHEMA,
        "kind": {"type": "STRING"},
        "reason": _LOCALIZED_TEXT_SCHEMA,
        "importance": {"type": "STRING"},
    },
    "required": ["text", "label", "kind", "reason", "importance"],
}
_HIGHLIGHT_ITEM_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "id": {"type": "STRING"},
        "text": {"type": "STRING"},
        "kind": {"type": "STRING"},
        "label": _LOCALIZED_TEXT_SCHEMA,
        "reason": _LOCALIZED_TEXT_SCHEMA,
        "importance": {"type": "STRING"},
    },
    "required": ["id", "text", "kind", "label", "reason", "importance"],
}
RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "micro_concept": {"type": "STRING"},
        "trap_type": {"type": "STRING"},
        "trap_type_is_new": {"type": "BOOLEAN"},
        "skill_tested": {"type": "STRING"},
        "question_keyword_meta": {
            "type": "OBJECT",
            "properties": {"keywords": {"type": "ARRAY", "items": _KEYWORD_ITEM_SCHEMA}},
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
            "properties": {"highlights": {"type": "ARRAY", "items": _HIGHLIGHT_ITEM_SCHEMA}},
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
    n_keys = len(_GEMINI_API_KEYS)

    for round_num in range(1, MAX_RETRIES + 1):
        all_rate_limited = True
        for _ in range(n_keys):
            api_key = next_api_key()
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{META_MODEL}:generateContent?key={api_key}"
            try:
                req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read())
                raw_text = _extract_gemini_text(data)
                _print_gemini_usage(data, META_MODEL, 12000)
                cleaned = re.sub(r"^```json\s*", "", raw_text.strip(), flags=re.IGNORECASE)
                cleaned = re.sub(r"\s*```$", "", cleaned)
                try:
                    return json.loads(cleaned)
                except json.JSONDecodeError as json_err:
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


def call_meta_json(prompt: str) -> dict[str, Any]:
    """Unified meta entry point — delegates to whichever provider is active."""
    if AI_PROVIDER == "gpt":
        raw = call_openai_responses(prompt, None, max_output_tokens=12000)
        return _extract_json_from_text(raw)
    if AI_PROVIDER == "cursor-api":
        raw = cursor_api.call_cursor_api(prompt, None, META_MODEL or None, expected="one JSON object matching the requested schema")
        _set_last_ai_usage("cursor-api", META_MODEL or "(default)", "", "", "", "")
        return _extract_json_from_text(raw)
    if AI_PROVIDER in {"codex-cli", "antigravity-cli", "claude-cli", "cursor-cli"}:
        raw = cli_ai.call_cli_ai(AI_PROVIDER, prompt, None, META_MODEL or None, expected="one JSON object matching the requested schema")
        _set_last_ai_usage(AI_PROVIDER, META_MODEL or "(default)", "", "", "", "")
        return _extract_json_from_text(raw)
    return call_gemini_json(prompt)


def taxonomy_list(values: list[str]) -> str:
    return "\n".join(f"- {value}" for value in values)


def canonical_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def canonical_taxonomy_value(value: Any, allowed: list[str], fallback: str | None = None) -> str | None:
    if value is None:
        return fallback
    lookup = {canonical_key(item): item for item in allowed}
    normalized = canonical_key(value)
    return lookup.get(normalized, fallback)


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


def build_meta_prompt(item: dict[str, Any], document_meta: dict[str, Any] | None) -> str:
    choices = parse_choices_from_json(item.get("choices") or {})
    choices_lines = "\n".join(f"{key}. {value}" for key, value in sorted(choices.items()))
    answer = answer_letter(item)
    explanation_html = item.get("explanation") or ""
    subject = item.get("subject") or (document_meta or {}).get("subject") or ""
    topic = item.get("topic") or item.get("chapter") or (document_meta or {}).get("chapter") or ""
    text_explanation = re.sub(r"<[^>]+>", " ", str(explanation_html))
    text_explanation = re.sub(r"\s+", " ", text_explanation).strip()[:3500]

    return (
        META_PROMPT
        .replace("__TRAP_TYPES__", taxonomy_list(TRAP_TYPES))
        .replace("__SUBJECT__", str(subject))
        .replace("__TOPIC__", str(topic))
        .replace("__QUESTION__", str(item.get("question") or "").strip())
        .replace("__CHOICES__", choices_lines)
        .replace("__CORRECT_ANSWER__", answer)
        .replace("__EXPLANATION__", text_explanation)
    )


def normalize_analysis_meta(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        value = {}

    highlight_meta = value.get("question_highlight_meta")
    highlights = highlight_meta.get("highlights") if isinstance(highlight_meta, dict) else []
    if not isinstance(highlights, list):
        highlights = []

    valid_kinds = {"key_sentence", "keyword", "issue", "rule_trigger", "fact_trigger"}
    valid_keyword_kinds = {
        "legal_term", "fact_trigger", "procedural_posture", "party_role",
        "time_marker", "trap_phrase", "remedy_or_relief",
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
    question_keywords_raw = question_keyword_meta.get("keywords") if isinstance(question_keyword_meta, dict) else []
    if not isinstance(question_keywords_raw, list):
        question_keywords_raw = []
    question_keywords = [kw for i, it in enumerate(question_keywords_raw, 1) if (kw := clean_keyword(it, i))]

    choice_keyword_meta = value.get("choice_keyword_meta")
    choices_raw = choice_keyword_meta.get("choices") if isinstance(choice_keyword_meta, dict) else {}
    if not isinstance(choices_raw, dict):
        choices_raw = {}
    choice_keywords: dict[str, list[dict[str, Any]]] = {}
    for choice in ("A", "B", "C", "D"):
        raw_items = choices_raw.get(choice) or choices_raw.get(choice.lower()) or []
        if not isinstance(raw_items, list):
            raw_items = []
        choice_keywords[choice] = [kw for i, it in enumerate(raw_items, 1) if (kw := clean_keyword(it, i))]

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
        "question_keyword_meta": {"keywords": question_keywords},
        "choice_keyword_meta": {"choices": choice_keywords},
        "question_highlight_meta": {"highlights": cleaned_highlights},
    }


def get_existing_analysis_meta(item: dict[str, Any]) -> dict[str, Any] | None:
    meta = item.get("meta")
    if isinstance(meta, dict) and isinstance(meta.get("question_analysis"), dict):
        return meta["question_analysis"]
    return None


def has_complete_meta(item: dict[str, Any]) -> bool:
    existing = get_existing_analysis_meta(item)
    if not existing:
        return False
    meta = normalize_analysis_meta(existing)
    return bool(
        meta["micro_concept"]
        and meta["skill_tested"]
        and meta["question_highlight_meta"]["highlights"]
        and meta["question_keyword_meta"]["keywords"]
    )


def save_analysis_meta(item: dict[str, Any], generated: dict[str, Any]) -> dict[str, Any]:
    analysis_meta = normalize_analysis_meta(generated)
    if not analysis_meta["micro_concept"] or not analysis_meta["skill_tested"]:
        raise ValueError("AI response missing required micro_concept or skill_tested")

    existing_meta = item.get("meta") if isinstance(item.get("meta"), dict) else {}
    item["meta"] = {
        **existing_meta,
        "question_analysis": {
            **analysis_meta,
            "generated_by": "generate_question_outputs.py",
            "generated_model": META_MODEL or AI_PROVIDER,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    return item["meta"]["question_analysis"]


# ─────────────────────────────────────────────────────────────────────────────
# Enriched JSON I/O
# ─────────────────────────────────────────────────────────────────────────────

def parse_enriched_document(raw: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if isinstance(raw, list):
        first = raw[0] if raw else {}
        return [item for item in raw if isinstance(item, dict)], {
            "subject": first.get("subject", ""),
            "chapter": first.get("chapter", ""),
            "count": first.get("count", len(raw)),
        }
    if isinstance(raw, dict) and isinstance(raw.get("questions"), list):
        return [item for item in raw["questions"] if isinstance(item, dict)], raw.get("meta") or {}
    raise ValueError("Unsupported enriched JSON shape. Expected an array or an object with questions[].")


def write_enriched(path: Path, document: Any) -> None:
    backup_path = path.with_suffix(path.suffix + f".{RUN_ID}.bak")
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    rendered = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    tmp_path.write_text(rendered, encoding="utf-8")
    json.loads(tmp_path.read_text(encoding="utf-8"))
    resolved = path.resolve()
    if resolved not in _BACKED_UP_FILES and path.exists():
        shutil.copy2(path, backup_path)
        _BACKED_UP_FILES.add(resolved)
        print(f"  backup: {backup_path.name}")
    os.replace(tmp_path, path)
    if backup_path.exists():
        backup_path.unlink()
        print(f"  backup deleted: {backup_path.name}")


def compact_summary(value: Any, max_len: int = 180) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:max_len]


def int_or_none(value: Any) -> int | None:
    try:
        if value in ("", None, "?"):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def round_up(value: int, step: int = 1000) -> int:
    return ((value + step - 1) // step) * step


def timed_call(fn):
    started_at = time.strftime("%Y-%m-%d %H:%M:%S")
    t0 = time.perf_counter()
    result = fn()
    duration_seconds = time.perf_counter() - t0
    finished_at = time.strftime("%Y-%m-%d %H:%M:%S")
    return result, started_at, finished_at, duration_seconds


def write_usage_csv(
    csv_path: Path | None,
    enriched_file: Path,
    item: dict[str, Any],
    mode: str,
    generated_field: str,
    usage: dict[str, Any] | None,
    started_at: str,
    finished_at: str,
    duration_seconds: float,
    output_chars: int,
    output_bytes: int,
    generated_summary: str,
) -> None:
    if not csv_path:
        return
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    exists = csv_path.exists()
    output_tokens = int_or_none((usage or {}).get("output_tokens"))
    configured_max = int_or_none((usage or {}).get("max_output_tokens"))
    recommended_max = round_up(max(1000, int(output_tokens * 1.2))) if output_tokens is not None else ""
    headroom = configured_max - output_tokens if configured_max is not None and output_tokens is not None else ""
    utilization = f"{output_tokens / configured_max:.4f}" if configured_max and output_tokens is not None else ""
    row = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "run_id": RUN_ID,
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_seconds": f"{duration_seconds:.3f}",
        "enriched_file": str(enriched_file),
        "subject": item.get("subject", ""),
        "chapter": item.get("chapter", ""),
        "index": item.get("index", ""),
        "question_label": question_label(item),
        "mode": mode,
        "generated_field": generated_field,
        "provider": (usage or {}).get("provider", ""),
        "model": (usage or {}).get("model", ""),
        "input_tokens": (usage or {}).get("input_tokens", ""),
        "output_tokens": (usage or {}).get("output_tokens", ""),
        "total_tokens": (usage or {}).get("total_tokens", ""),
        "configured_max_output_tokens": (usage or {}).get("max_output_tokens", ""),
        "recommended_max_output_tokens_20pct": recommended_max,
        "output_token_headroom": headroom,
        "output_token_utilization": utilization,
        "image_detail": (usage or {}).get("image_detail", ""),
        "output_chars": output_chars,
        "output_bytes": output_bytes,
        "status": "ok",
        "generated_summary": compact_summary(generated_summary),
    }
    with csv_path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=USAGE_CSV_COLUMNS)
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def write_error_csv(csv_path: Path | None, enriched_file: Path, item: dict[str, Any], mode: str) -> None:
    """Record a failed generation attempt in the usage CSV (status only; details are in the log file)."""
    if not csv_path:
        return
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    exists = csv_path.exists()
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    row = {
        "timestamp": now,
        "run_id": RUN_ID,
        "started_at": now,
        "finished_at": now,
        "duration_seconds": "",
        "enriched_file": str(enriched_file),
        "subject": item.get("subject", ""),
        "chapter": item.get("chapter", ""),
        "index": item.get("index", ""),
        "question_label": question_label(item),
        "mode": mode,
        "generated_field": "",
        "provider": AI_PROVIDER,
        "model": AI_HTML_MODEL if mode in {"en-html", "zh-html"} else AI_MODEL,
        "input_tokens": "",
        "output_tokens": "",
        "total_tokens": "",
        "configured_max_output_tokens": "",
        "recommended_max_output_tokens_20pct": "",
        "output_token_headroom": "",
        "output_token_utilization": "",
        "image_detail": "",
        "output_chars": "",
        "output_bytes": "",
        "status": "error",
        "generated_summary": "",
    }
    with csv_path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=USAGE_CSV_COLUMNS)
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def question_label(item: dict[str, Any]) -> str:
    return str(item.get("id") or item.get("question_id") or f"index-{item.get('index', '')}")


def answer_letter(item: dict[str, Any]) -> str:
    return str(
        item.get("answer") or item.get("correct_answer") or item.get("correctAnswer") or ""
    ).strip().upper()[:1]


def collect_image_paths(enriched_file: Path, item: dict[str, Any]) -> list[str]:
    image_paths: list[str] = []
    for key in ("source_img", "sourceExplanationImageFile"):
        rel = str(item.get(key) or "").strip()
        if not rel:
            continue
        path = enriched_file.parent / rel
        if path.exists():
            image_paths.append(str(path))
    return list(dict.fromkeys(image_paths))


def is_complex_illustration(path: Path) -> bool:
    """Classify if an image is a complex illustration/photo or a simple diagram/table.
    We resize to 128x128 and count unique colors and compute standard deviation.
    A complex illustration typically has >= 4000 unique colors AND standard deviation >= 45.0.
    """
    try:
        from PIL import Image
        import math
        with Image.open(path) as img:
            img_rgb = img.convert("RGB")
            img_small = img_rgb.resize((128, 128))
            colors = img_small.getcolors(maxcolors=128 * 128)
            uniq_count = len(colors) if colors else 128 * 128
            if uniq_count < 4000:
                return False
            img_gray = img_small.convert("L")
            pixels = list(img_gray.getdata())
            mean_val = sum(pixels) / len(pixels)
            variance = sum((x - mean_val) ** 2 for x in pixels) / len(pixels)
            std_dev = math.sqrt(variance)
            return std_dev >= 45.0
    except Exception as exc:
        print(f"    [img-classifier] failed to analyze {path.name}: {exc}")
        return True


def collect_explain_img_paths(enriched_file: Path, item: dict[str, Any]) -> list[str]:
    """Return absolute paths for previously-saved explain_imgs referenced in the enriched item."""
    paths: list[str] = []
    cleaned_rels: list[str] = []
    for rel in item.get("explain_imgs") or []:
        rel = str(rel).strip()
        if not rel:
            continue
        path = enriched_file.parent / rel
        if path.exists():
            if is_complex_illustration(path):
                paths.append(str(path))
                cleaned_rels.append(rel)
            else:
                print(f"  [img-classifier] {path.name} classified as simple diagram/table; forcing HTML rebuild (excluding from explain_imgs)")
    if "explain_imgs" in item:
        item["explain_imgs"] = cleaned_rels
    return paths


def has_good_html(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(text and not text.startswith("<!-- ERROR:"))


def validate_generated_html(html: str, label: str) -> None:
    text = str(html or "").strip()
    lowered = text.lower()
    if len(text) < 1000:
        raise RuntimeError(f"{label} output is suspiciously short ({len(text)} chars); refusing to write it.")
    if not lowered.startswith("<!doctype html"):
        preview = repr(text[:300])
        raise RuntimeError(f"{label} output does not start with <!doctype html>; refusing to write it.\n  Output starts with: {preview}")
    if "</html>" not in lowered:
        preview = repr(text[-300:])
        raise RuntimeError(f"{label} output is missing </html>; refusing to write it.\n  Output ends with: {preview}")


def has_good_meta(item: dict[str, Any]) -> bool:
    return has_complete_meta(item)


TOPIC_COMMENT_RE = re.compile(r'<!--\s*pbx-topic:\s*(.*?)\s*-->', re.IGNORECASE)


def extract_topic_from_html(html: str) -> str | None:
    m = TOPIC_COMMENT_RE.search(html)
    if m:
        value = m.group(1).strip()
        return value if value else None
    return None


def generate_en_html(item: dict[str, Any], image_paths: list[str], explain_img_paths: list[str] | None = None) -> tuple[str, str | None]:
    """Returns (html, topic_or_None)."""
    choices = parse_choices_from_json(item.get("choices") or {})
    prompt = build_english_explanation_prompt(choices, answer_letter(item))

    if explain_img_paths:
        rel_refs = [f"imgs/{os.path.basename(p)}" for p in explain_img_paths]
        img_tags = "".join(
            f'<figure class="pbx-explain-img">\n'
            f'  <img src="{r}" alt="Explanation diagram"'
            f' style="max-width:100%;height:auto;display:block;margin:0 auto;">\n'
            f"</figure>\n"
            for r in rel_refs
        )
        prompt += format_prompt(
            "en_explanation_illustration_images",
            img_refs="".join(f"  - `{r}`\n" for r in rel_refs),
            img_tags=img_tags,
        )
        all_image_paths = image_paths + [p for p in explain_img_paths if p not in image_paths]
    else:
        all_image_paths = image_paths

    raw = call_ai_rest(prompt, all_image_paths, use_html_model=True)
    html = extract_html_from_response(raw)

    if explain_img_paths:
        for p in explain_img_paths:
            ref = f"imgs/{os.path.basename(p)}"
            if ref not in html:
                raise RuntimeError(f"Generated HTML is missing required illustration image reference: '{ref}'")

    topic = extract_topic_from_html(html)
    return html, topic


def generate_zh_html(item: dict[str, Any], document_meta: dict[str, Any], image_paths: list[str]) -> str:
    choices = parse_choices_from_json(item.get("choices") or {})
    correct = answer_letter(item)
    english_explanation = html_to_prompt_text(str(item.get("explanation") or ""))
    prompt = GEMINI_PROMPT_TEMPLATE.format(
        subject=item.get("subject") or document_meta.get("subject", ""),
        chapter=item.get("chapter") or document_meta.get("chapter", ""),
        topic=resolve_zh_html_topic(item, document_meta, english_explanation),
        question=str(item.get("question") or ""),
        choices=format_choices_for_prompt(choices),
        correct_answer_letter=correct,
        correct_answer_text=choices.get(correct, ""),
        english_explanation=english_explanation or "(No supplemental OCR/plain text available; use the uploaded official explanation image.)",
    )
    raw = call_ai_rest(prompt, image_paths, use_html_model=True)
    return extract_html_from_response(raw)


def generate_meta(item: dict[str, Any], document_meta: dict[str, Any]) -> dict[str, Any]:
    generated = call_meta_json(build_meta_prompt(item, document_meta))
    return save_analysis_meta(item, generated)


def generate_translation(item: dict[str, Any], document_meta: dict[str, Any]) -> tuple[str, dict[str, str]]:
    choices = parse_choices_from_json(item.get("choices") or {})
    subject = item.get("subject") or document_meta.get("subject", "")
    chapter = item.get("chapter") or document_meta.get("chapter", "")
    return call_ai_translate(subject, chapter, str(item.get("question") or ""), choices)


def write_zh_html_preview(enriched_file: Path, item: dict[str, Any]) -> None:
    html = item.get("zh-explanation")
    if not html:
        return
    index = int(item.get("index") or 0)
    if index <= 0:
        return
    preview_dir = enriched_file.parent / "zh_html"
    preview_dir.mkdir(exist_ok=True)
    (preview_dir / f"q{index:04d}.html").write_text(str(html), encoding="utf-8")


def parse_index_range(value: str) -> set[int]:
    """Parse index range string like '3', '3-10', '3,5,7', '3-10,15,20-25' into a set of ints."""
    result: set[int] = set()
    for part in value.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = part.split("-", 1)
            result.update(range(int(lo.strip()), int(hi.strip()) + 1))
        elif part:
            result.add(int(part))
    return result


def has_missing_zh_translation(item: dict[str, Any]) -> bool:
    choices = parse_choices_from_json(item.get("choices") or {})
    zh_choices = item.get("zh-choices") or {}
    missing_choice = any(not str(zh_choices.get(k, "")).strip() for k in choices)
    return not str(item.get("zh-question", "")).strip() or missing_choice


# ─────────────────────────────────────────────────────────────────────────────
# build mode — sync enriched JSON from the latest questions/ scrape
# ─────────────────────────────────────────────────────────────────────────────

QUESTIONS_DIR = Path(__file__).parent.parent / "questions"


def sanitize_chapter(chapter: str) -> str:
    """Some raw scrapes have '/' in meta.chapter (e.g. 'Mortgages/Security Devices'),
    which would otherwise be misread as a path separator. Normalize to '-' so it
    matches the existing out/ folder naming convention."""
    return chapter.replace("/", "-")


def find_latest_raw_file(subject: str, chapter: str) -> Path | None:
    """Find the most recently scraped questions/{subject}/*/*.json for (subject, chapter)."""
    subject_dir = QUESTIONS_DIR / subject
    if not subject_dir.is_dir():
        return None

    best_path: Path | None = None
    best_captured: str = ""
    for json_path in subject_dir.glob("*/*.json"):
        try:
            raw = json.loads(json_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        meta = raw.get("meta") or {}
        raw_subject = str(meta.get("subject", "")).strip()
        raw_chapter = sanitize_chapter(str(meta.get("chapter", "")).strip())
        if raw_subject != subject or raw_chapter != chapter:
            continue
        captured = str(meta.get("capturedAt") or "")
        if not best_path or captured > best_captured:
            best_path = json_path
            best_captured = captured
    return best_path


def list_raw_subject_chapters() -> list[tuple[str, str]]:
    """Scan questions/ once and return all distinct (subject, chapter) pairs found in meta."""
    pairs: set[tuple[str, str]] = set()
    for json_path in QUESTIONS_DIR.glob("*/*/*.json"):
        try:
            raw = json.loads(json_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        meta = raw.get("meta") or {}
        subject = str(meta.get("subject", "")).strip()
        chapter = sanitize_chapter(str(meta.get("chapter", "")).strip())
        if subject and chapter:
            pairs.add((subject, chapter))
    return sorted(pairs)


def resolve_subject_chapter_pairs(subjects: list[str] | None, chapters: list[str] | None) -> list[tuple[str, str]]:
    """Filter all known (subject, chapter) pairs found under questions/ by CLI scope."""
    all_pairs = list_raw_subject_chapters()
    if subjects and chapters:
        return [(s, c) for s, c in all_pairs if s in subjects and c in chapters]
    if subjects:
        return [(s, c) for s, c in all_pairs if s in subjects]
    if chapters:
        return [(s, c) for s, c in all_pairs if c in chapters]
    return all_pairs


def canonical_enriched_path(subject: str, chapter: str) -> Path:
    return OUT_DIR / subject / chapter / f"{subject}_{chapter}_enriched.json"


def find_existing_enriched_for_build(subject: str, chapter: str) -> Path | None:
    """Prefer the canonical filename; otherwise reuse whatever *_enriched.json already exists."""
    canonical = canonical_enriched_path(subject, chapter)
    if canonical.exists():
        return canonical
    chapter_dir = OUT_DIR / subject / chapter
    if not chapter_dir.is_dir():
        return None
    candidates = sorted(chapter_dir.glob("*_enriched.json"))
    return candidates[0] if candidates else None


def build_enriched_file(subject: str, chapter: str, dry_run: bool, quiet: bool = False) -> Path | None:
    """Sync out/{subject}/{chapter}/{subject}_{chapter}_enriched.json from the latest raw scrape.

    Existing question records (matched by index) are left completely untouched —
    only missing indices and brand-new fields on those new records are added.

    quiet: suppress the "no new questions" line (used for the automatic pre-sync
    that now runs before translate/zh-html/en-html/meta so the user doesn't have
    to remember a separate --mode build step).
    """
    raw_path = find_latest_raw_file(subject, chapter)
    if not raw_path:
        if not quiet:
            print(f"  [build] {subject} / {chapter}: no questions/ scrape found, skipping")
        return None

    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    raw_meta = raw.get("meta") or {}
    raw_questions = raw.get("questions") or []
    count = raw_meta.get("count", len(raw_questions))

    output_path = canonical_enriched_path(subject, chapter)
    existing_source = find_existing_enriched_for_build(subject, chapter)
    existing_records: dict[int, dict[str, Any]] = {}
    if existing_source and existing_source.exists():
        existing_doc = json.loads(existing_source.read_text(encoding="utf-8"))
        existing_items, _ = parse_enriched_document(existing_doc)
        for it in existing_items:
            idx = it.get("index")
            if idx is not None:
                existing_records[int(idx)] = it

    raw_dir = raw_path.parent
    output_dir = output_path.parent
    source_imgs_dir = output_dir / "source_imgs"

    new_count = 0
    output_records: dict[int, dict[str, Any]] = dict(existing_records)

    for q in raw_questions:
        idx = int(q.get("index") or 0)
        if idx in existing_records:
            continue  # never touch an existing record's fields

        choices = {str(k).upper(): v for k, v in (q.get("choices") or {}).items()}
        answer = str(q.get("correctAnswer") or "").strip().upper()[:1]

        source_img = ""
        rel_img = str(q.get("explanationImageFile") or "").strip()
        if rel_img and not dry_run:
            src = raw_dir / rel_img
            if src.exists():
                source_imgs_dir.mkdir(parents=True, exist_ok=True)
                dest = source_imgs_dir / Path(rel_img).name
                if not dest.exists():
                    shutil.copy2(src, dest)
                source_img = f"source_imgs/{dest.name}"
        elif rel_img:
            source_img = f"source_imgs/{Path(rel_img).name}"

        output_records[idx] = {
            "index": idx,
            "subject": subject,
            "chapter": chapter,
            "count": count,
            "question": q.get("question", ""),
            "choices": choices,
            "answer": answer,
            "source_img": source_img,
            "explanation": "",
            "zh-question": "",
            "zh-choices": {},
            "zh-explanation": "",
        }
        new_count += 1

    if dry_run:
        if not quiet or new_count > 0:
            print(f"  [build] {subject} / {chapter}: would add {new_count} new question(s) "
                  f"(existing {len(existing_records)}) -> {output_path}")
        return None

    if new_count == 0 and existing_source == output_path:
        if not quiet:
            print(f"  [build] {subject} / {chapter}: up to date ({len(existing_records)} question(s))")
        return output_path

    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "subject": subject,
            "chapter": chapter,
            "count": count,
            "updatedAt": datetime.now().isoformat(timespec="seconds"),
            "sourceQuestionsFile": raw_path.name,
            "schema": "passbar.enriched.v2",
        },
        "questions": [output_records[i] for i in sorted(output_records)],
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  [build] {subject} / {chapter}: +{new_count} new question(s), "
          f"{len(output_records)} total -> {output_path}")
    return output_path


# ─────────────────────────────────────────────────────────────────────────────
# Main per-file processing
# ─────────────────────────────────────────────────────────────────────────────

def process_file(
    enriched_file: Path,
    modes: list[str],
    limit: int,
    index: int | None,
    index_range: set[int] | None,
    force: bool,
    dry_run: bool,
    usage_csv: Path | None,
) -> None:
    document = json.loads(enriched_file.read_text(encoding="utf-8"))
    items, document_meta = parse_enriched_document(document)
    selected = items
    if index_range is not None:
        selected = [item for item in selected if int(item.get("index") or -1) in index_range]
    elif index is not None:
        selected = [item for item in selected if int(item.get("index") or -1) == index]
    if limit > 0:
        selected = selected[:limit]

    print(f"Loaded {len(items)} question(s) from {enriched_file}")
    print(f"Selected {len(selected)} question(s)")
    print(f"Modes: {' '.join(modes)}")

    changed = False
    for position, item in enumerate(selected, 1):
        label = question_label(item)
        image_paths = collect_image_paths(enriched_file, item)
        explain_img_paths = collect_explain_img_paths(enriched_file, item)
        print(f"\n[{position}/{len(selected)}] {label} / index {item.get('index')}")
        if explain_img_paths:
            print(f"  explain_imgs: {len(explain_img_paths)} file(s)")

        for mode in modes:
            if mode == "translate":
                if not force and not has_missing_zh_translation(item):
                    print("  translate: cached (use --force to replace)")
                    continue
                if dry_run:
                    print("  translate: would generate")
                    continue
                print("  translate: generating...", end=" ", flush=True)
                clear_last_ai_usage()
                try:
                    (zh_q, zh_c), started_at, finished_at, duration_seconds = timed_call(
                        lambda: generate_translation(item, document_meta)
                    )
                except Exception as exc:
                    print(f"ERROR: {exc}")
                    traceback.print_exc()
                    write_error_csv(usage_csv, enriched_file, item, "translate")
                    time.sleep(RATE_LIMIT_DELAY)
                    continue
                usage = get_last_ai_usage()
                existing_zh_choices = item.get("zh-choices") if isinstance(item.get("zh-choices"), dict) else {}
                if zh_q and not str(item.get("zh-question", "")).strip():
                    item["zh-question"] = zh_q
                for k, v in zh_c.items():
                    if v and not str(existing_zh_choices.get(k, "")).strip():
                        existing_zh_choices[k] = v
                item["zh-choices"] = existing_zh_choices
                write_usage_csv(
                    usage_csv, enriched_file, item, "translate", "zh-question/zh-choices",
                    usage, started_at, finished_at, duration_seconds,
                    len(zh_q), len(zh_q.encode("utf-8")), zh_q or "Chinese translation",
                )
                print("✓")
                changed = True
                write_enriched(enriched_file, document)
                time.sleep(RATE_LIMIT_DELAY)

            elif mode == "en-html":
                if not force and has_good_html(item.get("explanation")):
                    print("  en-html: cached (use --force to replace)")
                    continue
                if dry_run:
                    print("  en-html: would generate")
                    continue
                print("  en-html: generating...", end=" ", flush=True)
                clear_last_ai_usage()
                try:
                    (html, topic), started_at, finished_at, duration_seconds = timed_call(
                        lambda: generate_en_html(item, image_paths, explain_img_paths or None)
                    )
                    validate_generated_html(html, "en-html")
                except Exception as exc:
                    print(f"ERROR: {exc}")
                    traceback.print_exc()
                    write_error_csv(usage_csv, enriched_file, item, "en-html")
                    time.sleep(RATE_LIMIT_DELAY)
                    continue
                usage = get_last_ai_usage()
                write_usage_csv(
                    usage_csv, enriched_file, item, "en-html", "explanation",
                    usage, started_at, finished_at, duration_seconds,
                    len(html), len(html.encode("utf-8")), topic or "English explanation HTML",
                )
                item["explanation"] = html
                if topic and not item.get("topic"):
                    new_item: dict[str, Any] = {}
                    for k, v in item.items():
                        new_item[k] = v
                        if k == "chapter":
                            new_item["topic"] = topic
                    item.clear()
                    item.update(new_item)
                    print(f"✓  (topic: {topic})")
                else:
                    print("✓")
                changed = True
                write_enriched(enriched_file, document)
                time.sleep(RATE_LIMIT_DELAY)

            elif mode == "zh-html":
                if not force and has_good_html(item.get("zh-explanation")):
                    print("  zh-html: cached (use --force to replace)")
                    continue
                if dry_run:
                    print("  zh-html: would force regenerate" if force else "  zh-html: would generate")
                    continue
                print("  zh-html: forcing regeneration..." if force else "  zh-html: generating...", end=" ", flush=True)
                clear_last_ai_usage()
                try:
                    html, started_at, finished_at, duration_seconds = timed_call(
                        lambda: generate_zh_html(item, document_meta, image_paths)
                    )
                    validate_generated_html(html, "zh-html")
                except Exception as exc:
                    print(f"ERROR: {exc}")
                    traceback.print_exc()
                    write_error_csv(usage_csv, enriched_file, item, "zh-html")
                    time.sleep(RATE_LIMIT_DELAY)
                    continue
                usage = get_last_ai_usage()
                write_usage_csv(
                    usage_csv, enriched_file, item, "zh-html", "zh-explanation",
                    usage, started_at, finished_at, duration_seconds,
                    len(html), len(html.encode("utf-8")), "Chinese explanation HTML",
                )
                item["zh-explanation"] = html
                write_zh_html_preview(enriched_file, item)
                print("✓")
                changed = True
                write_enriched(enriched_file, document)
                time.sleep(RATE_LIMIT_DELAY)

            elif mode == "meta":
                if not force and has_good_meta(item):
                    print("  meta: cached (use --force to replace)")
                    continue
                if dry_run:
                    print("  meta: would generate")
                    continue
                print("  meta: generating...", end=" ", flush=True)
                clear_last_ai_usage()
                try:
                    analysis, started_at, finished_at, duration_seconds = timed_call(
                        lambda: generate_meta(item, document_meta)
                    )
                except Exception as exc:
                    print(f"ERROR: {exc}")
                    traceback.print_exc()
                    write_error_csv(usage_csv, enriched_file, item, "meta")
                    time.sleep(RATE_LIMIT_DELAY)
                    continue
                usage = get_last_ai_usage()
                print(f"✓ {analysis.get('micro_concept')}")
                changed = True
                write_enriched(enriched_file, document)
                write_usage_csv(
                    usage_csv, enriched_file, item, "meta", "meta",
                    usage, started_at, finished_at, duration_seconds,
                    len(json.dumps(analysis, ensure_ascii=False)),
                    len(json.dumps(analysis, ensure_ascii=False).encode("utf-8")),
                    analysis.get("micro_concept") or "question analysis meta",
                )
                time.sleep(RATE_LIMIT_DELAY)

    if changed and not dry_run:
        print(f"\nSaved: {enriched_file}")
    else:
        print("\nNo changes written.")


# ─────────────────────────────────────────────────────────────────────────────
# File discovery
# ─────────────────────────────────────────────────────────────────────────────

OUT_DIR = Path(__file__).parent.parent / "out"


def find_enriched_file(subject: str, chapter: str) -> Path:
    """Locate the enriched JSON under out/{subject}/{chapter}/, preferring the canonical name."""
    canonical = canonical_enriched_path(subject, chapter)
    if canonical.exists():
        return canonical
    base = OUT_DIR / subject / chapter
    candidates = list(base.glob("*_enriched.json"))
    if not candidates:
        raise FileNotFoundError(
            f"No *_enriched.json found under {base}\n"
            f"Run --mode build --subject \"{subject}\" --chapter \"{chapter}\" first, "
            f"or check available subjects: {sorted(p.name for p in OUT_DIR.iterdir() if p.is_dir())}"
        )
    if len(candidates) > 1:
        raise ValueError(f"Multiple enriched files found under {base}: {candidates}. Expected canonical {canonical.name}.")
    return candidates[0]


def list_subjects_and_chapters() -> None:
    """Print all available subject/chapter pairs."""
    for subject_dir in sorted(OUT_DIR.iterdir()):
        if not subject_dir.is_dir():
            continue
        for chapter_dir in sorted(subject_dir.iterdir()):
            if not chapter_dir.is_dir():
                continue
            if list(chapter_dir.glob("*_enriched.json")):
                print(f"  --subject \"{subject_dir.name}\" --chapter \"{chapter_dir.name}\"")


def collect_enriched_files(subjects: list[str] | None, chapters: list[str] | None) -> list[Path]:
    """Resolve which enriched files to process based on subject/chapter filters.

    - subjects + chapters  -> cross-product (each subject x each chapter)
    - subjects only        -> all chapters under each subject
    - chapters only        -> search all subjects for those chapter names
    - neither              -> all chapters in OUT_DIR (recursive)
    """
    seen: set[Path] = set()
    files: list[Path] = []

    def _add(p: Path) -> None:
        if p not in seen:
            seen.add(p)
            files.append(p)

    if subjects and chapters:
        for s in subjects:
            for c in chapters:
                _add(find_enriched_file(s, c))
    elif subjects and not chapters:
        for s in subjects:
            search_root = OUT_DIR / s
            if not search_root.is_dir():
                raise FileNotFoundError(f"Subject directory not found: {search_root}")
            for p in sorted(search_root.rglob("*_enriched.json")):
                _add(p)
    elif chapters and not subjects:
        for p in sorted(OUT_DIR.rglob("*_enriched.json")):
            if p.parent.name in chapters:
                _add(p)
    else:
        for p in sorted(OUT_DIR.rglob("*_enriched.json")):
            _add(p)

    if not files:
        raise FileNotFoundError("No *_enriched.json found for the given subject/chapter filters.")
    return files


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate PassBar enriched question outputs")
    file_group = parser.add_mutually_exclusive_group(required=False)
    file_group.add_argument("--enriched-file", type=Path, help="Path to *_enriched.json")
    file_group.add_argument("--list", action="store_true", help="List all available subject/chapter pairs and exit")
    file_group.add_argument("--all-files", action="store_true", help="Process every *_enriched.json under out/ (explicit opt-in)")
    parser.add_argument("--subject", nargs="+", help="One or more subject names (e.g. 'Evidence' 'Torts'); omit to process all")
    parser.add_argument("--chapter", nargs="+", help="One or more chapter names; omit to process all chapters")
    parser.add_argument("--mode", nargs="+", default=["translate", "zh-html", "meta"], help="One or more: build translate zh-html en-html meta all")
    parser.add_argument(
        "--provider",
        choices=("gemini", "gpt", "codex-cli", "antigravity-cli", "claude-cli", "cursor-cli", "cursor-api"),
        default="gemini",
        help="Provider for generated outputs",
    )
    parser.add_argument("--model", default="", help="Override model for all modes (translation, meta, HTML)")
    parser.add_argument("--html-model", default="", help="Override model for en-html/zh-html only (high-output model)")
    parser.add_argument("--limit", type=int, default=0, help="Only process first N selected questions")
    parser.add_argument("--index", type=int, help="Only process a specific question index (single; use --index-range for ranges)")
    parser.add_argument("--index-range", help="Index range/list to process, e.g. '5-20', '3,7,9', '1-10,15,20-25'")
    parser.add_argument("--force", action="store_true", help="Regenerate even when cached output exists")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without API calls or writes")
    parser.add_argument("--usage-csv", default="logs/ai_generation_usage.csv", help="Append per-call token usage rows to this CSV")
    parser.add_argument("--log-file", default="", help="Tee stdout+stderr to this file (default: logs/generate_outputs_<RUN_ID>.log)")
    args = parser.parse_args()

    if args.list:
        list_subjects_and_chapters()
        return

    if args.index is not None and args.index_range:
        parser.error("--index and --index-range are mutually exclusive")

    log_path = Path(args.log_file) if args.log_file else Path(f"logs/generate_outputs_{RUN_ID}.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    _log_fh = open(log_path, "w", encoding="utf-8", buffering=1)

    class _Tee:
        def __init__(self, stream, fh):
            self._s, self._f = stream, fh
        def write(self, data):
            self._s.write(data)
            self._f.write(data)
        def flush(self):
            self._s.flush()
            self._f.flush()
        def fileno(self):
            return self._s.fileno()

    sys.stdout = _Tee(sys.stdout, _log_fh)  # type: ignore[assignment]
    sys.stderr = _Tee(sys.stderr, _log_fh)  # type: ignore[assignment]
    print(f"Log: {log_path.resolve()}")
    print(f"Run ID: {RUN_ID}")

    modes: list[str] = []
    for value in args.mode:
        if value not in VALID_MODES:
            parser.error(f"Unknown mode: {value}")
        if value == "all":
            for m in DEFAULT_ALL_MODES:
                if m not in modes:
                    modes.append(m)
        elif value not in modes:
            modes.append(value)

    index_range: set[int] | None = parse_index_range(args.index_range) if args.index_range else None

    scope_parts: list[str] = []
    if args.enriched_file:
        scope_parts.append(f"file={args.enriched_file}")
    else:
        if args.subject:
            scope_parts.append(f"subject={args.subject}")
        if args.chapter:
            scope_parts.append(f"chapter={args.chapter}")
        if not args.subject and not args.chapter:
            scope_parts.append("all enriched files under out/")
    if args.index is not None:
        scope_parts.append(f"index={args.index}")
    if index_range is not None:
        scope_parts.append(f"index-range={sorted(index_range)}")
    if args.limit > 0:
        scope_parts.append(f"limit={args.limit}")
    print(f"Provider: {args.provider}")
    print(f"Modes: {' '.join(modes)}")
    print(f"Scope: {', '.join(scope_parts) if scope_parts else 'default'}")
    print(f"Force regenerate: {'ON' if args.force else 'OFF'}")
    if args.force:
        print("  -> will call API and replace existing translate / zh-html / en-html / meta outputs")
    else:
        print("  -> will skip questions that already have valid outputs (shows 'cached')")
    set_ai_provider(args.provider, args.model or None, html_model=args.html_model or None)
    if not args.dry_run and args.provider == "cursor-api":
        try:
            cursor_api.check_cursor_api_ready()
        except Exception as exc:
            parser.error(str(exc))
    if not args.dry_run and args.provider in {"codex-cli", "antigravity-cli", "claude-cli", "cursor-cli"}:
        try:
            cli_ai.check_provider_ready(args.provider)
        except Exception as exc:
            parser.error(str(exc))
    usage_csv = Path(args.usage_csv) if args.usage_csv else None

    if "build" in modes:
        print("\n[build] Syncing enriched JSON from questions/ scrapes...")
        for subject, chapter in resolve_subject_chapter_pairs(args.subject, args.chapter):
            build_enriched_file(subject, chapter, dry_run=args.dry_run)
        modes = [m for m in modes if m != "build"]
        if not modes:
            return
    elif not args.enriched_file:
        # Auto pre-sync: cheap, idempotent, no AI calls — so you never have to
        # remember a separate `--mode build` step before translate/zh-html/etc.
        for subject, chapter in resolve_subject_chapter_pairs(args.subject, args.chapter):
            build_enriched_file(subject, chapter, dry_run=args.dry_run, quiet=True)

    if args.enriched_file:
        enriched_files = [args.enriched_file]
    else:
        enriched_files = collect_enriched_files(args.subject, args.chapter)

    total = len(enriched_files)
    for file_num, enriched_file in enumerate(enriched_files, 1):
        if total > 1:
            print(f"\n{'='*60}")
            print(f"[{file_num}/{total}] {enriched_file.relative_to(OUT_DIR)}")
            print(f"{'='*60}")
        else:
            print(f"Auto-located: {enriched_file}")
        process_file(
            enriched_file=enriched_file,
            modes=modes,
            limit=args.limit,
            index=args.index,
            index_range=index_range,
            force=args.force,
            dry_run=args.dry_run,
            usage_csv=usage_csv,
        )


if __name__ == "__main__":
    cursor_api.maybe_reexec_with_venv()
    main()
