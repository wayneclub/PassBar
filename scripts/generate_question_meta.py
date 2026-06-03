#!/usr/bin/env python3
"""
generate_question_meta.py

從 Supabase 讀取 questions（透過 questions view，含英文題目、選項、解析），
呼叫 Gemini API 為每道題目標記：
  - micro_concept  : 這道題考察的最小知識點，例如 "Offer & Acceptance"
  - trap_type      : 這道題設置的陷阱類型，例如 "Distractor Attraction"
  - skill_tested   : 這道題要求的操作技能，例如 "Apply the Mirror Image Rule"

結果直接 PATCH 回 Supabase 的 question_items 表。

使用方式：
  python3 generate_question_meta.py                        # 處理全部未填寫的題目
  python3 generate_question_meta.py --subject "Torts"     # 只處理特定科目
  python3 generate_question_meta.py --limit 50            # 限制數量（測試用）
  python3 generate_question_meta.py --dry-run             # 只印出計畫，不呼叫 API
  python3 generate_question_meta.py --refill              # 重新處理已有值的題目
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


# ── 環境變數 ──────────────────────────────────────────────────────────────────

def _load_env_file() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(script_dir, ".env"),
        os.path.join(script_dir, "..", "passbar", ".env.local"),
        os.path.join(os.getcwd(), "passbar", ".env.local"),
    ]
    seen: set[str] = set()
    for env_path in candidates:
        real = os.path.realpath(env_path)
        if real in seen or not os.path.exists(env_path):
            continue
        seen.add(real)
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

_load_env_file()

# ── Gemini ────────────────────────────────────────────────────────────────────

GEMINI_MODEL = "gemini-2.5-flash"
RATE_LIMIT_DELAY = 3   # 秒
MAX_RETRIES = 3

_GEMINI_API_KEYS: list[str] = [
    k for k in [
        os.environ.get(f"GEMINI_API_KEY_{i}") for i in range(1, 20)
    ] if k
]
if not _GEMINI_API_KEYS:
    single = os.environ.get("GEMINI_API_KEY")
    if single:
        _GEMINI_API_KEYS = [single]

if not _GEMINI_API_KEYS:
    print("ERROR: No GEMINI_API_KEY_1 ~ GEMINI_API_KEY_N (or GEMINI_API_KEY) found.")
    print("  Create scripts/.env and add:  GEMINI_API_KEY_1=your_key_here")
    sys.exit(1)

_key_index = 0

def next_api_key() -> str:
    global _key_index
    key = _GEMINI_API_KEYS[_key_index % len(_GEMINI_API_KEYS)]
    _key_index += 1
    return key


class RateLimitedError(Exception):
    pass


def call_gemini_json(prompt: str) -> dict:
    """呼叫 Gemini，要求回傳 JSON，返回已解析的 dict。"""
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 512,
            "responseMimeType": "application/json",
        },
    }).encode()

    last_error: Exception | None = None
    n_keys = len(_GEMINI_API_KEYS)

    for round_num in range(1, MAX_RETRIES + 1):
        all_rate_limited = True

        for _ in range(n_keys):
            api_key = next_api_key()
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{GEMINI_MODEL}:generateContent?key={api_key}"
            )
            try:
                req = urllib.request.Request(
                    url, data=payload,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read())
                raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
                # 清除可能殘留的 ```json ``` wrapper
                cleaned = re.sub(r"^```json\s*", "", raw_text.strip(), flags=re.IGNORECASE)
                cleaned = re.sub(r"\s*```$", "", cleaned)
                return json.loads(cleaned)
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors="replace")
                last_error = Exception(f"HTTP {e.code} (key …{api_key[-6:]}): {body[:200]}")
                if e.code == 429:
                    print(f"    Rate limited (key …{api_key[-6:]}), trying next key…")
                elif e.code >= 500:
                    all_rate_limited = False
                    time.sleep(10)
                else:
                    raise
            except Exception as exc:
                last_error = exc
                all_rate_limited = False
                time.sleep(5)

        if all_rate_limited:
            raise RateLimitedError(f"All keys rate limited (round {round_num}), skipping")

    raise RuntimeError(f"All API keys exhausted after {MAX_RETRIES} rounds. Last: {last_error}")


# ── Prompt ────────────────────────────────────────────────────────────────────

META_PROMPT = """\
You are an expert MBE (Multistate Bar Examination) question analyst.

Given the following MBE question, its answer choices, the correct answer, and the English explanation, \
return a JSON object with exactly three keys:

  "micro_concept"  — The single smallest, most specific legal concept or rule being tested.
                     Keep it concise (3–6 words). Examples:
                     "Offer & Acceptance", "Statute of Frauds", "Proximate Cause",
                     "Fourth Amendment Standing", "Hearsay Exception – Present Sense Impression"

  "trap_type"      — The specific type of distractor trap or common mistake this question exploits.
                     Keep it concise (3–6 words). Examples:
                     "Rule Exception Overlooked", "Distractor Attraction", "Temporal Sequence Confusion",
                     "Jurisdiction Scope Conflation", "Right-to-Wrong Overthinking",
                     "Similar-Sounding Rule Swap". Use null if there is no notable trap.

  "skill_tested"   — The cognitive operation the test-taker must perform to answer correctly.
                     Start with a verb. Keep it concise (4–8 words). Examples:
                     "Apply UCC § 2-207 Battle of Forms", "Distinguish assault from battery elements",
                     "Identify valid easement by estoppel", "Spot lack of Article III standing"

Return ONLY valid JSON. No markdown, no explanation.

---
Subject: {subject}
Chapter / Topic: {topic}

Question:
{question}

Answer Choices:
{choices}

Correct Answer: {correct_answer}

English Explanation:
{explanation}
"""

def build_prompt(q: dict) -> str:
    choices_lines = "\n".join(
        f"{letter}. {text}"
        for letter, text in sorted(q.get("choices", {}).items())
    )
    return META_PROMPT.format(
        subject=q.get("subject", ""),
        topic=q.get("topic", ""),
        question=q.get("question_text", "").strip(),
        choices=choices_lines,
        correct_answer=q.get("correct_answer_letter", ""),
        explanation=(q.get("en_explanation_text") or "")[:3000],
    )


# ── Supabase REST helpers ──────────────────────────────────────────────────────

def _sb_headers() -> dict:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    if not url or not key:
        print("ERROR: Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env")
        sys.exit(1)
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

def _sb_url() -> str:
    return (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "")).rstrip("/")


def _sb_get(path: str, params: list[tuple[str, str]]) -> list[dict]:
    headers = _sb_headers()
    url = f"{_sb_url()}/rest/v1/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def fetch_questions(subject: str | None, limit: int | None, refill: bool) -> list[dict]:
    """從 question_items + questions view 拼出需要標記的題目。

    question_items 提供 micro_concept/trap_type/skill_tested（filter null）；
    questions view 提供 subject, topic, question_text, options, en_explanation_html。
    """
    # Step 1：從 question_items 取 ID 清單（含 meta 欄位，filter null）
    meta_select = "id,micro_concept,trap_type,skill_tested"
    meta_params: list[tuple[str, str]] = [("select", meta_select), ("order", "id")]
    if not refill:
        meta_params.append(("or", "(micro_concept.is.null,trap_type.is.null,skill_tested.is.null)"))
    if limit:
        meta_params.append(("limit", str(limit)))
    meta_rows = _sb_get("question_items", meta_params)
    if not meta_rows:
        return []

    ids = [r["id"] for r in meta_rows]
    meta_by_id = {r["id"]: r for r in meta_rows}

    # Step 2：從 questions view 取英文內容（分批，每批 200 筆）
    content_select = "id,subject,topic,question_text,correct_answer_letter,options,en_explanation_html"
    content_by_id: dict[str, dict] = {}
    batch_size = 200
    for i in range(0, len(ids), batch_size):
        batch = ids[i:i + batch_size]
        id_list = "(" + ",".join(batch) + ")"
        params: list[tuple[str, str]] = [
            ("select", content_select),
            ("id", f"in.{id_list}"),
        ]
        # subject filter via questions view
        if subject:
            params.append(("subject", f"eq.{subject}"))
        rows = _sb_get("questions", params)
        for r in rows:
            content_by_id[r["id"]] = r

    # Step 3：合併
    result: list[dict] = []
    for qid in ids:
        content = content_by_id.get(qid)
        if not content:
            continue
        # subject filter applied here if view didn't filter (should be redundant)
        if subject and content.get("subject") != subject:
            continue
        row = {**content, **meta_by_id[qid]}

        # 把 options array → dict {"A": "text", ...}
        opts_raw = row.get("options") or []
        choices: dict[str, str] = {}
        for item in opts_raw:
            m = re.match(r"^([A-D])\.\s*", str(item))
            if m:
                choices[m.group(1)] = re.sub(r"^[A-D]\.\s*", "", str(item))
        row["choices"] = choices

        # strip HTML tags from explanation for prompt
        html = row.get("en_explanation_html") or ""
        row["en_explanation_text"] = re.sub(r"<[^>]+>", " ", html)[:3000].strip()
        result.append(row)

    return result


def patch_question_meta(question_id: str, meta: dict) -> None:
    """PATCH question_items 的三個欄位。"""
    headers = _sb_headers()
    url = f"{_sb_url()}/rest/v1/question_items?id=eq.{urllib.parse.quote(question_id)}"
    payload = json.dumps({
        "micro_concept": meta.get("micro_concept") or None,
        "trap_type":     meta.get("trap_type")     or None,
        "skill_tested":  meta.get("skill_tested")  or None,
    }).encode()
    req = urllib.request.Request(
        url, data=payload, method="PATCH",
        headers={**headers, "Prefer": "return=minimal"},
    )
    with urllib.request.urlopen(req, timeout=30):
        pass


# ── 主程式 ────────────────────────────────────────────────────────────────────

import urllib.parse   # noqa: E402 (placed after helpers for readability)


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto-tag MBE questions with Gemini")
    parser.add_argument("--subject", help="Only process this subject")
    parser.add_argument("--limit", type=int, help="Max questions to process (test mode)")
    parser.add_argument("--dry-run", action="store_true", help="Print plan, no API calls")
    parser.add_argument("--refill", action="store_true", help="Re-process already-tagged questions")
    args = parser.parse_args()

    print("Fetching questions from Supabase…")
    rows = fetch_questions(args.subject, args.limit, args.refill)
    print(f"Found {len(rows)} question(s) to tag.\n")

    if not rows:
        print("Nothing to do.")
        return

    ok = skipped = failed = 0

    for i, row in enumerate(rows, 1):
        qid = row["id"]
        label = f"[{i}/{len(rows)}] {qid} ({row.get('subject','')} / {row.get('topic','')})"
        print(label)

        if args.dry_run:
            print(f"  → DRY RUN: would tag  {qid}")
            print(f"    question: {row.get('question_text','')[:80]}…")
            ok += 1
            continue

        try:
            prompt = build_prompt(row)
            meta = call_gemini_json(prompt)

            mc = meta.get("micro_concept") or ""
            tt = meta.get("trap_type") or ""
            st = meta.get("skill_tested") or ""

            print(f"  micro_concept : {mc}")
            print(f"  trap_type     : {tt or '(none)'}")
            print(f"  skill_tested  : {st}")

            patch_question_meta(qid, meta)
            print(f"  ✓ saved")
            ok += 1
            time.sleep(RATE_LIMIT_DELAY)

        except RateLimitedError as e:
            print(f"  ⏭ SKIPPED: {e}")
            skipped += 1

        except Exception as e:
            print(f"  ✗ ERROR: {e}")
            failed += 1

    print(f"\nDone. ✓ {ok}  ⏭ {skipped}  ✗ {failed}")


if __name__ == "__main__":
    main()
