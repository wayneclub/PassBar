#!/usr/bin/env bash
#
# dev.sh — 一鍵啟動 PassBar 本地開發環境（frontend + backend）
#
#   ./dev.sh              啟動前後端（若缺 node_modules 會自動安裝）
#   ./dev.sh --install    強制先跑 npm install 再啟動
#   ./dev.sh backend      只起後端
#   ./dev.sh frontend     只起前端
#
# 前端 http://localhost:3000  /  後端 http://localhost:4000/api
# 兩者共用根目錄 .env.local。Ctrl+C 會一起關掉。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ── 顏色 ──────────────────────────────────────────────────────────────────
c_reset=$'\033[0m'; c_be=$'\033[36m'; c_fe=$'\033[35m'; c_ok=$'\033[32m'
c_warn=$'\033[33m'; c_err=$'\033[31m'; c_dim=$'\033[2m'
log()  { printf '%s[dev]%s %s\n' "$c_ok"   "$c_reset" "$*"; }
warn() { printf '%s[dev]%s %s\n' "$c_warn" "$c_reset" "$*"; }
die()  { printf '%s[dev] %s%s\n' "$c_err" "$*" "$c_reset" >&2; exit 1; }

# ── 參數 ──────────────────────────────────────────────────────────────────
FORCE_INSTALL=0
RUN_BACKEND=1
RUN_FRONTEND=1
for arg in "$@"; do
  case "$arg" in
    --install|-i) FORCE_INSTALL=1 ;;
    backend|be)   RUN_FRONTEND=0 ;;
    frontend|fe)  RUN_BACKEND=0 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "未知參數：$arg（用 --help 看用法）" ;;
  esac
done

# ── 前置檢查 ──────────────────────────────────────────────────────────────
command -v node >/dev/null || die "找不到 node，請先安裝 Node.js"
command -v npm  >/dev/null || die "找不到 npm"
[ -f .env.local ] || die ".env.local 不存在，請先 cp .env.example .env.local 並填好變數"

# DB 連線快速探測（連不上不擋，只提醒 — DATABASE_URL 指向遠端共享 Postgres）
db_url="$(grep -E '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- || true)"
if [[ "$db_url" =~ @([^:/?]+):([0-9]+) ]]; then
  db_host="${BASH_REMATCH[1]}"; db_port="${BASH_REMATCH[2]}"
  if command -v nc >/dev/null && ! nc -z -G 2 "$db_host" "$db_port" 2>/dev/null; then
    warn "連不到 Postgres ($db_host:$db_port) — 後端 /api 會報錯。若走 Tailscale 請確認已連線。"
  fi
fi

# auth-service 提醒（獨立 repo，本 script 不啟動）
auth_url="$(grep -E '^NEXT_PUBLIC_AUTH_SERVICE_URL=' .env.local | head -1 | cut -d= -f2- || true)"
if [[ "$auth_url" =~ localhost:([0-9]+) ]]; then
  auth_port="${BASH_REMATCH[1]}"
  if command -v nc >/dev/null && ! nc -z localhost "$auth_port" 2>/dev/null; then
    warn "auth-service ($auth_url) 沒在跑 — 登入功能需另外啟動它（獨立 repo）。"
  fi
fi

# ── 安裝相依 ──────────────────────────────────────────────────────────────
if [ "$FORCE_INSTALL" = 1 ] || [ ! -d node_modules ] \
   || [ ! -d frontend/node_modules ] || [ ! -d backend/node_modules ]; then
  log "安裝相依套件（npm install，workspaces）…"
  npm install
fi

# ── 啟動 ──────────────────────────────────────────────────────────────────
pids=()
cleanup() {
  printf '\n'; log "關閉中…"
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  # 收掉 next / nest 子行程
  wait 2>/dev/null || true
  log "已停止。"
}
trap cleanup INT TERM

# 用 sed 幫每行 log 加上彩色前綴
run() {
  local name="$1" color="$2" dir="$3"; shift 3
  ( cd "$dir" && "$@" 2>&1 | sed "s/^/${color}[${name}]${c_reset} /" ) &
  pids+=($!)
}

log "啟動 PassBar 本地環境…"
[ "$RUN_BACKEND" = 1 ]  && { run "backend"  "$c_be" "backend"  npm run start:dev; log "後端  → http://localhost:4000/api"; }
[ "$RUN_FRONTEND" = 1 ] && { run "frontend" "$c_fe" "frontend" npm run dev;       log "前端  → http://localhost:3000"; }

printf '%s%s%s\n' "$c_dim" "（Ctrl+C 停止全部）" "$c_reset"
wait
