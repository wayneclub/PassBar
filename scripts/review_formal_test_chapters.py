#!/usr/bin/env python3
"""Independently review chapter assignments for unmatched official questions.

The first pass in official_questions_review.json used nearest-question BM25 and
fuzzy retrieval.  This script deliberately uses a different evidence model:
subject-constrained TF-IDF chapter profiles built from existing question stems
and topic labels.  A question is approved only when a high-confidence first
pass agrees with this independent model.  Medium or missing first-pass
confidence always remains manual-review-only.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import analyze_unmatched_review_questions as search


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
UNMATCHED = {"chapter_classified", "no_existing_match"}


def source_id(item: dict[str, Any]) -> str:
    entry = item["formal_test_provenance"][0]
    return f"{entry['source_file']}::{item['subject']}#{entry['source_question_number']}"


def stem_tokens(item: dict[str, Any]) -> list[str]:
    # Deliberately exclude answer choices: the original classifier already used
    # them, and a stem/topic profile provides independent classification evidence.
    return search.tokens(str(item.get("question") or ""))


def chapter_profiles() -> dict[str, dict[str, Counter[str]]]:
    profiles: dict[str, dict[str, Counter[str]]] = defaultdict(lambda: defaultdict(Counter))
    for path in sorted(OUT.rglob("*_enriched.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        for item in document.get("questions", []):
            subject = str(item.get("subject") or "")
            chapter = str(item.get("chapter") or "")
            if not subject or not chapter:
                continue
            tokens = search.tokens(str(item.get("question") or ""))
            # A curated topic is a stronger chapter signal than generic fact
            # patterns, so weight it three times in the chapter profile.
            topic_tokens = search.tokens(str(item.get("topic") or ""))
            profiles[subject][chapter].update(tokens)
            profiles[subject][chapter].update(topic_tokens * 3)
    return profiles


def rank_profile(query_tokens: list[str], profiles: dict[str, Counter[str]]) -> list[tuple[float, str]]:
    if not query_tokens:
        return []
    document_frequency: Counter[str] = Counter()
    for profile in profiles.values():
        document_frequency.update(profile.keys())
    chapters = len(profiles)
    query = Counter(query_tokens)
    results: list[tuple[float, str]] = []
    for chapter, profile in profiles.items():
        dot = query_norm = profile_norm = 0.0
        for term, count in query.items():
            idf = math.log((chapters + 1) / (document_frequency[term] + 1)) + 1
            left = count * idf
            right = profile[term] * idf
            dot += left * right
            query_norm += left * left
        for term, count in profile.items():
            idf = math.log((chapters + 1) / (document_frequency[term] + 1)) + 1
            weighted = count * idf
            profile_norm += weighted * weighted
        score = dot / math.sqrt(query_norm * profile_norm) if query_norm and profile_norm else 0.0
        results.append((round(score, 6), chapter))
    return sorted(results, reverse=True)


def first_pass_confidence(item: dict[str, Any]) -> str:
    return str(item.get("review", {}).get("classification", {}).get("confidence") or "missing")


def decision_for(item: dict[str, Any], profiles: dict[str, dict[str, Counter[str]]]) -> dict[str, Any]:
    assigned = str(item.get("chapter") or "")
    confidence = first_pass_confidence(item)
    ranked = rank_profile(stem_tokens(item), profiles[item["subject"]])
    top_score, top_chapter = ranked[0] if ranked else (0.0, None)
    second_score = ranked[1][0] if len(ranked) > 1 else 0.0
    margin = round(top_score - second_score, 6)
    source_metadata = item.get("source_metadata") or {}
    source_chapter = source_metadata.get("chapter")
    source_chapter_verified = bool(source_metadata.get("chapter") and source_metadata.get("chapter_evidence"))

    agreed = top_chapter == assigned
    # High confidence requires agreement from two genuinely different retrieval
    # models and enough separation from the runner-up.  The explicit 0.01
    # margin avoids approving a chapter on an effectively tied profile score.
    approved = (
        confidence == "high"
        and agreed
        and margin >= 0.01
        and top_score > 0
    )
    if source_chapter_verified:
        approved = source_chapter == assigned
    status = "approved_for_staging" if approved else "manual_review_required"
    reason = (
        "verified_source_chapter"
        if source_chapter_verified and approved
        else "independent_profile_agrees_with_high_confidence_first_pass"
        if approved
        else "medium_or_missing_first_pass_confidence"
        if confidence in {"medium", "missing"}
        else "independent_profile_disagrees_or_has_insufficient_margin"
    )
    return {
        "source": {"id": source_id(item)},
        "review_index": item["index"],
        "subject": item["subject"],
        "assigned_chapter": assigned,
        "first_pass": {
            "confidence": confidence,
            "method": item.get("review", {}).get("classification", {}).get("method"),
        },
        "independent_profile": {
            "method": "subject_constrained_topic_and_stem_tfidf",
            "top_chapter": top_chapter,
            "top_score": top_score,
            "second_score": second_score,
            "margin": margin,
            "agrees_with_assigned_chapter": agreed,
            "top_candidates": [
                {"chapter": chapter, "score": score} for score, chapter in ranked[:3]
            ],
        },
        "source_chapter": source_chapter,
        "source_chapter_verified": source_chapter_verified,
        "status": status,
        "reason": reason,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-json", type=Path, default=ROOT / "formal test/official_questions_review.json")
    parser.add_argument(
        "--output", type=Path,
        default=ROOT / "tmp/formal-test-review/second-pass-chapter-review.json",
    )
    parser.add_argument("--apply-review", action="store_true", help="Write decisions to the non-importable review JSON")
    args = parser.parse_args()
    review_path = args.review_json.resolve()
    if OUT in review_path.parents or review_path.name.endswith("_enriched.json"):
        raise RuntimeError("Refusing to write an enriched JSON file")
    review = json.loads(review_path.read_text(encoding="utf-8"))
    if review.get("meta", {}).get("importable") is not False:
        raise RuntimeError("Expected a non-importable review JSON")
    profiles = chapter_profiles()
    decisions = [
        decision_for(item, profiles)
        for item in review["questions"]
        if item.get("review", {}).get("status") in UNMATCHED
    ]
    if len(decisions) != 290:
        raise RuntimeError(f"Expected 290 unmatched questions, found {len(decisions)}")
    by_index = {decision["review_index"]: decision for decision in decisions}
    audit_sample = [
        decision for decision in decisions
        if decision["status"] == "approved_for_staging" and decision["review_index"] % 10 == 0
    ]
    output = {
        "schema": "passbar.formal-test.chapter-review.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": "high-confidence first-pass agreement with independent subject-constrained topic/stem TF-IDF profile",
        "records": len(decisions),
        "approved_for_staging": sum(d["status"] == "approved_for_staging" for d in decisions),
        "manual_review_required": sum(d["status"] == "manual_review_required" for d in decisions),
        "manual_audit_sample": [
            {"review_index": d["review_index"], "subject": d["subject"], "chapter": d["assigned_chapter"]}
            for d in audit_sample
        ],
        "decisions": decisions,
    }
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.apply_review:
        for item in review["questions"]:
            decision = by_index.get(item["index"])
            if decision:
                item.setdefault("review", {})["chapter_import_review"] = decision
        review.setdefault("meta", {})["chapter_import_review"] = {
            "generated_at": output["generated_at"],
            "records": output["records"],
            "approved_for_staging": output["approved_for_staging"],
            "manual_review_required": output["manual_review_required"],
            "report": str(output_path.relative_to(ROOT)),
        }
        temporary = review_path.with_suffix(review_path.suffix + ".chapter-review.tmp")
        temporary.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        json.loads(temporary.read_text(encoding="utf-8"))
        os.replace(temporary, review_path)
    print(json.dumps({
        "records": output["records"],
        "approved_for_staging": output["approved_for_staging"],
        "manual_review_required": output["manual_review_required"],
        "manual_audit_sample": len(output["manual_audit_sample"]),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
