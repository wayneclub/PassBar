#!/usr/bin/env python3
"""
generate_zh_explanations.py

读取 out/ 目录下所有 castudy JSON 档案，为每一道题目输出结构化资料：
  - 英文题目、英文选项、正确答案、英文解析图（jpg/png）
  - 中文题目、中文选项（从 questionStem / options 提取）
  - 中文解析 HTML（已有的取 htmlContent；缺少的呼叫 AI 生成）

输出：
  - 每个章节目录下新增 <chapter>_enriched.json
  - 每道中文解析 HTML 额外存一份到 zh_html/<qid>.html

使用方式：
  python3 generate_zh_explanations.py                  # 处理全部
  python3 generate_zh_explanations.py --provider gpt   # 使用 OpenAI GPT
  python3 generate_zh_explanations.py --dry-run        # 只印出计划，不呼叫 API
  python3 generate_zh_explanations.py --subject "Torts" # 只处理特定 subject
  python3 generate_zh_explanations.py --chapter "Negligence" # 只处理特定 chapter
"""

import argparse
import base64
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

import cli_ai
import cursor_api
from ai_prompts import format_prompt, load_prompt

# Backward-compatible aliases for scripts that import these constants.
# zh_explanation prompt: 7 sections (no answer-box) + modular Diagram (Type A–D).
# Distractor styling: .distractor-box / .wrong-tag / .trap-word — see scripts/prompts/zh_explanation.txt
GEMINI_TRANSLATE_TEMPLATE = load_prompt("zh_translate")
GEMINI_EXPLANATION_PROMPT = load_prompt("en_explanation_restore")
GEMINI_PROMPT_TEMPLATE = load_prompt("zh_explanation")


def build_english_explanation_prompt(en_options: dict[str, str], correct_answer: str) -> str:
    context = "\n".join(
        f"{key}. {value}"
        for key, value in sorted(en_options.items())
    )
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


# ── 設定 ──────────────────────────────────────────────────────────────────────

GEMINI_MODEL = "gemini-3.5-flash"
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.4-mini")
OPENAI_MAX_OUTPUT_TOKENS = int(os.environ.get("OPENAI_MAX_OUTPUT_TOKENS", "65536"))
# en-html / zh-html: observed P95 output ~4.6k, max ~7.6k (see logs/ai_generation_usage.csv)
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
AI_HTML_MODEL = GEMINI_MODEL      # model for en-html/zh-html (may be provider-specific alias)
GEMINI_REST_HTML_MODEL = GEMINI_MODEL  # model for Gemini REST API fallback (must be a real API name)
LAST_AI_USAGE: dict | None = None

# 多組 API Key 輪替（round-robin）
# 從環境變數讀取，支援根目錄 .env.tools.local / .env.local
def _load_env_file() -> None:
    """讀取專案設定檔，補充尚未設定的環境變數。

    工具設定：專案根目錄 .env.tools.local。
    共用設定：專案根目錄 .env.local。
    """
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

_GEMINI_API_KEYS: list[str] = [
    k for k in [
        os.environ.get(f"GEMINI_API_KEY_{i}") for i in range(1, 20)
    ] if k
]

_key_index = 0  # 全域輪替指標


def set_ai_provider(provider: str, model: str | None = None, html_model: str | None = None) -> None:
    """設定本次執行使用的 AI provider/model。

    html_model: 若有設定，用於 en-html/zh-html 生成；否則 fallback 到 model。
    GEMINI_REST_HTML_MODEL 永遠用 Gemini REST API 可接受的 model name（CLI provider fallback 時使用）。
    """
    global AI_PROVIDER, AI_MODEL, AI_HTML_MODEL, GEMINI_REST_HTML_MODEL
    AI_PROVIDER = provider
    # GEMINI_REST_HTML_MODEL: always a real Gemini API model name (used when CLI falls back to Gemini)
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


def clear_last_ai_usage() -> None:
    global LAST_AI_USAGE
    LAST_AI_USAGE = None


def get_last_ai_usage() -> dict | None:
    return dict(LAST_AI_USAGE) if LAST_AI_USAGE else None


def next_api_key() -> str:
    """輪流取得下一組 API Key。"""
    global _key_index
    if not _GEMINI_API_KEYS:
        raise RuntimeError(
            "No GEMINI_API_KEY_1 ~ GEMINI_API_KEY_N found in environment or .env file."
        )
    key = _GEMINI_API_KEYS[_key_index % len(_GEMINI_API_KEYS)]
    _key_index += 1
    return key


OUT_DIR = os.environ.get("OUT_DIR", os.path.join(
    os.path.dirname(__file__), "..", "out"))
RATE_LIMIT_DELAY = 5   # 每次 API 呼叫後等待秒數
MAX_RETRIES = 3        # API 失敗重試次數



# ── 工具函式 ──────────────────────────────────────────────────────────────────

class RateLimitedError(Exception):
    """所有 API Key 均被 rate limited，呼叫方應跳過此題。"""


class NonTextGeminiResponseError(Exception):
    """Gemini returned a billable response but no text payload to consume."""


def has_chinese(text: str) -> bool:
    return any("一" <= c <= "鿿" for c in text)


def split_bilingual_stem(stem: str) -> tuple[str, str | None]:
    """從 questionStem 分離英文題目和中文題目。

    格式：Q{id}\\n\\n{EN段落1}\\n\\n...\\n\\n{ZH段落1}\\n\\n...
    策略：去掉 Q-id 前綴後，找第一個以中文字元開頭的段落作為分界點。
    """
    parts = stem.split("\n\n")

    # 去掉 Q-id 前綴（如 "Q88012"）
    if parts and re.match(r"^Q\d+$", parts[0].strip()):
        parts = parts[1:]

    # 找第一個以中文開頭的段落
    split_idx = None
    for i, part in enumerate(parts):
        stripped = part.strip()
        if stripped and has_chinese(stripped[0]):
            split_idx = i
            break

    if split_idx is None:
        return "\n\n".join(parts), None

    en_text = "\n\n".join(parts[:split_idx])
    zh_text = "\n\n".join(parts[split_idx:])
    return en_text, zh_text


def extract_option_parts(option_text: str) -> tuple[str, str]:
    """從雙語選項字串中提取英文部分和中文部分。

    格式：'A. English text\\nChinese text'
    回傳：(英文文字, 中文文字)，均不含 A./B./C./D. 前綴
    """
    lines = option_text.split("\n", 1)
    # 英文部分：去掉 "A. " 前綴
    en_line = re.sub(r"^[A-D]\.\s*", "", lines[0]).strip()
    zh_line = lines[1].strip() if len(lines) > 1 else ""
    return en_line, zh_line


def parse_choices_from_json(choices_raw: dict | list) -> dict[str, str]:
    """把 choices 欄位（可能是 dict 或 list）轉成 {'A': 'text', ...}。"""
    if isinstance(choices_raw, dict):
        return {k.upper(): v for k, v in choices_raw.items()}
    result: dict[str, str] = {}
    for item in choices_raw or []:
        m = re.match(r"^([A-D])\.\s*", item)
        if m:
            result[m.group(1)] = item
    return result


def extract_castudy_zh_fields(q: dict) -> tuple[str, dict[str, str], str, dict | None]:
    """從 castudy apiResult 提取中文題目、中文選項與 htmlContent。

    回傳 (zh_question, zh_choices, zh_html_content, api_data)。若沒有可用
    apiResult，前三者會是空值，api_data 會是 None。
    """
    api = q.get("apiResult", {})
    if not (api.get("ok") and api.get("data")):
        return "", {}, "", None

    api_data = api["data"][0]
    stem = api_data.get("questionStem", "")
    bilingual_opts = api_data.get("options", [])
    zh_html_content = api_data.get("htmlContent", "")

    _en_stem, zh_question = split_bilingual_stem(stem)
    zh_choices: dict[str, str] = {}
    for opt in bilingual_opts:
        m = re.match(r"^([A-D])\.\s*", opt)
        if not m:
            continue
        key = m.group(1)
        _en_part, zh_part_opt = extract_option_parts(opt)
        if zh_part_opt:
            zh_choices[key] = zh_part_opt

    return zh_question or "", zh_choices, zh_html_content or "", api_data


def missing_zh_choice_keys(record: dict, en_options: dict[str, str]) -> list[str]:
    """找出 record 中仍缺少中文翻譯的選項 key。"""
    zh_choices = record.get("zh-choices") or {}
    expected_keys = sorted(en_options.keys() or ["A", "B", "C", "D"])
    return [k for k in expected_keys if not str(zh_choices.get(k, "")).strip()]


def needs_zh_gemini(record: dict, en_options: dict[str, str]) -> bool:
    """判斷中文欄位是否仍需要 AI 補齊。"""
    return (
        not str(record.get("zh-question", "")).strip()
        or bool(missing_zh_choice_keys(record, en_options))
        or _is_error_html(record.get("zh-explanation", ""))
    )


def fill_zh_from_castudy(record: dict, q: dict) -> bool:
    """用 castudy 原始 JSON 補齊 enriched 的中文欄位；有修改回傳 True。"""
    zh_question, zh_choices, zh_html_content, _api_data = extract_castudy_zh_fields(q)
    changed = False

    if zh_question and not str(record.get("zh-question", "")).strip():
        record["zh-question"] = zh_question
        changed = True

    current_choices = record.get("zh-choices")
    if not isinstance(current_choices, dict):
        current_choices = {}
        record["zh-choices"] = current_choices
        changed = True

    for key, value in zh_choices.items():
        if value and not str(current_choices.get(key, "")).strip():
            current_choices[key] = value
            changed = True

    if (
        zh_html_content
        and zh_html_content.strip().startswith("<")
        and _is_error_html(record.get("zh-explanation", ""))
    ):
        record["zh-explanation"] = strip_copyright_footers(zh_html_content)
        changed = True

    return changed


def format_choices_for_prompt(choices: dict[str, str]) -> str:
    lines = []
    for key in sorted(choices.keys()):
        lines.append(f"{key}. {choices[key]}")
    return "\n".join(lines)


def _is_error_html(html: str) -> bool:
    """判斷一個 HTML 字串是否為錯誤佔位符（<!-- ERROR: ... -->）。"""
    return not html or html.strip().startswith("<!-- ERROR:")


def _has_error(record: dict) -> bool:
    """若 explanation 或 zh-explanation 任一為錯誤佔位符，回傳 True，代表需要重跑。"""
    return (
        _is_error_html(record.get("explanation", ""))
        or _is_error_html(record.get("zh-explanation", ""))
    )


def canonical_enriched_path(json_path: str) -> str:
    """同一章節固定寫入同一份 enriched JSON，不跟 castudy 日期產生新檔。"""
    chapter_dir = os.path.dirname(json_path)
    base_name = os.path.splitext(os.path.basename(json_path))[0]
    canonical_name = re.sub(r"_\d{4}-\d{2}-\d{2}_castudy$", "_castudy", base_name)
    return os.path.join(chapter_dir, f"{canonical_name}_enriched.json")


def load_enriched_questions(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    return data.get("questions", [])


def enriched_completeness_score(path: str, expected_count: int) -> tuple[float, int, int, int, int, str]:
    try:
        questions = load_enriched_questions(path)
    except Exception:
        return (0.0, 0, 0, 0, 0, path)
    count = len(questions)
    completeness = count / expected_count if expected_count > 0 else 1.0
    zh_questions = sum(1 for q in questions if str(q.get("zh-question", "")).strip())
    zh_choices = sum(1 for q in questions if q.get("zh-choices"))
    usable_zh_html = sum(
        1 for q in questions if not _is_error_html(q.get("zh-explanation", ""))
    )
    return (completeness, count, zh_questions, zh_choices, usable_zh_html, path)


def find_existing_enriched_source(output_path: str, json_path: str, expected_count: int) -> str | None:
    """找可沿用的 enriched 來源；優先 canonical，否則挑最完整的舊 dated 檔。"""
    if os.path.exists(output_path):
        return output_path

    chapter_dir = os.path.dirname(json_path)
    candidates = [
        path for path in glob.glob(os.path.join(chapter_dir, "*_enriched.json"))
        if os.path.abspath(path) != os.path.abspath(output_path)
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda path: enriched_completeness_score(path, expected_count))


_COPYRIGHT_PATTERN = re.compile(
    r"(?:©\s*MBE(?:\s*Study\s*Aid)?|MBE\s*Study\s*Aid|MBE\s*备考助手|MBE\s*备考)[^<\n]*",
    re.IGNORECASE,
)

# 匹配含有版權/品牌文字的整個 HTML 標籤區塊
_COPYRIGHT_BLOCK_RE = re.compile(
    r'<(footer|div|p|small|span|section)[^>]*>'
    r'(?:[^<]|<(?!\1))*?'
    r'(?:©\s*MBE(?:\s*Study\s*Aid)?|MBE\s*Study\s*Aid|MBE\s*备考助手|MBE\s*备考|仅供学习参考|仅供参考)'
    r'[^<]*?</\1>',
    re.IGNORECASE | re.DOTALL,
)


def strip_copyright_footers(html: str) -> str:
    """移除 HTML 中所有 MBE 版權 / branding footer 字樣（包括包裹元素）。"""
    if not html:
        return html

    # 先移除整個含有版權/品牌文字的 HTML 標籤區塊，重複套用直到無變化
    prev = None
    while prev != html:
        prev = html
        html = _COPYRIGHT_BLOCK_RE.sub('', html)
    # 移除剩餘的裸文字行
    html = _COPYRIGHT_PATTERN.sub('', html)
    # 清理連續空行
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


def resolve_zh_html_topic(
    item: dict,
    document_meta: dict | None = None,
    explanation_html: str = "",
) -> str:
    """Resolve English topic for zh-html header subtitle."""
    topic = str(item.get("topic") or "").strip()
    if topic:
        return topic
    html = explanation_html or str(item.get("explanation") or "")
    m = _TOPIC_COMMENT_RE.search(html)
    if m and m.group(1).strip():
        return m.group(1).strip()
    return str(item.get("chapter") or (document_meta or {}).get("chapter") or "").strip()


def extract_html_from_response(text: str) -> str:
    """從 AI 回覆中取出 HTML。

    處理三種情況：
    1. 包在 ```html ... ``` 中（含 thinking-model 前置文字）
    2. 裸 <!DOCTYPE html ...（可能前面有 thinking 前置文字）
    3. 都沒有：原文回傳（讓 validate 報錯）
    """
    # 先找 ```html fence（優先，最明確）
    m = re.search(r"```html\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if m:
        return strip_copyright_footers(m.group(1).strip())
    # 找 <!DOCTYPE html，忽略前置思考文字
    m = re.search(r"(<!DOCTYPE\s+html[\s\S]*)", text, re.IGNORECASE)
    if m:
        html = m.group(1).strip()
        # 如果後面還有 ``` 收尾（thinking model 可能加），截掉
        html = re.sub(r"\s*```\s*$", "", html).strip()
        return strip_copyright_footers(html)
    return strip_copyright_footers(text.strip())


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
    _set_last_ai_usage(
        "gemini",
        model,
        prompt_tokens,
        output_tokens,
        total_tokens,
        configured_max_output,
        "",
    )
    print(
        f"    Gemini usage: input={prompt_tokens} output={output_tokens} total={total_tokens}",
        flush=True,
    )


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


# ── Gemini API ────────────────────────────────────────────────────────────────

def call_gemini_rest(
    prompt_text: str,
    image_paths: list[str] | str | None = None,
    model: str | None = None,
    max_output_tokens: int | None = None,
) -> str:
    """呼叫 Gemini REST API，支援文字 + 多張圖片。
    model: 指定模型名稱；預設用 AI_MODEL。
    每次呼叫輪替使用下一組 API Key。
    """

    parts: list[dict] = []

    # 正規化為 list
    if isinstance(image_paths, str):
        image_paths = [image_paths]
    for img_path in (image_paths or []):
        if img_path and os.path.exists(img_path):
            with open(img_path, "rb") as f:
                img_bytes = f.read()
            ext = os.path.splitext(img_path)[1].lower().lstrip(".")
            mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
            parts.append({
                "inline_data": {
                    "mime_type": mime,
                    "data": base64.b64encode(img_bytes).decode(),
                }
            })

    parts.append({"text": prompt_text})

    configured_max_output = max_output_tokens or GEMINI_DEFAULT_MAX_OUTPUT_TOKENS
    payload = json.dumps({
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": configured_max_output,
        },
    }).encode()

    last_error: Exception | None = None
    # 策略：每次 429 立刻換下一組 key；
    #        只有整輪所有 key 都 429 後才等待，等待時間隨輪數遞增。
    n_keys = len(_GEMINI_API_KEYS)
    last_error: Exception | None = None

    for round_num in range(1, MAX_RETRIES + 1):
        all_rate_limited = True  # 假設這輪全部 429，有一個成功或非 429 就改 False

        for _ in range(n_keys):
            api_key = next_api_key()
            model_name = model or AI_MODEL
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model_name}:generateContent?key={api_key}"
            )
            try:
                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=180) as resp:
                    data = json.loads(resp.read())
                text = _extract_gemini_text(data)
                _print_gemini_usage(data, model_name, configured_max_output)
                return text
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors="replace")
                last_error = Exception(
                    f"HTTP {e.code} (key …{api_key[-6:]}): {body[:200]}")
                if e.code == 429:
                    print(
                        f"    Rate limited (key …{api_key[-6:]}), trying next key …")
                    # 不等待，直接換下一組 key
                elif e.code >= 500:
                    all_rate_limited = False
                    time.sleep(10)
                else:
                    raise  # 4xx 非 429 直接拋出
            except NonTextGeminiResponseError as e:
                if "RECITATION" in str(e):
                    raise RuntimeError(f"Gemini refused (RECITATION): prompt likely contains copyrighted text. Skipping.") from e
                raise
            except Exception as exc:
                last_error = exc
                all_rate_limited = False
                time.sleep(5)

        # 這輪所有 key 都被 rate limited，直接跳過（不等待）
        if all_rate_limited:
            raise RateLimitedError(
                f"All keys rate limited (round {round_num}), skipping question"
            )

    raise RuntimeError(
        f"All API keys exhausted after {MAX_RETRIES} rounds. Last error: {last_error}")


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
    _set_last_ai_usage(
        "gpt",
        model,
        input_tokens,
        output_tokens,
        total_tokens,
        configured_max_output,
        OPENAI_IMAGE_DETAIL,
    )
    print(
        f"    OpenAI usage: input={input_tokens} output={output_tokens} total={total_tokens}",
        flush=True,
    )


def _raise_if_openai_incomplete(data: dict) -> None:
    status = data.get("status")
    details = data.get("incomplete_details")
    if status == "incomplete":
        reason = ""
        if isinstance(details, dict):
            reason = str(details.get("reason") or "")
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
    """呼叫 OpenAI Responses API，支援文字 + 多張圖片。"""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "No OPENAI_API_KEY found in environment or .env file. Add OPENAI_API_KEY=your_key_here."
        )

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
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
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
                raise RateLimitedError(
                    f"OpenAI rate limited (round {round_num}), skipping question"
                )
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
        raw = cursor_api.call_cursor_api(
            prompt_text,
            image_paths,
            model,
            expected=expected,
        )
        _set_last_ai_usage("cursor-api", model or "(default)", "", "", "", "", "")
        return raw
    if AI_PROVIDER in {"codex-cli", "antigravity-cli", "claude-cli", "cursor-cli"}:
        # codex-cli supports --image flags natively.
        # antigravity-cli, claude-cli, and cursor-cli embed image paths in the prompt so their tools can view them.
        model = (AI_HTML_MODEL if use_html_model else AI_MODEL) or None
        raw = cli_ai.call_cli_ai(
            AI_PROVIDER,
            prompt_text,
            image_paths,
            model,
            expected=expected,
        )
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


# ── 核心處理邏輯 ──────────────────────────────────────────────────────────────

def call_ai_translate(
    subject: str,
    chapter: str,
    en_question: str,
    en_options: dict[str, str],
) -> tuple[str, dict[str, str]]:
    """呼叫 AI 翻譯英文題目和選項為簡體中文，回傳 (zh_question, zh_choices)。"""
    prompt = GEMINI_TRANSLATE_TEMPLATE.format(
        subject=subject,
        chapter=chapter,
        question=en_question,
        choices=format_choices_for_prompt(en_options),
    )
    raw = call_ai_rest(prompt, expected="one JSON object")
    # 嘗試解析 JSON（模型可能包在 ```json ``` 中）
    m = re.search(r"```json\s*([\s\S]*?)\s*```", raw, re.IGNORECASE)
    json_text = m.group(1) if m else raw.strip()
    try:
        parsed = json.loads(json_text)
        zh_q = parsed.get("zh_question", "")
        zh_c = {k.upper(): v for k, v in parsed.get("zh_choices", {}).items()}
        return zh_q, zh_c
    except Exception:
        return "", {}


def process_question(
    q: dict,
    chapter_dir: str,
    subject: str,
    chapter: str,
    count: int,
    dry_run: bool = False,
    existing_record: dict | None = None,
    no_gemini: bool = False,
    translate_only: bool = False,
    force_zh_html: bool = False,
) -> dict:
    """將一道題目轉為結構化格式，必要時呼叫 AI。"""

    index = q["index"]
    en_question = q.get("question", "").strip()
    choices_raw = q.get("choices", {})
    correct_answer = q.get("sourceCorrectAnswer", "").upper().strip()
    source_img_file = q.get("sourceExplanationImageFile", "")

    # 英文選項 dict（A/B/C/D → 文字）
    en_options = parse_choices_from_json(choices_raw)

    # 英文解析輔助文字；主要官方解析來源是 source_img / explain_img_files 圖片。
    en_explanation = q.get("sourceExplanationHtml", "")
    en_explanation_text = html_to_prompt_text(en_explanation)

    # 檢查是否已有 API 雙語資料
    castudy_zh_question, castudy_zh_choices, castudy_zh_html, api_data = (
        extract_castudy_zh_fields(q)
    )
    has_api = api_data is not None

    # 收集所有解析圖片路徑（source_img + API explain_img_files）
    def collect_img_paths(api_data: dict | None = None) -> list[str]:
        paths: list[str] = []
        if source_img_file:
            p = os.path.join(chapter_dir, source_img_file)
            if os.path.exists(p):
                paths.append(p)
        for rel in (api_data or {}).get("explain_img_files", []):
            p = os.path.join(chapter_dir, rel)
            if os.path.exists(p):
                paths.append(p)
        return paths

    existing_record = existing_record or {}
    zh_question = str(existing_record.get("zh-question", "")).strip()
    existing_zh_choices = existing_record.get("zh-choices") or {}
    zh_choices: dict[str, str] = (
        dict(existing_zh_choices) if isinstance(existing_zh_choices, dict) else {}
    )
    zh_explanation = existing_record.get("zh-explanation", "")
    en_explanation_html = existing_record.get("explanation", "")
    source_tag = "unknown"

    # source_img：只存 sourceExplanationImageFile（相對路徑）
    source_img = source_img_file or ""

    # 用 source_imgs 生成英文解析 HTML（若有圖片）
    def generate_explanation_html(img_paths: list[str]) -> str:
        if not img_paths:
            return ""
        print(f"  {ai_label()}(explanation) → Q{index:04d}…", end=" ", flush=True)
        try:
            raw = call_ai_rest(
                build_english_explanation_prompt(en_options, correct_answer),
                img_paths,
                use_html_model=True,
            )
            html = extract_html_from_response(raw)
            print("✓")
            time.sleep(RATE_LIMIT_DELAY)
            return html
        except RateLimitedError:
            print("⏭ SKIPPED (rate limited)")
            raise  # 向上傳遞，讓整題跳過
        except Exception as exc:
            print(f"✗ ERROR: {exc}")
            return f"<!-- ERROR: {exc} -->"

    if has_api:
        # ── 已有雙語資料：從 questionStem / options / htmlContent 提取 ──
        if castudy_zh_question and not zh_question:
            zh_question = castudy_zh_question
        for key, value in castudy_zh_choices.items():
            if value and not str(zh_choices.get(key, "")).strip():
                zh_choices[key] = value

        if not dry_run:
            # 英文解析 HTML：新記錄才用 source_imgs 生成；修補舊 enriched 時避免
            # 因為舊 explanation error 觸發不必要的 AI 呼叫。
            if no_gemini or translate_only:
                en_explanation_html = en_explanation_html or ""
            elif not existing_record and _is_error_html(en_explanation_html):
                en_explanation_html = generate_explanation_html(
                    collect_img_paths(api_data))

            # 若 htmlContent 存在則直接使用；否則呼叫 AI 生成
            if not force_zh_html and not _is_error_html(zh_explanation):
                source_tag = "cached"
            elif not force_zh_html and castudy_zh_html and castudy_zh_html.strip().startswith("<"):
                zh_explanation = strip_copyright_footers(castudy_zh_html)
                source_tag = "api"
            else:
                source_tag = "force_zh_html" if force_zh_html else "api_no_html"
                if no_gemini or translate_only:
                    print(f"  ⏭ Q{index:04d} missing zh HTML ({'translate-only' if translate_only else 'no-ai'})")
                else:
                    prompt = GEMINI_PROMPT_TEMPLATE.format(
                        subject=subject,
                        chapter=chapter,
                        topic=resolve_zh_html_topic(
                            existing_record, explanation_html=en_explanation_html or en_explanation
                        ),
                        question=en_question,
                        choices=format_choices_for_prompt(en_options),
                        correct_answer_letter=correct_answer,
                        correct_answer_text=en_options.get(correct_answer, ""),
                        english_explanation=en_explanation_text or "(No supplemental OCR/plain text available; use the uploaded official explanation image.)",
                    )
                    print(
                        f"  {ai_label()}(zh-html) → Q{index:04d}: {en_question[:55]}…", end=" ", flush=True)
                    try:
                        raw_response = call_ai_rest(
                            prompt, collect_img_paths(api_data), use_html_model=True)
                        zh_explanation = extract_html_from_response(raw_response)
                        print("✓")
                        source_tag = f"api+{AI_PROVIDER}_html"
                        time.sleep(RATE_LIMIT_DELAY)
                    except RateLimitedError:
                        raise  # 向上傳遞，整題跳過
                    except Exception as exc:
                        print(f"✗ ERROR: {exc}")
                        source_tag = "error"
                        zh_explanation = f"<!-- ERROR: {exc} -->"

            # 缺哪個中文欄位才呼叫 AI 補哪個；castudy 已有的直接沿用。
            missing_choice_keys = missing_zh_choice_keys(
                {"zh-choices": zh_choices}, en_options)
            if not zh_question or missing_choice_keys:
                if no_gemini:
                    print(f"  ⏭ Q{index:04d} missing zh question/choices (no-ai)")
                else:
                    print(
                        f"  {ai_label()}(translate) → Q{index:04d}: missing zh_question/choices", end=" ", flush=True)
                    try:
                        tq, tc = call_ai_translate(
                            subject, chapter, en_question, en_options)
                        if not zh_question:
                            zh_question = tq
                        for k, v in tc.items():
                            if k in missing_choice_keys and not zh_choices.get(k):
                                zh_choices[k] = v
                        print("✓")
                        time.sleep(RATE_LIMIT_DELAY)
                    except RateLimitedError:
                        raise  # 向上傳遞，整題跳過
                    except Exception as exc:
                        print(f"✗ TRANSLATE ERROR: {exc}")
        else:
            source_tag = "api"

    else:
        # ── 缺少 API 資料：呼叫 AI 翻譯題目+選項，並生成 HTML 解析 ──
        if dry_run:
            print(
                f"  [DRY-RUN] Q{index:04d}: would call {ai_label()} — {en_question[:70]}…")
            source_tag = f"pending_{AI_PROVIDER}"
        else:
            img_paths = collect_img_paths()

            # 1) 英文解析 HTML
            if no_gemini or translate_only:
                en_explanation_html = en_explanation_html or ""
            elif not existing_record and _is_error_html(en_explanation_html):
                en_explanation_html = generate_explanation_html(img_paths)

            # 2) 翻譯題目與選項
            missing_choice_keys = missing_zh_choice_keys(
                {"zh-choices": zh_choices}, en_options)
            if not zh_question or missing_choice_keys:
                if no_gemini:
                    print(f"  ⏭ Q{index:04d} missing zh question/choices (no-ai)")
                else:
                    print(
                        f"  {ai_label()}(translate) → Q{index:04d}: {en_question[:55]}…", end=" ", flush=True)
                    try:
                        tq, tc = call_ai_translate(
                            subject, chapter, en_question, en_options)
                        if not zh_question:
                            zh_question = tq
                        for k, v in tc.items():
                            if k in missing_choice_keys and not zh_choices.get(k):
                                zh_choices[k] = v
                        print("✓")
                        time.sleep(RATE_LIMIT_DELAY)
                    except RateLimitedError:
                        raise  # 向上傳遞，整題跳過
                    except Exception as exc:
                        print(f"✗ TRANSLATE ERROR: {exc}")

            # 3) 中文解析 HTML
            if not _is_error_html(zh_explanation):
                source_tag = "cached"
            else:
                if no_gemini or translate_only:
                    print(f"  ⏭ Q{index:04d} missing zh HTML ({'translate-only' if translate_only else 'no-ai'})")
                else:
                    prompt = GEMINI_PROMPT_TEMPLATE.format(
                        subject=subject,
                        chapter=chapter,
                        topic=resolve_zh_html_topic(
                            existing_record, explanation_html=en_explanation_html or en_explanation
                        ),
                        question=en_question,
                        choices=format_choices_for_prompt(en_options),
                        correct_answer_letter=correct_answer,
                        correct_answer_text=en_options.get(correct_answer, ""),
                        english_explanation=en_explanation_text or "(No supplemental OCR/plain text available; use the uploaded official explanation image.)",
                    )
                    print(
                        f"  {ai_label()}(zh-html) → Q{index:04d}: {en_question[:60]}…", end=" ", flush=True)
                    try:
                        raw_response = call_ai_rest(prompt, img_paths, use_html_model=True)
                        zh_explanation = extract_html_from_response(raw_response)
                        print("✓")
                        source_tag = AI_PROVIDER
                        time.sleep(RATE_LIMIT_DELAY)
                    except RateLimitedError:
                        raise  # 向上傳遞，整題跳過
                    except Exception as exc:
                        print(f"✗ ERROR: {exc}")
                        source_tag = "error"
                        zh_explanation = f"<!-- ERROR: {exc} -->"

    return {
        "index": index,
        "subject": subject,
        "chapter": chapter,
        "count": count,
        "question": en_question,
        "choices": en_options,
        "answer": correct_answer,
        "source_img": source_img,
        "explanation": en_explanation_html,
        "zh-question": zh_question,
        "zh-choices": zh_choices,
        "zh-explanation": zh_explanation,
        # 內部快取用，不對外輸出
        "_source": source_tag,
    }


def process_json_file(
    json_path: str,
    dry_run: bool = False,
    force: bool = False,
    limit: int = 0,
    no_gemini: bool = False,
    translate_only: bool = False,
    force_zh_html: bool = False,
) -> str | None:
    """處理一個章節的 castudy JSON，輸出 _enriched.json。"""

    chapter_dir = os.path.dirname(json_path)
    output_path = canonical_enriched_path(json_path)

    # 載入原始 JSON
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    subject = data["meta"]["subject"]
    chapter = data["meta"]["chapter"]
    all_questions = data.get("questions", [])
    questions = all_questions
    if limit > 0:
        questions = all_questions[:limit]

    count = data["meta"].get("count", len(all_questions))

    # castudy 所有題目的 index set（作為比對基準）
    castudy_indices: set[int] = {q["index"] for q in all_questions}

    # ── 載入 enriched JSON（只讀一次）並與 castudy 比對 ─────────────────
    existing_good: dict[int, dict] = {}   # 可直接 cache 的記錄（無 error）
    existing_records: dict[int, dict] = {}
    existing_error: set[int] = set()      # enriched 裡有但是 ERROR 的
    existing_all_indices: set[int] = set()
    preserved_records: dict[int, dict] = {}

    # 即使 --force 重跑，也先保留目前 canonical 輸出作為寫檔基底。
    # 如此中途 Ctrl-C / rate limit / API error 不會把未處理題目從 enriched JSON 刪掉。
    if os.path.exists(output_path):
        try:
            for eq in load_enriched_questions(output_path):
                idx = eq.get("index")
                if idx in castudy_indices:
                    preserved_records[idx] = eq
        except Exception as e:
            print(f"  WARN: cannot preserve current output {output_path} ({e})")

    existing_source = None if force else find_existing_enriched_source(
        output_path, json_path, len(questions)
    )
    if existing_source:
        try:
            enriched_raw = load_enriched_questions(existing_source)
            for eq in enriched_raw:
                idx = eq.get("index")
                if idx is None:
                    continue
                existing_records[idx] = eq
                existing_all_indices.add(idx)
                if _has_error(eq):
                    existing_error.add(idx)
                else:
                    existing_good[idx] = eq
        except Exception as e:
            print(f"  WARN: cannot read enriched JSON {existing_source} ({e}), will reprocess all")

    # 從 castudy 角度，找出完全不在 enriched 裡的題目
    missing_indices = sorted(castudy_indices - existing_all_indices)
    # enriched 裡有，但 castudy 裡沒有的（孤立記錄，不會寫入輸出）
    orphan_indices  = sorted(existing_all_indices - castudy_indices)

    total = len(all_questions)

    # ── 欄位缺失統計（從所有已知 enriched 記錄計算）────────────────────────
    def _missing_counts(records: dict[int, dict]) -> tuple[int, int, int, int]:
        """回傳 (缺 zh_q, 缺 zh_c, 缺 zh_html, 缺 en_html) 的題目數。"""
        mq = mc = mh = me = 0
        for r in records.values():
            if not str(r.get("zh-question", "")).strip():
                mq += 1
            choices = r.get("zh-choices") or {}
            if not isinstance(choices, dict) or not choices:
                mc += 1
            if not r.get("zh-explanation") or _is_error_html(r.get("zh-explanation", "")):
                mh += 1
            if not r.get("explanation") or _is_error_html(r.get("explanation", "")):
                me += 1
        return mq, mc, mh, me

    missing_q, missing_c, missing_h, missing_e = _missing_counts(existing_records)

    print(f"\n📂 {subject} / {chapter}")
    print(f"   castudy 題目數 : {total}")
    if limit > 0:
        print(f"   本次 limit    : 只掃描前 {len(questions)} 題，輸出仍保留整章資料")
    print(f"   enriched 狀態  : "
          f"✅ 已完成 {len(existing_good)}  "
          f"❌ 有錯誤 {len(existing_error)}  "
          f"⬜ 完全缺失 {len(missing_indices)}")
    print(f"   欄位缺失統計   : "
          f"zh_q:{missing_q}  zh_c:{missing_c}  "
          f"zh_html:{missing_h}  en_html:{missing_e}")
    if existing_source and os.path.abspath(existing_source) != os.path.abspath(output_path):
        print(f"   ↳ 沿用舊檔    : {os.path.basename(existing_source)}")
        print(f"   ↳ 固定輸出    : {os.path.basename(output_path)}")
    if missing_indices:
        print(f"   ⬜ 缺失 indices  : {missing_indices}")
    if existing_error:
        print(f"   ❌ ERROR indices : {sorted(existing_error)}")
    if orphan_indices:
        print(f"   ⚠️  孤立 indices（enriched 有但 castudy 無，將忽略）: {orphan_indices}")

    # 需要處理的 = error + 完全缺失；--limit 只限制本次掃描範圍，不縮小輸出基準。
    need_process_all = (existing_error | (castudy_indices - existing_all_indices))
    processing_indices = {q["index"] for q in questions}
    need_process = need_process_all & processing_indices
    will_skip = len(processing_indices) - len(need_process)
    if limit > 0 and len(need_process_all) != len(need_process):
        print(f"   → 整章待修 {len(need_process_all)} 題；本次將跳過 {will_skip} 題，重新處理 {len(need_process)} 題")
    else:
        print(f"   → 本次將跳過 {will_skip} 題，重新處理 {len(need_process)} 題")

    # 把 existing_good 作為 cache 來源（取代原本的 existing）
    existing = existing_good

    output_records: dict[int, dict] = {
        idx: record
        for idx, record in {**preserved_records, **existing_records}.items()
        if idx in castudy_indices
    }
    enriched_questions: list[dict] = []
    zh_html_dir = os.path.join(chapter_dir, "zh_html")
    output_dirty = False

    def write_enriched_output() -> None:
        _internal = {"_source"}
        output_questions = [
            {k: v for k, v in output_records[idx].items() if k not in _internal}
            for idx in sorted(output_records)
            if idx in castudy_indices
        ]
        payload = {
            "meta": {
                "subject": subject,
                "chapter": chapter,
                "count": count,
                "updatedAt": datetime.now().isoformat(timespec="seconds"),
                "sourceCastudyFile": os.path.basename(json_path),
                "schema": "passbar.enriched.v2",
            },
            "questions": output_questions,
        }
        tmp_path = f"{output_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, output_path)

    def write_zh_html(idx: int, record: dict) -> None:
        if not record.get("zh-explanation"):
            return
        os.makedirs(zh_html_dir, exist_ok=True)
        html_file = os.path.join(zh_html_dir, f"q{idx:04d}.html")
        with open(html_file, "w", encoding="utf-8") as f:
            f.write(record["zh-explanation"])

    for q in questions:
        idx = q["index"]

        # 若已有資料，先嘗試直接用 castudy 原始 JSON 補齊中文欄位。
        if idx in existing_records:
            cached = existing_records[idx]
            en_options = parse_choices_from_json(q.get("choices", {}))
            if fill_zh_from_castudy(cached, q):
                output_dirty = True
                output_records[idx] = cached
                if not dry_run:
                    write_zh_html(idx, cached)
                print(f"  ✓ Q{idx:04d} (cached + castudy zh)")
            if not needs_zh_gemini(cached, en_options):
                enriched_questions.append(cached)
                output_records[idx] = cached
                if idx in existing and not output_dirty:
                    print(f"  ✓ Q{idx:04d} (cached)")
                continue

        try:
            result = process_question(
                q,
                chapter_dir,
                subject,
                chapter,
                count=count,
                dry_run=dry_run,
                existing_record=existing_records.get(idx),
                no_gemini=no_gemini,
                translate_only=translate_only,
                force_zh_html=force_zh_html,
            )
        except RateLimitedError:
            print(f"  ⏭ Q{idx:04d} SKIPPED (all keys rate limited, will retry next run)")
            result = {
                "index": idx,
                "subject": subject,
                "chapter": chapter,
                "count": count,
                "question": q.get("question", ""),
                "choices": parse_choices_from_json(q.get("choices", {})),
                "answer": q.get("sourceCorrectAnswer", "").upper().strip(),
                "source_img": q.get("sourceExplanationImageFile", ""),
                "explanation": "<!-- ERROR: rate limited -->",
                "zh-question": "",
                "zh-choices": {},
                "zh-explanation": "<!-- ERROR: rate limited -->",
                "_source": "skipped",
            }
        enriched_questions.append(result)
        output_records[idx] = result

        if not dry_run:
            # 額外存一份 HTML 檔（方便直接在瀏覽器預覽）
            write_zh_html(idx, result)

            # 每題完成後立即寫檔，防止中途中斷遺失進度
            write_enriched_output()
            output_dirty = False

    if dry_run:
        print(f"  [DRY-RUN] Would write → {output_path}")
        return None

    # ── 最終驗證：確認輸出題數與 castudy 一致 ────────────────────────────
    output_indices = set(output_records)
    final_missing  = castudy_indices - output_indices
    if final_missing:
        print(f"  ⚠️  WARNING: {len(final_missing)} 題在輸出中仍缺失（可能遭遇持續性錯誤）: "
              f"{sorted(final_missing)}")
    else:
        fq, fc, fh, fe = _missing_counts(output_records)
        field_ok = all(v == 0 for v in (fq, fc, fh, fe))
        status = "✅" if field_ok else "⚠️ "
        print(f"  {status} 驗證完成：{len(output_records)} 題  "
              f"zh_q:{fq}  zh_c:{fc}  zh_html:{fh}  en_html:{fe}")

    write_enriched_output()

    print(f"  ✅ Saved → {output_path}")
    return output_path


# ── 主程式 ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Generate Chinese explanations for MBE questions")
    parser.add_argument("--provider", choices=("gemini", "gpt", "codex-cli", "antigravity-cli", "claude-cli", "cursor-cli", "cursor-api"), default="gemini",
                        help="AI provider for missing generated fields (default: gemini)")
    parser.add_argument("--model", default="",
                        help="Override provider model (default depends on provider)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print plan without calling AI APIs")
    parser.add_argument("--force", action="store_true",
                        help="Ignore existing enriched JSON, reprocess all")
    parser.add_argument("--subject", default="",
                        help="Filter by subject name (partial match)")
    parser.add_argument("--chapter", default="",
                        help="Filter by chapter name (partial match)")
    parser.add_argument("--out-dir", default=OUT_DIR,
                        help="Path to out/ directory")
    parser.add_argument("--limit", type=int, default=0,
                        help="Only process first N questions per chapter (0 = all)")
    parser.add_argument("--no-gemini", action="store_true",
                        help="Write only cached/castudy data; do not call AI APIs for missing fields")
    parser.add_argument("--no-ai", action="store_true",
                        help="Alias for --no-gemini")
    parser.add_argument("--translate-only", action="store_true",
                        help="Only call AI to translate zh_question/zh_choices; skip en_html and zh_html generation")
    parser.add_argument("--force-zh-html", action="store_true",
                        help="Regenerate zh-explanation HTML with AI even when castudy/API zh HTML exists")
    args = parser.parse_args()
    no_ai = args.no_gemini or args.no_ai
    set_ai_provider(args.provider, args.model or None)

    if not args.dry_run and not no_ai:
        if AI_PROVIDER == "gpt" and not os.environ.get("OPENAI_API_KEY"):
            print("ERROR: No OPENAI_API_KEY found in environment or .env file.")
            print("  Add OPENAI_API_KEY=your_key_here to .env.tools.local")
            sys.exit(1)
        if AI_PROVIDER == "gemini" and not _GEMINI_API_KEYS:
            print("ERROR: No GEMINI_API_KEY_1 ~ GEMINI_API_KEY_N found in environment or .env file.")
            print("  Add GEMINI_API_KEY_1=your_key_here to .env.tools.local")
            sys.exit(1)
        if AI_PROVIDER == "cursor-api":
            try:
                cursor_api.check_cursor_api_ready()
            except Exception as exc:
                parser.error(str(exc))
        if AI_PROVIDER in {"codex-cli", "antigravity-cli", "claude-cli", "cursor-cli"}:
            try:
                cli_ai.check_provider_ready(AI_PROVIDER)
            except RuntimeError as exc:
                print(f"ERROR: {exc}")
                sys.exit(1)

    out_dir = os.path.abspath(args.out_dir)
    if not os.path.isdir(out_dir):
        print(f"ERROR: out directory not found: {out_dir}")
        sys.exit(1)

    # 收集所有 castudy JSON（跳過 failed 和 enriched）
    pattern = os.path.join(out_dir, "*", "*", "*.json")
    all_files = sorted(glob.glob(pattern))
    json_files = [
        f for f in all_files
        if "failed" not in os.path.basename(f)
        and "enriched" not in os.path.basename(f)
    ]

    # 依 subject / chapter 過濾
    if args.subject:
        json_files = [f for f in json_files if args.subject.lower()
                      in f.lower()]
    if args.chapter:
        json_files = [f for f in json_files if args.chapter.lower()
                      in f.lower()]

    if not json_files:
        print("No matching JSON files found.")
        sys.exit(0)

    print(f"Found {len(json_files)} chapter file(s) to process.")
    print(f"AI provider: {AI_PROVIDER} ({AI_MODEL})")
    if args.dry_run:
        print("⚠️  DRY-RUN mode: no files will be written, no AI calls.\n")
    if args.translate_only:
        print(f"🔤 TRANSLATE-ONLY mode: only zh_question/zh_choices will be generated via {ai_label()}.\n")

    for json_file in json_files:
        process_json_file(json_file, dry_run=args.dry_run,
                          force=args.force, limit=args.limit,
                          no_gemini=no_ai,
                          translate_only=args.translate_only,
                          force_zh_html=args.force_zh_html)

    print("\n🎉 Done.")


if __name__ == "__main__":
    cursor_api.maybe_reexec_with_venv()
    main()
