# Docker Production Setup — Design Spec

**Date:** 2026-06-27
**Status:** Approved for planning

## Overview

Make the realtime chat app deployable to a single production host with Docker
Compose. Three services — Postgres, the NestJS backend, and the React Router
frontend — run together, orchestrated by one `docker-compose.prod.yml`. Per the
chosen approach there is **no reverse proxy and no TLS**: the backend and
frontend are exposed on two separate host ports and CORS is configured
explicitly between the two origins.

## Repositories

Two existing sibling repos:
- Backend: `/home/huyendt/projects/chat-app` (NestJS 11 + TypeORM + Socket.IO).
- Frontend: `/home/huyendt/projects/chat-app-react` (React Router v8, SSR via
  `react-router-serve`).

The production orchestration files live in the **backend** repo (it already
holds the dev `docker-compose.yml`). The frontend service builds from the
sibling path `../chat-app-react`. This assumes both repos sit side by side.

## Topology

```
                 Browser
               /          \
       :8080 (frontend)    :3000 (backend)      ← two origins, explicit CORS
   react-router-serve       NestJS + Socket.IO
       (SSR shell)               |
                                 | (compose network: DB_HOST=db)
                              db: Postgres 16
                          (NOT exposed to host)
```

- All client↔backend traffic (REST + Socket.IO) is browser→`:3000` directly.
  The SSR server only serves the app shell; it makes no backend calls.
- Postgres is reachable only on the internal compose network (no host port),
  so it is not exposed to the internet.
- Host ports `8080` (frontend) and `3000` (backend) are defaults; both are
  configurable.

## Components

### Backend Dockerfile (new) — `chat-app/Dockerfile`

Multi-stage, `node:24-alpine`:
1. `deps`: copy `package*.json`, `npm ci`.
2. `build`: copy source + deps, `npm run build` → `dist/`.
3. `runtime`: `npm ci --omit=dev`, copy `dist/`, `NODE_ENV=production`,
   `EXPOSE 3000`, `CMD ["node", "dist/main.js"]`.

### Backend `.dockerignore` (new) — `chat-app/.dockerignore`

Excludes `node_modules`, `dist`, `.env`, `.env.*` (secrets are injected at
runtime via compose `env_file`, never baked into the image), `test`, `.git`,
`.superpowers`, `coverage`, `docs`.

### Frontend Dockerfile (modified) — `chat-app-react/Dockerfile`

The existing multi-stage Dockerfile already builds and runs
`react-router-serve` (listens on container port 3000). Changes:
- Add a build arg `VITE_API_URL` and set it as an env var in the build stage so
  Vite bakes the production backend URL into the client bundle. The client uses
  `import.meta.env.VITE_API_URL` (see `app/lib/env.ts`) for REST + Socket.IO.
- Add `.git` and `.superpowers` to `.dockerignore`.

### `docker-compose.prod.yml` — `chat-app/docker-compose.prod.yml`

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASS}
      POSTGRES_DB: ${DB_NAME}
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${DB_USER}']
      interval: 5s
      timeout: 5s
      retries: 5
    # no ports — internal only

  backend:
    build: .
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    env_file: [.env.prod]
    environment:
      DB_HOST: db
    ports: ['3000:3000']

  frontend:
    build:
      context: ../chat-app-react
      args:
        VITE_API_URL: ${VITE_API_URL}
    restart: unless-stopped
    ports: ['8080:3000']

volumes:
  pgdata:
```

### Config & secrets — `chat-app/.env.prod.example`

```
# Backend
PORT=3000
JWT_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_STRING   # REQUIRED — never use the dev default
JWT_EXPIRES=7d
CLIENT_ORIGIN=http://localhost:8080            # frontend public origin (CORS)
DB_HOST=db
DB_PORT=5432
DB_USER=chat
DB_PASS=CHANGE_ME
DB_NAME=chat
DB_SYNCHRONIZE=true

# Frontend build arg (consumed by compose, baked into the client bundle)
VITE_API_URL=http://localhost:3000             # backend public URL
```

The real `.env.prod` is gitignored; only `.env.prod.example` is committed.
`CLIENT_ORIGIN` and `VITE_API_URL` must be set to the deployment host's actual
URLs (e.g. `http://<host-ip>:8080` / `http://<host-ip>:3000`).

**Compose interpolation gotcha:** the `${DB_USER}`, `${DB_PASS}`, `${DB_NAME}`,
and `${VITE_API_URL}` placeholders in `docker-compose.prod.yml` are resolved by
Compose at parse time from the `--env-file` (or the default `.env`), NOT from a
service's `env_file:`. So the stack must be launched with
`--env-file .env.prod` (see "How to run") for those to resolve. The backend's
`env_file: [.env.prod]` separately injects the full set of vars into the backend
container at runtime.

### Code change — make `synchronize` env-driven

`src/config/typeorm.config.ts` currently hardcodes `synchronize: true`. Change
it to read `DB_SYNCHRONIZE` (default `true` when unset, so existing dev behavior
is unchanged): `synchronize: config.get('DB_SYNCHRONIZE') !== 'false'`. Per the
chosen approach, production keeps `synchronize=true`; this change only makes it
flippable later without a code edit.

## CORS

The backend already reads `CLIENT_ORIGIN` for both REST (`main.ts`,
`app.enableCors`) and Socket.IO (the gateway, with `import 'dotenv/config'` at
the top of `main.ts` ensuring env is loaded before the gateway decorator
evaluates). Production needs no code change for CORS — only `CLIENT_ORIGIN` set
to the frontend's public origin so the two origins are allowed.

## How to run

From the backend repo, with a populated `.env.prod`, using `--env-file` so
Compose can resolve the `${...}` interpolations:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Verification: `docker compose -f docker-compose.prod.yml ps` shows all three
healthy; `curl http://localhost:3000/auth/login -X POST -H 'Content-Type:
application/json' -d '{"username":"prod_smoke"}'` returns a token; the frontend
loads at `http://localhost:8080`.

## Error handling / operational notes

- `depends_on: condition: service_healthy` ensures the backend starts only after
  Postgres is accepting connections.
- `restart: unless-stopped` on all long-running services.
- Postgres data persists in the `pgdata` named volume across restarts.
- Backend startup runs TypeORM with `synchronize=true`, creating the schema on
  first boot.

## Testing

- Build both images successfully (`docker compose -f docker-compose.prod.yml
  build`).
- Bring the stack up and verify a production smoke: login over REST, frontend
  page loads, and a Socket.IO round-trip (two clients exchange a message) works
  against the composed backend — mirroring the integration smoke already used in
  development.
- Confirm Postgres is NOT reachable from the host (no published port).
- Confirm CORS: a request from the configured `CLIENT_ORIGIN` is allowed and an
  unlisted origin is not reflected.

## Caveats (documented, accepted for this scope)

- **No TLS / no reverse proxy.** For real internet exposure, front the stack
  with a TLS-terminating proxy or CDN. As-is it serves plain HTTP on two ports.
- **`synchronize=true` in production** can alter the schema or lose data when
  entities change. Acceptable for demo/non-critical data only; switch to
  migrations before storing real data (flip `DB_SYNCHRONIZE=false` and add
  migrations).
- **Single host, in-memory presence.** No horizontal scaling; a second backend
  instance would not share presence (needs a Redis Socket.IO adapter — out of
  scope).
- **`VITE_API_URL` is baked at build time.** Changing the backend's public URL
  requires rebuilding the frontend image.

## Out of Scope (YAGNI)

- Reverse proxy, TLS/HTTPS, automatic certificate management.
- TypeORM migrations (kept as a documented future step).
- CI/CD pipeline, image registry, multi-host/orchestrator deployment.
- Redis adapter for multi-instance Socket.IO.
- Log aggregation, monitoring, healthcheck endpoints beyond Postgres.
