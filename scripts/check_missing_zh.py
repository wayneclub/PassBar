#!/usr/bin/env python3
"""
check_missing_zh.py

掃描所有 *_enriched.json，統計並匯出缺少中文解析的題目清單。

判斷標準：
  - zh-question  為空 → 缺中文題目
  - zh-choices   為空 → 缺中文選項
  - zh-explanation 為空或以 <!-- ERROR: 開頭 → 缺中文解析 HTML
  - explanation  為空或以 <!-- ERROR: 開頭 → 缺英文解析 HTML

輸出：
  - 終端機摘要
  - missing_zh_report.json  （結構化清單，可給 generate_zh_explanations.py 參考）
  - missing_zh_report.csv   （Excel 可直接開啟）

使用方式：
  python3 scripts/check_missing_zh.py
  python3 scripts/check_missing_zh.py --subject "Torts"
  python3 scripts/check_missing_zh.py --out-dir /path/to/out
"""

import argparse
import csv
import glob
import json
import os
import sys
from pathlib import Path


OUT_DIR = os.environ.get("OUT_DIR", os.path.join(
    os.path.dirname(__file__), "..", "out"))


# ── 工具函式 ──────────────────────────────────────────────────────────────────

def is_error_html(html: str) -> bool:
    return not html or html.strip().startswith("<!-- ERROR:")


def check_question(q: dict) -> dict[str, bool]:
    """回傳各欄位的缺失狀態（True = 缺失）。"""
    return {
        "missing_zh_question":     not q.get("zh-question", "").strip(),
        "missing_zh_choices":      not q.get("zh-choices"),
        "missing_zh_explanation":  is_error_html(q.get("zh-explanation", "")),
        "missing_en_explanation":  is_error_html(q.get("explanation", "")),
    }


# ── 主邏輯 ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Check missing Chinese/English explanations in enriched JSONs")
    parser.add_argument("--out-dir", default=OUT_DIR,
                        help="Path to out/ directory")
    parser.add_argument("--subject", default="",
                        help="Filter by subject name (partial match)")
    parser.add_argument("--chapter", default="",
                        help="Filter by chapter name (partial match)")
    parser.add_argument("--report-dir", default="",
                        help="Directory to write report files (default: out/ root)")
    args = parser.parse_args()

    out_dir = os.path.abspath(args.out_dir)
    if not os.path.isdir(out_dir):
        print(f"ERROR: out directory not found: {out_dir}")
        sys.exit(1)

    report_dir = os.path.abspath(args.report_dir) if args.report_dir else out_dir

    # 收集所有 enriched JSON
    pattern = os.path.join(out_dir, "*", "*", "*_enriched.json")
    enriched_files = sorted(glob.glob(pattern))

    if args.subject:
        enriched_files = [f for f in enriched_files if args.subject.lower() in f.lower()]
    if args.chapter:
        enriched_files = [f for f in enriched_files if args.chapter.lower() in f.lower()]

    if not enriched_files:
        print("No enriched JSON files found.")
        sys.exit(0)

    # 統計
    total_questions   = 0
    total_missing_any = 0

    # 按 subject/chapter 的摘要
    chapter_stats: list[dict] = []
    # 完整缺失清單（給 JSON/CSV）
    missing_records: list[dict] = []

    for fpath in enriched_files:
        try:
            with open(fpath, encoding="utf-8") as f:
                questions = json.load(f)
            if not isinstance(questions, list):
                questions = questions.get("questions", [])
        except Exception as e:
            print(f"  WARN: cannot read {fpath}: {e}")
            continue

        if not questions:
            continue

        subject = questions[0].get("subject", "?")
        chapter = questions[0].get("chapter", "?")

        ch_total       = len(questions)
        ch_missing_any = 0
        ch_missing: dict[str, int] = {
            "missing_zh_question": 0,
            "missing_zh_choices": 0,
            "missing_zh_explanation": 0,
            "missing_en_explanation": 0,
        }

        for q in questions:
            flags = check_question(q)
            if any(flags.values()):
                ch_missing_any += 1
                for k, v in flags.items():
                    if v:
                        ch_missing[k] += 1
                missing_records.append({
                    "subject":              subject,
                    "chapter":              chapter,
                    "index":                q.get("index", "?"),
                    "question_preview":     q.get("question", "")[:80],
                    **{k: "Y" if v else "" for k, v in flags.items()},
                    "enriched_file":        os.path.relpath(fpath, out_dir),
                })

        total_questions   += ch_total
        total_missing_any += ch_missing_any

        chapter_stats.append({
            "subject":   subject,
            "chapter":   chapter,
            "total":     ch_total,
            "missing_any": ch_missing_any,
            **ch_missing,
        })

    # ── 終端機輸出 ────────────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  MBE Enriched JSON — 中文解析缺失報告")
    print(f"{'='*70}")
    print(f"  掃描章節數 : {len(enriched_files)}")
    print(f"  總題目數   : {total_questions}")
    print(f"  有缺失題數 : {total_missing_any}  ({total_missing_any/total_questions*100:.1f}%)")
    print()

    # 按 subject 分組列印
    current_subject = None
    for cs in chapter_stats:
        if cs["subject"] != current_subject:
            current_subject = cs["subject"]
            print(f"  📚 {current_subject}")
        if cs["missing_any"] == 0:
            status = "✅"
        elif cs["missing_any"] == cs["total"]:
            status = "❌"
        else:
            status = "⚠️ "
        print(f"     {status} {cs['chapter']:<45} "
              f"{cs['missing_any']:>3}/{cs['total']:>3}  "
              f"[zh_q:{cs['missing_zh_question']} "
              f"zh_c:{cs['missing_zh_choices']} "
              f"zh_html:{cs['missing_zh_explanation']} "
              f"en_html:{cs['missing_en_explanation']}]")
    print()

    # ── 寫出報告檔 ────────────────────────────────────────────────────────────
    os.makedirs(report_dir, exist_ok=True)

    # JSON
    json_path = os.path.join(report_dir, "missing_zh_report.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "summary": {
                "total_chapters":  len(enriched_files),
                "total_questions": total_questions,
                "missing_any":     total_missing_any,
            },
            "chapter_stats": chapter_stats,
            "missing_questions": missing_records,
        }, f, ensure_ascii=False, indent=2)
    print(f"  📄 JSON report → {json_path}")

    # CSV
    csv_path = os.path.join(report_dir, "missing_zh_report.csv")
    if missing_records:
        fieldnames = list(missing_records[0].keys())
        with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(missing_records)
        print(f"  📊 CSV  report → {csv_path}")
    else:
        print("  🎉 No missing records — no CSV written.")

    print()


if __name__ == "__main__":
    main()
