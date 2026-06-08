#!/usr/bin/env python3
"""
audit_ai_zh_explanation.py

比對 castudy 原始題庫與 enriched JSON，找出「castudy 沒有 zh-explanation（htmlContent）」
但 enriched 裡已有 zh-explanation 的題目——這些通常是 AI 生成後寫入的。

不會修改任何檔案，只輸出報告供人工確認。

Usage:
  python3 scripts/audit_ai_zh_explanation.py
  python3 scripts/audit_ai_zh_explanation.py --subject "Civil Procedure"
  python3 scripts/audit_ai_zh_explanation.py --only-ai
  python3 scripts/audit_ai_zh_explanation.py --json out/audit_ai_zh_report.json --csv out/audit_ai_zh_report.csv
  python3 scripts/audit_ai_zh_explanation.py --clear-ai              # dry-run 清除 ai_generated
  python3 scripts/audit_ai_zh_explanation.py --clear-ai --apply      # 寫回 enriched JSON
"""

from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import generate_zh_explanations as zh_gen

OUT_DIR = Path(__file__).resolve().parent.parent / "out"
DEFAULT_JSON = OUT_DIR / "audit_ai_zh_explanation.json"
DEFAULT_CSV = OUT_DIR / "audit_ai_zh_explanation.csv"

CATEGORY_AI_GENERATED = "ai_generated"
CATEGORY_FROM_CASTUDY = "from_castudy"
CATEGORY_FROM_CASTUDY_DIFFERS = "from_castudy_differs"
CATEGORY_CASTUDY_HAS_ENRICHED_MISSING = "castudy_has_enriched_missing"
CATEGORY_BOTH_MISSING = "both_missing"
CATEGORY_ENRICHED_ERROR = "enriched_error"
CATEGORY_ENRICHED_MISSING = "enriched_missing"
CATEGORY_CASTUDY_MISSING_INDEX = "castudy_missing_index"


def load_questions(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [q for q in data if isinstance(q, dict)]
    if isinstance(data, dict) and isinstance(data.get("questions"), list):
        return [q for q in data["questions"] if isinstance(q, dict)]
    return []


def normalize_html(html: str) -> str:
    text = zh_gen.strip_copyright_footers(html or "")
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def html_fingerprint(html: str) -> str:
    return hashlib.sha1(normalize_html(html).encode("utf-8")).hexdigest()[:12]


def usable_zh_html(html: str) -> bool:
    return bool(html and str(html).strip().startswith("<") and not zh_gen._is_error_html(html))


def castudy_zh_html(castudy_q: dict[str, Any]) -> str:
    _zh_q, _zh_c, zh_html, _api = zh_gen.extract_castudy_zh_fields(castudy_q)
    return zh_html or ""


def castudy_has_api(castudy_q: dict[str, Any]) -> bool:
    api = castudy_q.get("apiResult") or {}
    return bool(api.get("ok") and api.get("data"))


def likely_new_ai_style(html: str) -> bool:
    markers = (
        "本题真正考的是",
        "三秒认题路径",
        "正确答案与干扰项排除",
        "--primary-ink",
        "题干得分关键字",
    )
    return any(marker in (html or "") for marker in markers)


def resolve_castudy_path(enriched_path: Path, enriched_meta: dict[str, Any]) -> Path | None:
    chapter_dir = enriched_path.parent
    named = str(enriched_meta.get("sourceCastudyFile") or "").strip()
    if named:
        candidate = chapter_dir / named
        if candidate.is_file():
            return candidate

    candidates = [
        Path(path)
        for path in glob.glob(str(chapter_dir / "*_castudy.json"))
        if not path.endswith("_castudy_enriched.json") and ".failed." not in path
    ]
    if not candidates:
        return None
    return sorted(candidates, key=lambda p: (p.stat().st_mtime, p.name), reverse=True)[0]


def classify_question(
    castudy_q: dict[str, Any] | None,
    enriched_q: dict[str, Any],
) -> dict[str, Any]:
    index = enriched_q.get("index")
    enriched_zh = str(enriched_q.get("zh-explanation") or "")
    enriched_ok = usable_zh_html(enriched_zh)
    enriched_error = zh_gen._is_error_html(enriched_zh)

    if castudy_q is None:
        category = CATEGORY_CASTUDY_MISSING_INDEX
        castudy_ok = False
        castudy_zh = ""
        has_api = False
    else:
        castudy_zh = castudy_zh_html(castudy_q)
        castudy_ok = usable_zh_html(castudy_zh)
        has_api = castudy_has_api(castudy_q)

        if enriched_error:
            category = CATEGORY_ENRICHED_ERROR
        elif castudy_ok and enriched_ok:
            if html_fingerprint(castudy_zh) == html_fingerprint(enriched_zh):
                category = CATEGORY_FROM_CASTUDY
            else:
                category = CATEGORY_FROM_CASTUDY_DIFFERS
        elif castudy_ok and not enriched_ok:
            category = CATEGORY_CASTUDY_HAS_ENRICHED_MISSING
        elif not castudy_ok and enriched_ok:
            category = CATEGORY_AI_GENERATED
        elif not castudy_ok and not enriched_ok:
            category = CATEGORY_BOTH_MISSING
        else:
            category = CATEGORY_ENRICHED_MISSING

    return {
        "index": index,
        "category": category,
        "castudy_has_html": castudy_ok,
        "castudy_has_api": has_api,
        "enriched_has_html": enriched_ok,
        "enriched_is_error": enriched_error,
        "likely_new_ai_style": likely_new_ai_style(enriched_zh) if enriched_ok else False,
        "enriched_zh_chars": len(enriched_zh),
        "castudy_zh_chars": len(castudy_zh),
        "enriched_fingerprint": html_fingerprint(enriched_zh) if enriched_ok else "",
        "castudy_fingerprint": html_fingerprint(castudy_zh) if castudy_ok else "",
        "question_preview": str(enriched_q.get("question") or "")[:120],
    }


def collect_enriched_files(out_dir: Path, subject: str, chapter: str) -> list[Path]:
    files = sorted(out_dir.glob("*/*/*_castudy_enriched.json"))
    if subject:
        files = [p for p in files if subject.lower() in str(p).lower()]
    if chapter:
        files = [p for p in files if chapter.lower() in str(p).lower()]
    return files


def audit_file(enriched_path: Path) -> dict[str, Any]:
    with enriched_path.open(encoding="utf-8") as f:
        enriched_data = json.load(f)

    enriched_meta = enriched_data.get("meta") if isinstance(enriched_data, dict) else {}
    if not isinstance(enriched_meta, dict):
        enriched_meta = {}

    castudy_path = resolve_castudy_path(enriched_path, enriched_meta)
    castudy_data: Any = {}
    castudy_questions: list[dict[str, Any]] = []
    if castudy_path and castudy_path.is_file():
        with castudy_path.open(encoding="utf-8") as f:
            castudy_data = json.load(f)
        castudy_questions = load_questions(castudy_data)

    castudy_by_index = {
        q.get("index"): q for q in castudy_questions if q.get("index") is not None
    }

    rows: list[dict[str, Any]] = []
    for enriched_q in load_questions(enriched_data):
        idx = enriched_q.get("index")
        row = classify_question(castudy_by_index.get(idx), enriched_q)
        row.update({
            "subject": enriched_q.get("subject") or enriched_meta.get("subject", ""),
            "chapter": enriched_q.get("chapter") or enriched_meta.get("chapter", ""),
            "enriched_file": str(enriched_path),
            "castudy_file": str(castudy_path) if castudy_path else "",
        })
        rows.append(row)

    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        counts[row["category"]] += 1

    return {
        "enriched_file": str(enriched_path),
        "castudy_file": str(castudy_path) if castudy_path else "",
        "subject": enriched_meta.get("subject", ""),
        "chapter": enriched_meta.get("chapter", ""),
        "question_count": len(rows),
        "counts": dict(counts),
        "questions": rows,
    }


def print_summary(report: dict[str, Any], only_ai: bool) -> None:
    files = report["files"]
    totals: dict[str, int] = defaultdict(int)
    ai_rows: list[dict[str, Any]] = []

    print(f"\n{'=' * 78}")
    print("  audit_ai_zh_explanation")
    print(f"  Generated: {report['generated_at']}")
    print(f"  Enriched files scanned: {len(files)}")
    print(f"{'=' * 78}\n")

    for file_report in files:
        counts = file_report["counts"]
        for key, value in counts.items():
            totals[key] += value

        ai_count = counts.get(CATEGORY_AI_GENERATED, 0)
        differs_count = counts.get(CATEGORY_FROM_CASTUDY_DIFFERS, 0)
        if only_ai and ai_count == 0:
            continue

        print(
            f"📂 {file_report['subject']} / {file_report['chapter']} "
            f"({file_report['question_count']} questions)"
        )
        print(f"   castudy: {Path(file_report['castudy_file']).name or '(not found)'}")
        print(
            f"   ai_generated={counts.get(CATEGORY_AI_GENERATED, 0)}  "
            f"from_castudy={counts.get(CATEGORY_FROM_CASTUDY, 0)}  "
            f"castudy_differs={differs_count}  "
            f"castudy_has_enriched_missing={counts.get(CATEGORY_CASTUDY_HAS_ENRICHED_MISSING, 0)}  "
            f"both_missing={counts.get(CATEGORY_BOTH_MISSING, 0)}  "
            f"enriched_error={counts.get(CATEGORY_ENRICHED_ERROR, 0)}"
        )

        for row in file_report["questions"]:
            if row["category"] != CATEGORY_AI_GENERATED:
                continue
            ai_rows.append(row)
            style = "new-prompt-style" if row["likely_new_ai_style"] else "unknown-style"
            print(
                f"   • Q{int(row['index']):04d}  [{style}]  "
                f"{row['enriched_zh_chars']} chars  {row['question_preview']}…"
            )
        print()

    print(f"{'-' * 78}")
    print("TOTALS")
    for key in sorted(totals):
        print(f"  {key}: {totals[key]}")
    print(f"  ai_generated (primary review list): {totals.get(CATEGORY_AI_GENERATED, 0)}")
    print(f"  from_castudy_differs (castudy had HTML but enriched differs): "
          f"{totals.get(CATEGORY_FROM_CASTUDY_DIFFERS, 0)}")
    print(f"{'-' * 78}\n")

    if totals.get(CATEGORY_AI_GENERATED, 0) == 0:
        print("✅ 未發現「castudy 無 zh-html、enriched 有 zh-explanation」的 AI 寫入題目。")
    else:
        print(
            f"⚠️  共 {totals.get(CATEGORY_AI_GENERATED, 0)} 題疑似 AI 寫入 zh-explanation。"
            "請先查看 JSON/CSV 報告，確認後再清除。"
        )


def clear_ai_in_file(enriched_path: Path, apply: bool) -> dict[str, Any]:
    with enriched_path.open(encoding="utf-8") as f:
        enriched_data = json.load(f)

    enriched_meta = enriched_data.get("meta") if isinstance(enriched_data, dict) else {}
    if not isinstance(enriched_meta, dict):
        enriched_meta = {}

    castudy_path = resolve_castudy_path(enriched_path, enriched_meta)
    castudy_questions: list[dict[str, Any]] = []
    if castudy_path and castudy_path.is_file():
        with castudy_path.open(encoding="utf-8") as f:
            castudy_data = json.load(f)
        castudy_questions = load_questions(castudy_data)

    castudy_by_index = {
        q.get("index"): q for q in castudy_questions if q.get("index") is not None
    }

    cleared: list[int] = []
    for enriched_q in load_questions(enriched_data):
        row = classify_question(castudy_by_index.get(enriched_q.get("index")), enriched_q)
        if row["category"] != CATEGORY_AI_GENERATED:
            continue
        if not str(enriched_q.get("zh-explanation") or "").strip():
            continue
        enriched_q["zh-explanation"] = ""
        cleared.append(int(row["index"]))

    if cleared and apply:
        with enriched_path.open("w", encoding="utf-8") as f:
            json.dump(enriched_data, f, ensure_ascii=False, indent=2)
            f.write("\n")

    return {
        "enriched_file": str(enriched_path),
        "subject": enriched_meta.get("subject", ""),
        "chapter": enriched_meta.get("chapter", ""),
        "cleared": cleared,
    }


def run_clear_ai(
    out_dir: Path,
    subject: str,
    chapter: str,
    apply: bool,
) -> int:
    enriched_files = collect_enriched_files(out_dir, subject, chapter)
    if not enriched_files:
        print("No matching *_castudy_enriched.json files found.")
        return 0

    mode = "APPLY" if apply else "DRY-RUN"
    print(f"\n{'=' * 78}")
    print(f"  clear ai_generated zh-explanation  [{mode}]")
    print(f"  Enriched files: {len(enriched_files)}")
    print(f"{'=' * 78}\n")

    total_cleared = 0
    files_touched = 0
    for path in enriched_files:
        result = clear_ai_in_file(path, apply=apply)
        count = len(result["cleared"])
        if count == 0:
            continue
        files_touched += 1
        total_cleared += count
        tag = "saved" if apply else "dry-run"
        indices = ", ".join(f"Q{i:04d}" for i in result["cleared"])
        print(
            f"  ✏️  {result['subject']} / {result['chapter']}: "
            f"{count} cleared ({tag})  [{indices}]"
        )

    print(f"\n{'-' * 78}")
    print(f"  Files touched : {files_touched}")
    print(f"  Questions cleared: {total_cleared}")
    print(f"{'-' * 78}\n")
    if total_cleared == 0:
        print("✅ 沒有需要清除的 ai_generated zh-explanation。")
    elif not apply:
        print("  Dry-run only. Re-run with --clear-ai --apply to write.")
    else:
        print("  ✅ 已清除 ai_generated 的 zh-explanation。")
    return total_cleared


def write_csv(path: Path, report: dict[str, Any], only_ai: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "subject",
        "chapter",
        "index",
        "category",
        "likely_new_ai_style",
        "castudy_has_html",
        "castudy_has_api",
        "enriched_has_html",
        "enriched_is_error",
        "enriched_zh_chars",
        "castudy_zh_chars",
        "enriched_fingerprint",
        "castudy_fingerprint",
        "enriched_file",
        "castudy_file",
        "question_preview",
    ]

    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for file_report in report["files"]:
            for row in file_report["questions"]:
                if only_ai and row["category"] != CATEGORY_AI_GENERATED:
                    continue
                writer.writerow({key: row.get(key, "") for key in fieldnames})


def main() -> None:
    parser = argparse.ArgumentParser(
        description="List enriched questions whose zh-explanation was AI-generated "
        "because castudy lacked htmlContent."
    )
    parser.add_argument("--out-dir", default=str(OUT_DIR), help="PassBar out/ directory")
    parser.add_argument("--subject", default="", help="Filter by subject (partial match)")
    parser.add_argument("--chapter", default="", help="Filter by chapter (partial match)")
    parser.add_argument(
        "--only-ai",
        action="store_true",
        help="Only include ai_generated rows in CSV and terminal detail",
    )
    parser.add_argument("--json", default=str(DEFAULT_JSON), help="Write JSON report to this path")
    parser.add_argument("--csv", default=str(DEFAULT_CSV), help="Write CSV report to this path")
    parser.add_argument(
        "--clear-ai",
        action="store_true",
        help="Clear zh-explanation for ai_generated questions (dry-run unless --apply)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="With --clear-ai, write cleared zh-explanation back to enriched JSON files",
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    if not out_dir.is_dir():
        print(f"ERROR: out directory not found: {out_dir}")
        sys.exit(1)

    if args.clear_ai:
        cleared = run_clear_ai(out_dir, args.subject, args.chapter, apply=args.apply)
        sys.exit(0 if cleared >= 0 else 1)

    enriched_files = collect_enriched_files(out_dir, args.subject, args.chapter)
    if not enriched_files:
        print("No matching *_castudy_enriched.json files found.")
        sys.exit(0)

    file_reports = [audit_file(path) for path in enriched_files]
    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "out_dir": str(out_dir),
        "filters": {"subject": args.subject, "chapter": args.chapter, "only_ai": args.only_ai},
        "categories": {
            CATEGORY_AI_GENERATED: "castudy 無可用 htmlContent，但 enriched 有 zh-explanation（AI 寫入）",
            CATEGORY_FROM_CASTUDY: "castudy 有 htmlContent，enriched zh-explanation 內容一致",
            CATEGORY_FROM_CASTUDY_DIFFERS: "castudy 有 htmlContent，但 enriched 內容不同",
            CATEGORY_CASTUDY_HAS_ENRICHED_MISSING: "castudy 有 htmlContent，enriched 缺少 zh-explanation",
            CATEGORY_BOTH_MISSING: "castudy 與 enriched 都沒有可用 zh-explanation",
            CATEGORY_ENRICHED_ERROR: "enriched zh-explanation 是 ERROR 佔位符",
            CATEGORY_ENRICHED_MISSING: "enriched 缺少 zh-explanation",
            CATEGORY_CASTUDY_MISSING_INDEX: "enriched 題目在 castudy 找不到對應 index",
        },
        "files": file_reports,
    }

    json_path = Path(args.json)
    csv_path = Path(args.csv)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")

    write_csv(csv_path, report, args.only_ai)
    print_summary(report, args.only_ai)
    print(f"JSON → {json_path.resolve()}")
    print(f"CSV  → {csv_path.resolve()}")


if __name__ == "__main__":
    main()
