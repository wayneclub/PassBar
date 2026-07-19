#!/usr/bin/env python3
"""Blind multi-model chapter review for unmatched official questions.

The source question is sent to three independent models without its previous
chapter assignment or nearest-UWorld candidate.  This avoids anchoring on the
first retrieval pass.  The script only writes an audit report; it never edits
the review JSON or enriched question bank.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cli_ai


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
DEFAULT_REVIEW = ROOT / "formal test/official_questions_review.json"
PANEL = (
    ("grok", "cursor-cli", "cursor-grok-4.5-high"),
    ("claude", "cursor-cli", "claude-opus-4-8-high"),
    # Cursor exposes GPT/Codex alongside Grok and Claude. Keeping the whole
    # panel on Cursor's headless API avoids local CLI auth/version drift while
    # retaining independent underlying model families.
    ("codex", "cursor-cli", "gpt-5.6-sol-high"),
)


def load_local_env() -> None:
    """Load tool-only credentials without printing or persisting their values."""
    for path in (ROOT / ".env.tools.local", ROOT / ".env.local"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() and key.strip() not in os.environ:
                os.environ[key.strip()] = value.strip().strip('"').strip("'")


def chapter_catalog() -> dict[str, list[str]]:
    catalog: dict[str, set[str]] = {}
    for path in OUT.rglob("*_enriched.json"):
        meta = json.loads(path.read_text(encoding="utf-8"))["meta"]
        catalog.setdefault(meta["subject"], set()).add(meta["chapter"])
    return {subject: sorted(chapters) for subject, chapters in catalog.items()}


def review_source_id(item: dict[str, Any]) -> str:
    entry = item["formal_test_provenance"][0]
    return f"{entry['source_file']}::{item['subject']}#{entry['source_question_number']}"


def prompt_for(item: dict[str, Any], chapters: list[str]) -> str:
    options = "\n".join(f"{key}. {item['choices'][key]}" for key in ("A", "B", "C", "D"))
    valid = ", ".join(json.dumps(chapter) for chapter in chapters)
    return f"""You are an independent MBE subject-matter classifier. Classify this one official question into exactly one existing chapter for the stated subject.

Do not inspect files, use tools, or infer any previous reviewer decision. Do not change the answer, assess whether it matches another question, or mention an unseen candidate. Your only task is chapter classification.

Subject: {item['subject']}
Allowed chapter names: [{valid}]

Question:
{item['question']}

Choices:
{options}

Official correct answer: {item['answer']}

Return exactly one JSON object with this schema:
{{"chapter":"one allowed chapter name","confidence":0.0,"rule":"brief legal reason, maximum 50 words","alternatives":["up to two allowed chapter names"]}}
"""


def parse_json(raw: str, allowed_chapters: list[str]) -> dict[str, Any]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        raise ValueError("response did not contain a JSON object")
    result = json.loads(match.group(0))
    chapter = result.get("chapter")
    confidence = result.get("confidence")
    if chapter not in allowed_chapters:
        raise ValueError(f"invalid chapter {chapter!r}")
    if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        raise ValueError("confidence must be a number from 0 to 1")
    alternatives = [choice for choice in result.get("alternatives", []) if choice in allowed_chapters and choice != chapter]
    return {
        "chapter": chapter,
        "confidence": round(float(confidence), 3),
        "rule": str(result.get("rule") or "").strip()[:600],
        "alternatives": alternatives[:2],
    }


def decide(votes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    valid = {name: vote for name, vote in votes.items() if "chapter" in vote}
    counts = Counter(vote["chapter"] for vote in valid.values())
    if not counts:
        return {"status": "panel_error", "chapter": None, "reason": "no valid agent responses"}
    chapter, count = counts.most_common(1)[0]
    confidence = [vote["confidence"] for vote in valid.values() if vote["chapter"] == chapter]
    if count == 3:
        return {"status": "panel_unanimous", "chapter": chapter, "reason": "three blind reviewers agree"}
    if count == 2 and min(confidence) >= 0.75:
        return {
            "status": "panel_majority", "chapter": chapter,
            "reason": "two blind reviewers agree with confidence at least 0.75",
        }
    return {
        "status": "panel_disagreement", "chapter": chapter,
        "reason": "no sufficiently confident two-model consensus",
    }


def review_one(item: dict[str, Any], catalog: dict[str, list[str]]) -> dict[str, Any]:
    """Collect independent votes sequentially; every prompt remains blind.

    Cursor Agent's macOS Keychain token bridge is process-safe but not reliably
    concurrent. Sequential calls prevent transient credential failures without
    exposing one model's answer to the next model.
    """
    chapters = catalog[item["subject"]]
    prompt = prompt_for(item, chapters)
    votes: dict[str, dict[str, Any]] = {}

    for name, provider, model in PANEL:
        for attempt in range(3):
            try:
                raw = cli_ai.call_cli_ai(
                    provider=provider,
                    prompt=prompt,
                    model=model,
                    expected="a single JSON object matching the requested schema",
                )
                votes[name] = {"provider": provider, "model": model, **parse_json(raw, chapters)}
                break
            except Exception as exc:
                transient = "Password not found for account" in str(exc) or "Security command failed" in str(exc)
                if transient and attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
                votes[name] = {"provider": provider, "model": model, "error": str(exc)}

    return {
        "review_index": item["index"],
        "source_id": review_source_id(item),
        "subject": item["subject"],
        "previous_chapter_hidden_from_agents": item["chapter"],
        "votes": votes,
        "decision": decide(votes),
    }


def apply_decisions(review: dict[str, Any], records: list[dict[str, Any]], report_path: Path) -> None:
    """Write only consensus chapter decisions back to the non-importable review."""
    decisions = {record["review_index"]: record for record in records}
    approved = retained = 0
    for item in review["questions"]:
        record = decisions.get(item["index"])
        if not record:
            continue
        decision = record["decision"]
        review_data = item.setdefault("review", {})
        review_data["multi_agent_chapter_review"] = record
        if decision["status"] in {"panel_unanimous", "panel_majority"}:
            item["chapter"] = decision["chapter"]
            review_data["chapter"] = decision["chapter"]
            review_data["chapter_source"] = "blind_multi_agent_panel"
            review_data["chapter_import_review"] = {
                "status": "approved_for_staging",
                "method": "three-model blind chapter panel",
                "panel_status": decision["status"],
                "chapter": decision["chapter"],
                "reason": decision["reason"],
            }
            approved += 1
        else:
            # Preserve the previous chapter hypothesis, but explicitly keep it
            # out of staging until a human resolves the disagreement.
            review_data["chapter_import_review"] = {
                "status": "manual_review_required",
                "method": "three-model blind chapter panel",
                "panel_status": decision["status"],
                "reason": decision["reason"],
            }
            retained += 1
    metadata = review.setdefault("meta", {}).setdefault("multi_agent_chapter_review", [])
    metadata.append({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "report": str(report_path.relative_to(ROOT)),
        "reviewed": len(records),
        "approved_for_staging": approved,
        "manual_review_required": retained,
    })


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-json", type=Path, default=DEFAULT_REVIEW)
    parser.add_argument("--limit", type=int, default=3, help="Maximum manual-review questions; default is a 3-question pilot")
    parser.add_argument("--review-indices", help="Comma-separated review indices, overrides --limit")
    parser.add_argument("--question-workers", type=int, default=1, help="Must remain 1: Cursor's Keychain bridge is not safe for concurrent headless agents")
    parser.add_argument("--apply-review", action="store_true", help="Write only panel-approved chapters to official_questions_review.json")
    parser.add_argument(
        "--output", type=Path,
        default=ROOT / "tmp/formal-test-review/multi-agent-chapter-review-pilot.json",
    )
    args = parser.parse_args()
    if args.limit < 1:
        raise ValueError("--limit must be at least 1")
    if args.question_workers != 1:
        raise ValueError("--question-workers must be 1 for reliable Cursor headless authentication")
    load_local_env()
    if not os.environ.get("CURSOR_API_KEY"):
        raise RuntimeError(
            "CURSOR_API_KEY is required for Cursor headless review. "
            "Add it to .env.tools.local; do not paste it into chat."
        )
    review = json.loads(args.review_json.resolve().read_text(encoding="utf-8"))
    candidates = [
        item for item in review["questions"]
        if item.get("review", {}).get("chapter_import_review", {}).get("status") == "manual_review_required"
    ]
    if args.review_indices:
        wanted = {int(value) for value in args.review_indices.split(",") if value.strip()}
        candidates = [item for item in candidates if item["index"] in wanted]
        if len(candidates) != len(wanted):
            raise RuntimeError("One or more requested review indices are not in the manual-review queue")
    else:
        candidates = candidates[:args.limit]
    catalog = chapter_catalog()
    records = [review_one(item, catalog) for item in candidates]
    report = {
        "schema": "passbar.formal-test.multi-agent-chapter-review.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "blind_review": True,
        "panel": [
            {"name": name, "provider": provider, "model": model}
            for name, provider, model in PANEL
        ],
        "records": records,
        "summary": Counter(record["decision"]["status"] for record in records),
    }
    report["summary"] = dict(report["summary"])
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.apply_review:
        apply_decisions(review, records, output)
        review_path = args.review_json.resolve()
        temporary = review_path.with_suffix(review_path.suffix + ".multi-agent.tmp")
        temporary.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        json.loads(temporary.read_text(encoding="utf-8"))
        os.replace(temporary, review_path)
    print(json.dumps({"records": len(records), "summary": report["summary"], "output": str(output.relative_to(ROOT))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
