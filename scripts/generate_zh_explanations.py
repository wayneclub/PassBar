#!/usr/bin/env python3
"""
generate_zh_explanations.py

读取 out/ 目录下所有 castudy JSON 档案，为每一道题目输出结构化资料：
  - 英文题目、英文选项、正确答案、英文解析图（jpg/png）
  - 中文题目、中文选项（从 questionStem / options 提取）
  - 中文解析 HTML（已有的取 htmlContent；缺少的呼叫 Gemini 生成）

输出：
  - 每个章节目录下新增 <chapter>_enriched.json
  - 每道中文解析 HTML 额外存一份到 zh_html/<qid>.html

使用方式：
  python3 generate_zh_explanations.py                  # 处理全部
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


# ── 設定 ──────────────────────────────────────────────────────────────────────

GEMINI_MODEL = "gemini-2.5-flash"

# 多組 API Key 輪替（round-robin）
# 從環境變數讀取，支援 .env 檔案（見 scripts/.env.example）
def _load_env_file() -> None:
    """讀取 scripts/.env 或專案根目錄 .env，補充尚未設定的環境變數。"""
    candidates = [
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.join(os.path.dirname(__file__), "..", ".env"),
    ]
    for env_path in candidates:
        if os.path.exists(env_path):
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
            break

_load_env_file()

_GEMINI_API_KEYS: list[str] = [
    k for k in [
        os.environ.get(f"GEMINI_API_KEY_{i}") for i in range(1, 20)
    ] if k
]

if (
    not _GEMINI_API_KEYS
    and "--dry-run" not in sys.argv
    and "--no-gemini" not in sys.argv
):
    print("ERROR: No GEMINI_API_KEY_1 ~ GEMINI_API_KEY_N found in environment or .env file.")
    print("  Create scripts/.env and add:")
    print("  GEMINI_API_KEY_1=your_key_here")
    sys.exit(1)

_key_index = 0  # 全域輪替指標


def next_api_key() -> str:
    """輪流取得下一組 API Key。"""
    global _key_index
    key = _GEMINI_API_KEYS[_key_index % len(_GEMINI_API_KEYS)]
    _key_index += 1
    return key


GEMINI_TRANSLATE_TEMPLATE = """\
你是专业的美国法律（MBE）翻译专家。请将以下英文题目和选项翻译成简体中文，保留必要的英文法律术语。

只返回 JSON，格式如下（不要有任何其他文字或代码块标记）：
{{
  "zh_question": "中文题目",
  "zh_choices": {{
    "A": "中文选项A",
    "B": "中文选项B",
    "C": "中文选项C",
    "D": "中文选项D"
  }}
}}

Subject: {subject} — {chapter}

Question:
{question}

Answer Choices:
{choices}
"""
OUT_DIR = os.environ.get("OUT_DIR", os.path.join(
    os.path.dirname(__file__), "..", "out"))
RATE_LIMIT_DELAY = 5   # 每次 API 呼叫後等待秒數
MAX_RETRIES = 3        # API 失敗重試次數


# ── Gemini Prompt ─────────────────────────────────────────────────────────────

GEMINI_EXPLANATION_PROMPT = """\
You are an expert in front-end development (HTML/JS/Tailwind CSS) and legal/academic instructional design.
Please help me completely convert the content of this uploaded image into a "single-file and highly exquisite" HTML interactive learning webpage.

Please strictly follow the design requirements and specifications below, excluding any redundant top toolbars or control buttons, and focus entirely on "pure detailed analysis" and "the ultimate visual restoration of text and graphics":

### 1. Visual and Layout Restoration Specifications (No Toolbar, No Explanation Tabs)
* **No Top Toolbar**: Absolutely do not generate any top navigation bar (Header), search box, font scaling buttons, or manual dark mode toggle buttons.
* **No Redundant Tabs**: Completely remove any switching tabs or labels similar to "Explanation" or "Quiz". The top of the webpage should start directly with the main graphic card or the main title.
* **Precise Text Formatting Restoration**: Accurately preserve all "Bold", "Italic", "color contrasts (such as the first letter of a mnemonic in red)", and structured lists from the image.
* **Clean Footer**: Turn the classification information at the very bottom of the image (e.g., Subject, Chapter, Topic, etc.) into a beautifully designed three-column footer.
* **Filter Out Copyright Notices**: Automatically detect and remove any "Copyright © ..." watermarks or copyright text from the image to keep the layout absolutely pristine.

### 2. Responsive Reconstruction of Realistic Graphic Cards/Tables (Critical Item)
* **Do Not Use Images**: Use Tailwind CSS Grid/Flex layouts, borders, subtle shadows (`shadow-md`), and rounded corners (`rounded-xl`) to perfectly rebuild the "tables" or "flowcharts" from the image natively within the webpage.
* **Responsive Layout Protection**: Apply an `overflow-x-auto` container to the outermost layer of the graphic cards to ensure smooth horizontal scrolling on mobile devices, absolutely preventing layout crushing or distortion.

### 3. Advanced Interactive Learning Features (Vanilla JS)
* **Mnemonic Hover Highlight**:
    * If there is a mnemonic in the graphic card, please set each letter or word in the mnemonic as a triggerable element (`.mnemonic-char`).
    * When the mouse hovers over a specific mnemonic element, the corresponding "exceptions/elimination items" in the card above must automatically receive a highlight class (e.g., slightly enlarged, adding an exquisite faint red background and a red border `.highlight-active`), which reverts immediately once the cursor moves away.
* **Terminology Tooltips**:
    * Identify core legal terms, case names, or specialized vocabulary within the English text (e.g., easement, dominant estate, etc.).
    * Add `class="term-tooltip"` to them. When a user hovers over the term, a floating bubble should appear displaying "the corresponding explanation in Simplified Chinese alongside its core original English meaning".
    * The background and text of the bubble must perfectly adapt to the system's light/dark mode (light background with dark text in dark mode; dark background with light text in light mode).

### 4. Code Integrity and Specifications
* **Single-File Mandate**: All HTML, CSS (imported via Tailwind CDN), and minimalist JavaScript must be entirely written within the same single `.html` file; no external dependencies are allowed.
* **No Omissions in Generation**: Please output complete, well-structured, and neatly formatted HTML source code without any code omissions or placeholders (such as `// ... rest of code`), ensuring the webpage can be executed directly and loads 100% correctly.

---
Now, please analyze the image I provided and begin constructing this "no-toolbar, pure detailed analysis" webpage for me:
"""

GEMINI_PROMPT_TEMPLATE = """\
【Role and Task】
You are a subject-matter expert proficient in U.S. law, especially the MBE exam, and also an excellent frontend UI/UX designer.
Your task is to take the “original English legal analysis materials” I provide, including the English question, answer choices, official explanation, and image descriptions, and perform deep refinement and translation to generate a visually polished, rigorously formatted, single HTML file: a “multi-dimensional deep subject-analysis card” with absolutely no distracting original English question text or answer-choice buttons.

【HTML Visual and Layout Requirements】
Please strictly follow the CSS visual requirements below. Embed refined styles directly inside the HTML, and ensure an excellent responsive experience on both mobile and desktop:

1. Mandatory unified visual design system (must be used exactly):
   The final HTML must look like the approved blue-gray reference style, not the rejected red/maroon style.
   Do not change the page theme by subject. Criminal Law/Procedure pages must still use the same blue-gray header.
   Red/maroon colors are forbidden for the page header, section headings, core issue boxes, diagrams, tables, and primary emphasis. Use red only inside wrong-answer cards or tiny error labels.

   Required CSS variables in `:root`:
   - `--primary-color`: #2c3e50;
   - `--primary-ink`: #243447;
   - `--accent-color`: #3498db;
   - `--accent-strong`: #2980d9;
   - `--highlight-bg`: #e8f4f8;
   - `--correct-bg`: #dff0d8;
   - `--correct-border`: #27ae60;
   - `--correct-text`: #1f8f4d;
   - `--wrong-bg`: #f8d7da;
   - `--wrong-border`: #f5c6cb;
   - `--wrong-text`: #721c24;
   - `--warning-bg`: #fff8e1;
   - `--warning-border`: #ffb300;
   - `--text-color`: #333333;
   - `--muted-text`: #666666;
   - `--border-color`: #dddddd;
   - `--card-bg`: #ffffff;
   - `--bg-color`: #ffffff;

2. Mandatory CSS scaffold:
   The HTML must include CSS equivalent to the following contract. You may add selectors, but do not override these values with another theme:
   ```css
   * {{ box-sizing: border-box; }}
   body {{
     margin: 0;
     padding: 24px 18px;
     background: var(--bg-color);
     color: var(--text-color);
     font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
     font-size: 18px;
     line-height: 1.72;
     letter-spacing: 0;
   }}
   .container {{
     width: min(100%, 960px);
     margin: 0 auto;
     background: var(--card-bg);
   }}
   .header {{
     background: var(--primary-color);
     color: #ffffff;
     border-radius: 12px 12px 0 0;
     padding: 34px 24px 32px;
     text-align: center;
     margin-bottom: 26px;
   }}
   .header h1 {{
     margin: 0 0 12px;
     font-size: clamp(30px, 4vw, 42px);
     line-height: 1.15;
     font-weight: 800;
     letter-spacing: 0;
   }}
   .sub-title {{
     margin: 0;
     font-size: clamp(18px, 2.4vw, 24px);
     line-height: 1.35;
     font-weight: 700;
     color: rgba(255,255,255,0.92);
   }}
   h2, h3 {{
     color: var(--primary-ink);
     font-weight: 800;
     line-height: 1.3;
     letter-spacing: 0;
   }}
   h2 {{
     font-size: clamp(24px, 3vw, 32px);
     border-bottom: 3px solid var(--accent-color);
     padding-bottom: 10px;
     margin: 34px 0 20px;
   }}
   h3 {{
     font-size: clamp(21px, 2.4vw, 26px);
     margin: 28px 0 16px;
   }}
   p, li {{
     font-size: 18px;
     line-height: 1.72;
   }}
   strong, b {{
     display: inline !important;
     white-space: normal !important;
     word-break: normal !important;
     overflow-wrap: break-word !important;
     font-weight: 800;
   }}
   ```

3. Required component styles:
   - `.answer-box`: green success card like the approved reference. Use `background: var(--correct-bg)`, `border-left: 6px solid var(--correct-border)`, `border-radius: 6px`, `padding: 20px 24px`, `margin: 22px 0 30px`, `font-size: 20px`, `font-weight: 700`.
   - `.concept-box`: light blue card. Use `background: var(--highlight-bg)`, `border-left: 6px solid var(--accent-color)`, `border-radius: 8px`, `padding: 22px 24px`, `margin: 24px 0`.
   - `.concept-box .concept-title`: blue title, `font-size: 24px`, `font-weight: 800`, `color: var(--accent-strong)`.
   - `.latin`: italic, `font-size: 18px`, `color: #555555`, `font-weight: 500`.
   - `.comparison-table`: full width, `border-collapse: collapse`, `margin: 24px 0`, `font-size: 17px`.
   - `.comparison-table th`: `background: #f8f9fa`, `color: var(--primary-color)`, `font-weight: 800`, `padding: 14px`, `border: 1px solid var(--border-color)`, `text-align: left`.
   - `.comparison-table td`: `padding: 14px`, `border: 1px solid var(--border-color)`, `vertical-align: top`.
   - `.diagram`: white or very light gray panel, not a colored poster. Use `background: #ffffff`, `border: 1px dashed #cccccc`, `border-radius: 8px`, `padding: 22px`, `margin: 28px 0`, `text-align: center`.
   - `.flow-node` / `.party-box`: light cyan chips with teal text, `background: #e8fcff`, `border: 1px solid #22b8cf`, `border-radius: 6px`, `padding: 10px 14px`, `font-weight: 700`, `color: #05606a`.
   - `.flow-node.active` or `.flow-node.highlight-node`: blue chip, `background: var(--accent-color)`, `border-color: var(--accent-color)`, `color: #ffffff`.
   - `.rule-block`, `.trap-alert`, `.footer-tip`: warm yellow only, never red. Use `background: var(--warning-bg)`, `border-left: 5px solid var(--warning-border)`, `border-radius: 6px`, `padding: 18px 20px`.
   - `.case-box`: light blue card, `background: var(--highlight-bg)`, `border-radius: 8px`, `padding: 20px 22px`, `margin: 20px 0`.
   - `.option.correct`: green card with `background: var(--correct-bg)`, `border-left: 5px solid var(--correct-border)`.
   - `.option.wrong`: red may appear only here, with `background: var(--wrong-bg)`, `border-left: 5px solid var(--wrong-border)`, `color: var(--wrong-text)`.
   - `code`: `background: rgba(0,0,0,0.05)`, `padding: 2px 4px`, `border-radius: 4px`, `font-size: 0.92em`.
   - `.term`: `background: #e1ecf4`, `color: #2980b9`, `padding: 2px 6px`, `border-radius: 4px`, `font-size: 0.92em`, `font-weight: 700`.

4. Responsive rules:
   - At `max-width: 640px`, set `body` padding to `12px`, `.header` padding to `26px 16px`, `body/p/li` font size to `16px`, and make wide tables/diagrams horizontally scroll with `overflow-x: auto`.
   - Text must never overflow its container. Long legal terms must wrap naturally. Do not use negative letter spacing or viewport-width-based body font scaling.
   - Do not create nested cards inside cards. Repeated answer-choice cards and standalone section boxes are allowed.

5. Core sections for the multi-dimensional deep analysis card (all sections must be included; do not delete or merge):
   - 【Card Top Header】: Use class `.header`, fixed navy `var(--primary-color)`, title text exactly “MBE 考点解析”, and subtitle as `[Subject]: [Chapter or Issue]`.
   - 【Correct Answer Box (.answer-box)】: Put the correct answer and one-sentence holding near the top, immediately after the header.
   - 【Core Legal Rule <h2> + .concept-box】: Explain the governing doctrine in Chinese, preserving essential English terms.
   - 【Concept Comparison Table (.comparison-table)】: Compare the tested rule with a commonly confused rule when useful.
   - 【Fact/Application Logic <h2> + .analysis-step】: Apply rule elements to the facts in progressive steps.
   - 【Diagram (.diagram)】: Include a simple flow/timeline/relationship diagram only when it clarifies the analysis. Use the standardized `.flow-node`/`.party-box` styles above.
   - 【Trap Alert (.trap-alert or .rule-block)】: Explain the MBE trap in warm yellow.
   - 【Answer-Choice Breakdown (.option-analysis / .option)】: The section title must be “正确答案与干扰项排除”. Correct card green; wrong cards red only inside `.option.wrong`.
   - 【Exam Tip (.footer-tip)】: End with a concise exam shortcut or decision rule.

【Special Restrictions and Quality Assurance】
- ⚠️ Absolutely do not include the original English question text or English answer-choice buttons, such as A/B/C/D buttons, from the source materials in the HTML!
- The HTML content must be a Chinese-only analysis in Simplified Chinese, while preserving necessary English legal terms.
- Do not simplify, cut down, or abbreviate any legal analysis! All eight sections listed above must be fully presented.
- Return only a complete, ready-to-use, single HTML code block that does not require any external JS/CSS files.

---
【Original Legal Analysis Material Input Area】

Subject: {subject} — {chapter}

Question:
{question}

Answer Choices:
{choices}

Correct Answer: {correct_answer}

(Please use the analysis materials to generate a complete Simplified Chinese HTML analysis card.)
"""


# ── 工具函式 ──────────────────────────────────────────────────────────────────

class RateLimitedError(Exception):
    """所有 API Key 均被 rate limited，呼叫方應跳過此題。"""


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
    """判斷中文欄位是否仍需要 Gemini 補齊。"""
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
    r"©\s*MBE[^<\n]*",
    re.IGNORECASE,
)


def strip_copyright_footers(html: str) -> str:
    """移除 HTML 中所有 MBE 版權 footer 字樣（包括包裹它們的 HTML 元素）。"""
    if not html:
        return html

    # 移除包含 © MBE 的整個 HTML 標籤區塊（<footer>, <div>, <p>, <small> 等）
    html = re.sub(
        r'<(footer|div|p|small|span)[^>]*>(?:[^<]|<(?!(?:footer|div|p|small|span)[^>]*>))*?©\s*MBE[^<]*?</\1>',
        '',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # 移除剩餘的裸文字行
    html = _COPYRIGHT_PATTERN.sub('', html)
    # 清理連續空行
    html = re.sub(r'\n{3,}', '\n\n', html)
    return html.strip()


def extract_html_from_response(text: str) -> str:
    """從 Gemini 回覆中取出 HTML（可能包在 ```html ``` 中）。"""
    m = re.search(r"```html\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if m:
        return strip_copyright_footers(m.group(1).strip())
    m = re.search(r"(<!DOCTYPE\s+html[\s\S]*)", text, re.IGNORECASE)
    if m:
        return strip_copyright_footers(m.group(1).strip())
    return strip_copyright_footers(text.strip())


# ── Gemini API ────────────────────────────────────────────────────────────────

def call_gemini_rest(
    prompt_text: str,
    image_paths: list[str] | str | None = None,
) -> str:
    """呼叫 Gemini REST API（gemini-2.5-flash），支援文字 + 多張圖片。
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

    payload = json.dumps({
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 65536,
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
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{GEMINI_MODEL}:generateContent?key={api_key}"
            )
            try:
                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=180) as resp:
                    data = json.loads(resp.read())
                return data["candidates"][0]["content"]["parts"][0]["text"]
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


# ── 核心處理邏輯 ──────────────────────────────────────────────────────────────

def call_gemini_translate(
    subject: str,
    chapter: str,
    en_question: str,
    en_options: dict[str, str],
) -> tuple[str, dict[str, str]]:
    """呼叫 Gemini 翻譯英文題目和選項為簡體中文，回傳 (zh_question, zh_choices)。"""
    prompt = GEMINI_TRANSLATE_TEMPLATE.format(
        subject=subject,
        chapter=chapter,
        question=en_question,
        choices=format_choices_for_prompt(en_options),
    )
    raw = call_gemini_rest(prompt)
    # 嘗試解析 JSON（Gemini 可能包在 ```json ``` 中）
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
) -> dict:
    """將一道題目轉為結構化格式，必要時呼叫 Gemini。"""

    index = q["index"]
    en_question = q.get("question", "").strip()
    choices_raw = q.get("choices", {})
    correct_answer = q.get("sourceCorrectAnswer", "").upper().strip()
    source_img_file = q.get("sourceExplanationImageFile", "")

    # 英文選項 dict（A/B/C/D → 文字）
    en_options = parse_choices_from_json(choices_raw)

    # 英文解析（純文字，從 sourceExplanationHtml 提取或空字串）
    en_explanation = q.get("sourceExplanationHtml", "")

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
        print(f"  Gemini(explanation) → Q{index:04d}…", end=" ", flush=True)
        try:
            raw = call_gemini_rest(GEMINI_EXPLANATION_PROMPT, img_paths)
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
            # 因為舊 explanation error 觸發不必要的 Gemini 呼叫。
            if no_gemini:
                en_explanation_html = en_explanation_html or ""
            elif not existing_record and _is_error_html(en_explanation_html):
                en_explanation_html = generate_explanation_html(
                    collect_img_paths(api_data))

            # 若 htmlContent 存在則直接使用；否則呼叫 Gemini 生成
            if not _is_error_html(zh_explanation):
                source_tag = "cached"
            elif castudy_zh_html and castudy_zh_html.strip().startswith("<"):
                zh_explanation = strip_copyright_footers(castudy_zh_html)
                source_tag = "api"
            else:
                source_tag = "api_no_html"
                if no_gemini:
                    print(f"  ⏭ Q{index:04d} missing zh HTML (no-gemini)")
                else:
                    prompt = GEMINI_PROMPT_TEMPLATE.format(
                        subject=subject,
                        chapter=chapter,
                        question=en_question,
                        choices=format_choices_for_prompt(en_options),
                        correct_answer=correct_answer,
                    )
                    print(
                        f"  Gemini(zh-html) → Q{index:04d}: {en_question[:55]}…", end=" ", flush=True)
                    try:
                        raw_response = call_gemini_rest(
                            prompt, collect_img_paths(api_data))
                        zh_explanation = extract_html_from_response(raw_response)
                        print("✓")
                        source_tag = "api+gemini_html"
                        time.sleep(RATE_LIMIT_DELAY)
                    except RateLimitedError:
                        raise  # 向上傳遞，整題跳過
                    except Exception as exc:
                        print(f"✗ ERROR: {exc}")
                        source_tag = "error"
                        zh_explanation = f"<!-- ERROR: {exc} -->"

            # 缺哪個中文欄位才呼叫 Gemini 補哪個；castudy 已有的直接沿用。
            missing_choice_keys = missing_zh_choice_keys(
                {"zh-choices": zh_choices}, en_options)
            if not zh_question or missing_choice_keys:
                if no_gemini:
                    print(f"  ⏭ Q{index:04d} missing zh question/choices (no-gemini)")
                else:
                    print(
                        f"  Gemini(translate) → Q{index:04d}: missing zh_question/choices", end=" ", flush=True)
                    try:
                        tq, tc = call_gemini_translate(
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
        # ── 缺少 API 資料：呼叫 Gemini 翻譯題目+選項，並生成 HTML 解析 ──
        if dry_run:
            print(
                f"  [DRY-RUN] Q{index:04d}: would call Gemini — {en_question[:70]}…")
            source_tag = "pending_gemini"
        else:
            img_paths = collect_img_paths()

            # 1) 英文解析 HTML
            if no_gemini:
                en_explanation_html = en_explanation_html or ""
            elif not existing_record and _is_error_html(en_explanation_html):
                en_explanation_html = generate_explanation_html(img_paths)

            # 2) 翻譯題目與選項
            missing_choice_keys = missing_zh_choice_keys(
                {"zh-choices": zh_choices}, en_options)
            if not zh_question or missing_choice_keys:
                if no_gemini:
                    print(f"  ⏭ Q{index:04d} missing zh question/choices (no-gemini)")
                else:
                    print(
                        f"  Gemini(translate) → Q{index:04d}: {en_question[:55]}…", end=" ", flush=True)
                    try:
                        tq, tc = call_gemini_translate(
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
                if no_gemini:
                    print(f"  ⏭ Q{index:04d} missing zh HTML (no-gemini)")
                else:
                    prompt = GEMINI_PROMPT_TEMPLATE.format(
                        subject=subject,
                        chapter=chapter,
                        question=en_question,
                        choices=format_choices_for_prompt(en_options),
                        correct_answer=correct_answer,
                    )
                    print(
                        f"  Gemini(zh-html) → Q{index:04d}: {en_question[:60]}…", end=" ", flush=True)
                    try:
                        raw_response = call_gemini_rest(prompt, img_paths)
                        zh_explanation = extract_html_from_response(raw_response)
                        print("✓")
                        source_tag = "gemini"
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
) -> str | None:
    """處理一個章節的 castudy JSON，輸出 _enriched.json。"""

    chapter_dir = os.path.dirname(json_path)
    output_path = canonical_enriched_path(json_path)

    # 載入原始 JSON
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    subject = data["meta"]["subject"]
    chapter = data["meta"]["chapter"]
    questions = data.get("questions", [])
    if limit > 0:
        questions = questions[:limit]

    count = data["meta"].get("count", len(questions))

    # castudy 所有題目的 index set（作為比對基準）
    castudy_indices: set[int] = {q["index"] for q in questions}

    # ── 載入 enriched JSON（只讀一次）並與 castudy 比對 ─────────────────
    existing_good: dict[int, dict] = {}   # 可直接 cache 的記錄（無 error）
    existing_records: dict[int, dict] = {}
    existing_error: set[int] = set()      # enriched 裡有但是 ERROR 的
    existing_all_indices: set[int] = set()

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

    total = len(questions)
    print(f"\n📂 {subject} / {chapter}")
    print(f"   castudy 題目數 : {total}")
    print(f"   enriched 狀態  : "
          f"✅ 已完成 {len(existing_good)}  "
          f"❌ 有錯誤 {len(existing_error)}  "
          f"⬜ 完全缺失 {len(missing_indices)}")
    if existing_source and os.path.abspath(existing_source) != os.path.abspath(output_path):
        print(f"   ↳ 沿用舊檔    : {os.path.basename(existing_source)}")
        print(f"   ↳ 固定輸出    : {os.path.basename(output_path)}")
    if missing_indices:
        print(f"   ⬜ 缺失 indices  : {missing_indices}")
    if existing_error:
        print(f"   ❌ ERROR indices : {sorted(existing_error)}")
    if orphan_indices:
        print(f"   ⚠️  孤立 indices（enriched 有但 castudy 無，將忽略）: {orphan_indices}")

    # 需要處理的 = error + 完全缺失
    need_process = (existing_error | (castudy_indices - existing_all_indices))
    will_skip    = len(castudy_indices) - len(need_process)
    print(f"   → 本次將跳過 {will_skip} 題，重新處理 {len(need_process)} 題")

    # 把 existing_good 作為 cache 來源（取代原本的 existing）
    existing = existing_good

    enriched_questions: list[dict] = []
    zh_html_dir = os.path.join(chapter_dir, "zh_html")
    output_dirty = False

    def write_enriched_output() -> None:
        _internal = {"_source"}
        output_questions = [
            {k: v for k, v in eq.items() if k not in _internal}
            for eq in enriched_questions
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
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

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
                if not dry_run:
                    write_zh_html(idx, cached)
                print(f"  ✓ Q{idx:04d} (cached + castudy zh)")
            if not needs_zh_gemini(cached, en_options):
                enriched_questions.append(cached)
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
    output_indices = {q.get("index") for q in enriched_questions}
    final_missing  = castudy_indices - output_indices
    if final_missing:
        print(f"  ⚠️  WARNING: {len(final_missing)} 題在輸出中仍缺失（可能遭遇持續性錯誤）: "
              f"{sorted(final_missing)}")
    else:
        print(f"  ✅ 驗證通過：輸出題數 {len(enriched_questions)} 題，與 castudy 完全一致")

    write_enriched_output()

    print(f"  ✅ Saved → {output_path}")
    return output_path


# ── 主程式 ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Generate Chinese explanations for MBE questions")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print plan without calling Gemini")
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
                        help="Write only cached/castudy data; do not call Gemini for missing fields")
    args = parser.parse_args()

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
    if args.dry_run:
        print("⚠️  DRY-RUN mode: no files will be written, no Gemini calls.\n")

    for json_file in json_files:
        process_json_file(json_file, dry_run=args.dry_run,
                          force=args.force, limit=args.limit,
                          no_gemini=args.no_gemini)

    print("\n🎉 Done.")


if __name__ == "__main__":
    main()
