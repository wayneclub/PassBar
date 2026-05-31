#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import requests
from html.parser import HTMLParser
import shutil
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import quote
from html import unescape
import random
from difflib import SequenceMatcher

# --- URL / Unicode sanitization ---
# Some sources can contain lone UTF-16 surrogate code points (common when text originates from JS).
# JS `encodeURIComponent` would throw "URI malformed" on these, and Python URL encoding can also fail.
# We sanitize by removing control chars (except common whitespace) and replacing invalid Unicode.
_SURROGATE_RE = re.compile(r"[\ud800-\udfff]")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_query_text(s: Any) -> str:
    """Best-effort sanitize text before URL-encoding.

    - Accepts any input and returns a safe `str`.
    - Removes problematic control characters.
    - Replaces lone UTF-16 surrogates.
    - Ensures the string can be UTF-8 encoded.
    """
    if s is None:
        return ""
    if not isinstance(s, str):
        s = str(s)

    # Normalize common line endings
    s = s.replace("\r\n", "\n").replace("\r", "\n")

    # Replace NBSP (\u00A0) which can appear in copied text and cause URL encoding issues in some stacks
    s = s.replace("\u00a0", " ")

    # Remove ASCII control chars except tab/newline
    s = _CONTROL_RE.sub(" ", s)

    # Replace lone surrogate code points (these can break URI encoding)
    if _SURROGATE_RE.search(s):
        s = _SURROGATE_RE.sub(" ", s)

    # Finally ensure UTF-8 safe (replace anything still unencodable)
    try:
        s.encode("utf-8")
    except UnicodeEncodeError:
        s = s.encode("utf-8", "replace").decode("utf-8")

    # Light cleanup: collapse excessive whitespace (including newlines) into single spaces
    s = re.sub(r"\s+", " ", s).strip()
    return s


# --- Query fallback helpers (when full question fetch fails) ---
_SENT_SPLIT_RE = re.compile(r"(?<=[\.!?。！？])\s+")
_PUNCT_STRIP_RE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff ]+")


def _simplify_query_text(s: str, max_len: int = 220) -> str:
    """Simplify a query string for API fallback.

    - Remove newlines
    - Strip most punctuation/symbols (keep alnum + CJK + spaces)
    - Collapse spaces
    - Truncate to a reasonable length
    """
    if not s:
        return ""
    s = s.replace("\r\n", " ").replace("\r", " ").replace("\n", " ")
    s = sanitize_query_text(s)
    s = _PUNCT_STRIP_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > max_len:
        # Avoid chopping mid-token; truncate at the last space before max_len when possible.
        cut = s.rfind(" ", 0, max_len)
        if cut >= max(20, int(max_len * 0.5)):
            s = s[:cut].rstrip()
        else:
            s = s[:max_len].rstrip()
    return s


def _split_sentences(text: str, min_chars: int = 40) -> List[str]:
    """Split a question into *complete* sentence-like chunks (best-effort).

    Requirements for our fallback queries:
    - Prefer a whole, independent sentence (ending with . ! ? or CJK equivalents)。
    - Do NOT arbitrarily cut by line breaks.
    - If sentences are extremely short, merge them with the next chunk to keep meaning.

    If the text has no clear sentence-ending punctuation, treat each paragraph as a single chunk.
    """
    if not text:
        return []

    # Normalize newlines but do NOT treat them as sentence boundaries.
    t = text.replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"\n{2,}", "\n", t)

    enders = set([".", "!", "?", "。", "！", "？"])

    sentences: List[str] = []
    buf: List[str] = []

    # Scan characters and split only on sentence-ending punctuation.
    for ch in t:
        if ch == "\n":
            # Preserve spacing but don't force a split.
            buf.append(" ")
            continue
        buf.append(ch)
        if ch in enders:
            s = "".join(buf).strip()
            if s:
                sentences.append(s)
            buf = []

    tail = "".join(buf).strip()
    if tail:
        # If no end punctuation, we still keep the remaining chunk.
        sentences.append(tail)

    # If we got no real splits (eg, no end punctuation), fall back to paragraphs.
    if len(sentences) <= 1:
        paras = [p.strip() for p in t.split("\n") if p.strip()]
        if len(paras) > 1:
            sentences = paras

    # Merge very short fragments with the next one so queries remain meaningful.
    merged: List[str] = []
    i = 0
    while i < len(sentences):
        cur = sentences[i].strip()
        if not cur:
            i += 1
            continue
        # If too short and there's a next sentence, merge.
        if len(cur) < int(min_chars) and i + 1 < len(sentences):
            nxt = sentences[i + 1].strip()
            if nxt:
                cur = f"{cur} {nxt}".strip()
                i += 1
        merged.append(cur)
        i += 1

    return merged


def build_fallback_queries(question_text: str, max_random: int = 3) -> List[str]:
    """Build fallback query candidates from a question.

    Strategy (no arbitrary slicing):
    1) Prefer the first complete sentence (simplified) that fits within the max length.
    2) If still failing, randomly sample up to `max_random` other complete sentences.

    We do NOT split on newlines and we avoid cutting in the middle of a sentence.
    """
    if not question_text:
        return []

    sentences = _split_sentences(question_text)
    if not sentences:
        return []

    # Simplify each sentence; keep only meaningful candidates.
    simplified: List[str] = []
    for s in sentences:
        cand = _simplify_query_text(s)
        # Ignore extremely short/empty candidates after simplification
        if cand and len(cand) >= 25:
            simplified.append(cand)

    if not simplified:
        # As a last resort, simplify the whole text (still sanitized)
        whole = _simplify_query_text(question_text)
        return [whole] if whole else []

    # De-dupe while preserving order
    seen: set[str] = set()
    ordered: List[str] = []
    for c in simplified:
        if c not in seen:
            seen.add(c)
            ordered.append(c)

    # First pick: the first sentence candidate
    out: List[str] = [ordered[0]]

    # Additional picks: random sample from the remaining *full sentence* candidates
    rest = ordered[1:]
    if rest:
        k = min(int(max_random), len(rest))
        sampled = random.sample(rest, k=k)
        for c in sampled:
            if c not in out:
                out.append(c)

    return out


API_BASE = "https://castudy.com/api/mcq-search"
API_TYPE = "MBE"

DEFAULT_HEADERS = {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9",
    "referer": "https://castudy.com/",
    # 下面這些其實不是必須，但你給的 curl 有，我也幫你帶上
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
}


# --- Progress bar helpers ---
def _fmt_hms(seconds: float) -> str:
    seconds = max(0, int(seconds))
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h:d}h{m:02d}m{s:02d}s"
    return f"{m:02d}m{s:02d}s"


def _render_progress(i: int, total: int, start_ts: float, label: str = "") -> str:
    total = max(1, int(total))
    i = max(0, min(int(i), total))
    pct = i / total

    width = 28  # progress bar width
    filled = int(round(pct * width))
    bar = "█" * filled + "-" * (width - filled)

    elapsed = time.time() - start_ts
    rate = (elapsed / i) if i > 0 else 0.0
    eta = rate * (total - i) if i > 0 else 0.0

    lbl = f" | {label}" if label else ""
    return f"[{bar}] {pct*100:6.2f}%  ({i}/{total})  elapsed={_fmt_hms(elapsed)}  eta={_fmt_hms(eta)}{lbl}"


def extract_explain_img_urls(explanation_html: Any) -> List[str]:
    """Extract explanation image URLs from the explanation HTML string.

    - Only inspects the `explanation` HTML string (no deep payload scanning).
    - Supports: .png .jpg .jpeg .webp .gif
    - If src starts with /admin-api/infra/ (or admin-api/infra/), prefix with https://getbar.link
    - Keeps absolute http(s) URLs as-is
    - Returns de-duplicated list preserving order
    """

    if not explanation_html or not isinstance(explanation_html, str):
        return []

    IMG_EXT_RE = re.compile(r"\.(png|jpe?g|webp|gif)(?:\?|#|$)", re.IGNORECASE)

    html = unescape(explanation_html)

    # Robust <img ... src=...> parser:
    # - handles src="..." / src='...' / src=unquoted
    img_src_re = re.compile(
        r"<img\b[^>]*?\bsrc\s*=\s*(?:\"([^\"]+)\"|'([^']+)'|([^>\s]+))",
        re.IGNORECASE,
    )

    seen: set[str] = set()
    out_urls: List[str] = []

    for m in img_src_re.finditer(html):
        src = (m.group(1) or m.group(2) or m.group(3) or "").strip()
        if not src:
            continue

        if not IMG_EXT_RE.search(src):
            continue

        normalized = src

        # normalize relative infra paths
        if normalized.startswith("/admin-api/infra/"):
            normalized = "https://getbar.link" + normalized
        elif normalized.startswith("admin-api/infra/"):
            normalized = "https://getbar.link/" + normalized
        elif normalized.startswith("//"):
            normalized = "https:" + normalized

        if normalized not in seen:
            seen.add(normalized)
            out_urls.append(normalized)

    return out_urls


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _guess_img_ext(url: str) -> str:
    # Keep it simple: most are png, but allow jpg/jpeg/webp if ever present.
    low = url.lower()
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        if ext in low:
            return ext
    return ".png"


def _basename_from_url(url: str) -> str:
    try:
        p = urlparse(url)
        base = os.path.basename(p.path)
        if base:
            return base
    except Exception:
        pass
    return "image" + _guess_img_ext(url)

# --- Helper: Ensure unique destination paths for images within a run ---


def _unique_dest_path(imgs_dir: str, basename: str, used: set[str]) -> tuple[str, str]:
    """Return (dest_abs, rel_path) using basename, de-duping collisions.

    If the same basename appears multiple times, append `__2`, `__3`, ... before extension.
    """
    base = basename.strip() or "image" + _guess_img_ext(basename)
    name, ext = os.path.splitext(base)
    ext = ext or _guess_img_ext(base)

    candidate = f"{name}{ext}"
    n = 1
    while candidate in used:
        n += 1
        candidate = f"{name}__{n}{ext}"

    used.add(candidate)
    dest_abs = os.path.join(imgs_dir, candidate)
    rel_path = os.path.join("imgs", candidate)
    return dest_abs, rel_path


# --- New helper: Recursively collect all explain_imgs URLs from any JSON shape ---
def _collect_explain_imgs(obj: Any) -> List[str]:
    """Recursively collect all explain_imgs URLs from any JSON shape."""
    urls: List[str] = []

    def _walk(x: Any) -> None:
        if isinstance(x, dict):
            for k, v in x.items():
                if k == "explain_imgs" and isinstance(v, list):
                    for u in v:
                        if isinstance(u, str) and u.strip():
                            urls.append(u.strip())
                else:
                    _walk(v)
        elif isinstance(x, list):
            for it in x:
                _walk(it)
    _walk(obj)

    # de-dup while preserving order
    seen: set[str] = set()
    out: List[str] = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def download_explain_images_simple(
    json_path: str,
    workers: int = 8,
    timeout: int = 30,
    retries: int = 3,
    debug: bool = False,
) -> str:
    """Download all explain_imgs found anywhere in the JSON.

    - Collects all `explain_imgs` arrays in the JSON (any nesting).
    - Downloads them in parallel into an `imgs/` folder next to the JSON.
    - Writes a lightweight `meta.imageDownload` summary + `meta.explain_img_files` mapping.
    """
    data = load_json(json_path)

    base_dir = os.path.dirname(os.path.abspath(json_path))
    imgs_dir = os.path.join(base_dir, "imgs")
    _ensure_dir(imgs_dir)

    urls = _collect_explain_imgs(data)
    if not urls:
        print("[imgs] No explain_imgs found in JSON; nothing to download.")
        return json_path

    # Build destination paths using URL basename (and de-dupe collisions)
    plan: List[tuple[str, str, str]] = []  # (url, dest_abs, rel_path)
    used_names: set[str] = set()
    for url in urls:
        base = _basename_from_url(url)
        dest_abs, rel_path = _unique_dest_path(imgs_dir, base, used_names)
        plan.append((url, dest_abs, rel_path))

    if debug:
        print(
            f"[imgs][debug] collected={len(urls)} workers={workers} imgs_dir={imgs_dir}")
        print(f"[imgs][debug] sample urls={urls[:3]}")

    errors: List[str] = []
    start_ts = time.time()

    with ThreadPoolExecutor(max_workers=max(1, int(workers))) as ex:
        future_map = {
            ex.submit(_download_one, url, dest_abs, timeout, retries, debug): (url, dest_abs)
            for (url, dest_abs, _rel) in plan
        }

        done = 0
        total = len(future_map)
        for fut in as_completed(future_map):
            url, dest_abs = future_map[fut]
            err = fut.result()
            done += 1
            if err:
                errors.append(f"{url} -> {dest_abs}: {err}")
            if done % 25 == 0 or done == total:
                sys.stdout.write("\r" + _render_progress(done,
                                 total, start_ts, label="imgs"))
                sys.stdout.flush()

    if len(plan) > 0:
        print()  # newline after progress bar

    ok_count = len(plan) - len(errors)
    print(
        f"[imgs] Unique downloads: {len(plan)} | Success: {ok_count} | Failed: {len(errors)}")

    # Write a lightweight mapping for convenience
    mapping = {url: rel for (url, _dest, rel) in plan}

    if isinstance(data, dict):
        data.setdefault("meta", {})
        data["meta"]["explain_img_files"] = mapping
        data["meta"]["imageDownload"] = {
            "unique": len(plan),
            "succeeded": ok_count,
            "failed": len(errors),
            "errors": errors[:200],
            "updatedAt": datetime.now().isoformat(timespec="seconds"),
        }
        save_json(json_path, data)

    return json_path


def _download_one(
    url: str,
    dest_path: str,
    timeout: int,
    retries: int,
    debug: bool = False,
) -> Optional[str]:
    """Download a single image.

    Notes:
    - Uses a fresh requests.Session per call to avoid thread-safety issues.
    - Writes to a .part file then atomically renames.
    - Returns an error string on failure, None on success.
    """
    # Fast path: already downloaded
    try:
        if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0:
            if debug:
                print(f"[imgs][skip] exists: {dest_path}")
            return None
    except Exception:
        # If stat fails, proceed to download
        pass

    last_err: Optional[str] = None

    # Ensure output directory exists
    _ensure_dir(os.path.dirname(dest_path))

    for attempt in range(1, retries + 1):
        try:
            if debug:
                print(f"[imgs][get] attempt {attempt}/{retries}: {url}")

            # New session per download task (safer with ThreadPoolExecutor)
            with requests.Session() as s:
                with s.get(url, headers=DEFAULT_HEADERS, stream=True, timeout=timeout) as r:
                    r.raise_for_status()
                    tmp = dest_path + ".part"
                    wrote_any = False
                    with open(tmp, "wb") as f:
                        for chunk in r.iter_content(chunk_size=1024 * 64):
                            if chunk:
                                f.write(chunk)
                                wrote_any = True

                    if not wrote_any:
                        raise IOError("Empty body (no content written)")

                    os.replace(tmp, dest_path)

            if debug:
                try:
                    print(
                        f"[imgs][ok] {dest_path} ({os.path.getsize(dest_path)} bytes)")
                except Exception:
                    print(f"[imgs][ok] {dest_path}")
            return None

        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            # Clean up partial file if present
            try:
                tmp = dest_path + ".part"
                if os.path.exists(tmp):
                    os.remove(tmp)
            except Exception:
                pass

            if debug:
                print(f"[imgs][err] {url} -> {dest_path}: {last_err}")

            time.sleep(0.8 * attempt)

    return last_err or "Unknown download error"


# --- Helper: Normalize various apiResult shapes into a list of item dicts ---

def _normalize_items_from_api_result(api_res: Any) -> List[Dict[str, Any]]:
    """Normalize various apiResult shapes into a list of item dicts.

    We’ve seen castudy return different shapes depending on endpoint/version:
    - apiResult["data"] is a list of items
    - apiResult["data"] is a dict with key "data" holding a list of items
    - apiResult["data"] is a single item dict
    - apiResult["data"] is non-JSON text (ignored)
    """
    if not isinstance(api_res, dict) or not api_res.get("ok"):
        return []

    payload = api_res.get("data")

    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]

    if isinstance(payload, dict):
        inner = payload.get("data")
        if isinstance(inner, list):
            return [x for x in inner if isinstance(x, dict)]

        # Some responses may already be the item
        if any(k in payload for k in ("qid", "questionStem", "explanation", "explantion")):
            return [payload]

    return []

# Helper: True if apiResult contains at least one question item.


def _has_api_items(api_res: Any) -> bool:
    """True if apiResult contains at least one question item."""
    try:
        return len(_normalize_items_from_api_result(api_res)) > 0
    except Exception:
        return False


def download_explain_images_for_result_json(
    result_json_path: str,
    workers: int = 8,
    timeout: int = 30,
    retries: int = 3,
    debug: bool = False,
) -> str:
    """Download all explain_imgs referenced in a generated chapter JSON.

    - Saves into an `imgs/` directory next to the JSON file.
    - Writes relative file paths back into each API item as `explain_img_files`.
    - Returns the updated JSON path.
    """
    data = load_json(result_json_path)

    base_dir = os.path.dirname(os.path.abspath(result_json_path))
    imgs_dir = os.path.join(base_dir, "imgs")
    _ensure_dir(imgs_dir)
    used_names: set[str] = set()

    tasks = []  # (url, dest_abs, write_back_item_dict)

    # Support multiple input shapes:
    # - Chapter JSON: {"meta":..., "questions":[{"apiResult":...}, ...]}
    # - API response JSON: {"ok":true, "data":[...items...]}
    # - Wrapped API response JSON: {"data": {"ok":true, "data":[...items...]}}
    questions = data.get("questions") if isinstance(data, dict) else None
    if not isinstance(questions, list):
        questions = []

    if debug:
        root_keys = list(data.keys()) if isinstance(
            data, dict) else [type(data).__name__]
        print(f"[imgs][debug] root keys={root_keys}")

    # If this isn't a chapter JSON, synthesize a single 'question' entry from root-level API shapes.
    if not questions and isinstance(data, dict):
        if isinstance(data.get("data"), list):
            questions = [
                {
                    "index": 1,
                    "apiResult": {"ok": True, "data": {"ok": True, "data": data.get("data")}},
                }
            ]
            if debug:
                print(
                    "[imgs][debug] Detected root-level 'data' as list; treating as API items list.")
        elif isinstance(data.get("data"), dict) and isinstance(data.get("data").get("data"), list):
            questions = [
                {
                    "index": 1,
                    "apiResult": {"ok": True, "data": {"ok": True, "data": data.get("data").get("data")}},
                }
            ]
            if debug:
                print(
                    "[imgs][debug] Detected root-level 'data.data' as list; treating as API items list.")

    total_imgs_ref = 0
    scanned_items = 0

    for q in questions:
        api_res = q.get("apiResult") or q.get("api_result")
        items = _normalize_items_from_api_result(api_res)
        if not items:
            continue

        for item in items:
            scanned_items += 1
            if not isinstance(item, dict):
                continue

            qid = (item.get("qid") or f"q{q.get('index', '')}").strip() or "q"
            imgs = item.get("explain_imgs")
            if not isinstance(imgs, list) or not imgs:
                continue

            total_imgs_ref += len(imgs)

            rel_files: List[str] = []
            for j, url in enumerate(imgs, start=1):
                if not isinstance(url, str) or not url.strip():
                    continue

                url = url.strip()
                base = _basename_from_url(url)
                dest_abs, rel_path = _unique_dest_path(
                    imgs_dir, base, used_names)

                rel_files.append(rel_path)
                tasks.append((url, dest_abs, item))

            # write planned relative paths now; downloader will skip existing files.
            item["explain_img_files"] = rel_files

    # De-dup by dest path (same qid/index may appear more than once)
    dedup: Dict[str, str] = {}
    for url, dest_abs, _item in tasks:
        dedup[dest_abs] = url

    if not dedup:
        # Still save JSON (it now may include explain_img_files if any were present)
        save_json(result_json_path, data)

        if debug:
            # Deep-scan for any explain_imgs keys to help diagnose shape mismatches
            def _scan_explain_imgs(obj, path="$"):
                found = []
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        p2 = f"{path}.{k}"
                        if k == "explain_imgs" and isinstance(v, list) and v:
                            found.append((p2, len(v), v[:3]))
                        found.extend(_scan_explain_imgs(v, p2))
                elif isinstance(obj, list):
                    for idx, v in enumerate(obj[:2000]):
                        found.extend(_scan_explain_imgs(v, f"{path}[{idx}]"))
                return found

            hits = _scan_explain_imgs(data)
            if hits:
                print(
                    f"[imgs][debug] Found explain_imgs in JSON, but downloader didn't pick them up. Sample:")
                for p2, n, sample in hits[:8]:
                    print(f"  - {p2}: {n} imgs, sample={sample}")
            else:
                print(
                    "[imgs][debug] No explain_imgs found anywhere in JSON by deep scan.")

            print(
                f"[imgs][debug] questions={len(questions)} scanned_items={scanned_items} referenced={total_imgs_ref}")

        print("[imgs] No explain_imgs found in JSON; nothing to download.")
        return result_json_path

    if debug:
        print(
            f"[imgs][debug] referenced={total_imgs_ref} tasks={len(tasks)} unique={len(dedup)} imgs_dir={imgs_dir}")
        print(
            f"[imgs][debug] questions={len(questions)} scanned_items={scanned_items}")

    errors: List[str] = []
    with ThreadPoolExecutor(max_workers=max(1, int(workers))) as ex:
        future_map = {
            ex.submit(_download_one, url, dest_abs, timeout, retries, debug): (url, dest_abs)
            for dest_abs, url in dedup.items()
        }

        done = 0
        total = len(future_map)
        for fut in as_completed(future_map):
            url, dest_abs = future_map[fut]
            err = fut.result()
            done += 1
            if err:
                errors.append(f"{url} -> {dest_abs}: {err}")
            if done % 25 == 0 or done == total:
                print(f"[imgs] {done}/{total} downloaded")

    # Summary
    ok_count = len(dedup) - len(errors)
    print(
        f"[imgs] Referenced images: {total_imgs_ref} | Unique downloads: {len(dedup)} | Success: {ok_count} | Failed: {len(errors)}")

    if errors:
        data.setdefault("meta", {}).setdefault("imageDownload", {})
        data["meta"]["imageDownload"] = {
            "referenced": total_imgs_ref,
            "unique": len(dedup),
            "succeeded": ok_count,
            "failed": len(errors),
            "errors": errors[:200],
            "updatedAt": datetime.now().isoformat(timespec="seconds"),
        }

    save_json(result_json_path, data)
    return result_json_path


def safe_filename(s: str, max_len: int = 140) -> str:
    s = s.strip()
    s = re.sub(r"[\\/:*?\"<>|]+", "-", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:max_len] if len(s) > max_len else s


def load_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# --- Flashcard (TXT) generation ---

# --- Markdown generation ---

def _md_escape(s: str) -> str:
    """Escape a few characters that can accidentally break markdown formatting."""
    if not s:
        return ""
    # Keep it minimal; we mainly want to avoid accidental headings/lists.
    # Do NOT escape URLs.
    return s.replace("\r\n", "\n").replace("\r", "\n")


def _md_bullet_multiline(text: str, bullet: str = "- ") -> List[str]:
    """Render a markdown bullet where subsequent lines are indented."""
    if not text:
        return []
    lines = text.split("\n")
    out = [f"{bullet}{lines[0]}".rstrip()]
    for ln in lines[1:]:
        if ln.strip() == "":
            # keep paragraph breaks inside the bullet
            out.append("  ")
        else:
            out.append(f"  {ln}".rstrip())
    return out


def _cleanup_empty_hr_sequences(lines: List[str]) -> List[str]:
    """Remove duplicated horizontal rules separated only by blank lines.

    Example to remove:
      ---

      ---
    """
    out: List[str] = []
    i = 0
    n = len(lines)
    while i < n:
        cur = lines[i]
        if cur.strip() == "---":
            j = i + 1
            while j < n and lines[j].strip() == "":
                j += 1
            if j < n and lines[j].strip() == "---":
                # keep first hr, skip blanks + second hr
                out.append("---")
                i = j + 1
                continue
        out.append(cur)
        i += 1
    return out


# --- Helper: Strip leading QID line like 'Q12345' from questionStem ---

_QID_LINE_RE = re.compile(r"^\s*Q\d+\s*$", re.IGNORECASE)


def strip_leading_qid(text: str) -> str:
    """Remove a leading standalone 'Q12345' line (and one following blank line) from a stem."""
    if not text:
        return ""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if lines and _QID_LINE_RE.match(lines[0] or ""):
        lines = lines[1:]
        if lines and lines[0].strip() == "":
            lines = lines[1:]
    return "\n".join(lines).strip()


def _normalize_for_similarity(s: Any, max_len: int = 1800) -> str:
    """Normalize text for similarity comparison.

    Goal: compare the original exported question text with apiResult.questionStem.
    We remove QID lines, HTML, punctuation, and normalize whitespace.
    """
    if s is None:
        return ""
    if not isinstance(s, str):
        s = str(s)

    # Convert small HTML fragments if present
    s = html_to_text(s)

    # Remove leading standalone QID line
    s = strip_leading_qid(s)

    # Replace NBSP and normalize whitespace/control chars
    s = sanitize_query_text(s)

    # Remove most punctuation/symbols; keep alnum + CJK + spaces
    s = _PUNCT_STRIP_RE.sub(" ", s)

    # Collapse whitespace and lowercase
    s = re.sub(r"\s+", " ", s).strip().lower()

    if max_len and len(s) > max_len:
        s = s[:max_len].rstrip()
    return s


def stem_similarity_ratio(original_question: str, api_question_stem: Any) -> float:
    """Return a 0..1 similarity ratio between original question and api questionStem."""
    a = _normalize_for_similarity(original_question)
    b = _normalize_for_similarity(api_question_stem)
    if not a or not b:
        return 0.0
    # SequenceMatcher is robust enough for our use case and fast for these lengths.
    return float(SequenceMatcher(None, a, b).ratio())


def create_markdown_from_result_json(
    result_json_path: str,
    debug: bool = False,
    use_url_images: bool = False,
) -> str:
    """Create a pretty markdown (.md) from an existing *_castudy.json result (no API calls).

    Output MD will be placed next to the JSON with the same base name.
    Format per question:
      ### Subject: Chapter
      #### [index]
      <questionStem>
      ---
      **解析圖**
      <embedded images>

    Notes:
    - Preserves multi-paragraph questions (blank lines kept).
    - Image selection:
        - If use_url_images=True, prefer `explain_imgs` URLs.
        - Otherwise, prefer `explain_img_files` local paths.
    """
    data = load_json(result_json_path)
    if not isinstance(data, dict):
        raise ValueError("Input JSON must be an object")

    meta = data.get("meta") or {}
    subject = (meta.get("subject") or "").strip()
    chapter = (meta.get("chapter") or "").strip()
    exam_name = (meta.get("examName") or meta.get("exam_name") or "").strip()

    header_left = subject or "UnknownSubject"
    header_right = chapter or exam_name or safe_filename(
        os.path.splitext(os.path.basename(result_json_path))[0]
    )

    # Match your preferred header style (### ...: ...)
    top_header = f"### {header_left}: {header_right}"

    questions = data.get("questions")
    if not isinstance(questions, list):
        # Some users may pass a raw API JSON; try to synthesize a questions list
        questions = [{"index": 1, "apiResult": data}]

    md: List[str] = []
    md.append(top_header)
    md.append("")

    missing_api_items: List[str] = []
    blocks: List[List[str]] = []

    for idx, q in enumerate(questions, start=1):
        if not isinstance(q, dict):
            continue

        item = _pick_first_api_item(q)
        if not item:
            # Fallback: keep original English question + choices + explanation HTML->Markdown
            qmd: List[str] = []
            q_label = f"#### {idx}"
            qmd.append(q_label)
            qmd.append("")

            stem = _md_escape((q.get("question") or "").strip())
            if stem:
                qmd.extend(stem.split("\n"))
                qmd.append("")

            for line in _render_source_choices(q.get("choices") or {}):
                qmd.append(_md_escape(line))
                qmd.append("")

            src_ans = _extract_source_correct_answer(q)
            src_img = _extract_source_explanation_image_file(q)
            qmd.append("---")
            if src_ans:
                qmd.append(f"**Correct Answer:** {src_ans}")
                qmd.append("")
                qmd.append("---")
            if src_img:
                qmd.append(f"![](<{src_img}>)")
                qmd.append("")
                qmd.append("---")
            else:
                exp_md = html_to_markdown(_extract_source_explanation_html(q))
                if exp_md:
                    qmd.extend(exp_md.split("\n"))
                    qmd.append("")
                    qmd.append("---")
                else:
                    qmd.append("(no explanation)")
                    qmd.append("")
            qmd.append("")
            blocks.append(qmd)
            if not stem:
                missing_api_items.append(str(q.get("index") or idx))
            continue

        qmd: List[str] = []
        q_label = f"#### {idx}"
        qmd.append(q_label)
        qmd.append("")

        stem = strip_leading_qid(html_to_text(item.get("questionStem") or ""))
        stem = _md_escape(stem)
        if stem:
            qmd.extend(stem.split("\n"))
            qmd.append("")
        # Insert options directly under the stem, no heading
        options = item.get("options")
        cleaned_options, _ = _clean_options_list(options)
        if isinstance(cleaned_options, list) and cleaned_options:
            for opt in cleaned_options:
                # Each option may be a string or dict (option text)
                if isinstance(opt, dict):
                    text = opt.get("text") or ""
                else:
                    text = opt
                text_line = _md_escape(html_to_text(text))
                if text_line:
                    qmd.append(text_line)
                    qmd.append("")  # blank line between options

        qmd.append("---")
        qmd.append("")

        ans = _extract_source_correct_answer(
            q) or _extract_item_correct_answer(item)
        if ans:
            qmd.append(f"**Correct Answer:** {ans}")
            qmd.append("")
            qmd.append("---")
            qmd.append("")

        explain_files: List[str] = []

        # Image source selection:
        # - use_url_images=True  -> prefer explain_imgs (URLs)
        # - use_url_images=False -> prefer explain_img_files (local paths)
        if use_url_images:
            eu = item.get("explain_imgs")
            if isinstance(eu, list) and eu:
                explain_files = [str(x).strip() for x in eu if str(x).strip()]
            else:
                ef = item.get("explain_img_files")
                if isinstance(ef, list) and ef:
                    explain_files = [str(x).strip()
                                     for x in ef if str(x).strip()]
        else:
            ef = item.get("explain_img_files")
            if isinstance(ef, list) and ef:
                explain_files = [str(x).strip() for x in ef if str(x).strip()]
            else:
                eu = item.get("explain_imgs")
                if isinstance(eu, list) and eu:
                    explain_files = [str(x).strip()
                                     for x in eu if str(x).strip()]

        if explain_files:
            for pth in explain_files:
                # Embed as image; wrap in <> to protect special chars in URLs/paths
                qmd.append(f"![](<{pth}>)")
            qmd.append("")
            qmd.append("---")
            qmd.append("")
        else:
            qmd.append("(none)")
            qmd.append("")

        blocks.append(qmd)

    if missing_api_items and debug:
        print(
            f"[markdown][debug] missing api items for indices: {missing_api_items[:30]}")

    # Join question blocks with a horizontal rule between questions
    for bi, block in enumerate(blocks):
        if bi > 0:
            md.append("---")
            md.append("")
        md.extend(block)

    md = _cleanup_empty_hr_sequences(md)

    out_md = os.path.splitext(result_json_path)[0] + ".md"
    with open(out_md, "w", encoding="utf-8") as f:
        f.write("\n".join(md).rstrip() + "\n")

    print(f"[markdown] wrote: {out_md}")
    return out_md


_BR_RE = re.compile(r"<\s*br\s*/?\s*>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


def html_to_text(html: Any) -> str:
    """Best-effort convert small HTML fragments to readable plain text."""
    if html is None:
        return ""
    if not isinstance(html, str):
        html = str(html)

    s = unescape(html)
    s = _BR_RE.sub("\n", s)
    # Keep paragraph-ish spacing
    s = s.replace("</p>", "\n").replace("</div>", "\n").replace("</tr>", "\n")
    s = _TAG_RE.sub("", s)
    # Normalize whitespace
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"\n{3,}", "\n\n", s)
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def _escape_md_table_cell(s: str) -> str:
    if not s:
        return ""
    s = s.replace("\n", "<br>").replace("|", "\\|")
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s


class _HTMLToMarkdownParser(HTMLParser):
    """Lightweight HTML -> Markdown parser focused on explanations."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: List[str] = []

        # list stack: [{"type":"ul"|"ol", "idx":int}]
        self.list_stack: List[Dict[str, Any]] = []

        # table states
        self.in_table = False
        self.table_rows: List[List[str]] = []
        self.table_header_flags: List[bool] = []
        self.cur_row: Optional[List[str]] = None
        self.cur_row_has_th: bool = False
        self.in_cell = False
        self.cur_cell_parts: List[str] = []

    def _write(self, s: str) -> None:
        if not s:
            return
        if self.in_cell:
            self.cur_cell_parts.append(s)
        else:
            self.out.append(s)

    def _attrs(self, attrs: List[tuple[str, Optional[str]]]) -> Dict[str, str]:
        d: Dict[str, str] = {}
        for k, v in attrs:
            if k:
                d[k.lower()] = (v or "")
        return d

    def handle_starttag(self, tag: str, attrs: List[tuple[str, Optional[str]]]) -> None:
        t = (tag or "").lower()
        a = self._attrs(attrs)
        cls = a.get("class", "")

        # Skip explanation tab nav chrome
        if t == "ul" and "nav" in cls and "nav-tabs" in cls:
            self._write("\n")
            return

        if t in ("strong", "b"):
            self._write("**")
            return
        if t in ("em", "i"):
            self._write("*")
            return
        if t == "br":
            self._write("\n")
            return

        if t in ("ul", "ol"):
            self.list_stack.append({"type": t, "idx": 1})
            self._write("\n")
            return

        if t == "li":
            depth = max(1, len(self.list_stack))
            top = self.list_stack[-1] if self.list_stack else {
                "type": "ul", "idx": 1}
            indent = "  " * (depth - 1)
            if top.get("type") == "ol":
                bullet = f"{int(top.get('idx', 1))}. "
                top["idx"] = int(top.get("idx", 1)) + 1
            else:
                bullet = "- "
            self._write(f"\n{indent}{bullet}")
            return

        if t in ("p", "div", "section", "article"):
            self._write("\n\n")
            return

        if t == "table":
            self.in_table = True
            self.table_rows = []
            self.table_header_flags = []
            self.cur_row = None
            self.cur_row_has_th = False
            self._write("\n\n")
            return

        if t == "tr" and self.in_table:
            self.cur_row = []
            self.cur_row_has_th = False
            return

        if t in ("th", "td") and self.in_table and self.cur_row is not None:
            self.in_cell = True
            self.cur_cell_parts = []
            if t == "th":
                self.cur_row_has_th = True
            return

    def handle_endtag(self, tag: str) -> None:
        t = (tag or "").lower()

        if t in ("strong", "b"):
            self._write("**")
            return
        if t in ("em", "i"):
            self._write("*")
            return

        if t == "li":
            self._write("\n")
            return

        if t in ("ul", "ol"):
            if self.list_stack:
                self.list_stack.pop()
            self._write("\n")
            return

        if t in ("p", "div", "section", "article"):
            self._write("\n\n")
            return

        if t in ("th", "td") and self.in_table and self.in_cell and self.cur_row is not None:
            cell = "".join(self.cur_cell_parts)
            cell = re.sub(r"\s+", " ", cell).strip()
            self.cur_row.append(cell)
            self.cur_cell_parts = []
            self.in_cell = False
            return

        if t == "tr" and self.in_table and self.cur_row is not None:
            self.table_rows.append(self.cur_row)
            self.table_header_flags.append(self.cur_row_has_th)
            self.cur_row = None
            self.cur_row_has_th = False
            return

        if t == "table" and self.in_table:
            self._write(self._render_table())
            self._write("\n\n")
            self.in_table = False
            self.table_rows = []
            self.table_header_flags = []
            self.cur_row = None
            self.cur_row_has_th = False
            self.in_cell = False
            self.cur_cell_parts = []
            return

    def handle_data(self, data: str) -> None:
        if not data:
            return
        txt = data.replace("\u00a0", " ")
        self._write(txt)

    def _render_table(self) -> str:
        rows = [r for r in self.table_rows if isinstance(
            r, list) and any(c.strip() for c in r)]
        if not rows:
            return ""
        col_count = max(len(r) for r in rows)
        norm = [r + [""] * (col_count - len(r)) for r in rows]
        header = norm[0]
        body = norm[1:]
        header_line = "| " + " | ".join(_escape_md_table_cell(c)
                                        for c in header) + " |"
        sep_line = "| " + " | ".join(["---"] * col_count) + " |"
        lines = [header_line, sep_line]
        for r in body:
            lines.append("| " + " | ".join(_escape_md_table_cell(c)
                         for c in r) + " |")
        return "\n".join(lines)

    def markdown(self) -> str:
        s = "".join(self.out)
        s = re.sub(r"\bUser\s*Id\s*:\s*\d+\b", "", s, flags=re.IGNORECASE)
        s = re.sub(r"[ \t]+\n", "\n", s)
        s = re.sub(r"[ \t]{2,}", " ", s)
        # markdownlint MD035: normalize any asterisk-only hr lines to `---`
        s = re.sub(r"(?m)^[ \t]*\*{3,}[ \t]*$", "---", s)
        s = re.sub(r"\n{3,}", "\n\n", s)
        return s.strip()


def html_to_markdown(html: Any) -> str:
    """Best-effort HTML -> Markdown conversion for explanation fallback output."""
    if html is None:
        return ""
    if not isinstance(html, str):
        html = str(html)

    s = unescape(html)
    # Some payloads contain escaped quotes from serialized HTML snippets.
    s = s.replace('\\"', '"')
    s = s.replace("\r\n", "\n").replace("\r", "\n")

    # Remove comments/scripts/styles
    s = re.sub(r"<!--.*?-->", "", s, flags=re.DOTALL)
    s = re.sub(
        r"<\s*(script|style)\b[^>]*>.*?<\s*/\s*\1\s*>",
        "",
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # Remove explanation tab header/nav chrome
    s = re.sub(
        r"<ul\b[^>]*id\s*=\s*['\"]explanation-tabs['\"][^>]*>.*?</ul>",
        "",
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # Remove hidden metadata block containing "Explanation:" / "User Id:"
    s = re.sub(
        r"<div\b[^>]*style\s*=\s*['\"][^'\"]*visibility\s*:\s*hidden[^'\"]*['\"][^>]*>.*?</div>",
        "",
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )
    s = re.sub(r"\bExplanation\s*:\s*", "", s, flags=re.IGNORECASE)

    parser = _HTMLToMarkdownParser()
    parser.feed(s)
    parser.close()
    return parser.markdown()


def _extract_source_explanation_html(q: Dict[str, Any]) -> str:
    for k in ("sourceExplanationHtml", "originalExplanationHtml", "explanationHtml"):
        v = q.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _extract_source_correct_answer(q: Dict[str, Any]) -> str:
    for k in ("sourceCorrectAnswer", "originalCorrectAnswer", "correctAnswer"):
        v = q.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip().upper()
    return ""


def _extract_item_correct_answer(item: Any) -> str:
    if not isinstance(item, dict):
        return ""
    for k in ("correctAnswer", "correct_answer", "answer", "correctOption", "correct_option"):
        v = item.get(k)
        if isinstance(v, str) and v.strip():
            m = re.search(r"\b([A-F])\b", v.strip().upper())
            return m.group(1) if m else v.strip().upper()
    return ""


def _extract_source_explanation_image_file(q: Dict[str, Any]) -> str:
    for k in (
        "sourceExplanationImageFile",
        "originalExplanationImageFile",
        "explanationImageFile",
    ):
        v = q.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _render_source_choices(choices: Any) -> List[str]:
    if not isinstance(choices, dict):
        return []
    out: List[str] = []
    for letter in ("A", "B", "C", "D", "E", "F"):
        v = choices.get(letter)
        if not isinstance(v, str):
            v = choices.get(letter.lower())
        if isinstance(v, str) and v.strip():
            out.append(f"{letter}. {v.strip()}")
    return out


# --- Options cleanup (castudy bug workaround) ---
_BAD_OPTION_STRINGS = {"不会", "不會"}


def _clean_options_list(opts: Any) -> tuple[Any, int]:
    """Remove stray option strings like '不会' from an options list.

    Returns (cleaned_opts, removed_count). If input isn't a list, returns it unchanged.
    """
    if not isinstance(opts, list):
        return opts, 0

    cleaned: List[Any] = []
    removed = 0

    for o in opts:
        if isinstance(o, str):
            if o.strip() in _BAD_OPTION_STRINGS:
                removed += 1
                continue
            if not o.strip():
                removed += 1
                continue
        cleaned.append(o)

    return cleaned, removed


def _clean_options_in_item(item: Any) -> int:
    """Clean options for a single API item dict. Returns removed_count."""
    if not isinstance(item, dict):
        return 0
    if "options" not in item:
        return 0

    cleaned, removed = _clean_options_list(item.get("options"))
    item["options"] = cleaned
    return removed


def fix_options_in_json_in_place(json_path: str, debug: bool = False) -> int:
    """Recursively remove stray '不会' items from any `options` lists inside a JSON file.

    Returns total removed count.
    """
    data = load_json(json_path)

    removed_total = 0

    def _walk(x: Any) -> None:
        nonlocal removed_total
        if isinstance(x, dict):
            # clean if this dict has options
            if "options" in x:
                cleaned, removed = _clean_options_list(x.get("options"))
                if removed:
                    x["options"] = cleaned
                    removed_total += removed
                    if debug:
                        qid = x.get("qid")
                        print(f"[fix-options] removed={removed} qid={qid}")
            for v in x.values():
                _walk(v)
        elif isinstance(x, list):
            for it in x:
                _walk(it)

    _walk(data)

    if removed_total:
        save_json(json_path, data)

    return removed_total


def _pick_first_api_item(q_entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return the first normalized API item (best match) for a question entry.

    Excludes mismatched results: if apiResult has `_match_ok` explicitly set to False,
    treat this entry as having no usable API items so downstream outputs (flashcards/markdown)
    will skip it.
    """
    api_res = q_entry.get("apiResult") or q_entry.get("api_result")

    # If we recorded a match decision and it failed, do not emit any item.
    if isinstance(api_res, dict) and api_res.get("_match_ok") is False:
        return None

    items = _normalize_items_from_api_result(api_res)
    return items[0] if items else None


def _select_best_api_item(original_question: str, api_res: Any) -> tuple[Optional[Dict[str, Any]], float]:
    """Pick the best matching item (highest similarity) from an apiResult.

    Returns (best_item, best_score). If no items are present, returns (None, 0.0).
    """
    items = _normalize_items_from_api_result(api_res)
    if not items:
        return None, 0.0

    best_item: Optional[Dict[str, Any]] = None
    best_score: float = 0.0

    for it in items:
        if not isinstance(it, dict):
            continue
        score = stem_similarity_ratio(
            original_question, it.get("questionStem") or "")
        if score > best_score:
            best_score = score
            best_item = it

    return best_item, float(best_score)


def _shrink_api_result_to_single_item(api_res: Any, best_item: Dict[str, Any]) -> Any:
    """Mutate api_res in-place (when possible) to keep only the best matching item."""
    if not isinstance(api_res, dict):
        return api_res

    payload = api_res.get("data")

    # payload is already a list of items
    if isinstance(payload, list):
        api_res["data"] = [best_item]
        return api_res

    # payload is a dict with inner list
    if isinstance(payload, dict):
        inner = payload.get("data")
        if isinstance(inner, list):
            payload["data"] = [best_item]
            return api_res

        # payload itself looks like an item
        if any(k in payload for k in ("qid", "questionStem", "explanation", "explantion")):
            api_res["data"] = best_item
            return api_res

    return api_res


def create_flashcards_from_result_json(
    result_json_path: str,
    debug: bool = False,
) -> str:
    """Create a flashcards TXT from an existing *_castudy.json result (no API calls).

    Output TXT will be placed next to the JSON with the same base name.
    Format per question:
      ### Subject: Chapter
      <questionStem>
      ---
      解析圖
      <explain_img_files (preferred) or explain_imgs>
    """
    data = load_json(result_json_path)
    if not isinstance(data, dict):
        raise ValueError("Input JSON must be an object")

    meta = data.get("meta") or {}
    subject = (meta.get("subject") or "").strip()
    chapter = (meta.get("chapter") or "").strip()
    exam_name = (meta.get("examName") or meta.get("exam_name") or "").strip()

    header_left = subject or "UnknownSubject"
    header_right = chapter or exam_name or safe_filename(
        os.path.splitext(os.path.basename(result_json_path))[0])
    header = f"### {header_left}: {header_right}"

    questions = data.get("questions")
    if not isinstance(questions, list):
        # Some users may pass a raw API JSON; try to synthesize a questions list
        questions = [{"index": 1, "apiResult": data}]

    lines: List[str] = []
    lines.append(header)
    lines.append("")

    missing_api_items: List[str] = []

    for idx, q in enumerate(questions, start=1):
        if not isinstance(q, dict):
            continue

        item = _pick_first_api_item(q)
        if not item:
            # Fallback: if this is a question-bank JSON without API, try its own text
            qtext = (q.get("question") or "").strip()
            if qtext:
                lines.append(f"[{idx}]")
                lines.append(qtext)
                for c in _render_source_choices(q.get("choices") or {}):
                    lines.append(c)
                src_ans = _extract_source_correct_answer(q)
                if src_ans:
                    lines.append(f"Correct Answer: {src_ans}")
                lines.append("---")
                src_img = _extract_source_explanation_image_file(q)
                if src_img:
                    lines.append(src_img)
                else:
                    exp_md = html_to_markdown(
                        _extract_source_explanation_html(q))
                    if exp_md:
                        lines.extend(exp_md.split("\n"))
                    else:
                        lines.append("(no explanation)")
                lines.append("")
            else:
                missing_api_items.append(str(q.get("index") or idx))
            continue

        stem = strip_leading_qid(html_to_text(item.get("questionStem") or ""))

        explain_files: List[str] = []
        ef = item.get("explain_img_files")
        if isinstance(ef, list) and ef:
            explain_files = [str(x).strip() for x in ef if str(x).strip()]
        else:
            # fallback to URLs if files not present
            eu = item.get("explain_imgs")
            if isinstance(eu, list) and eu:
                explain_files = [str(x).strip() for x in eu if str(x).strip()]

        # Render block
        label = f"[{idx}]"
        lines.append(label)
        if stem:
            lines.append(stem)
        # Insert options directly under the stem, no heading
        options = item.get("options")
        cleaned_options, _ = _clean_options_list(options)
        if isinstance(cleaned_options, list) and cleaned_options:
            for opt in cleaned_options:
                # Each option may be a string or dict (option text)
                if isinstance(opt, dict):
                    text = opt.get("text") or ""
                else:
                    text = opt
                text_line = html_to_text(text)
                if text_line:
                    lines.append(text_line)
        lines.append("---")
        if explain_files:
            lines.extend(explain_files)
        else:
            lines.append("(none)")
        lines.append("")

    if missing_api_items and debug:
        print(
            f"[flashcards][debug] missing api items for indices: {missing_api_items[:30]}")

    out_txt = os.path.splitext(result_json_path)[0] + ".flashcards.txt"
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip() + "\n")

    print(f"[flashcards] wrote: {out_txt}")
    return out_txt


def call_api(question_text: str, session: requests.Session, timeout: int) -> Dict[str, Any]:
    # q 參數：用 URL encode（跟你之前 %20 那種一致）
    cleaned = sanitize_query_text(question_text)
    q = quote(cleaned, safe="")
    url = f"{API_BASE}?q={q}&type={API_TYPE}"

    r = session.get(url, headers=DEFAULT_HEADERS, timeout=timeout)
    r.raise_for_status()

    # 盡量用 json()，若回傳不是 JSON 就保留 text
    try:
        return {"ok": True, "status": r.status_code, "data": r.json(), "url": url, "_q_len": len(cleaned)}
    except Exception:
        return {
            "ok": True,
            "status": r.status_code,
            "data": r.text,
            "url": url,
            "_q_len": len(cleaned),
        }


def process_file(
    input_path: str,
    out_dir: str,
    sleep_sec: float,
    timeout: int,
    max_retries: int,
    retry_backoff_sec: float,
    debug: bool,
) -> str:
    src = load_json(input_path)

    meta = src.get("meta", {}) or {}
    questions = src.get("questions", []) or []

    subject = meta.get("subject") or ""
    chapter = meta.get("chapter") or ""
    exam_name = meta.get("examName") or meta.get("exam_name") or ""

    # 你要「分 chapter 的 json」：這裡用 meta.chapter 來決定輸出
    # 沒有 chapter 的話就 fallback exam_name / input 檔名
    today = datetime.now().strftime("%Y-%m-%d")
    subject_safe = safe_filename(subject) if subject else "UnknownSubject"
    chapter_safe = safe_filename(chapter) if chapter else safe_filename(
        exam_name) or safe_filename(os.path.splitext(os.path.basename(input_path))[0])

    out_subdir = os.path.join(out_dir, subject_safe, chapter_safe)
    out_path = os.path.join(out_subdir, f"{chapter_safe}_{today}_castudy.json")
    source_img_out_dir = os.path.join(out_subdir, "source_imgs")
    source_json_dir = os.path.dirname(os.path.abspath(input_path))
    os.makedirs(source_img_out_dir, exist_ok=True)

    result: Dict[str, Any] = {
        "meta": {
            "sourceInput": os.path.abspath(input_path),
            "subject": subject,
            "chapter": chapter,
            "examName": exam_name,
            "generatedAt": datetime.now().isoformat(timespec="seconds"),
            "api": {
                "base": API_BASE,
                "type": API_TYPE,
            },
            "count": len(questions),
        },
        "questions": [],
    }

    session = requests.Session()
    failed: List[Dict[str, Any]] = []

    start_ts = time.time()

    def dlog(msg: str) -> None:
        if debug:
            print(msg)

    def copy_source_explanation_image(qobj: Dict[str, Any], idx: int) -> str:
        rel = (qobj.get("explanationImageFile") or "").strip()
        if not rel:
            return ""
        src_abs = os.path.join(source_json_dir, rel)
        if not os.path.exists(src_abs):
            return ""
        ext = os.path.splitext(src_abs)[1].lower() or ".png"
        out_name = f"q{int(qobj.get('index', idx)):04d}{ext}"
        dst_abs = os.path.join(source_img_out_dir, out_name)
        try:
            shutil.copy2(src_abs, dst_abs)
            return os.path.join("source_imgs", out_name)
        except Exception:
            return ""

    for i, qobj in enumerate(questions, start=1):
        qtext = (qobj.get("question") or "").strip()
        if not qtext:
            result["questions"].append(
                {
                    "index": qobj.get("index", i),
                    "question": "",
                    "choices": qobj.get("choices", {}),
                    "apiResult": {"ok": False, "error": "Empty question text"},
                }
            )
            continue

        last_err: Optional[str] = None
        api_res: Optional[Dict[str, Any]] = None

        for attempt in range(1, max_retries + 1):
            try:
                api_res = call_api(qtext, session=session, timeout=timeout)
                last_err = None
                break
            except requests.HTTPError as e:
                last_err = f"HTTPError: {e} (status={getattr(e.response, 'status_code', None)})"
            except requests.RequestException as e:
                last_err = f"RequestException: {e}"
            except Exception as e:
                last_err = f"UnexpectedError: {e}"

            # retry backoff
            time.sleep(retry_backoff_sec * attempt)

        if api_res is None:
            # If the full-question query keeps failing, try fallbacks:
            # 1) first sentence (simplified)
            # 2) random other sentence(s) (up to 3)
            fallback_queries = build_fallback_queries(qtext, max_random=3)
            if debug and fallback_queries:
                dlog(
                    f"[debug] q{i}: primary query failed; trying fallbacks (n={len(fallback_queries)})")

            for k, fq in enumerate(fallback_queries, start=1):
                if not fq:
                    continue
                try:
                    if debug:
                        dlog(
                            f"[debug] q{i}: fallback {k}/{len(fallback_queries)} query={fq!r}")
                    api_res = call_api(fq, session=session, timeout=timeout)
                    if debug:
                        payload = api_res.get("data") if isinstance(
                            api_res, dict) else None
                        dlog(
                            f"[debug] q{i}: fallback {k} got data type={type(payload).__name__}")
                    # If this fallback returns items, accept it.
                    if _has_api_items(api_res):
                        if debug:
                            dlog(f"[debug] q{i}: fallback {k} succeeded")
                        last_err = None
                        break
                except Exception as e:
                    if debug:
                        dlog(
                            f"[debug] q{i}: fallback {k} failed: {type(e).__name__}: {e}")
                    continue

            if api_res is None:
                api_res = {"ok": False, "error": last_err or "Unknown error"}

        # Extract explanation images from API payload and store into each item["explain_imgs"].
        items = _normalize_items_from_api_result(api_res)

        # Fix castudy bug: options sometimes contains a stray "不会" element
        removed_opts = 0
        for _it in items:
            removed_opts += _clean_options_in_item(_it)
        if debug and removed_opts:
            dlog(f"[debug] q{i}: removed bad options count={removed_opts}")

        # Debug payload shape
        if debug:
            payload = api_res.get("data") if isinstance(
                api_res, dict) else None
            dlog(
                f"[debug] q{i}: apiResult.data type={type(payload).__name__}, items={len(items)}")
            if items:
                dlog(
                    f"[debug] q{i}: first item keys={sorted(list(items[0].keys()))[:20]}")

        # Extract and attach explain_imgs
        for item_idx, item in enumerate(items, start=1):
            try:
                explanation_html = item.get(
                    "explanation") or item.get("explantion") or ""
                urls = extract_explain_img_urls(explanation_html)
                item["explain_imgs"] = urls
                if debug and item_idx == 1:
                    dlog(f"[debug] q{i}: extracted explain_imgs={len(urls)}")
                    if urls[:3]:
                        dlog(f"[debug] q{i}: sample urls={urls[:3]}")
            except Exception as e:
                item["explain_imgs"] = []
                if debug:
                    dlog(
                        f"[debug] q{i}: extract_explain_img_urls error: {type(e).__name__}: {e}")

        # Similarity check: ensure apiResult.questionStem matches original question with >= 70% similarity
                # Similarity check: pick the best matching returned item by questionStem similarity.
        best_item, best_score = _select_best_api_item(qtext, api_res)
        match_score = float(best_score)
        match_ok = match_score >= 0.70

        # Store match info for downstream tooling/debug
        try:
            if isinstance(api_res, dict):
                api_res["_match_score"] = round(match_score, 4)
                api_res["_match_ok"] = bool(match_ok)
        except Exception:
            pass

        # If mismatch (<0.70), do NOT keep returned data; treat as failure.
        # If match OK, keep ONLY the best matching item.
        if not match_ok:
            if isinstance(api_res, dict):
                api_res = {
                    "ok": False,
                    "error": "stem-mismatch",
                    "_match_score": round(match_score, 4),
                    "_match_ok": False,
                    "url": api_res.get("url", ""),
                    "status": api_res.get("status", None),
                }
            items = []
        else:
            if best_item is not None:
                api_res = _shrink_api_result_to_single_item(api_res, best_item)
                items = [best_item]

        hit = _has_api_items(api_res)
        # Treat as failure if no items OR questionStem mismatch (< 90%)
        is_failure = (not hit) or (hit and not match_ok)

        if is_failure:
            qid_for_log = qobj.get("qid") or qobj.get(
                "id") or f"index={qobj.get('index', i)}"
            preview = qtext.replace("\n", " ").strip()[:120]
            reason = "empty-data"
            err_msg = ""

            # Updated block for stem-mismatch and request-failed
            if (not match_ok) and (match_score > 0):
                reason = "stem-mismatch"
            elif isinstance(api_res, dict) and not api_res.get("ok"):
                reason = "request-failed"
                err_msg = str(api_res.get("error") or "")

            print(
                f"[WARN] Castudy fetch failed for {qid_for_log} ({reason}): {preview!r}")
            if reason == "stem-mismatch":
                print(f"       match_score={match_score:.4f} (< 0.70)")
            if err_msg:
                print(f"       error: {err_msg}")

            failed.append(
                {
                    "index": qobj.get("index", i),
                    "qid": qobj.get("qid") or qobj.get("id") or "",
                    "question": qtext,
                    "reason": reason,
                    "match_score": round(match_score, 4),
                    "error": err_msg,
                    "url": api_res.get("url") if isinstance(api_res, dict) else "",
                }
            )

        result["questions"].append(
            {
                "index": qobj.get("index", i),
                "question": qtext,
                "choices": qobj.get("choices", {}),
                "sourceCorrectAnswer": (qobj.get("correctAnswer") or "").strip() if isinstance(qobj.get("correctAnswer"), str) else "",
                "sourceExplanationHtml": (qobj.get("explanationHtml") or "").strip() if isinstance(qobj.get("explanationHtml"), str) else "",
                "sourceExplanationImageFile": copy_source_explanation_image(qobj, i),
                "apiResult": api_res,
                "apiMatchScore": round(match_score, 4),
                "apiMatchOk": bool(match_ok),
            }
        )

        # polite delay，避免打爆人家
        if sleep_sec > 0 and i < len(questions):
            time.sleep(sleep_sec)

        # Live progress bar
        qid_for_label = str(qobj.get("qid") or qobj.get(
            "id") or qobj.get("index", i) or i).strip()
        sys.stdout.write("\r" + _render_progress(i, len(questions),
                         start_ts, label=f"qid={qid_for_label}"))
        sys.stdout.flush()

        # Print a newline when finished to keep the terminal tidy
        if i == len(questions):
            print()

    # Persist failure list for easy re-run
    result.setdefault("meta", {})
    result["meta"]["failed"] = failed
    result["meta"]["failedCount"] = len(failed)

    failed_path = os.path.splitext(out_path)[0] + ".failed.json"
    try:
        save_json(
            failed_path,
            {
                "meta": {
                    "sourceResult": os.path.abspath(out_path),
                    "generatedAt": datetime.now().isoformat(timespec="seconds"),
                    "failedCount": len(failed),
                },
                "failed": failed,
            },
        )
        if debug:
            print(
                f"[debug] wrote failed list: {failed_path} (count={len(failed)})")
    except Exception as e:
        if debug:
            print(
                f"[debug] failed to write sidecar failed list: {type(e).__name__}: {e}")

    save_json(out_path, result)
    return out_path


# New function: retry only failed questions and update JSON in-place
def retry_failed_in_place(
    result_json_path: str,
    sleep_sec: float,
    timeout: int,
    max_retries: int,
    retry_backoff_sec: float,
    debug: bool,
) -> str:
    """Re-run only failed questions in an existing result JSON and update it in-place."""
    data = load_json(result_json_path)
    if not isinstance(data, dict):
        raise ValueError("Result JSON must be an object")

    questions = data.get("questions")
    meta = data.get("meta") or {}
    failed = meta.get("failed") or []

    if not isinstance(questions, list):
        print("[retry] No 'questions' list found; nothing to do.")
        return result_json_path

    if not isinstance(failed, list) or not failed:
        print("[retry] No failures recorded in meta.failed; nothing to retry.")
        return result_json_path

    # Build quick index -> question entry map
    idx_map: Dict[int, Dict[str, Any]] = {}
    for q in questions:
        try:
            idx = int(q.get("index"))
            idx_map[idx] = q
        except Exception:
            continue

    session = requests.Session()
    start_ts = time.time()

    new_failed: List[Dict[str, Any]] = []
    retried = 0
    fixed = 0

    def dlog(msg: str) -> None:
        if debug:
            print(msg)

    total = len(failed)
    for j, f in enumerate(failed, start=1):
        retried += 1
        idx = f.get("index")
        try:
            idx_int = int(idx)
        except Exception:
            idx_int = None

        entry = idx_map.get(idx_int) if idx_int is not None else None
        qtext = ""
        if isinstance(entry, dict):
            qtext = (entry.get("question") or "").strip()
        if not qtext:
            qtext = (f.get("question") or "").strip()

        if not qtext:
            f2 = dict(f)
            f2["reason"] = "missing-question-text"
            new_failed.append(f2)
            continue

        last_err: Optional[str] = None
        api_res: Optional[Dict[str, Any]] = None

        for attempt in range(1, max_retries + 1):
            try:
                api_res = call_api(qtext, session=session, timeout=timeout)
                last_err = None
                break
            except requests.HTTPError as e:
                last_err = f"HTTPError: {e} (status={getattr(e.response, 'status_code', None)})"
            except requests.RequestException as e:
                last_err = f"RequestException: {e}"
            except Exception as e:
                last_err = f"UnexpectedError: {e}"

            time.sleep(retry_backoff_sec * attempt)

        if api_res is None:
            fallback_queries = build_fallback_queries(qtext, max_random=3)
            if debug and fallback_queries:
                dlog(
                    f"[debug][retry] idx={idx_int}: primary query failed; trying fallbacks (n={len(fallback_queries)})")

            for k, fq in enumerate(fallback_queries, start=1):
                if not fq:
                    continue
                try:
                    if debug:
                        dlog(
                            f"[debug][retry] idx={idx_int}: fallback {k}/{len(fallback_queries)} query={fq!r}")
                    api_res = call_api(fq, session=session, timeout=timeout)
                    if _has_api_items(api_res):
                        if debug:
                            dlog(
                                f"[debug][retry] idx={idx_int}: fallback {k} succeeded")
                        last_err = None
                        break
                except Exception as e:
                    if debug:
                        dlog(
                            f"[debug][retry] idx={idx_int}: fallback {k} failed: {type(e).__name__}: {e}")
                    continue

            if api_res is None:
                api_res = {"ok": False, "error": last_err or "Unknown error"}

        # attach explain_imgs for any returned items
        items = _normalize_items_from_api_result(api_res)

        # Fix castudy bug: options sometimes contains a stray "不会" element
        removed_opts = 0
        for _it in items:
            removed_opts += _clean_options_in_item(_it)
        if debug and removed_opts:
            dlog(
                f"[debug][retry] idx={idx_int}: removed bad options count={removed_opts}")

        for item in items:
            try:
                explanation_html = item.get(
                    "explanation") or item.get("explantion") or ""
                item["explain_imgs"] = extract_explain_img_urls(
                    explanation_html)
            except Exception:
                item["explain_imgs"] = []

        # Similarity check: ensure apiResult.questionStem matches original question with >= 70% similarity
                # Similarity check: pick the best matching returned item by questionStem similarity.
        best_item, best_score = _select_best_api_item(qtext, api_res)
        match_score = float(best_score)
        match_ok = match_score >= 0.70

        # Store match info for downstream tooling/debug
        try:
            if isinstance(api_res, dict):
                api_res["_match_score"] = round(match_score, 4)
                api_res["_match_ok"] = bool(match_ok)
        except Exception:
            pass

        # If mismatch (<0.70), do NOT keep returned data; treat as failure.
        # If match OK, keep ONLY the best matching item.
        if not match_ok:
            if isinstance(api_res, dict):
                api_res = {
                    "ok": False,
                    "error": "stem-mismatch",
                    "_match_score": round(match_score, 4),
                    "_match_ok": False,
                    "url": api_res.get("url", ""),
                    "status": api_res.get("status", None),
                }
            items = []
        else:
            if best_item is not None:
                api_res = _shrink_api_result_to_single_item(api_res, best_item)
                items = [best_item]

        hit = _has_api_items(api_res)
        # Treat as failure if no items OR questionStem mismatch (< 90%)
        is_failure = (not hit) or (hit and not match_ok)

        if (not is_failure) and isinstance(entry, dict):
            entry["apiResult"] = api_res
            entry["apiMatchScore"] = round(match_score, 4)
            entry["apiMatchOk"] = bool(match_ok)
            fixed += 1
        else:
            # Update entry with whatever we got (so you can inspect later), but keep it in failed list.
            if isinstance(entry, dict):
                entry["apiResult"] = api_res
                entry["apiMatchScore"] = round(match_score, 4)
                entry["apiMatchOk"] = bool(match_ok)

            f2 = dict(f)
            if hit and not match_ok:
                f2["reason"] = "stem-mismatch"
            else:
                f2["reason"] = "empty-data" if (isinstance(
                    api_res, dict) and api_res.get("ok")) else "request-failed"
            f2["match_score"] = round(match_score, 4)
            f2["error"] = str(api_res.get("error") or last_err or "") if isinstance(
                api_res, dict) else (last_err or "")
            f2["url"] = api_res.get("url") if isinstance(api_res, dict) else ""
            new_failed.append(f2)

        # polite delay
        if sleep_sec > 0 and j < total:
            time.sleep(sleep_sec)

        # progress
        qid_label = str(f.get("qid") or f.get("index") or "")
        sys.stdout.write("\r" + _render_progress(j, total,
                         start_ts, label=f"retry={qid_label}"))
        sys.stdout.flush()
        if j == total:
            print()

    # update meta + write sidecar
    data.setdefault("meta", {})
    data["meta"]["failed"] = new_failed
    data["meta"]["failedCount"] = len(new_failed)
    data["meta"]["retrySummary"] = {
        "retried": retried,
        "fixed": fixed,
        "stillFailed": len(new_failed),
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
    }

    save_json(result_json_path, data)

    failed_path = os.path.splitext(result_json_path)[0] + ".failed.json"
    try:
        save_json(
            failed_path,
            {
                "meta": {
                    "sourceResult": os.path.abspath(result_json_path),
                    "generatedAt": datetime.now().isoformat(timespec="seconds"),
                    "failedCount": len(new_failed),
                },
                "failed": new_failed,
            },
        )
        if debug:
            print(
                f"[debug] updated failed list: {failed_path} (count={len(new_failed)})")
    except Exception as e:
        if debug:
            print(
                f"[debug] failed to write sidecar failed list: {type(e).__name__}: {e}")

    print(
        f"[retry] retried={retried} fixed={fixed} stillFailed={len(new_failed)}")
    return result_json_path


def main():
    p = argparse.ArgumentParser(
        description=(
            "Read UWorld-export JSON, query castudy mcq-search by question text, "
            "save results into new JSON grouped by chapter."
        )
    )

    p.add_argument(
        "input",
        help="Input JSON file (your exported question bank)",
    )
    p.add_argument(
        "--outdir",
        default="./out",
        help="Output root folder (default: ./out)",
    )
    p.add_argument(
        "--sleep",
        type=float,
        default=0.35,
        help="Sleep seconds between requests (default: 0.35)",
    )
    p.add_argument(
        "--timeout",
        type=int,
        default=20,
        help="Request timeout seconds (default: 20)",
    )
    p.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Max retries per question (default: 3)",
    )
    p.add_argument(
        "--backoff",
        type=float,
        default=1.2,
        help="Retry backoff base seconds (default: 1.2)",
    )
    p.add_argument(
        "--debug",
        action="store_true",
        help="Enable verbose debug logging (payload shape, image extraction counts).",
    )

    p.add_argument(
        "--download-images",
        action="store_true",
        help=(
            "After fetching and saving, automatically download explain_imgs into imgs/ "
            "and write explain_img_files back into the saved JSON."
        ),
    )
    p.add_argument(
        "--create-flashcards",
        action="store_true",
        help=(
            "After fetching (and optional image download), create a .flashcards.txt next to the saved *_castudy.json."
        ),
    )
    p.add_argument(
        "--create-markdown",
        action="store_true",
        help=(
            "Create a pretty Markdown (.md) file containing question + options + explanation images. "
            "Works with existing *_castudy.json in --create-flashcards-only / --create-markdown-only mode, or after fetching."
        ),
    )
    p.add_argument(
        "--markdown-img-url",
        action="store_true",
        help=(
            "When creating Markdown, embed explanation images using original URLs (explain_imgs) instead of local files (explain_img_files)."
        ),
    )
    p.add_argument(
        "--create-flashcards-only",
        action="store_true",
        help=(
            "Do not call the API. Treat input as an existing *_castudy.json (or API JSON) and only create .flashcards.txt."
        ),
    )
    p.add_argument(
        "--create-markdown-only",
        action="store_true",
        help=(
            "Do not call the API. Treat input as an existing *_castudy.json (or API JSON) and only create a .md Markdown file."
        ),
    )
    # Backward-compatible alias (kept so older commands still work)
    p.add_argument(
        "--create-only",
        action="store_true",
        help=(
            "[Deprecated] Same as --create-flashcards-only."
        ),
    )
    p.add_argument(
        "--download-only",
        action="store_true",
        help=(
            "Do not call the API. Treat input as a generated chapter JSON and only "
            "download explain_imgs into imgs/ (and update JSON)."
        ),
    )
    p.add_argument(
        "--img-workers",
        type=int,
        default=8,
        help="Parallel workers for image downloads (default: 8)",
    )
    p.add_argument(
        "--img-timeout",
        type=int,
        default=30,
        help="Timeout seconds for each image download (default: 30)",
    )
    p.add_argument(
        "--img-retries",
        type=int,
        default=3,
        help="Retries per image download (default: 3)",
    )
    p.add_argument(
        "--retry-failed",
        action="store_true",
        help=(
            "Retry only failed questions recorded in an existing *_castudy.json result and update it in-place. "
            "(Input must be the result JSON that contains meta.failed)"
        ),
    )

    p.add_argument(
        "--fix-options-only",
        action="store_true",
        help=(
            "Do not call the API. Recursively remove stray option strings like '不会' from any options lists in the input JSON, "
            "and write the JSON back in-place."
        ),
    )

    args = p.parse_args()

    if not os.path.isfile(args.input):
        print(f"Input not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    if args.retry_failed:
        updated = retry_failed_in_place(
            result_json_path=args.input,
            sleep_sec=args.sleep,
            timeout=args.timeout,
            max_retries=args.retries,
            retry_backoff_sec=args.backoff,
            debug=args.debug,
        )
        print(f"\n✅ Retried failures + updated: {updated}")
        return

    if args.fix_options_only:
        removed = fix_options_in_json_in_place(args.input, debug=args.debug)
        print(f"[fix-options] removed_total={removed}")
        return

    # Create-* -only modes: no API calls.
    # - --create-flashcards-only: create .flashcards.txt only
    # - --create-markdown-only: create .md only
    # - --create-only: deprecated alias for --create-flashcards-only
    if args.create_flashcards_only or args.create_markdown_only or args.create_only:
        path = args.input

        # Optional: download images from existing explain_imgs, then write explain_img_files back.
        if args.download_images:
            path = download_explain_images_for_result_json(
                result_json_path=path,
                workers=args.img_workers,
                timeout=args.img_timeout,
                retries=args.img_retries,
                debug=args.debug,
            )
            print(f"\n✅ Images downloaded: {path}")

        # Backward-compat: --create-only behaves like --create-flashcards-only
        want_flashcards = bool(args.create_flashcards_only or args.create_only)
        want_markdown = bool(args.create_markdown_only)

        if want_flashcards:
            out_txt = create_flashcards_from_result_json(
                path, debug=args.debug)
            print(f"\n✅ Flashcards created: {out_txt}")

        if want_markdown:
            out_md = create_markdown_from_result_json(
                path,
                debug=args.debug,
                use_url_images=args.markdown_img_url,
            )
            print(f"\n✅ Markdown created: {out_md}")

        return

    if args.download_only:
        updated = download_explain_images_simple(
            json_path=args.input,
            workers=args.img_workers,
            timeout=args.img_timeout,
            retries=args.img_retries,
            debug=args.debug,
        )
        print(f"\n✅ Images downloaded: {updated}")
        return

    out_path = process_file(
        input_path=args.input,
        out_dir=args.outdir,
        sleep_sec=args.sleep,
        timeout=args.timeout,
        max_retries=args.retries,
        retry_backoff_sec=args.backoff,
        debug=args.debug,
    )

    if args.download_images:
        out_path = download_explain_images_for_result_json(
            result_json_path=out_path,
            workers=args.img_workers,
            timeout=args.img_timeout,
            retries=args.img_retries,
            debug=args.debug,
        )
        print(f"\n✅ Saved + images downloaded: {out_path}")
    else:
        print(f"\n✅ Saved: {out_path}")

    if args.create_flashcards:
        out_txt = create_flashcards_from_result_json(
            out_path, debug=args.debug)
        print(f"\n✅ Flashcards created: {out_txt}")

    if args.create_markdown:
        out_md = create_markdown_from_result_json(
            out_path,
            debug=args.debug,
            use_url_images=args.markdown_img_url,
        )
        print(f"\n✅ Markdown created: {out_md}")


if __name__ == "__main__":
    main()
