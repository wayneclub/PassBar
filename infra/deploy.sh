#!/usr/bin/env bash
# Run on the Lightsail server after GitHub Actions has pushed new images to GHCR.
# Expected server location:
#   /home/ubuntu/apps/passbar/{docker-compose.yml,.env,deploy.sh}
#
# Usage:
#   cd /home/ubuntu/apps/passbar && ./deploy.sh <image-tag>
set -euo pipefail

cd "$(dirname "$0")"

IMAGE_TAG="${1:-}"
if [[ -z "$IMAGE_TAG" ]]; then
  echo "Usage: ./deploy.sh <image-tag>" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and fill production secrets first." >&2
  exit 1
fi

previous_tag=""
if [[ -f .deployed-image-tag ]]; then
  previous_tag="$(<.deployed-image-tag)"
fi

export IMAGE_TAG

rollback() {
  if [[ -z "$previous_tag" || "$previous_tag" == "$IMAGE_TAG" ]]; then
    echo "No previous image tag is available for rollback." >&2
    return
  fi

  echo "==> deployment failed; rolling app containers back to $previous_tag" >&2
  export IMAGE_TAG="$previous_tag"
  docker compose pull
  docker compose up -d --remove-orphans
}

trap rollback ERR

echo "==> pull images tagged $IMAGE_TAG"
docker compose pull

echo "==> run db migrations (backend)"
docker compose run --rm \
  --entrypoint sh \
  backend -c 'npm install drizzle-kit@^0.31.10 --no-save --include=dev && ./node_modules/.bin/drizzle-kit migrate'

echo "==> up -d"
docker compose up -d --remove-orphans

echo "==> wait for healthy containers"
for attempt in $(seq 1 36); do
  frontend_health="$(docker inspect --format '{{.State.Health.Status}}' passbar-frontend 2>/dev/null || true)"
  backend_health="$(docker inspect --format '{{.State.Health.Status}}' passbar-backend 2>/dev/null || true)"

  if [[ "$frontend_health" == "healthy" && "$backend_health" == "healthy" ]]; then
    break
  fi

  if [[ "$frontend_health" == "unhealthy" || "$backend_health" == "unhealthy" ]]; then
    echo "Container health check failed: frontend=$frontend_health backend=$backend_health" >&2
    docker compose logs --tail=100 frontend backend >&2
    false
  fi

  if [[ "$attempt" -eq 36 ]]; then
    echo "Timed out waiting for containers: frontend=$frontend_health backend=$backend_health" >&2
    docker compose logs --tail=100 frontend backend >&2
    false
  fi

  sleep 5
done

echo "==> reload nginx-proxy-manager (refresh Docker upstream IPs)"
if docker ps --format '{{.Names}}' | grep -qx 'nginx-proxy-manager'; then
  docker network connect npm_network nginx-proxy-manager 2>/dev/null || true
  docker exec nginx-proxy-manager nginx -s reload
fi

echo "==> prune dangling images"
docker image prune -f

printf '%s\n' "$IMAGE_TAG" > .deployed-image-tag
trap - ERR

echo "==> status"
docker compose ps
