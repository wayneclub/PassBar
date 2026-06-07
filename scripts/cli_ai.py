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

    if provider == "claude-cli":
        if not (os.environ.get("CLAUDE_CLI_BIN") or shutil.which("claude")):
            raise RuntimeError("Claude CLI not found. Install Claude Code or set CLAUDE_CLI_BIN.")
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


def _append_claude_cli_contract(prompt: str, expected: str, has_images: bool) -> str:
    """Output contract variant for Claude CLI.

    Unlike the standard contract, this explicitly permits reading the attached image
    files (which Claude Code must do via its Read tool) while still blocking all
    other agentic actions such as writing files or running shell commands.
    """
    read_rule = (
        "- You MAY read the image files listed in the prompt above — that is the only file operation permitted.\n"
        if has_images
        else "- Do NOT read, open, or inspect any files in the workspace.\n"
    )
    return (
        prompt.rstrip()
        + "\n\n---\n"
        + "STRICT OUTPUT CONTRACT — read carefully before responding:\n"
        + f"- Your entire response must be {expected} and nothing else.\n"
        + read_rule
        + "- Do NOT write, edit, or create any files.\n"
        + "- Do NOT run shell commands or perform any other agentic actions.\n"
        + "- Do NOT add any preamble, explanation, reasoning, or markdown fences around the output.\n"
        + "- Do NOT summarise what you did — just output the result directly.\n"
        + "- If you cannot comply, output a single line starting with ERROR: explaining why.\n"
    )


def call_codex_cli(prompt: str, image_paths: list[str] | str | None = None, model: str | None = None) -> str:
    """Run Codex CLI non-interactively and return the final agent message.

    codex exec writes the assistant's final message to stdout.
    The header block (model/session info) goes to stderr so we can separate them.
    """
    codex_bin = os.environ.get("CODEX_CLI_BIN") or shutil.which("codex")
    if not codex_bin:
        raise RuntimeError("Codex CLI not found. Install it or set CODEX_CLI_BIN.")

    images = _normalize_images(image_paths)
    cmd = [
        codex_bin,
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-C",
        os.getcwd(),
        "--ephemeral",
    ]
    if model:
        cmd.extend(["--model", model])
    for image in images:
        cmd.extend(["--image", image])
    cmd.append("-")  # read prompt from stdin

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

    images = _normalize_images(image_paths)
    full_prompt = prompt
    if images:
        # Ask Antigravity to read each image file before responding.
        image_list = "\n".join(f"  {p}" for p in images)
        full_prompt = (
            full_prompt.rstrip()
            + f"\n\n[Attached image files — read each one before responding:]\n{image_list}"
        )

    with tempfile.TemporaryDirectory(prefix="passbar-agy-") as tmp:
        prompt_path = Path(tmp) / "prompt.txt"
        output_path = Path(tmp) / "output.txt"
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


def call_claude_cli(prompt: str, image_paths: list[str] | str | None = None, model: str | None = None) -> str:
    """Run Claude Code CLI non-interactively and return the response text.

    Images are passed by embedding their absolute paths in the prompt so that
    Claude Code's built-in Read tool can view them.  The model must be capable
    of vision (any current claude-* model is).

    Set CLAUDE_CLI_BIN to override the `claude` binary path.
    """
    claude_bin = os.environ.get("CLAUDE_CLI_BIN") or shutil.which("claude")
    if not claude_bin:
        raise RuntimeError("Claude CLI not found. Install Claude Code or set CLAUDE_CLI_BIN.")

    images = _normalize_images(image_paths)

    full_prompt = prompt
    if images:
        # Ask Claude to read each image file before responding.
        image_list = "\n".join(f"  {p}" for p in images)
        full_prompt = (
            full_prompt.rstrip()
            + f"\n\n[Attached image files — read each one before responding:]\n{image_list}"
        )

    cmd = [
        claude_bin,
        "--print",
        "--dangerously-skip-permissions",
        "--output-format", "text",
    ]
    if model:
        cmd.extend(["--model", model])
    cmd.append(full_prompt)

    proc = subprocess.Popen(
        cmd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        stdout, stderr = proc.communicate(timeout=DEFAULT_TIMEOUT_SECONDS)
    except KeyboardInterrupt:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        raise
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        raise RuntimeError(f"Claude CLI timed out after {DEFAULT_TIMEOUT_SECONDS}s")

    if proc.returncode != 0:
        raise RuntimeError(
            "Claude CLI failed "
            f"(exit {proc.returncode}): {(stderr or stdout).strip()[:1200]}"
        )
    output = stdout.strip()
    if not output:
        stderr_snippet = stderr.strip()[:600] if stderr else ""
        raise RuntimeError(
            "Claude CLI returned empty output (exit 0)."
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
    if provider == "claude-cli":
        images = _normalize_images(image_paths)
        claude_prompt = _append_claude_cli_contract(prompt, expected, has_images=bool(images))
        return call_claude_cli(claude_prompt, image_paths, model)
    raise ValueError(f"Unsupported CLI provider: {provider}")
