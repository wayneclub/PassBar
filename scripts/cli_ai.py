#!/usr/bin/env python3
"""Small adapters for using local agent CLIs as text/image generators."""

from __future__ import annotations

import os
import re
import shlex
import time
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlparse

from ai_prompts import format_prompt, load_prompt


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

    if provider == "cursor-cli":
        if not _resolve_cursor_cli_command():
            raise RuntimeError(
                "Cursor CLI not found. Install via: curl https://cursor.com/install -fsS | bash "
                "or set CURSOR_CLI_BIN."
            )
        return


def _normalize_images(image_paths: list[str] | str | None) -> list[str]:
    if isinstance(image_paths, str):
        image_paths = [image_paths]
    return [str(Path(p).expanduser()) for p in (image_paths or []) if p and Path(p).expanduser().exists()]


def _append_output_contract(prompt: str, expected: str) -> str:
    return prompt.rstrip() + format_prompt("cli_output_contract", expected=expected)


_ANTIGRAVITY_FILE_HTML_RE = re.compile(
    r"(?:\]\(|^|\s)(file://[^\s\)\]\"'<>]+\.html)",
    re.IGNORECASE,
)


def _looks_like_html_document(text: str) -> bool:
    lowered = text.strip().lower()
    if lowered.startswith("<!doctype html"):
        return True
    return lowered.startswith("<html") and "</html>" in lowered


def _recover_antigravity_written_html(output: str) -> str | None:
    """Gemini via `agy --print` often writes HTML to disk and returns a short summary.

    Recover the document from any file://…html link in the CLI stdout.
    """
    seen: set[str] = set()
    for match in _ANTIGRAVITY_FILE_HTML_RE.finditer(output):
        raw_url = match.group(1).rstrip(".,;)")
        if raw_url in seen:
            continue
        seen.add(raw_url)
        path = Path(unquote(urlparse(raw_url).path))
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8").strip()
        if _looks_like_html_document(text):
            return text
    return None


def _finalize_antigravity_output(output: str) -> str:
    if _looks_like_html_document(output):
        return output
    recovered = _recover_antigravity_written_html(output)
    if recovered:
        return recovered
    return output


def _append_antigravity_cli_contract(prompt: str, expected: str, has_images: bool) -> str:
    """Output contract for Antigravity CLI.

    Unlike the generic CLI contract, this permits reading attached image files
    while still requiring inline output (no workspace file writes).
    """
    read_rule = (
        load_prompt("cli_claude_read_rule")
        if has_images
        else load_prompt("cli_claude_no_read_rule")
    )
    return prompt.rstrip() + format_prompt(
        "cli_claude_output_contract",
        expected=expected,
        read_rule=read_rule,
    )


def _append_claude_cli_contract(prompt: str, expected: str, has_images: bool) -> str:
    """Output contract variant for Claude CLI.

    Unlike the standard contract, this explicitly permits reading the attached image
    files (which Claude Code must do via its Read tool) while still blocking all
    other agentic actions such as writing files or running shell commands.
    """
    read_rule = (
        load_prompt("cli_claude_read_rule")
        if has_images
        else load_prompt("cli_claude_no_read_rule")
    )
    return prompt.rstrip() + format_prompt(
        "cli_claude_output_contract",
        expected=expected,
        read_rule=read_rule,
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
            result = subprocess.run(
                cmd,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=DEFAULT_TIMEOUT_SECONDS,
                check=False,
            )
        else:
            # Use shell redirect (< prompt_file) to feed the prompt to agy.
            # agy's --print /dev/stdin doesn't work reliably with subprocess
            # stdin pipes (stdout stays empty on exit 0); shell file-redirect
            # is the only reliable way to pass long prompts without hitting
            # ARG_MAX limits on large HTML-generation prompts.
            timeout_val = os.environ.get("ANTIGRAVITY_PRINT_TIMEOUT", "15m")
            model_flag = f" --model {shlex.quote(model)}" if model else ""
            shell_cmd = (
                f"{shlex.quote(agy_bin)} --print /dev/stdin"
                f" --print-timeout {shlex.quote(timeout_val)}"
                f" --dangerously-skip-permissions{model_flag}"
                f" < {shlex.quote(str(prompt_path))}"
            )
            max_retries = int(os.environ.get("ANTIGRAVITY_EMPTY_RETRIES", "3"))
            retry_delay = float(os.environ.get("ANTIGRAVITY_RETRY_DELAY", "5"))
            result = None
            for attempt in range(1, max_retries + 1):
                result = subprocess.run(
                    shell_cmd,
                    shell=True,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=DEFAULT_TIMEOUT_SECONDS,
                    check=False,
                )
                if result.returncode != 0 or result.stdout.strip():
                    break
                if attempt < max_retries:
                    print(f"    [agy] empty output on attempt {attempt}/{max_retries}, retrying in {retry_delay}s...", flush=True)
                    time.sleep(retry_delay)

        if result.returncode != 0:
            raise RuntimeError(
                "Antigravity CLI failed "
                f"(exit {result.returncode}): {(result.stderr or result.stdout).strip()[:1200]}"
            )
        if output_path.exists():
            text = output_path.read_text(encoding="utf-8").strip()
            if text:
                return _finalize_antigravity_output(text)
        output = result.stdout.strip()
        if not output:
            stderr_snippet = result.stderr.strip()[:600] if result.stderr else ""
            raise RuntimeError(
                "Antigravity CLI returned empty output (exit 0)."
                + (f"\n  stderr: {stderr_snippet}" if stderr_snippet else "")
            )
        return _finalize_antigravity_output(output)


def _resolve_cursor_cli_command() -> list[str] | None:
    """Resolve both legacy Cursor Agent binaries and Cursor 3's ``cursor agent``.

    Cursor 3.11 exposes its headless agent as a subcommand of ``cursor`` rather
    than installing a separate ``agent`` executable.  Keep the old binaries
    first for users who explicitly configured them.
    """
    configured = os.environ.get("CURSOR_CLI_BIN")
    if configured:
        return shlex.split(configured)
    legacy = shutil.which("agent") or shutil.which("cursor-agent")
    if legacy:
        return [legacy]
    cursor = shutil.which("cursor")
    return [cursor, "agent"] if cursor else None


def call_cursor_cli(prompt: str, image_paths: list[str] | str | None = None, model: str | None = None) -> str:
    """Run Cursor Agent CLI non-interactively and return the response text.

    Images are passed by embedding their absolute paths in the prompt; the agent
    reads them via its Read tool (see Cursor headless CLI docs).

    Set CURSOR_CLI_BIN to override the command (for example ``cursor agent``).
    Authenticate with ``cursor agent login`` or CURSOR_API_KEY for headless runs.
    """
    agent_command = _resolve_cursor_cli_command()
    if not agent_command:
        raise RuntimeError(
            "Cursor CLI not found. Install via: curl https://cursor.com/install -fsS | bash "
            "or set CURSOR_CLI_BIN."
        )

    images = _normalize_images(image_paths)

    full_prompt = prompt
    if images:
        image_list = "\n".join(f"  {p}" for p in images)
        full_prompt = (
            full_prompt.rstrip()
            + f"\n\n[Attached image files — read each one before responding:]\n{image_list}"
        )

    cmd = [
        *agent_command,
        "-p",
        "--mode",
        "ask",
        "--output-format",
        "text",
        "--trust",
        "--workspace",
        os.getcwd(),
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
        raise RuntimeError(f"Cursor CLI timed out after {DEFAULT_TIMEOUT_SECONDS}s")

    if proc.returncode != 0:
        detail = (stderr or stdout).strip()
        if "Authentication required" in detail:
            raise RuntimeError(
                "Cursor CLI authentication required for headless/script mode. "
                "Set CURSOR_API_KEY (Cursor Dashboard → Integrations) in your environment, "
                "or add it to root .env.tools.local."
            )
        raise RuntimeError(
            "Cursor CLI failed "
            f"(exit {proc.returncode}): {detail[:1200]}"
        )
    output = stdout.strip()
    if not output:
        stderr_snippet = stderr.strip()[:600] if stderr else ""
        raise RuntimeError(
            "Cursor CLI returned empty output (exit 0)."
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


def call_cli_ai(
    provider: str,
    prompt: str,
    image_paths: list[str] | str | None = None,
    model: str | None = None,
    expected: str = "the requested content",
) -> str:
    if provider == "codex-cli":
        return call_codex_cli(_append_output_contract(prompt, expected), image_paths, model)
    if provider == "antigravity-cli":
        images = _normalize_images(image_paths)
        final_prompt = _append_antigravity_cli_contract(prompt, expected, bool(images))
        return call_antigravity_cli(final_prompt, image_paths, model)
    if provider in {"claude-cli", "cursor-cli"}:
        images = _normalize_images(image_paths)
        cli_prompt = _append_claude_cli_contract(prompt, expected, has_images=bool(images))
        if provider == "claude-cli":
            return call_claude_cli(cli_prompt, image_paths, model)
        return call_cursor_cli(cli_prompt, image_paths, model)
    raise ValueError(f"Unsupported CLI provider: {provider}")
