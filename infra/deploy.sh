#!/usr/bin/env bash
# Run on the Lightsail server after GitHub Actions has pushed new images to GHCR.
# Expected server location:
#   /home/ubuntu/apps/passbar/{docker-compose.yml,.env,deploy.sh}
#
# Usage:
#   cd /home/ubuntu/apps/passbar && ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and fill production secrets first." >&2
  exit 1
fi

echo "==> pull latest images"
docker compose pull

echo "==> run db migrations (backend)"
docker compose run --rm \
  --entrypoint "sh -c 'npm install drizzle-kit@^0.31.10 --no-save --include=dev && ./node_modules/.bin/drizzle-kit migrate'" \
  backend

echo "==> up -d"
docker compose up -d

echo "==> reload nginx-proxy-manager (refresh Docker upstream IPs)"
if docker ps --format '{{.Names}}' | grep -qx 'nginx-proxy-manager'; then
  docker network connect npm_network nginx-proxy-manager 2>/dev/null || true
  docker exec nginx-proxy-manager nginx -s reload
fi

echo "==> prune dangling images"
docker image prune -f

echo "==> status"
docker compose ps
