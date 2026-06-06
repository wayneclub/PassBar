#!/usr/bin/env python3
"""Small adapters for using local agent CLIs as text/image generators."""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import tempfile
from pathlib import Path


DEFAULT_TIMEOUT_SECONDS = int(os.environ.get("PASSBAR_CLI_AI_TIMEOUT", "900"))


def check_provider_ready(provider: str) -> None:
    """Fail fast when a selected CLI provider cannot run generation."""
    if provider == "codex-cli":
        if not (os.environ.get("CODEX_CLI_BIN") or shutil.which("codex")):
            raise RuntimeError("Codex CLI not found. Install it or set CODEX_CLI_BIN.")
        return

    if provider == "antigravity-cli":
        if not (os.environ.get("ANTIGRAVITY_CLI_BIN") or shutil.which("agy")):
            raise RuntimeError("Antigravity CLI not found. Install `agy` or set ANTIGRAVITY_CLI_BIN.")
        return


def _normalize_images(image_paths: list[str] | str | None) -> list[str]:
    if isinstance(image_paths, str):
        image_paths = [image_paths]
    return [str(Path(p).expanduser()) for p in (image_paths or []) if p and Path(p).expanduser().exists()]


def _append_output_contract(prompt: str, expected: str) -> str:
    return (
        prompt.rstrip()
        + "\n\n---\n"
        + "STRICT OUTPUT CONTRACT — read carefully before responding:\n"
        + f"- Your entire response must be {expected} and nothing else.\n"
        + "- Do NOT read, open, or inspect any files in the workspace before generating your response.\n"
        + "- Do NOT edit files, run shell commands, or perform any agentic actions.\n"
        + "- Do NOT add any preamble, explanation, reasoning, or markdown fences around the output.\n"
        + "- Do NOT summarise what you are about to do — just output the result directly.\n"
        + "- If you cannot comply, output a single line starting with ERROR: explaining why.\n"
    )


def call_codex_cli(prompt: str, image_paths: list[str] | str | None = None, model: str | None = None) -> str:
    """Run Codex CLI non-interactively and return the final agent message."""
    codex_bin = os.environ.get("CODEX_CLI_BIN") or shutil.which("codex")
    if not codex_bin:
        raise RuntimeError("Codex CLI not found. Install it or set CODEX_CLI_BIN.")

    images = _normalize_images(image_paths)
    with tempfile.TemporaryDirectory(prefix="passbar-codex-") as tmp:
        output_path = Path(tmp) / "last-message.txt"
        cmd = [
            codex_bin,
            "exec",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "-C",
            os.getcwd(),
            "-o",
            str(output_path),
        ]
        if model:
            cmd.extend(["--model", model])
        for image in images:
            cmd.extend(["--image", image])
        cmd.append("-")

        result = subprocess.run(
            cmd,
            input=prompt,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=DEFAULT_TIMEOUT_SECONDS,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "Codex CLI failed "
                f"(exit {result.returncode}): {(result.stderr or result.stdout).strip()[:1200]}"
            )
        if output_path.exists():
            text = output_path.read_text(encoding="utf-8").strip()
            if text:
                return text
        output = result.stdout.strip()
        if not output:
            stderr_snippet = result.stderr.strip()[:600] if result.stderr else ""
            raise RuntimeError(
                "Codex CLI returned empty output (exit 0)."
                + (f"\n  stderr: {stderr_snippet}" if stderr_snippet else "")
            )
        return output


def call_antigravity_cli(prompt: str, image_paths: list[str] | str | None = None, model: str | None = None) -> str:
    """Run Antigravity CLI through a user-configurable non-interactive command template.

    By default this uses `agy --print`, which is the installed CLI's
    non-interactive mode. You can override the command by setting
    ANTIGRAVITY_CLI_COMMAND to a shell-like template. Supported placeholders:
      {prompt_file}, {output_file}, {model}

    Example:
      ANTIGRAVITY_CLI_COMMAND='agy exec --model {model} --output {output_file} {prompt_file}'
    """
    agy_bin = os.environ.get("ANTIGRAVITY_CLI_BIN") or shutil.which("agy")
    if not agy_bin:
        raise RuntimeError("Antigravity CLI not found. Install `agy` or set ANTIGRAVITY_CLI_BIN.")

    # antigravity-cli (--print mode) cannot access local files outside its workspace.
    # Passing image paths causes the model to attempt file reads that silently fail,
    # resulting in empty output. Image context must be embedded in the prompt itself.
    with tempfile.TemporaryDirectory(prefix="passbar-agy-") as tmp:
        prompt_path = Path(tmp) / "prompt.txt"
        output_path = Path(tmp) / "output.txt"
        full_prompt = prompt
        prompt_path.write_text(full_prompt, encoding="utf-8")

        template = os.environ.get("ANTIGRAVITY_CLI_COMMAND")
        if template:
            rendered = template.format(
                agy=agy_bin,
                prompt_file=str(prompt_path),
                output_file=str(output_path),
                model=model or "",
            )
            cmd = shlex.split(rendered)
            if cmd and cmd[0] == "agy":
                cmd[0] = agy_bin
        else:
            cmd = [
                agy_bin,
                "--print",
                full_prompt,
                "--print-timeout",
                os.environ.get("ANTIGRAVITY_PRINT_TIMEOUT", "15m"),
                "--dangerously-skip-permissions",
            ]
            if model:
                cmd.extend(["--model", model])

        result = subprocess.run(
            cmd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=DEFAULT_TIMEOUT_SECONDS,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "Antigravity CLI failed "
                f"(exit {result.returncode}): {(result.stderr or result.stdout).strip()[:1200]}"
            )
        if output_path.exists():
            text = output_path.read_text(encoding="utf-8").strip()
            if text:
                return text
        output = result.stdout.strip()
        if not output:
            stderr_snippet = result.stderr.strip()[:600] if result.stderr else ""
            raise RuntimeError(
                "Antigravity CLI returned empty output (exit 0)."
                + (f"\n  stderr: {stderr_snippet}" if stderr_snippet else "")
            )
        return output


def _is_gemini_model(model: str | None) -> bool:
    return bool(model and model.lower().startswith("gemini"))


def call_cli_ai(
    provider: str,
    prompt: str,
    image_paths: list[str] | str | None = None,
    model: str | None = None,
    expected: str = "the requested content",
) -> str:
    # Gemini models via antigravity-cli don't need agentic restrictions and
    # the extra contract text causes them to generate more verbose output that
    # can exceed their effective --print output limit.
    skip_contract = provider == "antigravity-cli" and _is_gemini_model(model)
    final_prompt = prompt if skip_contract else _append_output_contract(prompt, expected)
    if provider == "codex-cli":
        return call_codex_cli(final_prompt, image_paths, model)
    if provider == "antigravity-cli":
        return call_antigravity_cli(final_prompt, image_paths, model)
    raise ValueError(f"Unsupported CLI provider: {provider}")
