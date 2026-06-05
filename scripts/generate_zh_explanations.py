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


# ── 設定 ──────────────────────────────────────────────────────────────────────

GEMINI_MODEL = "gemini-3.5-flash"
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.4-mini")
AI_PROVIDER = "gemini"
AI_MODEL = GEMINI_MODEL

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

_key_index = 0  # 全域輪替指標


def set_ai_provider(provider: str, model: str | None = None) -> None:
    """設定本次執行使用的 AI provider/model。"""
    global AI_PROVIDER, AI_MODEL
    AI_PROVIDER = provider
    if provider == "gpt":
        AI_MODEL = model or OPENAI_MODEL
    else:
        AI_MODEL = model or GEMINI_MODEL


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
You are an expert front-end developer and legal/academic instructional designer.
Your task is to convert the uploaded source explanation image into a faithful, single-file HTML document for embedding in PassBar's ExplanationView iframe.

The highest priority is visual and textual fidelity to the source explanation image. Do not redesign the explanation, do not rewrite the legal analysis, and do not add new sections that are not present in the image. Recreate the image's actual content, typography hierarchy, spacing, cards, tables, flowcharts, emphasis, and ordering as closely as possible using HTML and scoped CSS.

### 1. Faithful Restoration Rules
* Preserve the original explanation's English text exactly as it appears, except for obvious OCR spacing mistakes.
* Preserve bold, italics, underline/dotted underline, color emphasis, bullets, numbered lists, tables, timelines, flowcharts, callouts, and date highlights.
* **Tables**: Rebuild as `<table>` with explicit borders. Every table must have `border: 1px solid #cccccc; border-collapse: collapse;` on the table element, and `border: 1px solid #cccccc; padding: 8px 12px;` on every `<th>` and `<td>`. Header cells (`<th>`) use `background: #f5f5f5; font-weight: bold;`. Do not use borderless or invisible-border tables.
* **Text emphasis from source**: Reproduce underlines as `text-decoration: underline`, bold as `<strong>`, and any dotted/dashed underlines as `border-bottom: 1px dashed #555`. Do not drop these from the source image.
* **Diagrams/flowcharts**: Rebuild as native HTML/CSS. Do not embed the uploaded image itself.
* Do not invent a new "learning card" design if the source image already has a design. Match the source image.
* Do not add a toolbar, navigation bar, dark-mode toggle, search box, tabs, quiz controls, title labels like "Explanation", or any app chrome.
* **REMOVE entirely**: the bottom metadata footer (Subject / Chapter / Topic labels and their values), copyright notices, watermarks, and source-site branding. These must not appear anywhere in the output HTML.

### 2. CSS Architecture: No Tailwind, No Frameworks
* Do NOT use Tailwind CSS, Tailwind CDN, Bootstrap, external CSS frameworks, icon libraries, web components, React/Vue, or external JavaScript.
* Use one inline `<style>` block only. All CSS must be vanilla CSS scoped under a root wrapper class such as `.pbx-explanation`.
* Every custom class should be prefixed with `pbx-` to avoid collisions.
* Do not style global `html`, global `body`, or global `*` except for a minimal body margin/font/background needed for the standalone HTML. Prefer `.pbx-explanation ...` selectors.
* Do not set `height: 100vh`, `min-height: 100vh`, `position: fixed`, or full-screen viewport layouts. The document must naturally grow to its content height inside an iframe.
* Do not rely on generated utility classes such as `md:*`, `hover:*`, `min-w-[840px]`, etc. Write explicit CSS rules instead.

### 3. Layout and Responsive Behavior
* The content must render correctly at full iframe width on both desktop and mobile (320px–1400px).
* **Base font**: `body { font-size: 1rem; line-height: 1.7; }`. Use `rem` for all font sizes and `em` for padding/margin — never `px` for typography, never `vw` units for font-size. This ensures the layout respects the user's browser font size preferences.
* **Mobile breakpoint** (`@media (max-width: 640px)`): set `body { font-size: 0.95rem; padding: 0.75rem; }` and reduce heading sizes proportionally using `rem`.

* **Tables**:
  - Always wrap every `<table>` in `<div class="pbx-scroll-x" style="overflow-x:auto; -webkit-overflow-scrolling:touch; margin: 16px 0;">`.
  - Set `table { min-width: 480px; width: 100%; border-collapse: collapse; }` so the table scrolls horizontally on mobile rather than collapsing.
  - On mobile (`max-width: 640px`): reduce `th, td` font-size to `0.825rem` and padding to `0.5em 0.625em`.
  - Never hide table columns or reformat a table into a stacked list — preserve the original tabular structure and let it scroll.

* **Flowcharts / decision trees / timelines**:
  - Wrap the diagram content in `<div class="pbx-flow-inner">` inside `.pbx-scroll-x`.
  - Set a `min-width` on `.pbx-flow-inner` that matches the natural width of the diagram (e.g. `min-width: 560px`).
  - Do not vertically collapse horizontal flowcharts. On small screens, allow horizontal scrolling.

* **General layout**:
  - `.pbx-explanation { padding: 1.25rem 1.5rem; }` on desktop; `padding: 0.875rem 1rem` on mobile. Use `rem`/`em` — not `px`.
  - All cards, concept boxes, and callouts: `box-sizing: border-box; width: 100%; padding: 1em 1.25em`.
  - Long legal terms and URLs must break with `word-break: break-word; overflow-wrap: break-word`.
  - Images (if any) must have `max-width: 100%; height: auto`.

### 4. Interactivity: Prefer CSS, Use Minimal Vanilla JS Only When Needed
* Preserve source-image interactivity only when it helps explain the existing graphic, such as hover-linked dates, terms, timeline nodes, or mnemonic highlights.
* Choice-linked highlighting contract for PassBar:
  - If any explanation paragraph, card, list item, table row, timeline node, tooltip, or callout explains a particular answer choice, add `data-choice="A"`, `data-choice="B"`, `data-choice="C"`, or `data-choice="D"` to that exact element.
  - If it explains the correct choice, also add `data-choice-role="correct"`.
  - If it explains a distractor/wrong choice, also add `data-choice-role="distractor"`.
  - Put the attribute on the smallest useful block, not the whole page. Example: `<li data-choice="C" data-choice-role="distractor">...</li>`.
  - If one block discusses multiple choices, use a space-separated value, e.g. `data-choice="A D"`.
  - Do not write custom JavaScript for this; PassBar will highlight these anchors from the parent app.
  - If the source explanation contains an answer-choice explanation section, preserve its visual/textual style but add anchors using this required structure:
    `<div data-choice="B" data-choice-role="correct">...</div>` for the correct answer block and
    `<li data-choice="A" data-choice-role="distractor">...</li>` for each wrong-answer line.
  - The final HTML should contain one correct `data-choice` anchor and, when the source discusses distractors, one distractor anchor for each wrong choice. Use the provided Answer Choice Context below to identify the correct letter.
* Use CSS-only hover/focus when possible:
  - `.pbx-term:hover .pbx-tooltip`
  - `.pbx-date:hover`
  - `.pbx-hotspot:hover`
* If JavaScript is necessary, use a short inline vanilla JS script only. No dependencies, no network calls, no storage, no timers.
* Interactive popups/tooltips must stay inside the explanation card, must not be clipped, and must work inside an iframe.
* Tooltips for legal terms may include concise Simplified Chinese explanations, but do not alter the visible original English explanation text.
* Support keyboard focus for interactive terms using `tabindex="0"` and `:focus-within` where practical.

### 5. Educational Objective and References Styling (MANDATORY)
If the source image contains an "Educational objective:" section, render it with this exact style:
```html
<div class="pbx-edu-objective">
  <div class="pbx-edu-objective-title">📌 Educational Objective</div>
  <p>...objective text...</p>
</div>
```
CSS for `.pbx-edu-objective`: `background: #f0f7ff; border-left: 4px solid #3498db; border-radius: 6px; padding: 14px 18px; margin: 24px 0;`
CSS for `.pbx-edu-objective-title`: `font-size: 13px; font-weight: 700; color: #2980b9; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;`

If the source image contains a "References" section with case citations or statute links, render it with this exact style:
```html
<div class="pbx-references">
  <div class="pbx-references-title">📚 References</div>
  <ul class="pbx-ref-list">
    <li>citation text (plain text, no external links)</li>
  </ul>
</div>
```
CSS for `.pbx-references`: `background: #fafafa; border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px 18px; margin: 20px 0;`
CSS for `.pbx-references-title`: `font-size: 13px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;`
CSS for `.pbx-ref-list`: `margin: 0; padding-left: 18px; font-size: 14px; color: #555; line-height: 1.7;`
* Render all case/statute citations as plain text (no `<a>` links, no external URLs).

### 6. Topic Extraction (MANDATORY)
* Look at the bottom footer area of the source image. It typically shows three metadata labels in columns: Subject / Chapter / Topic (e.g. "Criminal Law and Procedure | Constitutional Protections | Right to counsel").
* Extract the **Topic** value (the third column, e.g. "Right to counsel", "Double jeopardy", "Search and seizure").
* Do NOT render this footer in the HTML output.
* Instead, output the topic as a single HTML comment on the very first line of the `<body>`, before all other content:
  `<!-- pbx-topic: Right to counsel -->`
* If no topic can be identified from the image, output: `<!-- pbx-topic: -->`

### 7. Output Contract
* Return one complete HTML document only: `<!doctype html><html>...`.
* Include all CSS and any minimal JS inline in that same document.
* Do not use external assets, external scripts, external stylesheets, CDN links, or placeholders.
* Do not include Markdown fences, explanations, comments about your process, or omitted-code markers.
* The file must work directly in a browser and inside an iframe.

Now analyze the uploaded image and produce the faithful single-file HTML restoration:
"""

def build_english_explanation_prompt(en_options: dict[str, str], correct_answer: str) -> str:
    context = "\n".join(
        f"{key}. {value}"
        for key, value in sorted(en_options.items())
    )
    wrong_answers = [k for k in sorted(en_options.keys()) if k != correct_answer]
    return (
        GEMINI_EXPLANATION_PROMPT
        + "\n\nAnswer Choice Context for PassBar data-choice anchors:\n"
        + f"Correct Answer: {correct_answer or '(unknown)'}\n"
        + f"Wrong Answers: {', '.join(wrong_answers) or '(unknown)'}\n"
        + f"{context or '(No answer choices available)'}\n"
        + """
### Answer Choice Color-Coding Rules
Use these exact hex colors (do NOT use CSS variables — they may not be defined in this document):
- Correct color: `#1f8f4d` (green)
- Wrong color: `#9b1c1c` (red)
- Mixed color: `#b07d00` (dark amber, when token contains both correct and wrong letters)
- Correct border: `#27ae60`
- Wrong border: `#c0392b`

Detect which of the three patterns applies and handle accordingly. Do NOT use background colors — use only left-border and text color to keep the styling clean and non-distracting.

**Pattern A — Paragraph that begins with "(Choice X)" or "(Choices X & Y)"** (the entire paragraph is dedicated to explaining that choice):
- Keep the paragraph as-is. Add `data-choice="{letter}" data-choice-role="correct|distractor"` to the `<p>` or wrapping element.
- Add a subtle left border: correct `border-left:3px solid #27ae60; padding-left:10px;`, wrong `border-left:3px solid #c0392b; padding-left:10px;`
- Wrap only the leading "(Choice X)" label in a `<strong>` with matching color: correct `color:#1f8f4d`, wrong `color:#9b1c1c`.
- Example: `<p style="border-left:3px solid #c0392b;padding-left:10px;" data-choice="B" data-choice-role="distractor"><strong style="color:#9b1c1c">(Choice B)</strong> The rest of text...</p>`

**Pattern B — Inline choice mention mid-sentence** (e.g. "(Choice C)", "(Choices A and C)", "(Choices B & D)" appear inside a larger paragraph):
- Do NOT add any border or background to the paragraph.
- Wrap only the token itself in a colored `<span>`. Determine the color by checking all letters in the token against the Correct Answer provided above:
  - Token contains **only wrong letters** → `<span style="color:#9b1c1c;font-weight:600;" data-choice="{letters}" data-choice-role="distractor">(Choices ...)</span>`
  - Token contains **only the correct letter** → `<span style="color:#1f8f4d;font-weight:600;" data-choice="{letter}" data-choice-role="correct">(Choice {letter})</span>`
  - Token contains **a mix of correct and wrong letters** → `<span style="color:#b07d00;font-weight:600;" data-choice="{letters}">(Choices ...)</span>`
- For multi-letter tokens like "(Choices A and C)" or "(Choices B & D)", use space-separated letters in `data-choice`, e.g. `data-choice="A C"` or `data-choice="B D"`.
- Recognized token patterns (match case-insensitively):
  - `(Choice X)` — single letter
  - `(Choices X and Y)` — two letters joined by "and"
  - `(Choices X & Y)` — two letters joined by "&"
  - `(Choices X, Y, and Z)` — three letters
  - Extract all capital letters A–D from the token to determine which choices are referenced.

**Pattern C — Dedicated visual card/block per choice** (source has a visually separate card or list item entirely for one choice):
- Add correct `border-left:3px solid #27ae60; padding-left:10px;` or wrong `border-left:3px solid #c0392b; padding-left:10px;` to that block.
- Do NOT add background colors.
- Add `data-choice` and `data-choice-role` attributes.

**Rules:**
- Never invent a per-choice section if one does not exist in the source.
- Never add background colors to any choice block.
- Apply these styles only to elements that already discuss a specific choice.
"""
    )

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

   CRITICAL LAYOUT RULES (do not violate):
   - Do NOT use Tailwind CSS, Tailwind CDN, Bootstrap, external CSS frameworks, external JavaScript, icon libraries, or web fonts.
   - Use only vanilla HTML and one inline `<style>` block. Optional inline vanilla JS is allowed only for small CSS-like interactions such as hover/focus tooltips.
   - DO NOT use `display: flex` or `justify-content: center` on `body`; the document is embedded in an iframe and must naturally grow to content height.
   - DO NOT set `height: 100vh`, `min-height: 100vh`, `position: fixed`, or app-like full-screen layouts.
   - DO NOT use `margin: 0 auto` on `.container` for the main layout. The page must look correct at full iframe width, not as a narrow centered landing page.
   - DO NOT set a fixed `max-width` less than 100% on `.container`. Instead, use horizontal padding on `.container` for breathing room.
   - Wide tables/diagrams must be wrapped in a horizontal-scroll container and keep their natural minimum width rather than collapsing.

   ```css
   * {{ box-sizing: border-box; }}
   body {{
     margin: 0;
     padding: 0;
     background: var(--bg-color);
     color: var(--text-color);
     font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
     font-size: 18px;
     line-height: 1.72;
     letter-spacing: 0;
     display: block;
   }}
   .container {{
     width: 100%;
     padding: 0 24px 32px;
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
     font-size: 32px;
     line-height: 1.15;
     font-weight: 800;
     letter-spacing: 0;
   }}
   .sub-title {{
     margin: 0;
     font-size: 20px;
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
     font-size: 26px;
     border-bottom: 3px solid var(--accent-color);
     padding-bottom: 10px;
     margin: 34px 0 20px;
   }}
   h3 {{
     font-size: 22px;
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
   - Any answer-choice explanation block MUST include a PassBar anchor attribute: `data-choice="A"` / `data-choice="B"` / `data-choice="C"` / `data-choice="D"`. Correct-answer blocks must also include `data-choice-role="correct"`; wrong-answer/distractor blocks must include `data-choice-role="distractor"`.
   - `.option .option-title`: short blue/green/red heading, `font-size: 22px`, `font-weight: 800`, `margin: 0 0 12px`.
   - `.key-clue`: inline key fact marker, `font-weight: 800`, `background: rgba(52,152,219,0.12)`, `border-bottom: 2px solid rgba(52,152,219,0.45)`, `padding: 0 2px`.
   - `.term-grid`: compact legal-term grid, `display: grid`, `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))`, `gap: 12px`, `margin: 18px 0`.
   - `.term-card`: concise term card, `background: #f8fbff`, `border: 1px solid #d7e9f8`, `border-radius: 8px`, `padding: 12px 14px`.
   - `.term-card strong`: term heading, `color: var(--primary-ink)`.
   - `.keyword-strip`: compact key-clue strip, `display: flex`, `flex-wrap: wrap`, `gap: 8px`, `margin: 12px 0 18px`.
   - `.keyword-chip`: small clue chip, `background: rgba(52,152,219,0.12)`, `border: 1px solid rgba(52,152,219,0.35)`, `border-radius: 999px`, `padding: 4px 10px`, `font-weight: 700`.
   - `.elimination-list`: compact list for wrong choices, `margin: 12px 0 0`, `padding-left: 0`, `list-style: none`.
   - `.elimination-list li`: compact lines, `margin: 8px 0`, `line-height: 1.55`.
   - `.method-box`: systematic solving-method card, `background: var(--highlight-bg)`, `border-left: 5px solid var(--accent-color)`, `border-radius: 8px`, `padding: 18px 20px`, `margin: 22px 0`.
   - `code`: `background: rgba(0,0,0,0.05)`, `padding: 2px 4px`, `border-radius: 4px`, `font-size: 0.92em`.
   - `.term`: quiet textbook-style emphasis, not a pill/badge. Do not set an explicit `color`; it must inherit the surrounding text color. Use `background: transparent`, `border-bottom: 1px solid rgba(36,52,71,0.26)`, `padding: 0 1px 1px`, `border-radius: 0`, `font-size: 1em`, `font-weight: 800`, `white-space: normal`. It must read as part of the sentence, blend naturally inside green/red/yellow cards, and should never look like a separate button, label, or badge.
   - When marking a legal term with `.term`, wrap the complete bilingual term in one span whenever English appears with Chinese. Correct: `<span class="term">要约（offer）</span>` or `<span class="term">确定要约规则（firm offer rule）</span>`. Incorrect: `<span class="term">要约</span>（offer）`. Do not mark only the Chinese half when the English term is present.

4. Responsive rules:
   The HTML must render correctly at any viewport from 320px to 1400px wide. The following rules are MANDATORY — not optional suggestions.

   **Tables (`.comparison-table` and any other `<table>`):**
   - Always wrap every `<table>` in `<div style="overflow-x:auto; -webkit-overflow-scrolling:touch; margin:16px 0;">`.
   - Set `table { min-width: 480px; width: 100%; border-collapse: collapse; }` so tables scroll horizontally on mobile instead of collapsing.
   - At `max-width: 640px`: reduce `th, td` font-size to `14px` and padding to `8px 10px`.
   - Never hide columns, stack rows, or reformat a table into a list. Preserve the original tabular structure and let it scroll.

   **Diagrams / flowcharts / timelines (`.diagram`):**
   - Wrap diagram content in an inner div with a fixed `min-width` that preserves the layout (e.g. `style="min-width:520px"`), nested inside `<div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">`.
   - Never collapse a horizontal flowchart into a vertical stack on mobile. Allow horizontal scrolling instead.
   - `.flow-node` and `.party-box` must never have their text truncated or clipped. Use `white-space: normal; word-break: break-word`.

   **General:**
   - Use `rem` for all font-sizes and `em` for padding/margin so the layout scales with user font preferences. Never use `px` for font-size or typographic spacing.
   - Base: `body { font-size: 1rem; line-height: 1.75; padding: 1.25rem; }` (1rem = browser default, typically 16px but respects user settings).
   - Headings: `h2 { font-size: 1.5rem; margin: 1.5em 0 0.75em; }`, `h3 { font-size: 1.25rem; margin: 1.25em 0 0.6em; }`.
   - At `max-width: 640px`: `body { font-size: 0.95rem; padding: 0.75rem; }`, `.header { padding: 1.5em 1rem; }`.
   - All cards and boxes: `box-sizing: border-box; width: 100%; max-width: 100%; padding: 1em 1.25em`.
   - Long legal terms and English phrases must wrap: `word-break: break-word; overflow-wrap: break-word`.
   - Do not use `vw` units for font-size or negative letter-spacing.
   - Do not create nested cards inside cards.

5. Core sections for the multi-dimensional deep analysis card (all sections must be included; do not delete or merge):
   - 【Card Top Header】: Use class `.header`, fixed navy `var(--primary-color)`, title text exactly “MBE 考点解析”, and subtitle as `[Subject]: [Chapter or Issue]`.
   - 【Correct Answer Box (.answer-box)】: Put the correct answer and one-sentence holding near the top, immediately after the header.
   - 【Core Legal Rule <h2> + .concept-box】: Explain the governing doctrine in Chinese, preserving essential English terms. Before the rule explanation, include a concise `.term-grid` titled “先抓法律术语” with 3-6 high-value bilingual terms from the English question, choices, and uploaded official English explanation image(s). Each term card must use this style: `中文术语（English term） — 一句话说明它在本题中的作用`. Do not list generic terms that do not matter to the answer.
   - 【Concept Comparison Table (.comparison-table)】: Compare the tested rule with a commonly confused rule when useful.
   - 【Fact/Application Logic <h2> + .analysis-step】: Apply rule elements to the facts in progressive steps. Start this section with a `.keyword-strip` titled “题干得分关键字”, containing 3-5 bilingual clue chips such as `timing / 时间点`, `procedural posture / 程序姿态`, `relief requested / 请求救济`, `jurisdiction / 管辖`, etc. Then explain the application in 3-5 short steps, using `<span class="key-clue">...</span>` for the decisive words from the question.
   - 【Diagram (.diagram)】: Include a diagram only when it genuinely clarifies the analysis. When a diagram is included, it MUST be interactive — use vanilla JS and CSS to add meaningful interactivity. Choose the most appropriate interactive pattern from the list below based on the content type, and implement it fully:

     **Flowchart / Decision tree** (e.g. legal test with Yes/No branches):
     - Each `.flow-node` is clickable. Clicking a node highlights the path taken in this specific fact pattern (the "correct path") using a `.active` class.
     - Nodes on the correct path glow with `background: var(--accent-color); color:#fff; box-shadow: 0 0 0 3px rgba(52,152,219,0.35)`.
     - Add a "重置" reset button to restore all nodes to default.
     - On page load, auto-animate the correct path step-by-step (200ms delay between nodes) so the student sees the logical flow immediately.

     **Timeline** (e.g. sequence of legal events):
     - Each event node is clickable and reveals a detail tooltip/popup below it with the legal significance of that moment.
     - Highlight the "pivotal event" (the one that controls the answer) in accent color on load.
     - Allow clicking other events to compare and contrast (tooltip shows "此时 X 已/未发生").

     **Comparison table** (e.g. two doctrines side-by-side):
     - Each row is hoverable — hovering highlights the row and shows a small badge explaining which rule applies to the facts of this question.
     - Add a "本题适用" tag that animates in (fadeIn) next to the applicable row on load.

     **Element checklist** (e.g. legal test with multiple required elements):
     - Render as an animated checklist. On load, each element checks off one by one (300ms apart) with a ✓ animation.
     - Elements satisfied by the facts get a green check; elements NOT satisfied get a red ✗.
     - Each element is clickable to expand a one-line explanation of why it is/isn't met in this case.

     **General rules for all interactive diagrams:**
     - All interactivity must work inside an iframe without any external dependencies.
     - Use only vanilla JS (no jQuery, no libraries). Keep the script under 60 lines.
     - CSS transitions must be smooth (`transition: all 0.2s ease`).
     - Mobile touch must work — use both `click` and `touchend` events.
     - The diagram must still be readable if JS is disabled (progressive enhancement).
     - Do NOT make the diagram full-screen or modal — it must sit inline in the page flow.
   - 【Trap Alert (.trap-alert or .rule-block)】: Explain the MBE trap in warm yellow.
   - 【Answer-Choice Breakdown (.option-analysis / .option)】: The section title must be “正确答案与干扰项排除”. This section must be concise, exam-useful, and structured like a tutor explaining elimination logic. Correct card green; wrong cards red only inside `.option.wrong`. Do NOT restate the full answer-choice text. Do NOT write only “正确/错误”. Use the required format below.
     Required format:
     1. Start with a short subheading: `为什么选 [letter]？`
     2. Wrap the correct explanation block in an element with `data-choice="[letter]" data-choice-role="correct"`.
     3. In 2 short sentences, explain why the correct option wins. Must cite one exact trigger fact from the English question and one rule concept read from the uploaded official English explanation image(s). Use `<span class="key-clue">...</span>` for the trigger fact, and keep the English legal term in parentheses.
     4. Then include a compact “为什么排除其他选项：” block using `.elimination-list`. Each wrong choice must have one line only, in this style: `✕ A (No): 错在把 ___ 当成 ___；关键字 ___ 排除它。`
        Each wrong-choice `<li>` MUST include `data-choice="A"` etc. and `data-choice-role="distractor"`.
     5. For every wrong choice, identify the precise wrong assumption, missing element, wrong legal consequence, or trap in that choice. Avoid generic lines like “不符合规则”, “法律结论错误”, “本题不适用”, or repeating the same rule in long form.
     6. End this section with a `.method-box` titled `这题建议用什么方法？`, explaining the best solving method: elimination, timeline, element checklist, party-role mapping, jurisdiction-first, remedy-first, exception spotting, or issue-trigger matching. Also explain in 1-2 sentences the exam writer's design logic: what tempting rule/trap they expected the student to fall for.
     Length control: the correct-answer explanation should be 60-110 Chinese characters; each wrong-choice line should be 28-60 Chinese characters; the method box should be 70-130 Chinese characters. Be sharp, not verbose.
     Mandatory interaction skeleton (adapt the text, but preserve the attributes exactly):
     ```html
     <section class="option-analysis">
       <h2>正确答案与干扰项排除</h2>
       <div class="option correct" data-choice="B" data-choice-role="correct">
         <h3 class="option-title">为什么选 B？</h3>
         <p>...</p>
       </div>
       <p><strong>为什么排除其他选项：</strong></p>
       <ul class="elimination-list">
         <li data-choice="A" data-choice-role="distractor">✕ A (...): ...</li>
         <li data-choice="C" data-choice-role="distractor">✕ C (...): ...</li>
         <li data-choice="D" data-choice-role="distractor">✕ D (...): ...</li>
       </ul>
     </section>
     ```
     Replace `B` with the actual correct answer letter and include all three wrong choices. Before finalizing, self-check that the final HTML contains at least four `data-choice="..."` attributes: one correct block and three distractor lines. If it does not, fix the HTML before answering.
   - 【Exam Tip (.footer-tip)】: End with a concise exam shortcut or decision rule.

【Special Restrictions and Quality Assurance】
- ⚠️ Absolutely do not include the original English question text or English answer-choice buttons, such as A/B/C/D buttons, from the source materials in the HTML!
- ⚠️ You MUST read and use all three English inputs: the original English question, the English answer choices, and the uploaded official English explanation image(s) attached to this prompt. The Chinese analysis must be derived from these materials, not from guessing based only on the correct answer.
- ⚠️ Every major legal term and decisive keyword should appear in bilingual form at least once, e.g. `重新审判动议（motion for a new trial）`, `判决登录（entry of judgment）`, `自动暂缓执行（automatic stay）`. Use Chinese first, English in parentheses.
- ⚠️ In “正确答案与干扰项排除”, do not copy or paraphrase the complete original answer choices. Avoid verbose lines like “正确选项：买方可以立即提起违约诉讼（对应原题 A 选项）” or “错误选项：买方必须给珠宝商补救的机会（对应原题 B 选项）”. Also avoid bare labels like “A. 正确” / “B. 错误” without real reasoning. The section must read like: “为什么选 B？” → key clue from the question → concise elimination of A/C/D → recommended solving method and trap logic.
- ⚠️ Do NOT generate any footer, watermark, branding, or copyright notice of any kind — no "MBE 备考助手", no "© MBE", no "仅供学习参考", no "PassBar", and no similar text anywhere in the HTML. The page must contain zero branding elements.
- OUTPUT LANGUAGE: Every sentence of analysis, explanation, and UI label must be written in Simplified Chinese (简体中文). Traditional Chinese characters (繁體字) are strictly forbidden. English is permitted only for: legal terms of art, case names, statutes (e.g. U.S.C. §), Latin maxims, MBE exam keywords, and key concepts that must stay in English for exam accuracy. All other text must be 简体中文.
- Do not simplify, cut down, or abbreviate any legal analysis! All nine sections listed above must be fully presented.
- Return only a complete, ready-to-use, single HTML document that does not require any external JS/CSS files.

---
【Original Legal Analysis Material Input Area】

Subject: {subject} — {chapter}

Question:
{question}

Answer Choices:
{choices}

Correct Answer: {correct_answer_letter}. {correct_answer_text}

Official English Explanation Source:
The official English explanation is provided as uploaded image(s), usually from `source_img` / `sourceExplanationImageFile`. Read those image(s) carefully and extract the rule, legal terms, factual triggers, and option logic from them. If supplemental OCR/plain text is available below, use it only as a helper and trust the uploaded image when there is a conflict.

Supplemental OCR/plain text, if available:
{english_explanation}

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


def extract_html_from_response(text: str) -> str:
    """從 AI 回覆中取出 HTML（可能包在 ```html ``` 中）。"""
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
    """呼叫 Gemini REST API（gemini-3.5-flash），支援文字 + 多張圖片。
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


def call_openai_responses(
    prompt_text: str,
    image_paths: list[str] | str | None = None,
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
                "detail": "high",
            })
    content.append({"type": "input_text", "text": prompt_text})

    payload = json.dumps({
        "model": AI_MODEL,
        "input": [{"role": "user", "content": content}],
        "max_output_tokens": 65536,
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
                return _extract_openai_text(json.loads(resp.read()))
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
) -> str:
    if AI_PROVIDER == "gpt":
        return call_openai_responses(prompt_text, image_paths)
    return call_gemini_rest(prompt_text, image_paths)


def ai_label() -> str:
    return "GPT" if AI_PROVIDER == "gpt" else "Gemini"


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
    raw = call_ai_rest(prompt)
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
            raw = call_ai_rest(build_english_explanation_prompt(en_options, correct_answer), img_paths)
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
                            prompt, collect_img_paths(api_data))
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
                        question=en_question,
                        choices=format_choices_for_prompt(en_options),
                        correct_answer_letter=correct_answer,
                        correct_answer_text=en_options.get(correct_answer, ""),
                        english_explanation=en_explanation_text or "(No supplemental OCR/plain text available; use the uploaded official explanation image.)",
                    )
                    print(
                        f"  {ai_label()}(zh-html) → Q{index:04d}: {en_question[:60]}…", end=" ", flush=True)
                    try:
                        raw_response = call_ai_rest(prompt, img_paths)
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
    parser.add_argument("--provider", choices=("gemini", "gpt"), default="gemini",
                        help="AI provider for missing generated fields (default: gemini)")
    parser.add_argument("--model", default="",
                        help="Override provider model (default: gemini-3.5-flash or OPENAI_MODEL/gpt-5.4-mini)")
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
            print("  Create scripts/.env and add: OPENAI_API_KEY=your_key_here")
            sys.exit(1)
        if AI_PROVIDER == "gemini" and not _GEMINI_API_KEYS:
            print("ERROR: No GEMINI_API_KEY_1 ~ GEMINI_API_KEY_N found in environment or .env file.")
            print("  Create scripts/.env and add: GEMINI_API_KEY_1=your_key_here")
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
    main()
