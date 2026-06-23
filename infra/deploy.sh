#!/usr/bin/env bash
# Run on the Lightsail server after GitHub Actions has pushed new images to GHCR.
# Usage: cd ~/PassBar/infra && ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> pull latest images"
docker compose pull

echo "==> run db migrations (backend)"
docker compose run --rm \
  --entrypoint "sh -c 'npm install drizzle-kit@^0.31.10 --no-save && npx drizzle-kit migrate'" \
  backend

echo "==> up -d"
docker compose up -d

echo "==> prune dangling images"
docker image prune -f

echo "==> status"
docker compose ps
