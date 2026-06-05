#!/usr/bin/env python3
"""
Experimental multi-output generator for enriched PassBar questions.

This script intentionally does not replace generate_zh_explanations.py or
generate_question_meta.py. It reuses their existing prompts/helpers, but lets you
choose multiple outputs in one command:

  --mode zh-html en-html meta
  --mode zh-html meta
  --mode en-html
  --mode all

It reads and writes the enriched JSON file directly.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any

import generate_question_meta as meta_gen
import generate_zh_explanations as zh_gen


VALID_MODES = {"zh-html", "en-html", "meta", "all", "sync-explain-imgs"}
DEFAULT_ALL_MODES = ["zh-html", "meta", "en-html"]


def expand_modes(values: list[str]) -> list[str]:
    modes: list[str] = []
    for value in values:
        if value not in VALID_MODES:
            raise ValueError(f"Unknown mode: {value}")
        if value == "all":
            for mode in DEFAULT_ALL_MODES:
                if mode not in modes:
                    modes.append(mode)
        elif value not in modes:
            modes.append(value)
    return modes


def parse_enriched_document(raw: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if isinstance(raw, list):
        first = raw[0] if raw else {}
        return [item for item in raw if isinstance(item, dict)], {
            "subject": first.get("subject", ""),
            "chapter": first.get("chapter", ""),
            "count": first.get("count", len(raw)),
        }
    if isinstance(raw, dict) and isinstance(raw.get("questions"), list):
        return [item for item in raw["questions"] if isinstance(item, dict)], raw.get("meta") or {}
    raise ValueError("Unsupported enriched JSON shape. Expected an array or an object with questions[].")


def write_enriched(path: Path, document: Any) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp_path, path)


def question_label(item: dict[str, Any]) -> str:
    return str(item.get("id") or item.get("question_id") or f"index-{item.get('index', '')}")


def answer_letter(item: dict[str, Any]) -> str:
    return str(
        item.get("answer")
        or item.get("sourceCorrectAnswer")
        or item.get("correct_answer")
        or item.get("correctAnswer")
        or ""
    ).strip().upper()[:1]


def collect_image_paths(enriched_file: Path, item: dict[str, Any]) -> list[str]:
    image_paths: list[str] = []
    for key in ("source_img", "sourceExplanationImageFile"):
        rel = str(item.get(key) or "").strip()
        if not rel:
            continue
        path = enriched_file.parent / rel
        if path.exists():
            image_paths.append(str(path))
    return list(dict.fromkeys(image_paths))


def collect_explain_img_paths(enriched_file: Path, item: dict[str, Any]) -> list[str]:
    """Return absolute paths for explain_imgs stored in the enriched item."""
    paths: list[str] = []
    for rel in item.get("explain_imgs") or []:
        rel = str(rel).strip()
        if not rel:
            continue
        path = enriched_file.parent / rel
        if path.exists():
            paths.append(str(path))
    return paths


def _deep_collect_explain_imgs(obj: Any) -> list[str]:
    """Recursively collect all explain_imgs URL lists from any JSON shape."""
    result: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "explain_imgs" and isinstance(v, list):
                result.extend(str(u) for u in v if u)
            else:
                result.extend(_deep_collect_explain_imgs(v))
    elif isinstance(obj, list):
        for item in obj:
            result.extend(_deep_collect_explain_imgs(item))
    return result


def _download_img(url: str, dest: Path, timeout: int = 20) -> bool:
    """Download a single image to dest. Returns True on success."""
    import urllib.request
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            dest.write_bytes(resp.read())
        return True
    except Exception as exc:
        print(f"    [imgs] download failed {url}: {exc}")
        return False


def sync_explain_imgs(enriched_file: Path, force: bool = False) -> int:
    """Scan the sibling castudy.json and populate explain_imgs in the enriched file.

    For each question, deep-searches explain_imgs URLs in apiResult, downloads any
    missing images to imgs/, then writes relative local paths into the enriched item.
    Never stores URLs — only local paths are persisted. Returns number of questions updated.
    """
    import urllib.parse

    # Find the latest castudy.json sibling (non-failed)
    castudy_candidates = sorted(
        [p for p in enriched_file.parent.glob("*_castudy.json") if "failed" not in p.name],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not castudy_candidates:
        print("  [sync-explain-imgs] No *_castudy.json found; skipping.")
        return 0

    castudy_file = castudy_candidates[0]
    castudy_raw = json.loads(castudy_file.read_text(encoding="utf-8"))
    castudy_qs: list[dict[str, Any]] = (
        castudy_raw if isinstance(castudy_raw, list) else castudy_raw.get("questions", [])
    )
    castudy_by_index: dict[int, dict[str, Any]] = {
        int(q.get("index") or 0): q for q in castudy_qs if q.get("index")
    }

    imgs_dir = enriched_file.parent / "imgs"
    imgs_dir.mkdir(exist_ok=True)

    document = json.loads(enriched_file.read_text(encoding="utf-8"))
    items, _ = parse_enriched_document(document)

    updated = 0
    for item in items:
        idx = int(item.get("index") or 0)
        castudy_q = castudy_by_index.get(idx)
        if not castudy_q:
            continue

        if not force and item.get("explain_imgs") is not None:
            continue

        urls = _deep_collect_explain_imgs(castudy_q)
        rel_paths: list[str] = []
        for url in urls:
            basename = os.path.basename(urllib.parse.urlparse(url).path)
            # Skip ai.png or any AI-generated image (filename ends with "ai.png")
            bl = basename.lower()
            if not bl or bl == "ai.png" or bl.endswith("ai.png"):
                continue
            local = imgs_dir / basename
            if not local.exists():
                print(f"    [imgs] downloading {basename}...")
                if not _download_img(url, local):
                    continue  # skip if download failed
            rel_paths.append(f"imgs/{basename}")

        # Deduplicate preserving order
        seen: set[str] = set()
        deduped = [p for p in rel_paths if not (p in seen or seen.add(p))]  # type: ignore[func-returns-value]

        item["explain_imgs"] = deduped
        updated += 1

    if updated:
        write_enriched(enriched_file, document)
    return updated


def has_good_html(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(text and not text.startswith("<!-- ERROR:"))


def has_good_meta(item: dict[str, Any]) -> bool:
    existing = meta_gen.get_existing_analysis_meta(item)
    return meta_gen.has_complete_meta({"meta": {"question_analysis": existing}}) if existing else False


TOPIC_COMMENT_RE = re.compile(r'<!--\s*pbx-topic:\s*(.*?)\s*-->', re.IGNORECASE)


def extract_topic_from_html(html: str) -> str | None:
    """Extract <!-- pbx-topic: ... --> comment from generated en-html.
    The comment appears right after <body>, which may be preceded by a large <head>/<style> block.
    Search the entire HTML rather than just the start.
    """
    m = TOPIC_COMMENT_RE.search(html)
    if m:
        value = m.group(1).strip()
        return value if value else None
    return None


def generate_en_html(
    item: dict[str, Any],
    image_paths: list[str],
    explain_img_paths: list[str] | None = None,
) -> tuple[str, str | None]:
    """Returns (html, topic_or_None)."""
    choices = zh_gen.parse_choices_from_json(item.get("choices") or {})
    prompt = zh_gen.build_english_explanation_prompt(choices, answer_letter(item))

    if explain_img_paths:
        # Build "imgs/filename.jpg" relative refs (matching the enriched JSON explain_imgs paths)
        rel_refs = [f"imgs/{os.path.basename(p)}" for p in explain_img_paths]
        img_tags = "".join(
            f'<figure class="pbx-explain-img">\n'
            f'  <img src="{r}" alt="Explanation diagram"'
            f' style="max-width:100%;height:auto;display:block;margin:0 auto;">\n'
            f"</figure>\n"
            for r in rel_refs
        )
        prompt += (
            "\n\n### Explanation Illustration Images (MANDATORY)\n"
            "The following official UWorld diagram(s) are attached alongside the source image.\n"
            "They are too complex to recreate in HTML/CSS — you MUST embed each one as a responsive "
            "`<img>` tag at the appropriate location in the explanation "
            "(after the rule or section it illustrates).\n\n"
            "**CRITICAL — use this EXACT src path (including the `imgs/` prefix):**\n"
            + "".join(f"  - `{r}`\n" for r in rel_refs)
            + "\nEmbed each image using EXACTLY this pattern:\n"
            "```html\n"
            + img_tags
            + "```\n"
            "CSS to add to the `<style>` block:\n"
            "```css\n"
            ".pbx-explain-img { margin: 1.25em 0; text-align: center; }\n"
            ".pbx-explain-img img { max-width: 100%; height: auto; border-radius: 6px; "
            "box-shadow: 0 1px 4px rgba(0,0,0,0.12); }\n"
            "@media (max-width: 640px) { .pbx-explain-img img { border-radius: 3px; } }\n"
            "```\n"
            "Do NOT omit the `imgs/` prefix. Do NOT invent a different path."
        )
        all_image_paths = image_paths + [p for p in explain_img_paths if p not in image_paths]
    else:
        all_image_paths = image_paths

    raw = zh_gen.call_ai_rest(prompt, all_image_paths)
    html = zh_gen.extract_html_from_response(raw)
    topic = extract_topic_from_html(html)
    return html, topic


def generate_zh_html(
    item: dict[str, Any],
    document_meta: dict[str, Any],
    image_paths: list[str],
) -> str:
    choices = zh_gen.parse_choices_from_json(item.get("choices") or {})
    correct = answer_letter(item)
    english_explanation = zh_gen.html_to_prompt_text(str(item.get("explanation") or ""))
    prompt = zh_gen.GEMINI_PROMPT_TEMPLATE.format(
        subject=item.get("subject") or document_meta.get("subject", ""),
        chapter=item.get("chapter") or document_meta.get("chapter", ""),
        question=str(item.get("question") or ""),
        choices=zh_gen.format_choices_for_prompt(choices),
        correct_answer_letter=correct,
        correct_answer_text=choices.get(correct, ""),
        english_explanation=english_explanation or "(No supplemental OCR/plain text available; use the uploaded official explanation image.)",
    )
    raw = zh_gen.call_ai_rest(prompt, image_paths)
    return zh_gen.extract_html_from_response(raw)


def generate_meta(item: dict[str, Any], document_meta: dict[str, Any]) -> dict[str, Any]:
    generated = meta_gen.call_meta_json(meta_gen.build_prompt(item, document_meta))
    return meta_gen.save_analysis_meta(item, generated)


def write_zh_html_preview(enriched_file: Path, item: dict[str, Any]) -> None:
    html = item.get("zh-explanation")
    if not html:
        return
    index = int(item.get("index") or 0)
    if index <= 0:
        return
    preview_dir = enriched_file.parent / "zh_html"
    preview_dir.mkdir(exist_ok=True)
    (preview_dir / f"q{index:04d}.html").write_text(str(html), encoding="utf-8")


def process_file(
    enriched_file: Path,
    modes: list[str],
    limit: int,
    index: int | None,
    force: bool,
    dry_run: bool,
) -> None:
    document = json.loads(enriched_file.read_text(encoding="utf-8"))
    items, document_meta = parse_enriched_document(document)
    selected = items
    if index is not None:
        selected = [item for item in selected if int(item.get("index") or -1) == index]
    if limit > 0:
        selected = selected[:limit]

    print(f"Loaded {len(items)} question(s) from {enriched_file}")
    print(f"Selected {len(selected)} question(s)")
    print(f"Modes: {' '.join(modes)}")

    if "sync-explain-imgs" in modes:
        print("\n[sync-explain-imgs] Scanning castudy.json for explain_imgs...")
        if dry_run:
            print("[sync-explain-imgs] --dry-run: would scan (skipping write)")
            n = 0
        else:
            n = sync_explain_imgs(enriched_file, force=force)
        print(f"[sync-explain-imgs] Updated {n} question(s).")
        # Reload document after sync
        document = json.loads(enriched_file.read_text(encoding="utf-8"))
        items, document_meta = parse_enriched_document(document)
        selected = items
        if index is not None:
            selected = [item for item in selected if int(item.get("index") or -1) == index]
        if limit > 0:
            selected = selected[:limit]
        if modes == ["sync-explain-imgs"]:
            return

    changed = False
    for position, item in enumerate(selected, 1):
        label = question_label(item)
        image_paths = collect_image_paths(enriched_file, item)
        explain_img_paths = collect_explain_img_paths(enriched_file, item)
        print(f"\n[{position}/{len(selected)}] {label} / index {item.get('index')}")
        if explain_img_paths:
            print(f"  explain_imgs: {len(explain_img_paths)} file(s)")

        for mode in modes:
            if mode == "sync-explain-imgs":
                continue
            if mode == "en-html":
                if not force and has_good_html(item.get("explanation")):
                    print("  en-html: cached")
                    continue
                if dry_run:
                    print("  en-html: would generate")
                    continue
                print("  en-html: generating...", end=" ", flush=True)
                html, topic = generate_en_html(item, image_paths, explain_img_paths or None)
                item["explanation"] = html
                if topic and not item.get("topic"):
                    # Insert topic right after "chapter" key
                    new_item: dict[str, Any] = {}
                    for k, v in item.items():
                        new_item[k] = v
                        if k == "chapter":
                            new_item["topic"] = topic
                    item.clear()
                    item.update(new_item)
                    print(f"✓  (topic: {topic})")
                else:
                    print("✓")
                changed = True
                time.sleep(zh_gen.RATE_LIMIT_DELAY)

            elif mode == "zh-html":
                if not force and has_good_html(item.get("zh-explanation")):
                    print("  zh-html: cached")
                    continue
                if dry_run:
                    print("  zh-html: would generate")
                    continue
                print("  zh-html: generating...", end=" ", flush=True)
                item["zh-explanation"] = generate_zh_html(item, document_meta, image_paths)
                write_zh_html_preview(enriched_file, item)
                print("✓")
                changed = True
                time.sleep(zh_gen.RATE_LIMIT_DELAY)

            elif mode == "meta":
                if not force and has_good_meta(item):
                    print("  meta: cached")
                    continue
                if dry_run:
                    print("  meta: would generate")
                    continue
                print("  meta: generating...", end=" ", flush=True)
                analysis = generate_meta(item, document_meta)
                print(f"✓ {analysis.get('micro_concept')}")
                changed = True
                time.sleep(meta_gen.RATE_LIMIT_DELAY)

        if changed and not dry_run:
            write_enriched(enriched_file, document)

    if changed and not dry_run:
        print(f"\nSaved: {enriched_file}")
    else:
        print("\nNo changes written.")


OUT_DIR = Path(__file__).parent.parent / "out"


def find_enriched_file(subject: str, chapter: str) -> Path:
    """Locate *_enriched.json under out/{subject}/{chapter}/."""
    base = OUT_DIR / subject / chapter
    candidates = list(base.glob("*_enriched.json"))
    if not candidates:
        raise FileNotFoundError(
            f"No *_enriched.json found under {base}\n"
            f"Available subjects: {sorted(p.name for p in OUT_DIR.iterdir() if p.is_dir())}"
        )
    if len(candidates) > 1:
        raise ValueError(f"Multiple enriched files found under {base}: {candidates}")
    return candidates[0]


def list_subjects_and_chapters() -> None:
    """Print all available subject/chapter pairs."""
    for subject_dir in sorted(OUT_DIR.iterdir()):
        if not subject_dir.is_dir():
            continue
        for chapter_dir in sorted(subject_dir.iterdir()):
            if not chapter_dir.is_dir():
                continue
            if list(chapter_dir.glob("*_enriched.json")):
                print(f"  --subject \"{subject_dir.name}\" --chapter \"{chapter_dir.name}\"")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate selected PassBar enriched question outputs")
    file_group = parser.add_mutually_exclusive_group(required=True)
    file_group.add_argument("--enriched-file", type=Path, help="Path to *_enriched.json")
    file_group.add_argument("--subject", help="Subject name (e.g. 'Evidence')")
    file_group.add_argument("--list", action="store_true", help="List all available subject/chapter pairs and exit")
    parser.add_argument("--chapter", help="Chapter name (required when --subject is used)")
    parser.add_argument("--mode", nargs="+", default=["zh-html", "meta"], help="One or more: zh-html en-html meta all")
    parser.add_argument("--provider", choices=("gemini", "gpt"), default="gemini", help="Provider for HTML generation")
    parser.add_argument("--model", default="", help="Override HTML generation model")
    parser.add_argument("--limit", type=int, default=0, help="Only process first N selected questions")
    parser.add_argument("--index", type=int, help="Only process a specific question index")
    parser.add_argument("--force", action="store_true", help="Regenerate even when cached output exists")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without API calls or writes")
    args = parser.parse_args()

    if args.list:
        list_subjects_and_chapters()
        return

    if args.subject:
        if not args.chapter:
            parser.error("--chapter is required when --subject is used")
        enriched_file = find_enriched_file(args.subject, args.chapter)
        print(f"Auto-located: {enriched_file}")
    else:
        enriched_file = args.enriched_file

    modes = expand_modes(args.mode)
    zh_gen.set_ai_provider(args.provider, args.model or None)
    meta_gen.set_meta_provider(args.provider, args.model or None)
    process_file(
        enriched_file=enriched_file,
        modes=modes,
        limit=args.limit,
        index=args.index,
        force=args.force,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
