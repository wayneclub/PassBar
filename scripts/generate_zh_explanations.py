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

if not _GEMINI_API_KEYS:
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

1. CSS variable theme control (`:root`):
   To make future theme changes easier, define the following variables inside `:root` in the `<style>` block and apply them globally:
   - `--primary-color`: dark blue-gray (#2c3e50, or adjust based on the subject area, e.g., deep blue for Civil Procedure, deep red #7a1b1b for Criminal Law, deep green #1b4d3e for Contracts)
   - `--accent-color`: marker blue (#3498db, used for subtitles, step labels, and card borders)
   - `--highlight-bg`: light blue background for core issues (#e8f4f8)
   - `--correct-bg`: green background for correct answers (#d4edda)
   - `--correct-text`: green text for correct answers (#155724)
   - `--wrong-bg`: red background for wrong answer choices (#f8d7da)
   - `--wrong-text`: red text for wrong answer choices (#721c24)
   - `--text-color`: main text color (#333333)
   - `--card-bg`: #ffffff
   - `--bg-color`: #f4f4f9 (full-page background color)

2. Tags and global typography:
   - Global font: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.
   - The page background color must be `var(--bg-color)`. The card should be horizontally and vertically centered, with a maximum width of `480px` wrapped by a `container` class.
   - The card must have rounded corners (`border-radius: 12px`) and an elegant shadow (`box-shadow: 0 4px 15px rgba(0,0,0,0.1)`).
   - Force bold/strong tags to wrap properly and prevent overflow beyond the border:
     `strong, b {{ display: inline !important; white-space: normal !important; word-break: normal !important; overflow-wrap: break-word !important; }}`
   - For statutes, legal provisions, and rule numbers, such as 28 U.S.C. § 1332, always wrap them in `<code>` tags and give them a soft background:
     `code {{ background: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px; font-family: monospace; font-size: 0.92em; }}`
   - Introduce a dedicated highlight tag for legal terms, `.term`:
     `.term {{ background-color: #e1ecf4; color: #2980b9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; font-weight: 500; }}`

3. Core sections for the multi-dimensional deep analysis card (⚠️ all sections must be fully included; deleting or merging them is strictly prohibited):
   - 【Card Top Header】: background color must be `var(--primary-color)`. Include a main title `<h1>` such as “MBE Issue Analysis” and a subtitle `.sub-title` in all caps, e.g., `CIVIL PROCEDURE: SUBJECT-MATTER JURISDICTION`.
   - 【💡 Core Issue Box (.concept-box)】: background must be `var(--highlight-bg)`, with a 5px solid left border using `var(--accent-color)`. It must include a prominent title: “Core Issue: [Chinese issue title]”, and one italic `.latin` line containing the core English legal term, e.g., *The Well-Pleaded Complaint Rule*.
   - 【📊 Concept Comparison Table (.comparison-table)】: used to compare two commonly confused concepts, such as TRO vs. Preliminary Injunction / General vs. Specific Jurisdiction. The table must have 100% width, border color `#ddd`, and header background `#f8f9fa`.
   - 【🎨 Adaptive Multi-Function Diagram Section (.diagram)】:
     * Background color must be `#f9f9f9`, with a `1px dashed #ccc` dashed border.
     * Based on the facts, automatically determine whether to generate a “relationship diagram,” such as citizens of State A vs. citizens of State B plus additional foreign parties, or a “timeline/litigation flow diagram.”
     * Key nodes in the diagram should use `.party-box` and `.flow-node`, such as `.flow-node.active` to emphasize the current disputed point, and `.flow-node.highlight-node` to emphasize the answer’s corresponding result.
   - 【⚖️ Legal Authority and Reasoning <h3> and 🧠 Progressive Analysis Steps (.analysis-step)】:
     * Place a compact `.step-label` tag on the left side of each step. The background color should be `var(--primary-color)`, with white text, such as Step 1, Step 2, for progressive analysis.
     * This section must provide deep analysis of the facts and legal elements.
   - 【⚠️ Core Rule / Trap Alert (.rule-block or .trap-alert)】: background color must be warm light yellow (#fff3cd), border color `#ffeeba`, and text color `#856404`. Use this section to highlight the most dangerous MBE trap or a specific turning-point rule.
   - 【🔑 Independent Case / Extended Scenario Box (.case-box)】: background color must be `#e3f2fd` (light blue), with a `1px solid #bbdefb` border. Use this section for core cases, such as Louisville, Mohawk, etc., or for “extended comparative scenarios” showing how the result changes if the conditions are modified.
   - 【❌ Deep Answer-Choice Breakdown (.option-analysis / .option)】:
     * The section title must be “✅ Correct Answer and Elimination of Distractors”.
     * The correct answer card must use the `.option.correct` style, with green background, green text, and border `#c3e6cb`.
     * Wrong answer cards must use the `.option.wrong` style, with red background, red text, and border `#f5c6cb`.
     * ⚠️ At the beginning of each answer-choice card, you must write the original English text of that choice in bold, for example: <b>Choice A is wrong: No, because...</b>. Then insert a line break and provide a deep Chinese explanation.
   - 【🎓 Bottom Exam Tip (.footer-tip)】: background color must be `#fff8e1`, with a top border of `2px solid #ffb300`. Provide an exam shortcut, Exam Tip/Exam Trick, or a practical decision-flow mnemonic.

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


def extract_html_from_response(text: str) -> str:
    """從 Gemini 回覆中取出 HTML（可能包在 ```html ``` 中）。"""
    m = re.search(r"```html\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(r"(<!DOCTYPE\s+html[\s\S]*)", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return text.strip()


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
    api = q.get("apiResult", {})
    has_api = bool(api.get("ok") and api.get("data"))

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

    zh_question = ""
    zh_choices: dict[str, str] = {}
    zh_explanation = ""
    en_explanation_html = ""
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
        api_data = api["data"][0]
        stem = api_data.get("questionStem", "")
        bilingual_opts = api_data.get("options", [])
        zh_html_content = api_data.get("htmlContent", "")

        # 從 questionStem 分離中英文題目
        _en_stem, zh_part = split_bilingual_stem(stem)
        zh_question = zh_part or ""

        # 從 options 中提取中文選項（保持 ABCD 順序）
        for opt in bilingual_opts:
            m = re.match(r"^([A-D])\.\s*", opt)
            if not m:
                continue
            key = m.group(1)
            _en_part, zh_part_opt = extract_option_parts(opt)
            zh_choices[key] = zh_part_opt

        if not dry_run:
            # 英文解析 HTML：用 source_imgs 生成
            en_explanation_html = generate_explanation_html(
                collect_img_paths(api_data))

            # 若 htmlContent 存在則直接使用；否則呼叫 Gemini 生成
            if zh_html_content and zh_html_content.strip().startswith("<"):
                zh_explanation = zh_html_content
                source_tag = "api"
            else:
                source_tag = "api_no_html"
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

            # 若中文題目或選項缺失，補呼叫 Gemini 翻譯
            if not zh_question or not zh_choices:
                print(
                    f"  Gemini(translate) → Q{index:04d}: missing zh_question/choices", end=" ", flush=True)
                try:
                    tq, tc = call_gemini_translate(
                        subject, chapter, en_question, en_options)
                    if not zh_question:
                        zh_question = tq
                    for k, v in tc.items():
                        if k not in zh_choices:
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
            en_explanation_html = generate_explanation_html(img_paths)

            # 2) 翻譯題目與選項
            print(
                f"  Gemini(translate) → Q{index:04d}: {en_question[:55]}…", end=" ", flush=True)
            try:
                zh_question, zh_choices = call_gemini_translate(
                    subject, chapter, en_question, en_options)
                print("✓")
                time.sleep(RATE_LIMIT_DELAY)
            except RateLimitedError:
                raise  # 向上傳遞，整題跳過
            except Exception as exc:
                print(f"✗ TRANSLATE ERROR: {exc}")

            # 3) 中文解析 HTML
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
) -> str | None:
    """處理一個章節的 castudy JSON，輸出 _enriched.json。"""

    chapter_dir = os.path.dirname(json_path)
    base_name = os.path.splitext(os.path.basename(json_path))[0]
    output_path = os.path.join(chapter_dir, f"{base_name}_enriched.json")

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
    existing_error: set[int] = set()      # enriched 裡有但是 ERROR 的
    existing_all_indices: set[int] = set()

    if not force and os.path.exists(output_path):
        try:
            with open(output_path, encoding="utf-8") as f:
                enriched_raw = json.load(f)
            if not isinstance(enriched_raw, list):
                enriched_raw = enriched_raw.get("questions", [])
            for eq in enriched_raw:
                idx = eq.get("index")
                if idx is None:
                    continue
                existing_all_indices.add(idx)
                if _has_error(eq):
                    existing_error.add(idx)
                else:
                    existing_good[idx] = eq
        except Exception as e:
            print(f"  WARN: cannot read enriched JSON ({e}), will reprocess all")

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

    for q in questions:
        idx = q["index"]

        # 若已有完整資料（且無 ERROR），直接複用（跳過 API 呼叫）
        if idx in existing:
            cached = existing[idx]
            enriched_questions.append(cached)
            print(f"  ✓ Q{idx:04d} (cached)")
            continue

        try:
            result = process_question(
                q, chapter_dir, subject, chapter, count=count, dry_run=dry_run)
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
            if result.get("zh-explanation"):
                os.makedirs(zh_html_dir, exist_ok=True)
                html_file = os.path.join(zh_html_dir, f"q{idx:04d}.html")
                with open(html_file, "w", encoding="utf-8") as f:
                    f.write(result["zh-explanation"])

            # 每題完成後立即寫檔，防止中途中斷遺失進度
            _internal = {"_source"}
            output_questions = [
                {k: v for k, v in eq.items() if k not in _internal}
                for eq in enriched_questions
            ]
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(output_questions, f, ensure_ascii=False, indent=2)

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
                          force=args.force, limit=args.limit)

    print("\n🎉 Done.")


if __name__ == "__main__":
    main()
