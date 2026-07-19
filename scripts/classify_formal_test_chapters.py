#!/usr/bin/env python3
"""Double-pass chapter classification for unmatched formal-test questions.

Writes only a reviewable classification report; it never changes enriched JSON.
"""
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.request
import urllib.error
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def source_id_from_review(item: dict) -> str:
    provenance = item["formal_test_provenance"][0]
    return (
        f"{provenance['source_file']}::{item['subject']}"
        f"#{provenance['source_question_number']}"
    )


def env_values() -> dict[str, str]:
    result: dict[str, str] = {}
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            result[key] = value.strip().strip('"').strip("'")
    return result


def invoke(prompt: str, temperature: float) -> list[dict]:
    env = env_values()
    model = env.get("GEMINI_MODEL")
    key = env.get("GEMINI_API_KEY")
    if not model or not key:
        raise RuntimeError("GEMINI_MODEL and GEMINI_API_KEY must be set in .env.local")
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": 8192,
            "responseMimeType": "application/json",
        },
    }).encode()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    last_error: Exception | None = None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                data = json.loads(response.read())
            break
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 5:
                raise
            if exc.code == 429:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                try:
                    delay = min(45, max(15, int(retry_after)))
                except (TypeError, ValueError):
                    delay = min(45, 15 * (attempt + 1))
                print(f"Rate limited; retrying in {delay}s", flush=True)
                time.sleep(delay)
            else:
                time.sleep(5 * (attempt + 1))
    else:
        raise RuntimeError("Chapter classifier request failed") from last_error
    candidate = data.get("candidates", [{}])[0]
    output = candidate.get("content", {}).get("parts", [{}])[0].get("text", "")
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Classifier did not return JSON: {output[:500]!r}") from exc
    if not isinstance(parsed, list):
        raise RuntimeError("Classifier returned JSON that is not an array.")
    # Keep requests below the service's per-minute quota, including when both
    # independent passes are run for the same batch.
    time.sleep(4)
    return parsed


def chapters_by_subject() -> dict[str, list[str]]:
    grouped: dict[str, set[str]] = defaultdict(set)
    for path in (ROOT / "out").rglob("*_enriched.json"):
        doc = json.loads(path.read_text(encoding="utf-8"))
        for item in doc.get("questions", doc) if isinstance(doc, dict) else doc:
            grouped[str(item["subject"])].add(str(item["chapter"]))
    return {subject: sorted(chapters) for subject, chapters in grouped.items()}


def prompt_for(records: list[dict], chapters: dict[str, list[str]], pass_label: str) -> str:
    rendered = []
    for record in records:
        source = record["source"]
        rendered.append({
            "id": source["id"],
            "subject": source["subject"],
            "allowed_chapters": chapters[source["subject"]],
            "question": source["stem"],
            "choices": source["choices"],
            "correct_answer": source["answer"],
        })
    return f"""You classify MBE multiple-choice questions into an existing PassBar chapter.
This is independent classification pass {pass_label}. Do not infer from question IDs.
For each record, choose exactly one chapter from its allowed_chapters. The subject is fixed.
Return only a JSON array. Every array item must be:
{{"id": "...", "chapter": "one allowed chapter", "confidence": 0.0 to 1.0,
  "reason": "legal-topic reason of at most 12 words"}}
Records:
{json.dumps(rendered, ensure_ascii=False)}
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=ROOT / "tmp/formal-test-review/review-export-report.json")
    parser.add_argument("--review-json", type=Path, default=ROOT / "formal test/official_questions_review.json")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/formal-test-review/chapter-classification.json")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0, help="Classify only the first N records for a pilot.")
    args = parser.parse_args()
    input_path = args.input.resolve()
    report = json.loads(input_path.read_text(encoding="utf-8"))
    records = [x for x in report["needs_review_records"] if x["reason"] == "no_existing_match"]
    review_doc = json.loads(args.review_json.resolve().read_text(encoding="utf-8"))
    blank_chapter_ids = {
        source_id_from_review(item)
        for item in review_doc["questions"]
        if not str(item.get("chapter") or "").strip()
    }
    records = [item for item in records if item["source"]["id"] in blank_chapter_ids]
    if args.limit:
        records = records[:args.limit]
    chapters = chapters_by_subject()
    output_path = args.output.resolve()
    prior_output = json.loads(output_path.read_text(encoding="utf-8")) if output_path.exists() else {}
    decisions: list[dict] = list(prior_output.get("decisions", []))
    completed_ids = {item["source"]["id"] for item in decisions}
    pending_records = [item for item in records if item["source"]["id"] not in completed_ids]

    def write_checkpoint() -> None:
        output = {
            "input": str(input_path.relative_to(ROOT)),
            "records": len(records),
            "completed": len(decisions),
            "candidate_additions": sum(x["action"] == "candidate_add" for x in decisions),
            "needs_review": sum(x["action"] == "needs_review" for x in decisions),
            "decisions": decisions,
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = output_path.with_suffix(output_path.suffix + ".tmp")
        temporary.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(output_path)

    for start in range(0, len(pending_records), args.batch_size):
        batch = pending_records[start:start + args.batch_size]
        print(f"Classifying {start + 1}-{start + len(batch)} of {len(pending_records)} pending ({len(decisions)} already checkpointed)", flush=True)
        # Run the two independent passes sequentially to stay below the API's
        # request-rate limit while retaining a separate result for each pass.
        with ThreadPoolExecutor(max_workers=1) as pool:
            first_future = pool.submit(invoke, prompt_for(batch, chapters, "A"), 0.0)
            second_future = pool.submit(invoke, prompt_for(batch, chapters, "B"), 0.2)
            first = {item["id"]: item for item in first_future.result()}
            second = {item["id"]: item for item in second_future.result()}
        for record in batch:
            source = record["source"]
            a, b = first.get(source["id"]), second.get(source["id"])
            allowed = set(chapters[source["subject"]])
            agreed = bool(
                a and b and a.get("chapter") == b.get("chapter")
                and a.get("chapter") in allowed
                and float(a.get("confidence", 0)) >= 0.85
                and float(b.get("confidence", 0)) >= 0.85
            )
            decisions.append({
                "source": source,
                "pass_a": a,
                "pass_b": b,
                "action": "candidate_add" if agreed else "needs_review",
                "chapter": a.get("chapter") if agreed else None,
            })
        write_checkpoint()
    write_checkpoint()
    output = json.loads(output_path.read_text(encoding="utf-8"))
    print(f"Report: {output_path.relative_to(ROOT)}")
    print(f"Two-pass agreed: {output['candidate_additions']}; needs review: {output['needs_review']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
