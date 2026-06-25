#!/usr/bin/env python3
"""
Export explanation HTML from all *_enriched.json files.

Creates a debuggable folder tree, preserving subject/chapter names, and writes
one HTML file per question plus an index.html with links.

Usage:
  python3 scripts/export_explanation_html.py
  python3 scripts/export_explanation_html.py --lang en
  python3 scripts/export_explanation_html.py --lang zh
  python3 scripts/export_explanation_html.py --clean
  python3 scripts/export_explanation_html.py --subject "Criminal Law"
  python3 scripts/export_explanation_html.py --output-dir /tmp/explanations-html
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "out"

OUT_EXPLANATIONS_DIR = ROOT / "out_explanations_html"

LANG_CONFIG = {
    "zh": {
        "field": "zh-explanation",
        "default_output_dir": OUT_EXPLANATIONS_DIR / "zh",
        "html_lang": "zh-CN",
        "index_title": "PassBar zh-explanation HTML export",
    },
    "en": {
        "field": "explanation",
        "default_output_dir": OUT_EXPLANATIONS_DIR / "en",
        "html_lang": "en",
        "index_title": "PassBar en-explanation HTML export",
    },
}


def safe_name(value: str) -> str:
    value = (value or "").strip()
    value = re.sub(r"[\\/:*?\"<>|]+", "-", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" .") or "untitled"


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def get_questions(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("questions"), list):
        return data["questions"]
    return []


def is_error_html(value: str) -> bool:
    text = (value or "").strip()
    return not text or text.startswith("<!-- ERROR:")


def ensure_html_document(fragment: str, title: str, html_lang: str) -> str:
    if re.search(r"<html[\s>]", fragment, flags=re.IGNORECASE):
        return fragment
    return f"""<!doctype html>
<html lang="{html_lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{html.escape(title)}</title>
</head>
<body>
{fragment}
</body>
</html>
"""


def relative_link(from_file: Path, to_file: Path) -> str:
    return os.path.relpath(to_file, from_file.parent).replace(os.sep, "/")


def export_file(
    enriched_path: Path,
    output_dir: Path,
    out_dir: Path,
    field: str,
    html_lang: str,
) -> dict[str, Any]:
    data = load_json(enriched_path)
    questions = get_questions(data)
    rel_parts = enriched_path.relative_to(out_dir).parts
    subject = rel_parts[0] if len(rel_parts) >= 1 else "Unknown Subject"
    chapter = rel_parts[1] if len(rel_parts) >= 2 else enriched_path.parent.name

    chapter_dir = output_dir / safe_name(subject) / safe_name(chapter)
    chapter_dir.mkdir(parents=True, exist_ok=True)

    exported: list[dict[str, Any]] = []
    skipped = 0

    for offset, question in enumerate(questions, start=1):
        raw_html = question.get(field) or ""
        if is_error_html(raw_html):
            skipped += 1
            continue

        index = question.get("index") or offset
        title = f"{subject} / {chapter} / Q{index}"
        file_name = (
            f"{int(index):03d}.html"
            if isinstance(index, int) or str(index).isdigit()
            else f"{safe_name(str(index))}.html"
        )
        target = chapter_dir / file_name
        target.write_text(ensure_html_document(raw_html, title, html_lang), encoding="utf-8")

        exported.append({
            "index": index,
            "path": target,
            "question": question.get("question", ""),
        })

    return {
        "source": enriched_path,
        "subject": subject,
        "chapter": chapter,
        "dir": chapter_dir,
        "exported": exported,
        "skipped": skipped,
    }


def write_index(results: list[dict[str, Any]], output_dir: Path, index_title: str) -> None:
    index_path = output_dir / "index.html"
    rows: list[str] = []
    total = 0

    for result in results:
        exported = result["exported"]
        if not exported:
            continue
        total += len(exported)
        rows.append(
            f"<h2>{html.escape(result['subject'])} / {html.escape(result['chapter'])} "
            f"<span>{len(exported)} files</span></h2>"
        )
        rows.append("<ol>")
        for item in exported:
            question = re.sub(r"\s+", " ", item["question"]).strip()
            if len(question) > 160:
                question = question[:157] + "..."
            href = relative_link(index_path, item["path"])
            rows.append(
                f'<li><a href="{html.escape(href)}">Q{html.escape(str(item["index"]))}</a>'
                f'<small>{html.escape(question)}</small></li>'
            )
        rows.append("</ol>")

    index_path.write_text(f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{html.escape(index_title)}</title>
  <style>
    body {{
      margin: 0;
      padding: 32px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1f2937;
      background: #f8fafc;
    }}
    main {{
      max-width: 1080px;
      margin: 0 auto;
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: 28px;
    }}
    .meta {{
      margin: 0 0 28px;
      color: #64748b;
    }}
    h2 {{
      margin: 28px 0 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #dbe3ec;
      font-size: 18px;
    }}
    h2 span {{
      color: #64748b;
      font-size: 13px;
      font-weight: 500;
    }}
    ol {{
      margin: 0;
      padding-left: 24px;
    }}
    li {{
      margin: 6px 0;
    }}
    a {{
      display: inline-block;
      min-width: 58px;
      color: #2563eb;
      font-weight: 700;
      text-decoration: none;
    }}
    a:hover {{
      text-decoration: underline;
    }}
    small {{
      color: #475569;
    }}
  </style>
</head>
<body>
  <main>
    <h1>{html.escape(index_title)}</h1>
    <p class="meta">{total} HTML files exported</p>
    {''.join(rows)}
  </main>
</body>
</html>
""", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export explanation HTML files for debugging")
    parser.add_argument("--lang", default="both", choices=["zh", "en", "both"], help="Language to export: zh, en, or both (default: both)")
    parser.add_argument("--out-dir", default=str(OUT_DIR), help="Input out directory")
    parser.add_argument("--output-dir", default="", help="Base directory to write HTML files (default: out_explanations_html/)")
    parser.add_argument("--subject", default="", help="Filter by subject/path text")
    parser.add_argument("--chapter", default="", help="Filter by chapter/path text")
    parser.add_argument("--clean", action="store_true", help="Delete output directory before exporting")
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    if not out_dir.is_dir():
        print(f"ERROR: out dir not found: {out_dir}")
        sys.exit(1)

    files = sorted(out_dir.glob("*/*/*_enriched.json"))
    if args.subject:
        files = [p for p in files if args.subject.lower() in str(p).lower()]
    if args.chapter:
        files = [p for p in files if args.chapter.lower() in str(p).lower()]

    langs = ["zh", "en"] if args.lang == "both" else [args.lang]

    for lang in langs:
        cfg = LANG_CONFIG[lang]
        output_dir = (
            Path(args.output_dir).resolve() / lang
            if args.output_dir
            else cfg["default_output_dir"]
        )

        if args.clean and output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        results = [
            export_file(path, output_dir, out_dir, cfg["field"], cfg["html_lang"])
            for path in files
        ]
        write_index(results, output_dir, cfg["index_title"])

        exported = sum(len(result["exported"]) for result in results)
        skipped = sum(result["skipped"] for result in results)

        print(f"[{lang}] Exported {exported} explanation HTML file(s), skipped {skipped}")
        print(f"      Output  {output_dir}")
        print(f"      Index   {output_dir / 'index.html'}")


if __name__ == "__main__":
    main()
