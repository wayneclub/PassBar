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
import re
import sys
from pathlib import Path


OUT_DIR = os.environ.get("OUT_DIR", os.path.join(
    os.path.dirname(__file__), "..", "out"))


# ── 工具函式 ──────────────────────────────────────────────────────────────────

def is_error_html(html: str) -> bool:
    return not html or html.strip().startswith("<!-- ERROR:")


def load_enriched_questions(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, list) else data.get("questions", [])


def enriched_score(path: str) -> tuple[int, int, str]:
    """優先固定檔名，其次題數較完整，最後檔名排序。"""
    try:
        questions = load_enriched_questions(path)
    except Exception:
        questions = []
    dated = re.search(
        r"_\d{4}-\d{2}-\d{2}_castudy_enriched\.json$",
        os.path.basename(path),
    )
    return (0 if dated else 1, len(questions), path)


def check_question(q: dict) -> dict[str, bool]:
    """回傳各欄位的缺失狀態（True = 缺失）。"""
    meta = q.get("meta")
    qa = meta.get("question_analysis") if meta else None
    return {
        "missing_zh_question":        not q.get("zh-question", "").strip(),
        "missing_zh_choices":         not q.get("zh-choices"),
        "missing_zh_explanation":     is_error_html(q.get("zh-explanation", "")),
        "missing_en_explanation":     is_error_html(q.get("explanation", "")),
        "missing_meta":               not meta,
        "missing_question_analysis":  not qa,
        "missing_micro_concept":      not (qa or {}).get("micro_concept", "").strip() if qa else True,
        "missing_keyword_meta":       not (qa or {}).get("question_keyword_meta") if qa else True,
        "missing_highlight_meta":     not (qa or {}).get("question_highlight_meta") if qa else True,
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

    # 收集所有 subject/chapter 目錄
    all_chapter_dirs = sorted([
        d for d in glob.glob(os.path.join(out_dir, "*", "*"))
        if os.path.isdir(d)
    ])

    if args.subject:
        all_chapter_dirs = [d for d in all_chapter_dirs if args.subject.lower() in d.lower()]
    if args.chapter:
        all_chapter_dirs = [d for d in all_chapter_dirs if args.chapter.lower() in d.lower()]

    if not all_chapter_dirs:
        print("No chapter directories found.")
        sys.exit(0)

    # 統計
    total_questions        = 0
    total_missing_any      = 0
    total_no_enriched      = 0

    # 按 subject/chapter 的摘要
    chapter_stats: list[dict] = []
    # 完整缺失清單（給 JSON/CSV）
    missing_records: list[dict] = []

    for chapter_dir in all_chapter_dirs:
        parts = Path(chapter_dir).parts
        subject = parts[-2]
        chapter = parts[-1]

        # 找該 chapter 下的 enriched JSON；每章只取 canonical/最完整的一份
        enriched_files = sorted(glob.glob(os.path.join(chapter_dir, "*_enriched.json")))

        if not enriched_files:
            total_no_enriched += 1
            chapter_stats.append({
                "subject":                   subject,
                "chapter":                   chapter,
                "total":                     0,
                "missing_any":               0,
                "no_enriched_file":          True,
                "missing_zh_question":       0,
                "missing_zh_choices":        0,
                "missing_zh_explanation":    0,
                "missing_en_explanation":    0,
                "missing_meta":              0,
                "missing_question_analysis": 0,
                "missing_micro_concept":     0,
                "missing_keyword_meta":      0,
                "missing_highlight_meta":    0,
            })
            continue

        selected_enriched = max(enriched_files, key=enriched_score)
        try:
            all_questions = load_enriched_questions(selected_enriched)
        except Exception as e:
            print(f"  WARN: cannot read {selected_enriched}: {e}")
            all_questions = []

        if not all_questions:
            chapter_stats.append({
                "subject":              subject,
                "chapter":              chapter,
                "total":                0,
                "missing_any":          0,
                "no_enriched_file":     False,
                "missing_zh_question":  0,
                "missing_zh_choices":   0,
                "missing_zh_explanation": 0,
                "missing_en_explanation": 0,
            })
            continue

        ch_total       = len(all_questions)
        ch_missing_any = 0
        ch_missing: dict[str, int] = {
            "missing_zh_question": 0,
            "missing_zh_choices": 0,
            "missing_zh_explanation": 0,
            "missing_en_explanation": 0,
            "missing_meta": 0,
            "missing_question_analysis": 0,
            "missing_micro_concept": 0,
            "missing_keyword_meta": 0,
            "missing_highlight_meta": 0,
        }

        for q in all_questions:
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
                    "enriched_file":        os.path.relpath(selected_enriched, out_dir),
                })

        total_questions   += ch_total
        total_missing_any += ch_missing_any

        chapter_stats.append({
            "subject":          subject,
            "chapter":          chapter,
            "total":            ch_total,
            "missing_any":      ch_missing_any,
            "no_enriched_file": False,
            **ch_missing,
        })

    # ── 終端機輸出 ────────────────────────────────────────────────────────────
    pct = f"{total_missing_any/total_questions*100:.1f}%" if total_questions else "N/A"
    print(f"\n{'='*70}")
    print(f"  MBE Enriched JSON — 中文解析缺失報告")
    print(f"{'='*70}")
    print(f"  掃描章節數     : {len(all_chapter_dirs)}")
    print(f"  無 enriched 檔 : {total_no_enriched}")
    print(f"  總題目數       : {total_questions}")
    print(f"  有缺失題數     : {total_missing_any}  ({pct})")
    print()

    # 按 subject 分組列印
    current_subject = None
    for cs in chapter_stats:
        if cs["subject"] != current_subject:
            current_subject = cs["subject"]
            print(f"  📚 {current_subject}")
        if cs.get("no_enriched_file"):
            status = "🔲"
            print(f"     {status} {cs['chapter']:<45}  (no enriched file)")
        elif cs["missing_any"] == 0:
            status = "✅"
            print(f"     {status} {cs['chapter']:<45} "
                  f"{cs['missing_any']:>3}/{cs['total']:>3}  all ok")
        elif cs["missing_any"] == cs["total"]:
            status = "❌"
            print(f"     {status} {cs['chapter']:<45} "
                  f"{cs['missing_any']:>3}/{cs['total']:>3}  "
                  f"[zh_q:{cs['missing_zh_question']} "
                  f"zh_c:{cs['missing_zh_choices']} "
                  f"zh_html:{cs['missing_zh_explanation']} "
                  f"en_html:{cs['missing_en_explanation']} "
                  f"meta:{cs['missing_meta']} "
                  f"qa:{cs['missing_question_analysis']} "
                  f"concept:{cs['missing_micro_concept']} "
                  f"kw:{cs['missing_keyword_meta']} "
                  f"hl:{cs['missing_highlight_meta']}]")
        else:
            status = "⚠️ "
            print(f"     {status} {cs['chapter']:<45} "
                  f"{cs['missing_any']:>3}/{cs['total']:>3}  "
                  f"[zh_q:{cs['missing_zh_question']} "
                  f"zh_c:{cs['missing_zh_choices']} "
                  f"zh_html:{cs['missing_zh_explanation']} "
                  f"en_html:{cs['missing_en_explanation']} "
                  f"meta:{cs['missing_meta']} "
                  f"qa:{cs['missing_question_analysis']} "
                  f"concept:{cs['missing_micro_concept']} "
                  f"kw:{cs['missing_keyword_meta']} "
                  f"hl:{cs['missing_highlight_meta']}]")
    print()

    # ── 寫出報告檔 ────────────────────────────────────────────────────────────
    os.makedirs(report_dir, exist_ok=True)

    # JSON
    json_path = os.path.join(report_dir, "missing_zh_report.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "summary": {
                "total_chapters":      len(all_chapter_dirs),
                "no_enriched_file":    total_no_enriched,
                "total_questions":     total_questions,
                "missing_any":         total_missing_any,
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
