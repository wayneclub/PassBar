#!/usr/bin/env bash
set -u
set -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUESTIONS_DIR="${QUESTIONS_DIR:-"$ROOT_DIR/questions"}"
OUT_DIR="${OUT_DIR:-"$ROOT_DIR/out"}"
LOG_DIR="${LOG_DIR:-"$ROOT_DIR/logs/explain_fetch"}"
SLEEP="${SLEEP:-0.35}"
TIMEOUT="${TIMEOUT:-20}"
RETRIES="${RETRIES:-3}"
BACKOFF="${BACKOFF:-1.2}"
DEBUG="${DEBUG:-0}"

usage() {
  cat <<EOF
Run explain_fetch.py for every chapter JSON under questions/.

Usage:
  scripts/run_explain_fetch_all.sh

Optional env vars:
  QUESTIONS_DIR  Source question folder. Default: $ROOT_DIR/questions
  OUT_DIR        Output folder. Default: $ROOT_DIR/out
  LOG_DIR        Log folder. Default: $ROOT_DIR/logs/explain_fetch
  SLEEP          Seconds between API requests. Default: 0.35
  TIMEOUT        Request timeout seconds. Default: 20
  RETRIES        Retries per question. Default: 3
  BACKOFF        Retry backoff base seconds. Default: 1.2
  DEBUG          Set to 1 to add --debug. Default: 0
  EXTRA_ARGS     Extra args passed to explain_fetch.py.

Example:
  DEBUG=1 scripts/run_explain_fetch_all.sh
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -d "$QUESTIONS_DIR" ]]; then
  echo "Questions folder not found: $QUESTIONS_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR" "$LOG_DIR"

total="$(find "$QUESTIONS_DIR" -type f -name '*.json' | wc -l | tr -d ' ')"
if [[ "$total" == "0" ]]; then
  echo "No JSON files found under: $QUESTIONS_DIR"
  exit 0
fi

echo "Found $total question JSON files."
echo "Output: $OUT_DIR"
echo "Logs:   $LOG_DIR"
echo

ok_count=0
fail_count=0
index=0
failed_files=()

while IFS= read -r -d '' json_file; do
  index=$((index + 1))
  base_name="$(basename "$json_file" .json)"
  safe_name="$(printf '%s' "$base_name" | tr -c 'A-Za-z0-9._-' '_' | sed 's/_\{2,\}/_/g')"
  log_file="$LOG_DIR/$(printf '%03d' "$index")_${safe_name}.log"

  echo "[$index/$total] Fetching: $json_file"
  echo "          Log: $log_file"

  cmd=(
    python3 "$ROOT_DIR/explain_fetch.py" "$json_file"
    --outdir "$OUT_DIR"
    --sleep "$SLEEP"
    --timeout "$TIMEOUT"
    --retries "$RETRIES"
    --backoff "$BACKOFF"
    --download-images
  )

  if [[ "$DEBUG" == "1" || "$DEBUG" == "true" ]]; then
    cmd+=(--debug)
  fi

  if [[ -n "${EXTRA_ARGS:-}" ]]; then
    # shellcheck disable=SC2206
    extra_args_array=($EXTRA_ARGS)
    cmd+=("${extra_args_array[@]}")
  fi

  printf 'Command: ' > "$log_file"
  printf '%q ' "${cmd[@]}" >> "$log_file"
  printf '\n\n' >> "$log_file"

  "${cmd[@]}" 2>&1 | tee -a "$log_file"
  status="${PIPESTATUS[0]}"

  if [[ "$status" == "0" ]]; then
    ok_count=$((ok_count + 1))
    echo "[$index/$total] OK"
  else
    fail_count=$((fail_count + 1))
    failed_files+=("$json_file")
    echo "[$index/$total] FAILED status=$status"
  fi
  echo
done < <(find "$QUESTIONS_DIR" -type f -name '*.json' -print0)

echo "Done."
echo "Succeeded: $ok_count"
echo "Failed:    $fail_count"

if [[ "$fail_count" != "0" ]]; then
  echo
  echo "Failed files:"
  for file in "${failed_files[@]}"; do
    echo "  - $file"
  done
  exit 1
fi
