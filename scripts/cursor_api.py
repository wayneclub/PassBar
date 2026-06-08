#!/usr/bin/env python3
"""Cursor Agent API adapter via the official cursor-sdk (local runtime)."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from typing import Any

from ai_prompts import format_prompt, load_prompt
from cli_ai import _normalize_images

_CURSOR_SDK_IMPORT_ERROR: Exception | None = None
try:
    from cursor_sdk import (
        Agent,
        AgentOptions,
        CursorAgentError,
        LocalAgentOptions,
        ModelParameterValue,
        ModelSelection,
        SDKImage,
        UserMessage,
    )
except ImportError as exc:
    _CURSOR_SDK_IMPORT_ERROR = exc
    ModelParameterValue = Any  # type: ignore[misc, assignment]
    ModelSelection = Any  # type: ignore[misc, assignment]

_MAX_IMAGE_BYTES = int(os.environ.get("CURSOR_API_MAX_IMAGE_BYTES", "350000"))
_MAX_IMAGE_DIM = int(os.environ.get("CURSOR_API_MAX_IMAGE_DIM", "1600"))
_MAX_RETRIES = int(os.environ.get("CURSOR_API_MAX_IMAGE_RETRIES", "2"))
_HTML_FALLBACK_MODEL = os.environ.get("CURSOR_API_HTML_FALLBACK_MODEL", "gpt-5.4-mini")
_MIN_HTML_CHARS = 1000

ModelLike = str | ModelSelection


def project_venv_python() -> Path:
    return Path(__file__).resolve().parent / ".venv" / "bin" / "python3"


def maybe_reexec_with_venv(argv: list[str] | None = None) -> None:
    """Re-exec with scripts/.venv when --provider cursor-api needs cursor-sdk."""
    if _CURSOR_SDK_IMPORT_ERROR is None:
        return

    args = list(argv or sys.argv)
    if "--provider" not in args:
        return
    provider = args[args.index("--provider") + 1] if args.index("--provider") + 1 < len(args) else ""
    if provider != "cursor-api":
        return

    venv_py = project_venv_python()
    if not venv_py.is_file():
        return
    os.execv(str(venv_py), [str(venv_py), *args])


def check_cursor_api_ready() -> None:
    """Fail fast when cursor-sdk or CURSOR_API_KEY is missing."""
    if _CURSOR_SDK_IMPORT_ERROR is not None:
        venv_py = project_venv_python()
        venv_hint = (
            f"  {venv_py}\n"
            if venv_py.is_file()
            else "  scripts/.venv/bin/python3\n"
        )
        raise RuntimeError(
            "cursor-sdk is not installed for the current Python interpreter. Install it with:\n"
            "  python3 -m venv scripts/.venv\n"
            "  scripts/.venv/bin/pip install -r scripts/requirements.txt\n"
            "Then run scripts with:\n"
            + venv_hint
            + "or let the script auto-switch to scripts/.venv when using --provider cursor-api."
        ) from _CURSOR_SDK_IMPORT_ERROR

    if not os.environ.get("CURSOR_API_KEY", "").strip():
        raise RuntimeError(
            "CURSOR_API_KEY is required for --provider cursor-api. "
            "Set it in passbar/.env.local (Cursor Dashboard → Integrations)."
        )


def _workspace_cwd() -> str:
    return str(Path(__file__).resolve().parent.parent)


def _is_html_task(expected: str) -> bool:
    return "html" in (expected or "").lower()


def _model_id(model: ModelLike | None) -> str:
    if model is None:
        return ""
    if isinstance(model, str):
        return model.strip()
    return str(getattr(model, "id", "") or "").strip()


def _coerce_model_selection(model: ModelLike | None, *, html_task: bool) -> ModelLike:
    if isinstance(model, ModelSelection):
        return model

    if html_task:
        model_id = (
            (model or "").strip()
            or os.environ.get("CURSOR_API_HTML_MODEL", "").strip()
            or _HTML_FALLBACK_MODEL
        )
    else:
        model_id = (model or "").strip() or os.environ.get("CURSOR_API_MODEL", "composer-2.5").strip()

    if model_id.startswith("gpt-5.4") and html_task:
        return ModelSelection(model_id, (ModelParameterValue("reasoning", "none"),))
    if model_id == "composer-2":
        return ModelSelection(model_id, (ModelParameterValue("fast", "true"),))
    return model_id


def _models_for_task(model: ModelLike | None, expected: str) -> list[ModelLike]:
    html_task = _is_html_task(expected)
    primary = _coerce_model_selection(model, html_task=html_task)
    models: list[ModelLike] = [primary]

    if not html_task:
        return models

    fallback = _coerce_model_selection(_HTML_FALLBACK_MODEL, html_task=True)
    if _model_id(fallback) and _model_id(fallback) != _model_id(primary):
        models.append(fallback)
    return models


def _append_cursor_output_contract(prompt: str, expected: str, has_images: bool) -> str:
    image_rule = (
        load_prompt("cursor_api_image_rule_attached")
        if has_images
        else load_prompt("cursor_api_image_rule_none")
    )
    suffix = format_prompt(
        "cursor_api_output_contract",
        expected=expected,
        image_rule=image_rule,
    )
    if _is_html_task(expected):
        suffix += (
            "\n- Keep inline CSS compact; avoid verbose comments.\n"
            "- You MUST output a complete document through </html> in this single response.\n"
        )
    return prompt.rstrip() + suffix


def _compress_image_for_sdk(path: str, *, max_bytes: int, max_dim: int) -> str:
    """Return a path suitable for SDK upload, downscaling large screenshots if needed."""
    source = Path(path)
    if not source.is_file():
        return path

    original_size = source.stat().st_size
    if original_size <= max_bytes:
        try:
            from PIL import Image

            with Image.open(source) as img:
                if max(img.size) <= max_dim:
                    return path
        except Exception:
            return path

    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "Large explanation images require Pillow for compression. "
            "Install scripts/requirements.txt in scripts/.venv."
        ) from exc

    with Image.open(source) as img:
        img = img.convert("RGB")
        width, height = img.size
        longest = max(width, height)
        if longest > max_dim:
            scale = max_dim / longest
            img = img.resize(
                (max(1, int(width * scale)), max(1, int(height * scale))),
                Image.Resampling.LANCZOS,
            )

        fd, tmp_name = tempfile.mkstemp(suffix=".jpg", prefix="passbar-cursor-img-")
        os.close(fd)
        tmp_path = Path(tmp_name)
        quality = 88
        while quality >= 55:
            img.save(tmp_path, format="JPEG", quality=quality, optimize=True)
            if tmp_path.stat().st_size <= max_bytes:
                print(
                    f"    [cursor-api] compressed {source.name}: "
                    f"{original_size // 1024}KB → {tmp_path.stat().st_size // 1024}KB",
                    flush=True,
                )
                return str(tmp_path)
            quality -= 9

        print(
            f"    [cursor-api] compressed {source.name}: "
            f"{original_size // 1024}KB → {tmp_path.stat().st_size // 1024}KB (still large)",
            flush=True,
        )
        return str(tmp_path)


def _prepare_sdk_images(image_paths: list[str], *, max_bytes: int, max_dim: int) -> list[str]:
    prepared: list[str] = []
    for path in image_paths:
        prepared.append(_compress_image_for_sdk(path, max_bytes=max_bytes, max_dim=max_dim))
    return prepared


def _extract_assistant_text_from_conversation(conversation: list[object]) -> str:
    best = ""
    for turn in conversation:
        inner = getattr(turn, "turn", None)
        if inner is None:
            continue
        for step in getattr(inner, "steps", ()) or ():
            if getattr(step, "type", "") != "assistantMessage":
                continue
            message = getattr(step, "message", None)
            text = getattr(message, "text", "") if message is not None else ""
            if isinstance(text, str) and len(text) > len(best):
                best = text
    return best.strip()


def _collect_run_output(result: object) -> str:
    output = (getattr(result, "result", "") or "").strip()
    if output:
        return output

    text_attr = getattr(result, "text", None)
    if callable(text_attr):
        try:
            text_value = text_attr()
            if isinstance(text_value, str) and text_value.strip():
                return text_value.strip()
        except Exception:
            pass

    if getattr(result, "supports", lambda _op: False)("conversation"):
        try:
            assistant_text = _extract_assistant_text_from_conversation(result.conversation())
            if assistant_text:
                return assistant_text
        except Exception:
            pass
    return ""


def _is_complete_html(text: str) -> bool:
    lowered = text.lower().strip()
    return (
        len(text) >= _MIN_HTML_CHARS
        and lowered.startswith("<!doctype html")
        and "</html>" in lowered
    )


def _run_failure_details(run_id: str) -> str:
    if not run_id or _CURSOR_SDK_IMPORT_ERROR is not None:
        return ""

    details: list[str] = []
    try:
        run = Agent.get_run(run_id)
        result_text = (getattr(run, "result", "") or "").strip()
        if result_text:
            details.append(f"result={result_text[:800]}")

        if run.supports("conversation"):
            assistant_text = _extract_assistant_text_from_conversation(run.conversation())
            if assistant_text and assistant_text not in result_text:
                details.append(f"assistant={assistant_text[:800]}")
    except Exception as exc:
        details.append(f"detail_lookup_failed={exc}")

    return " | ".join(details)


def _raise_run_failure(result: object, *, recovered: str = "") -> None:
    run_id = getattr(result, "id", None) or getattr(result, "run_id", "")
    result_text = (getattr(result, "result", "") or "").strip()
    extra = _run_failure_details(str(run_id or ""))
    message = f"Cursor API run failed (status=error){f': {run_id}' if run_id else ''}"
    if result_text:
        message += f"\n  agent result: {result_text[:1000]}"
    if recovered:
        message += f"\n  recovered assistant text: {recovered[:1000]}"
    if extra:
        message += f"\n  details: {extra}"
    raise RuntimeError(message)


def _agent_options(model: ModelLike, api_key: str) -> AgentOptions:
    return AgentOptions(
        api_key=api_key,
        model=model,
        local=LocalAgentOptions(
            cwd=_workspace_cwd(),
            setting_sources=[],
        ),
    )


def _continue_truncated_html(agent_id: str, partial: str, api_key: str) -> str:
    tail = partial[-500:]
    continuation_prompt = (
        "Your previous HTML response was truncated before </html>.\n"
        "Output ONLY the continuation starting exactly where you left off, "
        "through a complete </html>. Do not repeat earlier content.\n"
        "Do NOT add markdown fences or commentary.\n"
        f"Previous ending:\n...{tail}"
    )
    with Agent.resume(agent_id, _agent_options(_coerce_model_selection(None, html_task=True), api_key)) as agent:
        run = agent.send(continuation_prompt)
        result = run.wait()
        continuation = _collect_run_output(result)
        if continuation.upper().startswith("ERROR:"):
            raise RuntimeError(f"Cursor API continuation returned ERROR: {continuation[:1000]}")

        merged = partial.rstrip() + continuation.lstrip()
        if not _is_complete_html(merged):
            raise RuntimeError(
                "Cursor API continuation did not produce a complete HTML document "
                f"({len(merged)} chars)."
            )
        return merged


def _finalize_html_output(result: object, output: str, api_key: str, expected: str) -> str:
    if not _is_html_task(expected):
        return output

    if _is_complete_html(output):
        return output

    agent_id = getattr(result, "agent_id", "") or ""
    if agent_id and output.lower().startswith("<!doctype html"):
        print("    [cursor-api] HTML truncated; requesting continuation…", flush=True)
        return _continue_truncated_html(agent_id, output, api_key)

    if output:
        preview = repr(output[-300:])
        raise RuntimeError(
            "Cursor API returned incomplete HTML "
            f"({len(output)} chars, missing </html>).\n"
            f"  Output ends with: {preview}"
        )
    return output


def _call_once(
    prompt: str,
    image_paths: list[str],
    model: ModelLike,
    expected: str,
    *,
    max_bytes: int,
    max_dim: int,
) -> str:
    prepared_paths = _prepare_sdk_images(image_paths, max_bytes=max_bytes, max_dim=max_dim)
    temp_paths = [p for p in prepared_paths if p.startswith(tempfile.gettempdir())]
    api_key = os.environ.get("CURSOR_API_KEY", "").strip()
    try:
        has_images = bool(prepared_paths)
        final_prompt = _append_cursor_output_contract(prompt, expected, has_images)
        sdk_images = [SDKImage.from_file(path) for path in prepared_paths] if prepared_paths else None
        message = UserMessage(text=final_prompt, images=sdk_images)

        result = Agent.prompt(message, _agent_options(model, api_key))
    except CursorAgentError as exc:
        raise RuntimeError(f"Cursor API startup failed: {exc.message}") from exc
    finally:
        for temp_path in temp_paths:
            try:
                os.remove(temp_path)
            except OSError:
                pass

    output = _collect_run_output(result)

    if result.status == "error":
        if _is_html_task(expected) and _is_complete_html(output):
            print("    [cursor-api] recovered complete HTML from errored run", flush=True)
            return output
        _raise_run_failure(result, recovered=output)

    if output.upper().startswith("ERROR:"):
        run_id = getattr(result, "id", None) or getattr(result, "run_id", "")
        raise RuntimeError(
            f"Cursor API agent returned ERROR{f': {run_id}' if run_id else ''}: {output[:1000]}"
        )
    if not output:
        raise RuntimeError("Cursor API returned empty result despite status=finished.")

    if _is_html_task(expected):
        return _finalize_html_output(result, output, api_key, expected)
    return output


def call_cursor_api(
    prompt: str,
    image_paths: list[str] | str | None = None,
    model: ModelLike | None = None,
    expected: str = "the requested content",
) -> str:
    """One-shot local Cursor agent call with optional image attachments."""
    check_cursor_api_ready()

    images = _normalize_images(image_paths)
    models = _models_for_task(model, expected)
    last_error: Exception | None = None

    for model_index, selected_model in enumerate(models):
        if model_index > 0:
            print(
                f"    [cursor-api] retrying with fallback model {_model_id(selected_model)}…",
                flush=True,
            )

        for attempt in range(1, _MAX_RETRIES + 1):
            max_bytes = _MAX_IMAGE_BYTES if attempt == 1 else max(120_000, _MAX_IMAGE_BYTES // 2)
            max_dim = _MAX_IMAGE_DIM if attempt == 1 else max(1024, _MAX_IMAGE_DIM // 2)
            try:
                return _call_once(
                    prompt,
                    images,
                    selected_model,
                    expected,
                    max_bytes=max_bytes,
                    max_dim=max_dim,
                )
            except RuntimeError as exc:
                last_error = exc
                if attempt < _MAX_RETRIES:
                    print(
                        f"    [cursor-api] attempt {attempt} failed, retrying with smaller images…",
                        flush=True,
                    )
                    continue
                break

    assert last_error is not None
    raise last_error
