# PassBar Deployment (AWS Lightsail)

## Forgot everything? Start here

You do not need to understand the rest of this document to do these. Pick the
row that matches what you're trying to do.

| I want to... | Do this |
|---|---|
| Ship a normal code change | `git push origin main`, then watch the **Actions** tab on GitHub. Nothing to run by hand. |
| Check if prod is currently up | `https://passbar.wayneclub.com` loads, or SSH in and run `docker compose -f /home/ubuntu/apps/passbar/docker-compose.yml ps` |
| SSH into the server | `ssh <user>@<host>` — the host/user/key are in GitHub repo secrets `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_SSH_KEY` (Settings → Secrets and variables → Actions). If you've also lost those, you don't have another copy — they only exist on whatever machine generated the SSH key and in those secrets. |
| See what's currently deployed | `cat /home/ubuntu/apps/passbar/.deployed-image-tag` on the server, or check the latest successful run in the **Actions** tab |
| Re-run the last deploy without a new commit | GitHub → **Actions** → `CI/CD` → pick the latest run on `main` → **Re-run all jobs** |
| Roll back to a specific old version manually | On the server: `cd /home/ubuntu/apps/passbar && ./deploy.sh <old-commit-sha>` (find old SHAs in the GHCR package version list or `git log`) |
| Tail logs | `docker compose -f /home/ubuntu/apps/passbar/docker-compose.yml logs -f backend` (or `frontend`) |
| Change a production env var | Edit `/home/ubuntu/apps/passbar/.env` on the server, then `cd /home/ubuntu/apps/passbar && docker compose up -d` (no need to rebuild — only `NEXT_PUBLIC_*` vars require a rebuild, see below) |
| Change a `NEXT_PUBLIC_*` (frontend build-time) var | Update it in GitHub → Settings → Secrets and variables → Actions (**Variables** or **Secrets**), then trigger a new deploy (push or re-run) — these are baked into the image at build time, editing `.env` on the server does nothing |
| Apply a schema change manually (skip CI) | `docker compose -f /home/ubuntu/apps/passbar/docker-compose.yml run --rm backend node dist/src/db/migrate.js` |
| Connect to the production DB directly | SSH in, then `docker exec -it postgres psql -U postgres -d passbar` (DB container is on the host stack, not the passbar stack) |
| Something is broken and I don't know why | Jump to **Troubleshooting** near the bottom of this file |

## CI/CD flow

1. Local dev as usual.
2. Before pushing: `npm run typecheck && npm run lint && npm run build` (frontend), `npm run test && npm run build` (backend) — same checks CI runs, so nothing surprises you in Actions.
3. `git push origin main`.
4. `.github/workflows/ci-cd.yml` runs frontend and backend checks.
5. For `main`, both images are published to GHCR with the commit SHA and
   `latest` tags.
6. GitHub Actions copies the Compose/deploy files to the server and runs
   `./deploy.sh <commit-sha>`.
7. The deploy script runs migrations, starts that exact image version, waits
   for both containers to become healthy, and rolls the app images back if the
   health checks fail.

### One-time GitHub setup

- Repo → Settings → Actions → General → Workflow permissions → "Read and write permissions" (so `GITHUB_TOKEN` can push to GHCR).
- Repo → Settings → Secrets and variables → Actions:
  - **Variables**: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AUTH_SERVICE_URL`,
    `PRODUCTION_URL`, and optionally `DEPLOY_PATH`
  - **Secrets**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`,
    `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, optionally `DEPLOY_PORT`, and
    `GHCR_READ_TOKEN`
- Create a `production` GitHub Environment. Add required reviewers there if
  production deployments should wait for manual approval.
- `GHCR_READ_TOKEN` should be a classic PAT with only `read:packages`.
- Create `DEPLOY_KNOWN_HOSTS` from a trusted machine with
  `ssh-keyscan -H <server-host>` (add `-p <port>` for a non-default SSH port).
- After the first successful run, the GHCR packages (`passbar-frontend`, `passbar-backend`) are created as **private** by default — either set them to public (package → Package settings → Change visibility) or `docker login ghcr.io` on the server with a PAT that has `read:packages`.

## Topology

One Lightsail instance, two separately-managed docker-compose stacks, joined by shared external networks:

| Stack | Repo | Manages | Network membership |
|---|---|---|---|
| Host stack | `~/docker-compose.yaml` (not in any app repo) | `postgres` (shared DB), `nginx-proxy-manager` (NPM), other unrelated services | `database-network` (postgres), `npm_network` (NPM) |
| PassBar stack | `/home/ubuntu/apps/passbar/docker-compose.yml` | `frontend`, `backend` | `database-network`, `npm_network` |
| auth-service stack | `/home/ubuntu/apps/auth-service/docker-compose.yml` or existing auth-service compose | `auth-service` | `database-network`, `npm_network` |

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
mkdir -p /home/ubuntu/apps/passbar
cd /home/ubuntu/apps/passbar

# First time only: copy these files from this repo's infra/ folder:
#   docker-compose.yml
#   deploy.sh
#   .env.example
cp .env.example .env
nano .env
chmod +x deploy.sh
docker login ghcr.io -u wayneclub

./deploy.sh <image-tag>
```

**auth-service** — still builds locally on the server (no CI pipeline set up for it yet, it's not on GitHub):
```bash
cd /home/ubuntu/apps/auth-service
git pull --ff-only
docker compose build
docker compose up -d
```

## NPM proxy hosts

Containers on `npm_network` are reachable from NPM by container name. In the NPM admin UI (`:81`), create proxy hosts:

| Domain | Forward to |
|---|---|
| `passbar.wayneclub.com` | `passbar-frontend:3000` |
| `passbar.wayneclub.com/api/*` | `passbar-backend:4000` (or route `/api` at the Next.js level if simpler) |
| `auth.wayneclub.com` | `auth-service:4010` |

Enable "Force SSL" + request a Let's Encrypt cert per host as usual.

## Calendar feed subscription (webcal)

Each user gets a per-user subscription URL (Profile page → 匯出日曆): a 5-year
signed token embedded in `https://passbar.wayneclub.com/api/calendar/feed?token=…`
(the `<a>` rewrites it to `webcal://…`). The URL's host comes entirely from the
build-time `NEXT_PUBLIC_API_URL` — it is NOT auto-corrected by Cloudflare.

Requirements for external calendar clients (Google/Apple fetch it anonymously —
the token in the query IS the auth), all config, not code:

| Item | Requirement |
|---|---|
| `NEXT_PUBLIC_API_URL` (GitHub repo **variable**, build-time) | `https://passbar.wayneclub.com/api` — baked into the frontend image at build; setting it only in runtime `.env` does nothing |
| Cloudflare SSL/TLS mode | **Full (strict)** — "Flexible" fights NPM's Force SSL → redirect loop (`ERR_TOO_MANY_REDIRECTS`) |
| Cloudflare Bot Fight / WAF | Add an **allow/skip** rule for path `/api/calendar/feed*` — otherwise Google's `Google-Calendar-Importer` bot gets a challenge page instead of the `.ics` and the subscription silently stops updating |
| Cloudflare proxy (orange cloud) | Fine here — the feed is on 443, which CF proxies. (Contrast: SSH on 22 must bypass CF via direct IP / grey cloud.) |
| NPM | Existing `passbar.wayneclub.com/api/*` → `passbar-backend:4000` rule already covers it |

Verify after deploy (should print `BEGIN:VCALENDAR`, not a CF challenge page or a
redirect). Get a real token from the Profile page, or any logged-in `GET /api/auth/calendar-token`:

```bash
curl -sSL -A "Google-Calendar-Importer" "https://passbar.wayneclub.com/api/calendar/feed?token=<TOKEN>" | head -5
```

If you get HTML (a CF challenge) → fix the WAF/Bot rule; if it loops or errors on
TLS → check the Cloudflare SSL mode is Full (strict).

## Responsibility (which container owns what)

- **frontend** (`passbar-frontend`, port 3000): renders UI, calls `backend` for app data and `auth-service` for login/session. No DB access.
- **backend** (`passbar-backend`, port 4000): PassBar business data (questions, attempts, todos, push). Verifies JWTs issued by `auth-service` (`JWT_SECRET` must match exactly) — never issues tokens itself.
- **auth-service** (port 4010, separate repo): identity/session/membership only — Google OAuth, JWT issuance, refresh tokens. Owns its own DB/schema, never PassBar's product tables.

## Restart behavior

All three app containers use `restart: unless-stopped` — they come back after a host reboot or crash, but stay down if you intentionally `docker compose stop` them. `watchtower` in the host stack does NOT auto-update these (it only watches whatever's in `~/docker-compose.yaml`); redeploy via `deploy.sh` / the auth-service commands above to ship new code.

## Logs

Each service uses the `json-file` driver with `max-size: 10m, max-file: 3` (30MB cap per container, auto-rotated) so logs can't fill the disk. Tail with:

```bash
docker compose -f /home/ubuntu/apps/passbar/docker-compose.yml logs -f backend
docker compose -f /home/ubuntu/apps/passbar/docker-compose.yml logs -f frontend
docker compose -f /home/ubuntu/apps/auth-service/docker-compose.yml logs -f auth-service
```

## DB migrations

`backend` and `auth-service` both use Drizzle. Migrations run as a one-off step in `deploy.sh` (backend) — `auth-service` should do the same (`npx drizzle-kit migrate`) before `up -d` if its schema changed. Migrations are never run automatically on container start, so a bad migration can't silently take down a running deploy.

## Troubleshooting

**GitHub Actions deploy job fails at "Validate deployment configuration"**
A required secret is missing or empty. The error lists which one(s) — go to
Settings → Secrets and variables → Actions and check `DEPLOY_HOST`,
`DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `GHCR_READ_TOKEN`.

**Deploy job fails at the SSH step**
`DEPLOY_KNOWN_HOSTS` is stale (server was rebuilt/IP changed) or the SSH key
was rotated. Regenerate from a trusted machine:
`ssh-keyscan -H <server-host>` (add `-p <port>` if non-default) and update the
`DEPLOY_KNOWN_HOSTS` secret.

**`deploy.sh` fails with "Missing .env"**
First-time setup on a new/rebuilt server — `infra/.env` doesn't exist yet.
SSH in, `cd /home/ubuntu/apps/passbar`, `cp .env.example .env`, fill in real
values, then re-run.

**Containers never become healthy / deploy times out and rolls back**
1. `docker compose -f /home/ubuntu/apps/passbar/docker-compose.yml logs --tail=200 backend frontend`
2. Common causes: `DATABASE_URL` wrong or Postgres unreachable (check
   `database-network` is attached), `JWT_SECRET`/`SERVICE_SECRET` mismatch
   with `auth-service` (backend will fail auth-dependent calls but should
   still pass its own healthcheck — check logs for the actual error), or a
   migration that errored (see next item).

**Migration step fails during deploy**
The deploy aborts before `up -d`, so the *old* containers keep running — prod
is not down. Fix the migration locally, push a new commit, deploy again. To
inspect what happened: `docker compose -f /home/ubuntu/apps/passbar/docker-compose.yml run --rm backend node dist/src/db/migrate.js` on the server and read the
output directly.

**`docker compose pull` fails with unauthorized / image not found**
GHCR packages are private by default after the first publish. Either make
`passbar-frontend`/`passbar-backend` public (GitHub → your profile → Packages
→ package settings → Change visibility), or run
`docker login ghcr.io -u <github-username>` on the server with a PAT that has
`read:packages`.

**Site loads but shows a stale version after a successful deploy**
`nginx-proxy-manager` cached the old container IP. The deploy script already
tries to reload it automatically; if that step was skipped or NPM was
restarted separately, manually run `docker exec nginx-proxy-manager nginx -s reload`.

**Frontend can't reach backend or auth-service (CORS / network errors in browser)**
Check `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_AUTH_SERVICE_URL` (GitHub Actions
**Variables**, not `infra/.env` — these are baked in at build time). If they
look correct, the image needs to be rebuilt after changing them; editing
`infra/.env` on the server has no effect on these.

**I changed something in `infra/` but the server still runs the old version**
`infra/docker-compose.yml` and `infra/deploy.sh` are only copied to the server
by the GitHub Actions deploy job (see "Update deployment files" step), not
read from this repo directly. Push to `main` so Actions re-copies them, or
manually `scp` the updated files to `/home/ubuntu/apps/passbar/` if you need
it sooner.
