# PassBar Deployment (AWS Lightsail)

## CI/CD flow

1. Local dev as usual.
2. Before pushing: `npm run typecheck && npm run lint && npm run build` (frontend), `npm run test && npm run build` (backend) — same checks CI runs, so nothing surprises you in Actions.
3. `git push origin main`.
4. `.github/workflows/docker-publish.yml` runs: detects which of `frontend/**` / `backend/**` changed, re-runs the same checks, then builds and pushes that image to GHCR (only the changed service rebuilds).
5. Images land at `ghcr.io/wayneclub/passbar-frontend:latest` and `ghcr.io/wayneclub/passbar-backend:latest` (also tagged with the commit SHA).
6. On the server:
   ```bash
   cd ~/PassBar/infra
   docker compose pull
   docker compose up -d
   ```
   (`./deploy.sh` wraps this plus the DB migration step — see below.)

### One-time GitHub setup

- Repo → Settings → Actions → General → Workflow permissions → "Read and write permissions" (so `GITHUB_TOKEN` can push to GHCR).
- Repo → Settings → Secrets and variables → Actions:
  - **Variables**: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AUTH_SERVICE_URL` (public, non-secret URLs baked into the frontend build)
  - **Secrets**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (public key but treat as a secret to keep it in one place with `VAPID_PRIVATE_KEY`)
- After the first successful run, the GHCR packages (`passbar-frontend`, `passbar-backend`) are created as **private** by default — either set them to public (package → Package settings → Change visibility) or `docker login ghcr.io` on the server with a PAT that has `read:packages`.

## Topology

One Lightsail instance, two separately-managed docker-compose stacks, joined by shared external networks:

| Stack | Repo | Manages | Network membership |
|---|---|---|---|
| Host stack | `~/docker-compose.yaml` (not in any app repo) | `postgres` (shared DB), `nginx-proxy-manager` (NPM), other unrelated services | `database-network` (postgres), `npm_network` (NPM) |
| PassBar stack | this repo, `infra/docker-compose.yml` | `frontend`, `backend` | `database-network`, `npm_network` |
| auth-service stack | `~/auth-service`, `docker-compose.prod.yml` | `auth-service` | `database-network`, `npm_network` |

Nothing here runs its own Postgres or its own reverse proxy — they connect to the host's existing ones by container name over the two external networks.

## One-time host setup

```bash
docker network create npm_network
```

Add `npm_network` to the `nginx-proxy-manager` service in `~/docker-compose.yaml`:

```yaml
  nginx-proxy-manager:
    ...
    networks:
      - default
      - npm_network

networks:
  database-network:
    external: true
  npm_network:
    external: true
```

Then `docker compose up -d` on that stack to attach it.

In each of the `passbar` and `auth-service` databases (already exist in the shared `postgres` container), make sure the DB/user used by `DATABASE_URL` exists — `auth-service` and PassBar's `backend` use separate databases on the same Postgres instance, never the same schema.

## Per-repo deploy

**PassBar** (`frontend` + `backend`) — images come from GHCR, nothing builds on the server:
```bash
cd ~/PassBar/infra
cp .env.example .env   # first time only — fill in real secrets
./deploy.sh            # pull + migrate + up -d
```

**auth-service** — still builds locally on the server (no CI pipeline set up for it yet, it's not on GitHub):
```bash
cd ~/auth-service
git pull --ff-only
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

## NPM proxy hosts

Containers on `npm_network` are reachable from NPM by container name. In the NPM admin UI (`:81`), create proxy hosts:

| Domain | Forward to |
|---|---|
| `passbar.wayneclub.com` | `passbar-frontend:3000` |
| `passbar.wayneclub.com/api/*` | `passbar-backend:4000` (or route `/api` at the Next.js level if simpler) |
| `auth.wayneclub.com` | `auth-service:4010` |

Enable "Force SSL" + request a Let's Encrypt cert per host as usual.

## Responsibility (which container owns what)

- **frontend** (`passbar-frontend`, port 3000): renders UI, calls `backend` for app data and `auth-service` for login/session. No DB access.
- **backend** (`passbar-backend`, port 4000): PassBar business data (questions, attempts, todos, push). Verifies JWTs issued by `auth-service` (`JWT_SECRET` must match exactly) — never issues tokens itself.
- **auth-service** (port 4010, separate repo): identity/session/membership only — Google OAuth, JWT issuance, refresh tokens. Owns its own DB/schema, never PassBar's product tables.

## Restart behavior

All three app containers use `restart: unless-stopped` — they come back after a host reboot or crash, but stay down if you intentionally `docker compose stop` them. `watchtower` in the host stack does NOT auto-update these (it only watches whatever's in `~/docker-compose.yaml`); redeploy via `deploy.sh` / the auth-service commands above to ship new code.

## Logs

Each service uses the `json-file` driver with `max-size: 10m, max-file: 3` (30MB cap per container, auto-rotated) so logs can't fill the disk. Tail with:

```bash
docker compose -f ~/PassBar/infra/docker-compose.yml logs -f backend
docker compose -f ~/PassBar/infra/docker-compose.yml logs -f frontend
docker compose -f ~/auth-service/docker-compose.prod.yml logs -f auth-service
```

## DB migrations

`backend` and `auth-service` both use Drizzle. Migrations run as a one-off step in `deploy.sh` (backend) — `auth-service` should do the same (`npx drizzle-kit migrate`) before `up -d` if its schema changed. Migrations are never run automatically on container start, so a bad migration can't silently take down a running deploy.
