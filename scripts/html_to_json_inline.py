#!/usr/bin/env python3
"""
html_to_json_inline.py

將 HTML 檔案內容轉成 JSON inline，並可直接寫入指定 enriched JSON 的指定題目。

使用方式：
  # 直接更新 enriched JSON 中 index=3 的 zh-explanation
  python3 scripts/html_to_json_inline.py my_card.html --json path/to/_enriched.json --index 3

  # 更新 explanation（英文解析）欄位
  python3 scripts/html_to_json_inline.py my_en.html --json path/to/_enriched.json --index 3 --field explanation

  # 不寫入，只印出 JSON 片段（預覽）
  python3 scripts/html_to_json_inline.py my_card.html --field zh-explanation

  # 多個 HTML 依序更新多個 index
  python3 scripts/html_to_json_inline.py q1.html q2.html --json path/to/_enriched.json --index 5 7
"""

import argparse
import json
import os
import sys


def read_html(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read().strip()


def load_enriched_doc(json_path: str) -> tuple[object, list[dict]]:
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data, data
    return data, data.get("questions", [])


def load_enriched(json_path: str) -> list[dict]:
    _doc, questions = load_enriched_doc(json_path)
    return questions


def save_enriched(json_path: str, questions: list[dict], doc: object | None = None) -> None:
    payload = questions
    if isinstance(doc, dict):
        payload = {**doc, "questions": questions}
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(
        description="Embed HTML file(s) into enriched JSON by index")
    parser.add_argument("files", nargs="+", help="HTML file(s) to embed")
    parser.add_argument(
        "--json", "-j", default="",
        metavar="ENRICHED_JSON",
        help="Path to the enriched JSON file to update")
    parser.add_argument(
        "--index", "-i", nargs="+", type=int, default=[],
        metavar="N",
        help="Question index(es) to update (must match number of HTML files)")
    parser.add_argument(
        "--field", "-f", default="zh-explanation",
        help='Field to update: zh-explanation (default) | explanation | zh-question')
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Preview what would be written without saving")
    args = parser.parse_args()

    # ── 模式 1：指定 enriched JSON + index → 直接寫入 ─────────────────────
    if args.json:
        if not os.path.exists(args.json):
            print(f"ERROR: enriched JSON not found: {args.json}", file=sys.stderr)
            sys.exit(1)

        if args.index and len(args.index) != len(args.files):
            print(
                f"ERROR: {len(args.files)} HTML file(s) but {len(args.index)} index(es) given. "
                "Counts must match.",
                file=sys.stderr,
            )
            sys.exit(1)

        doc, questions = load_enriched_doc(args.json)
        index_map: dict[int, dict] = {q.get("index"): q for q in questions}

        for i, html_path in enumerate(args.files):
            target_index = args.index[i] if args.index else None

            if target_index is None:
                print(f"ERROR: --index is required when using --json", file=sys.stderr)
                sys.exit(1)

            if target_index not in index_map:
                print(f"ERROR: index {target_index} not found in {args.json}", file=sys.stderr)
                print(f"  Available indices: {sorted(index_map.keys())}", file=sys.stderr)
                sys.exit(1)

            html = read_html(html_path)
            q = index_map[target_index]

            if args.dry_run:
                preview = html[:120].replace("\n", " ")
                print(f"[dry-run] Q{target_index:04d}.{args.field} ← {html_path}")
                print(f"          preview: {preview}…")
            else:
                q[args.field] = html
                print(f"✅ Q{target_index:04d}.{args.field} ← {html_path}")

        if not args.dry_run:
            save_enriched(args.json, questions, doc)
            print(f"\n💾 Saved → {args.json}")

    # ── 模式 2：無 enriched JSON → 印出 JSON 片段供手動貼入 ───────────────
    else:
        for html_path in args.files:
            if not os.path.exists(html_path):
                print(f"ERROR: file not found: {html_path}", file=sys.stderr)
                sys.exit(1)
            html = read_html(html_path)
            snippet = {args.field: html}
            print(json.dumps(snippet, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
