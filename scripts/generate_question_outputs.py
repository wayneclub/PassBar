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
import csv
import json
import os
import re
import shutil
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import generate_question_meta as meta_gen
import generate_zh_explanations as zh_gen
import cli_ai
import cursor_api
from ai_prompts import format_prompt


VALID_MODES = {"zh-html", "en-html", "meta", "all", "sync-explain-imgs"}
DEFAULT_ALL_MODES = ["zh-html", "meta", "en-html"]
RUN_ID = time.strftime("%Y%m%d-%H%M%S")
_BACKED_UP_FILES: set[Path] = set()
USAGE_CSV_COLUMNS = [
    "timestamp",
    "run_id",
    "started_at",
    "finished_at",
    "duration_seconds",
    "enriched_file",
    "subject",
    "chapter",
    "index",
    "question_label",
    "mode",
    "generated_field",
    "provider",
    "model",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "configured_max_output_tokens",
    "recommended_max_output_tokens_20pct",
    "output_token_headroom",
    "output_token_utilization",
    "image_detail",
    "output_chars",
    "output_bytes",
    "status",        # "ok" | "error"
    "generated_summary",
]


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
    backup_path = path.with_suffix(path.suffix + f".{RUN_ID}.bak")
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    rendered = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    tmp_path.write_text(rendered, encoding="utf-8")
    json.loads(tmp_path.read_text(encoding="utf-8"))
    resolved = path.resolve()
    if resolved not in _BACKED_UP_FILES and path.exists():
        shutil.copy2(path, backup_path)
        _BACKED_UP_FILES.add(resolved)
        print(f"  backup: {backup_path.name}")
    os.replace(tmp_path, path)
    # Delete the backup now that the new file is confirmed written.
    if backup_path.exists():
        backup_path.unlink()
        print(f"  backup deleted: {backup_path.name}")


def compact_summary(value: Any, max_len: int = 180) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:max_len]


def int_or_none(value: Any) -> int | None:
    try:
        if value in ("", None, "?"):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def round_up(value: int, step: int = 1000) -> int:
    return ((value + step - 1) // step) * step


def timed_call(fn):
    started_at = time.strftime("%Y-%m-%d %H:%M:%S")
    t0 = time.perf_counter()
    result = fn()
    duration_seconds = time.perf_counter() - t0
    finished_at = time.strftime("%Y-%m-%d %H:%M:%S")
    return result, started_at, finished_at, duration_seconds


def write_usage_csv(
    csv_path: Path | None,
    enriched_file: Path,
    item: dict[str, Any],
    mode: str,
    generated_field: str,
    usage: dict[str, Any] | None,
    started_at: str,
    finished_at: str,
    duration_seconds: float,
    output_chars: int,
    output_bytes: int,
    generated_summary: str,
) -> None:
    if not csv_path:
        return
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    exists = csv_path.exists()
    output_tokens = int_or_none((usage or {}).get("output_tokens"))
    configured_max = int_or_none((usage or {}).get("max_output_tokens"))
    recommended_max = round_up(max(1000, int(output_tokens * 1.2))) if output_tokens is not None else ""
    headroom = configured_max - output_tokens if configured_max is not None and output_tokens is not None else ""
    utilization = (
        f"{output_tokens / configured_max:.4f}"
        if configured_max and output_tokens is not None
        else ""
    )
    row = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "run_id": RUN_ID,
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_seconds": f"{duration_seconds:.3f}",
        "enriched_file": str(enriched_file),
        "subject": item.get("subject", ""),
        "chapter": item.get("chapter", ""),
        "index": item.get("index", ""),
        "question_label": question_label(item),
        "mode": mode,
        "generated_field": generated_field,
        "provider": (usage or {}).get("provider", ""),
        "model": (usage or {}).get("model", ""),
        "input_tokens": (usage or {}).get("input_tokens", ""),
        "output_tokens": (usage or {}).get("output_tokens", ""),
        "total_tokens": (usage or {}).get("total_tokens", ""),
        "configured_max_output_tokens": (usage or {}).get("max_output_tokens", ""),
        "recommended_max_output_tokens_20pct": recommended_max,
        "output_token_headroom": headroom,
        "output_token_utilization": utilization,
        "image_detail": (usage or {}).get("image_detail", ""),
        "output_chars": output_chars,
        "output_bytes": output_bytes,
        "status": "ok",
        "generated_summary": compact_summary(generated_summary),
    }
    with csv_path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=USAGE_CSV_COLUMNS)
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def write_error_csv(
    csv_path: Path | None,
    enriched_file: Path,
    item: dict[str, Any],
    mode: str,
) -> None:
    """Record a failed generation attempt in the usage CSV (status only; details are in the log file)."""
    if not csv_path:
        return
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    exists = csv_path.exists()
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    row = {
        "timestamp": now,
        "run_id": RUN_ID,
        "started_at": now,
        "finished_at": now,
        "duration_seconds": "",
        "enriched_file": str(enriched_file),
        "subject": item.get("subject", ""),
        "chapter": item.get("chapter", ""),
        "index": item.get("index", ""),
        "question_label": question_label(item),
        "mode": mode,
        "generated_field": "",
        "provider": zh_gen.AI_PROVIDER,
        "model": zh_gen.AI_HTML_MODEL if mode in {"en-html", "zh-html"} else zh_gen.AI_MODEL,
        "input_tokens": "",
        "output_tokens": "",
        "total_tokens": "",
        "configured_max_output_tokens": "",
        "recommended_max_output_tokens_20pct": "",
        "output_token_headroom": "",
        "output_token_utilization": "",
        "image_detail": "",
        "output_chars": "",
        "output_bytes": "",
        "status": "error",
        "generated_summary": "",
    }
    with csv_path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=USAGE_CSV_COLUMNS)
        if not exists:
            writer.writeheader()
        writer.writerow(row)


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


def is_complex_illustration(path: Path) -> bool:
    """Classify if an image is a complex illustration/photo or a simple diagram/table.
    We resize to 128x128 and count unique colors and compute standard deviation.
    A complex illustration typically has >= 4000 unique colors AND standard deviation >= 45.0.
    """
    try:
        from PIL import Image
        import math
        with Image.open(path) as img:
            img_rgb = img.convert("RGB")
            img_small = img_rgb.resize((128, 128))
            colors = img_small.getcolors(maxcolors=128 * 128)
            uniq_count = len(colors) if colors else 128 * 128
            
            if uniq_count < 4000:
                return False
                
            img_gray = img_small.convert("L")
            pixels = list(img_gray.getdata())
            mean_val = sum(pixels) / len(pixels)
            variance = sum((x - mean_val) ** 2 for x in pixels) / len(pixels)
            std_dev = math.sqrt(variance)
            
            return std_dev >= 45.0
    except Exception as exc:
        print(f"    [img-classifier] failed to analyze {path.name}: {exc}")
        return True  # Fallback to True (treat as complex) on error


def collect_explain_img_paths(enriched_file: Path, item: dict[str, Any]) -> list[str]:
    """Return absolute paths for explain_imgs stored in the enriched item."""
    paths: list[str] = []
    cleaned_rels: list[str] = []
    for rel in item.get("explain_imgs") or []:
        rel = str(rel).strip()
        if not rel:
            continue
        path = enriched_file.parent / rel
        if path.exists():
            if is_complex_illustration(path):
                paths.append(str(path))
                cleaned_rels.append(rel)
            else:
                print(f"  [img-classifier] {path.name} classified as simple diagram/table; forcing HTML rebuild (excluding from explain_imgs)")
    
    if "explain_imgs" in item:
        item["explain_imgs"] = cleaned_rels

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


def load_castudy_by_index(enriched_file: Path) -> dict[int, dict[str, Any]]:
    """Load the sibling *_castudy.json, keyed by question index."""
    castudy_candidates = sorted(
        [p for p in enriched_file.parent.glob("*_castudy.json") if "failed" not in p.name],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not castudy_candidates:
        return {}

    castudy_file = castudy_candidates[0]
    castudy_raw = json.loads(castudy_file.read_text(encoding="utf-8"))
    castudy_qs: list[dict[str, Any]] = (
        castudy_raw if isinstance(castudy_raw, list) else castudy_raw.get("questions", [])
    )
    return {
        int(q.get("index") or 0): q
        for q in castudy_qs
        if q.get("index")
    }


def downloaded_explain_img_refs(enriched_file: Path, castudy_q: dict[str, Any]) -> list[str]:
    """Download official explanation images and return local imgs/... refs."""
    import urllib.parse

    imgs_dir = enriched_file.parent / "imgs"
    imgs_dir.mkdir(exist_ok=True)

    rel_paths: list[str] = []
    for url in _deep_collect_explain_imgs(castudy_q):
        basename = os.path.basename(urllib.parse.urlparse(url).path)
        bl = basename.lower()
        if not bl or bl == "ai.png" or bl.endswith("ai.png"):
            continue
        local = imgs_dir / basename
        if not local.exists():
            print(f"    [imgs] downloading {basename}...")
            if not _download_img(url, local):
                continue
        if local.exists() and not is_complex_illustration(local):
            print(f"    [imgs] {basename} classified as simple diagram/table; forcing HTML rebuild (skipping img embed)")
            continue
        rel_paths.append(f"imgs/{basename}")

    seen: set[str] = set()
    return [p for p in rel_paths if not (p in seen or seen.add(p))]  # type: ignore[func-returns-value]


def sync_item_explain_imgs(
    enriched_file: Path,
    item: dict[str, Any],
    castudy_by_index: dict[int, dict[str, Any]],
) -> bool:
    """Refresh one item's explain_imgs from castudy before en-html generation."""
    idx = int(item.get("index") or 0)
    castudy_q = castudy_by_index.get(idx)
    if not castudy_q:
        return False

    next_refs = downloaded_explain_img_refs(enriched_file, castudy_q)
    current_refs = [
        str(ref)
        for ref in (item.get("explain_imgs") or [])
        if ref and not os.path.basename(str(ref)).lower().endswith("ai.png")
    ]
    if current_refs == next_refs:
        return False

    item["explain_imgs"] = next_refs
    return True


def sync_explain_imgs(enriched_file: Path, force: bool = False) -> int:
    """Scan the sibling castudy.json and populate explain_imgs in the enriched file.

    For each question, deep-searches explain_imgs URLs in apiResult, downloads any
    missing images to imgs/, then writes relative local paths into the enriched item.
    Never stores URLs — only local paths are persisted. Returns number of questions updated.
    """
    castudy_by_index = load_castudy_by_index(enriched_file)
    if not castudy_by_index:
        print("  [sync-explain-imgs] No *_castudy.json found; skipping.")
        return 0

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

        if sync_item_explain_imgs(enriched_file, item, castudy_by_index):
            updated += 1

    if updated:
        write_enriched(enriched_file, document)
    return updated


def has_good_html(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(text and not text.startswith("<!-- ERROR:"))



def validate_generated_html(html: str, label: str) -> None:
    text = str(html or "").strip()
    lowered = text.lower()
    if len(text) < 1000:
        raise RuntimeError(f"{label} output is suspiciously short ({len(text)} chars); refusing to write it.")
    if not lowered.startswith("<!doctype html"):
        preview = repr(text[:300])
        raise RuntimeError(
            f"{label} output does not start with <!doctype html>; refusing to write it.\n"
            f"  Output starts with: {preview}"
        )
    if "</html>" not in lowered:
        preview = repr(text[-300:])
        raise RuntimeError(
            f"{label} output is missing </html>; refusing to write it.\n"
            f"  Output ends with: {preview}"
        )


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
        prompt += format_prompt(
            "en_explanation_illustration_images",
            img_refs="".join(f"  - `{r}`\n" for r in rel_refs),
            img_tags=img_tags,
        )
        all_image_paths = image_paths + [p for p in explain_img_paths if p not in image_paths]
    else:
        all_image_paths = image_paths

    raw = zh_gen.call_ai_rest(prompt, all_image_paths, use_html_model=True)
    html = zh_gen.extract_html_from_response(raw)

    # Validate that all required illustration diagrams/images are actually present in the generated HTML
    if explain_img_paths:
        for p in explain_img_paths:
            ref = f"imgs/{os.path.basename(p)}"
            if ref not in html:
                raise RuntimeError(
                    f"Generated HTML is missing required illustration image reference: '{ref}'"
                )

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
        topic=zh_gen.resolve_zh_html_topic(item, document_meta, english_explanation),
        question=str(item.get("question") or ""),
        choices=zh_gen.format_choices_for_prompt(choices),
        correct_answer_letter=correct,
        correct_answer_text=choices.get(correct, ""),
        english_explanation=english_explanation or "(No supplemental OCR/plain text available; use the uploaded official explanation image.)",
    )
    raw = zh_gen.call_ai_rest(prompt, image_paths, use_html_model=True)
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


def parse_index_range(value: str) -> set[int]:
    """Parse index range string like '3', '3-10', '3,5,7', '3-10,15,20-25' into a set of ints."""
    result: set[int] = set()
    for part in value.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = part.split("-", 1)
            result.update(range(int(lo.strip()), int(hi.strip()) + 1))
        elif part:
            result.add(int(part))
    return result


def process_file(
    enriched_file: Path,
    modes: list[str],
    limit: int,
    index: int | None,
    index_range: set[int] | None,
    force: bool,
    dry_run: bool,
    usage_csv: Path | None,
) -> None:
    document = json.loads(enriched_file.read_text(encoding="utf-8"))
    items, document_meta = parse_enriched_document(document)
    selected = items
    if index_range is not None:
        selected = [item for item in selected if int(item.get("index") or -1) in index_range]
    elif index is not None:
        selected = [item for item in selected if int(item.get("index") or -1) == index]
    if limit > 0:
        selected = selected[:limit]

    print(f"Loaded {len(items)} question(s) from {enriched_file}")
    print(f"Selected {len(selected)} question(s)")
    print(f"Modes: {' '.join(modes)}")
    castudy_by_index = load_castudy_by_index(enriched_file) if "en-html" in modes else {}

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
        if index_range is not None:
            selected = [item for item in selected if int(item.get("index") or -1) in index_range]
        elif index is not None:
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
                    print("  en-html: cached (use --force to replace)")
                    continue
                if dry_run:
                    print("  en-html: would generate")
                    continue
                if castudy_by_index and sync_item_explain_imgs(enriched_file, item, castudy_by_index):
                    explain_img_paths = collect_explain_img_paths(enriched_file, item)
                    print(f"  explain_imgs: synced {len(explain_img_paths)} file(s)")
                    write_enriched(enriched_file, document)
                    changed = True
                print("  en-html: generating...", end=" ", flush=True)
                zh_gen.clear_last_ai_usage()
                try:
                    (html, topic), started_at, finished_at, duration_seconds = timed_call(
                        lambda: generate_en_html(item, image_paths, explain_img_paths or None)
                    )
                    validate_generated_html(html, "en-html")
                except Exception as exc:
                    print(f"ERROR: {exc}")
                    traceback.print_exc()
                    write_error_csv(usage_csv, enriched_file, item, "en-html")
                    time.sleep(zh_gen.RATE_LIMIT_DELAY)
                    continue
                usage = zh_gen.get_last_ai_usage()
                write_usage_csv(
                    usage_csv,
                    enriched_file,
                    item,
                    "en-html",
                    "explanation",
                    usage,
                    started_at,
                    finished_at,
                    duration_seconds,
                    len(html),
                    len(html.encode("utf-8")),
                    topic or "English explanation HTML",
                )
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
                write_enriched(enriched_file, document)
                time.sleep(zh_gen.RATE_LIMIT_DELAY)

            elif mode == "zh-html":
                if not force and has_good_html(item.get("zh-explanation")):
                    print("  zh-html: cached (use --force to replace)")
                    continue
                if dry_run:
                    print("  zh-html: would force regenerate" if force else "  zh-html: would generate")
                    continue
                print("  zh-html: forcing regeneration..." if force else "  zh-html: generating...", end=" ", flush=True)
                zh_gen.clear_last_ai_usage()
                try:
                    html, started_at, finished_at, duration_seconds = timed_call(
                        lambda: generate_zh_html(item, document_meta, image_paths)
                    )
                    validate_generated_html(html, "zh-html")
                except Exception as exc:
                    print(f"ERROR: {exc}")
                    traceback.print_exc()
                    write_error_csv(usage_csv, enriched_file, item, "zh-html")
                    time.sleep(zh_gen.RATE_LIMIT_DELAY)
                    continue
                usage = zh_gen.get_last_ai_usage()
                write_usage_csv(
                    usage_csv,
                    enriched_file,
                    item,
                    "zh-html",
                    "zh-explanation",
                    usage,
                    started_at,
                    finished_at,
                    duration_seconds,
                    len(html),
                    len(html.encode("utf-8")),
                    "Chinese explanation HTML",
                )
                item["zh-explanation"] = html
                write_zh_html_preview(enriched_file, item)
                print("✓")
                changed = True
                write_enriched(enriched_file, document)
                time.sleep(zh_gen.RATE_LIMIT_DELAY)

            elif mode == "meta":
                if not force and has_good_meta(item):
                    print("  meta: cached (use --force to replace)")
                    continue
                if dry_run:
                    print("  meta: would generate")
                    continue
                print("  meta: generating...", end=" ", flush=True)
                meta_gen.clear_last_meta_usage()
                try:
                    analysis, started_at, finished_at, duration_seconds = timed_call(
                        lambda: generate_meta(item, document_meta)
                    )
                except Exception as exc:
                    print(f"ERROR: {exc}")
                    traceback.print_exc()
                    write_error_csv(usage_csv, enriched_file, item, "meta")
                    time.sleep(meta_gen.RATE_LIMIT_DELAY)
                    continue
                usage = meta_gen.get_last_meta_usage()
                print(f"✓ {analysis.get('micro_concept')}")
                changed = True
                write_enriched(enriched_file, document)
                write_usage_csv(
                    usage_csv,
                    enriched_file,
                    item,
                    "meta",
                    "meta",
                    usage,
                    started_at,
                    finished_at,
                    duration_seconds,
                    len(json.dumps(analysis, ensure_ascii=False)),
                    len(json.dumps(analysis, ensure_ascii=False).encode("utf-8")),
                    analysis.get("micro_concept") or "question analysis meta",
                )
                time.sleep(meta_gen.RATE_LIMIT_DELAY)

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


def collect_enriched_files(
    subjects: list[str] | None,
    chapters: list[str] | None,
) -> list[Path]:
    """Resolve which enriched files to process based on subject/chapter filters.

    - subjects + chapters  → cross-product (each subject × each chapter)
    - subjects only        → all chapters under each subject
    - chapters only        → search all subjects for those chapter names
    - neither              → all chapters in OUT_DIR (recursive)
    """
    seen: set[Path] = set()
    files: list[Path] = []

    def _add(p: Path) -> None:
        if p not in seen:
            seen.add(p)
            files.append(p)

    if subjects and chapters:
        for s in subjects:
            for c in chapters:
                _add(find_enriched_file(s, c))
    elif subjects and not chapters:
        for s in subjects:
            search_root = OUT_DIR / s
            if not search_root.is_dir():
                raise FileNotFoundError(f"Subject directory not found: {search_root}")
            for p in sorted(search_root.rglob("*_enriched.json")):
                _add(p)
    elif chapters and not subjects:
        for p in sorted(OUT_DIR.rglob("*_enriched.json")):
            if p.parent.name in chapters:
                _add(p)
    else:
        for p in sorted(OUT_DIR.rglob("*_enriched.json")):
            _add(p)

    if not files:
        raise FileNotFoundError("No *_enriched.json found for the given subject/chapter filters.")
    return files


def validate_run_scope(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    if args.all_files:
        return
    if args.yes:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate selected PassBar enriched question outputs")
    file_group = parser.add_mutually_exclusive_group(required=False)
    file_group.add_argument("--enriched-file", type=Path, help="Path to *_enriched.json")
    file_group.add_argument("--list", action="store_true", help="List all available subject/chapter pairs and exit")
    file_group.add_argument("--all-files", action="store_true", help="Process every *_enriched.json under out/ (explicit opt-in)")
    parser.add_argument("--subject", nargs="+", help="One or more subject names (e.g. 'Evidence' 'Torts'); omit to process all")
    parser.add_argument("--chapter", nargs="+", help="One or more chapter names; omit to process all chapters")
    parser.add_argument("--mode", nargs="+", default=["zh-html", "meta"], help="One or more: zh-html en-html meta all")
    parser.add_argument(
        "--provider",
        choices=("gemini", "gpt", "codex-cli", "antigravity-cli", "claude-cli", "cursor-cli", "cursor-api"),
        default="gemini",
        help="Provider for generated outputs",
    )
    parser.add_argument("--model", default="", help="Override model for all modes (translation, meta, HTML)")
    parser.add_argument("--html-model", default="", help="Override model for en-html/zh-html only (high-output model); falls back to ANTIGRAVITY_CLI_HTML_MODEL env var")
    parser.add_argument("--limit", type=int, default=0, help="Only process first N selected questions")
    parser.add_argument("--index", type=int, help="Only process a specific question index (single; use --index-range for ranges)")
    parser.add_argument("--index-range", help="Index range/list to process, e.g. '5-20', '3,7,9', '1-10,15,20-25'")
    parser.add_argument("--force", action="store_true", help="Regenerate even when cached output exists")
    parser.add_argument("--yes", action="store_true", help="Confirm a broad --force rewrite")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without API calls or writes")
    parser.add_argument("--usage-csv", default="logs/ai_generation_usage.csv", help="Append per-call token usage rows to this CSV")
    parser.add_argument("--log-file", default="", help="Tee stdout+stderr to this file (default: logs/generate_outputs_<RUN_ID>.log)")
    args = parser.parse_args()

    if args.list:
        list_subjects_and_chapters()
        return

    if args.index is not None and args.index_range:
        parser.error("--index and --index-range are mutually exclusive")
    validate_run_scope(args, parser)

    log_path = Path(args.log_file) if args.log_file else Path(f"logs/generate_outputs_{RUN_ID}.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    _log_fh = open(log_path, "w", encoding="utf-8", buffering=1)  # line-buffered

    class _Tee:
        def __init__(self, stream, fh):
            self._s, self._f = stream, fh
        def write(self, data):
            self._s.write(data)
            self._f.write(data)
        def flush(self):
            self._s.flush()
            self._f.flush()
        def fileno(self):
            return self._s.fileno()

    sys.stdout = _Tee(sys.stdout, _log_fh)  # type: ignore[assignment]
    sys.stderr = _Tee(sys.stderr, _log_fh)  # type: ignore[assignment]
    print(f"Log: {log_path.resolve()}")
    print(f"Run ID: {RUN_ID}")

    modes = expand_modes(args.mode)
    index_range: set[int] | None = parse_index_range(args.index_range) if args.index_range else None

    scope_parts: list[str] = []
    if args.enriched_file:
        scope_parts.append(f"file={args.enriched_file}")
    else:
        if args.subject:
            scope_parts.append(f"subject={args.subject}")
        if args.chapter:
            scope_parts.append(f"chapter={args.chapter}")
        if not args.subject and not args.chapter:
            scope_parts.append("all enriched files under out/")
    if args.index is not None:
        scope_parts.append(f"index={args.index}")
    if index_range is not None:
        scope_parts.append(f"index-range={sorted(index_range)}")
    if args.limit > 0:
        scope_parts.append(f"limit={args.limit}")
    print(f"Provider: {args.provider}")
    print(f"Modes: {' '.join(modes)}")
    print(f"Scope: {', '.join(scope_parts) if scope_parts else 'default'}")
    print(f"Force regenerate: {'ON' if args.force else 'OFF'}")
    if args.force:
        print("  → will call API and replace existing zh-html / en-html / meta outputs")
    else:
        print("  → will skip questions that already have valid outputs (shows 'cached')")
    zh_gen.set_ai_provider(args.provider, args.model or None, html_model=args.html_model or None)
    meta_gen.set_meta_provider(args.provider, args.model or None)
    if not args.dry_run and args.provider == "cursor-api":
        try:
            cursor_api.check_cursor_api_ready()
        except Exception as exc:
            parser.error(str(exc))
    if not args.dry_run and args.provider in {"codex-cli", "antigravity-cli", "claude-cli", "cursor-cli"}:
        try:
            cli_ai.check_provider_ready(args.provider)
        except Exception as exc:
            parser.error(str(exc))
    usage_csv = Path(args.usage_csv) if args.usage_csv else None

    if args.enriched_file:
        enriched_files = [args.enriched_file]
    else:
        enriched_files = collect_enriched_files(args.subject, args.chapter)

    total = len(enriched_files)
    for file_num, enriched_file in enumerate(enriched_files, 1):
        if total > 1:
            print(f"\n{'='*60}")
            print(f"[{file_num}/{total}] {enriched_file.relative_to(OUT_DIR)}")
            print(f"{'='*60}")
        else:
            print(f"Auto-located: {enriched_file}")
        process_file(
            enriched_file=enriched_file,
            modes=modes,
            limit=args.limit,
            index=args.index,
            index_range=index_range,
            force=args.force,
            dry_run=args.dry_run,
            usage_csv=usage_csv,
        )


if __name__ == "__main__":
    cursor_api.maybe_reexec_with_venv()
    main()
