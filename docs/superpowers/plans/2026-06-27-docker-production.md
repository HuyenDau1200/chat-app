# Docker Production Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat app deployable to a single host via one `docker-compose.prod.yml` running Postgres + NestJS backend + React Router frontend, with no reverse proxy and no TLS (two exposed ports, explicit CORS).

**Architecture:** A new multi-stage backend Dockerfile, a small build-arg tweak to the existing frontend Dockerfile (to bake `VITE_API_URL`), and a production compose file that wires the three services. Postgres stays internal (no host port); backend on host `:3000`, frontend on host `:8080`. Secrets/config come from a gitignored `.env.prod`.

**Tech Stack:** Docker, Docker Compose, `node:24-alpine`, `postgres:16-alpine`, NestJS 11 (TypeORM), React Router v8 (`react-router-serve`).

## Global Constraints

- Backend repo: `/home/huyendt/projects/chat-app` (holds all orchestration files). Frontend repo (sibling): `/home/huyendt/projects/chat-app-react`.
- No reverse proxy, no TLS. Backend exposed on host `:3000`, frontend on host `:8080` (both map to container port `3000`).
- Postgres is internal-only — NEVER publish a host port for `db` in the prod compose.
- Secrets via gitignored `.env.prod`; only `.env.prod.example` is committed. `JWT_SECRET` and `DB_PASS` must NOT use dev defaults.
- `CLIENT_ORIGIN` (backend CORS) = frontend public origin; `VITE_API_URL` (frontend build arg, baked into client bundle) = backend public URL.
- `synchronize` stays `true` in production per the chosen approach, but is made env-driven via `DB_SYNCHRONIZE` (default `true`; `false` disables).
- Compose `${...}` interpolation resolves from `--env-file`, NOT from a service `env_file:` — the stack is launched with `docker compose --env-file .env.prod -f docker-compose.prod.yml ...`.
- Backend unit tests run with `npm test` (Jest), from the backend repo.

---

### Task 1: Backend production image + env-driven synchronize

**Files:**
- Create: `chat-app/Dockerfile`
- Create: `chat-app/.dockerignore`
- Create: `chat-app/.env.prod.example`
- Modify: `chat-app/src/config/typeorm.config.ts`
- Modify: `chat-app/.gitignore` (add `.env.prod`)
- Test: `chat-app/src/config/typeorm.config.spec.ts`

**Interfaces:**
- Consumes: existing `typeOrmConfig(config: ConfigService): TypeOrmModuleOptions` and the env var names `PORT, JWT_SECRET, JWT_EXPIRES, CLIENT_ORIGIN, DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME`.
- Produces: a buildable backend image whose entrypoint is `node dist/main.js` on port 3000; `DB_SYNCHRONIZE` env var controlling TypeORM `synchronize`; `.env.prod.example` documenting all prod env vars.

- [ ] **Step 1: Write the failing test for env-driven synchronize**

Create `chat-app/src/config/typeorm.config.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { typeOrmConfig } from './typeorm.config';

const cfg = (vals: Record<string, string>) =>
  ({ get: (k: string) => vals[k] }) as unknown as ConfigService;

describe('typeOrmConfig', () => {
  it('enables synchronize by default (unset)', () => {
    expect((typeOrmConfig(cfg({})) as any).synchronize).toBe(true);
  });

  it('keeps synchronize true when DB_SYNCHRONIZE=true', () => {
    expect((typeOrmConfig(cfg({ DB_SYNCHRONIZE: 'true' })) as any).synchronize).toBe(true);
  });

  it('disables synchronize when DB_SYNCHRONIZE=false', () => {
    expect((typeOrmConfig(cfg({ DB_SYNCHRONIZE: 'false' })) as any).synchronize).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/huyendt/projects/chat-app && npm test -- typeorm.config`
Expected: FAIL — the third case fails because `synchronize` is currently hardcoded `true` (and/or the file currently has no logic reading `DB_SYNCHRONIZE`).

- [ ] **Step 3: Make `synchronize` env-driven**

In `chat-app/src/config/typeorm.config.ts`, change the hardcoded line:

```ts
  synchronize: true, // dev only — see Global Constraints
```

to:

```ts
  synchronize: config.get<string>('DB_SYNCHRONIZE') !== 'false', // default true; set DB_SYNCHRONIZE=false to disable
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/huyendt/projects/chat-app && npm test -- typeorm.config`
Expected: PASS (3 tests). Also run the full suite `npm test` — expected all green (still 12 + 3 = 15 tests).

- [ ] **Step 5: Create `chat-app/.dockerignore`**

```
node_modules
dist
.env
.env.*
test
coverage
.git
.superpowers
docs
```

- [ ] **Step 6: Create `chat-app/Dockerfile`**

```dockerfile
# --- install all deps (for build) ---
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- compile TypeScript ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- production deps only ---
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime ---
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

- [ ] **Step 7: Create `chat-app/.env.prod.example`**

```
# Backend
PORT=3000
JWT_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_STRING
JWT_EXPIRES=7d
CLIENT_ORIGIN=http://localhost:8080
DB_HOST=db
DB_PORT=5432
DB_USER=chat
DB_PASS=CHANGE_ME
DB_NAME=chat
DB_SYNCHRONIZE=true

# Frontend build arg (baked into the client bundle by compose)
VITE_API_URL=http://localhost:3000
```

- [ ] **Step 8: Add `.env.prod` to `chat-app/.gitignore`**

Append a line `.env.prod` under the existing dotenv section (the current patterns `.env`, `.env.*.local` do NOT cover `.env.prod`).

- [ ] **Step 9: Verify the backend image builds and runs against Postgres**

Run (uses the existing dev `db` container or starts it; the dev compose maps host `5434`):

```bash
cd /home/huyendt/projects/chat-app
docker build -t chat-backend:prod .
docker compose up -d db    # dev postgres, healthy on the compose network + host 5434
# run the image on the host network pointing at the dev db (host port 5434)
docker run --rm -d --name cb-test --network host \
  -e PORT=3000 -e JWT_SECRET=test-secret -e JWT_EXPIRES=7d \
  -e CLIENT_ORIGIN=http://localhost:8080 \
  -e DB_HOST=localhost -e DB_PORT=5434 -e DB_USER=chat -e DB_PASS=chat -e DB_NAME=chat \
  chat-backend:prod
sleep 6
curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"username":"prod_smoke"}'
docker logs cb-test | tail -5
docker stop cb-test
```

Expected: `docker build` succeeds; the curl returns `{"userId":"...","username":"prod_smoke","token":"..."}`; logs show "Nest application successfully started". (If host `:3000` is occupied, stop the offending process first.)

- [ ] **Step 10: Commit**

```bash
cd /home/huyendt/projects/chat-app
git add Dockerfile .dockerignore .env.prod.example .gitignore src/config/typeorm.config.ts src/config/typeorm.config.spec.ts
git commit -m "feat: backend production Dockerfile + env-driven synchronize"
```

---

### Task 2: Frontend production image with baked `VITE_API_URL`

**Files:**
- Modify: `chat-app-react/Dockerfile` (build stage: add `ARG`/`ENV VITE_API_URL`)
- Modify: `chat-app-react/.dockerignore` (add `.git`, `.superpowers`, `.idea`)

**Interfaces:**
- Consumes: the existing frontend build (`npm run build` → `react-router build`) and `app/lib/env.ts` which reads `import.meta.env.VITE_API_URL`.
- Produces: a frontend image that, when built with `--build-arg VITE_API_URL=<url>`, bakes that URL into the client bundle and serves the app on container port 3000 via `react-router-serve`.

- [ ] **Step 1: Add the build arg to the build stage of `chat-app-react/Dockerfile`**

The current build stage is:

```dockerfile
FROM node:24-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build
```

Replace it with (adds `ARG` + `ENV` BEFORE `npm run build` so Vite sees it):

```dockerfile
FROM node:24-alpine AS build-env
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build
```

Leave the other three stages (development-dependencies-env, production-dependencies-env, final runtime with `CMD ["npm", "run", "start"]`) unchanged.

- [ ] **Step 2: Update `chat-app-react/.dockerignore`**

Current content is:

```
.react-router
build
node_modules
README.md
```

Replace with:

```
.react-router
build
node_modules
README.md
.git
.superpowers
.idea
```

- [ ] **Step 3: Verify the image builds and bakes the URL**

```bash
cd /home/huyendt/projects/chat-app-react
docker build --build-arg VITE_API_URL=http://example.test:3000 -t chat-frontend:prod .
# confirm the URL was baked into the client bundle
docker run --rm chat-frontend:prod sh -c "grep -rl 'example.test:3000' build/client/assets | head -1" \
  && echo "VITE_API_URL baked into client bundle"
# confirm it serves
docker run --rm -d --name cf-test -p 8080:3000 chat-frontend:prod
sleep 4
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080
docker stop cf-test
```

Expected: build succeeds; the grep finds at least one client asset containing `example.test:3000` (proving the build arg was baked); the curl returns `200`. (If host `:8080` is occupied, pick another host port for the check.)

- [ ] **Step 4: Commit**

```bash
cd /home/huyendt/projects/chat-app-react
git add Dockerfile .dockerignore
git commit -m "feat: bake VITE_API_URL build arg into frontend production image"
```

---

### Task 3: Production compose orchestration

**Files:**
- Create: `chat-app/docker-compose.prod.yml`

**Interfaces:**
- Consumes: the backend image build context (`.`), the frontend build context (`../chat-app-react` with build arg `VITE_API_URL`), and `.env.prod` for both `--env-file` interpolation and the backend `env_file`.
- Produces: a one-command-up production stack (db internal, backend `:3000`, frontend `:8080`).

- [ ] **Step 1: Create `chat-app/docker-compose.prod.yml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASS}
      POSTGRES_DB: ${DB_NAME}
    volumes:
      - pgdata:/var/lib/postgresql/data
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
      db:
        condition: service_healthy
    env_file:
      - .env.prod
    environment:
      DB_HOST: db
    ports:
      - '3000:3000'

  frontend:
    build:
      context: ../chat-app-react
      args:
        VITE_API_URL: ${VITE_API_URL}
    restart: unless-stopped
    ports:
      - '8080:3000'

volumes:
  pgdata:
```

- [ ] **Step 2: Create a local `.env.prod` for verification**

(This file is gitignored — it is only for the verification run, not committed.)

```bash
cd /home/huyendt/projects/chat-app
cp .env.prod.example .env.prod
# set non-default secrets and host-internal DB_HOST for the verify run
sed -i 's#^JWT_SECRET=.*#JWT_SECRET=prod-verify-secret-please-change#' .env.prod
sed -i 's#^DB_PASS=.*#DB_PASS=chatprodpass#' .env.prod
sed -i 's#^DB_HOST=.*#DB_HOST=db#' .env.prod
```

- [ ] **Step 3: Bring the stack up and verify it builds + boots**

Run:

```bash
cd /home/huyendt/projects/chat-app
# free host :3000 / :8080 if a dev process holds them
for p in 3000 8080; do for pid in $(lsof -ti:$p 2>/dev/null); do kill "$pid" 2>/dev/null; done; done
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
sleep 12
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

Expected: all three services running; `db` shows `healthy`. (Build pulls images on first run — allow extra time.)

- [ ] **Step 4: Verify REST, frontend serving, CORS, and that Postgres is NOT exposed**

Run:

```bash
cd /home/huyendt/projects/chat-app
echo "--- REST login (backend :3000) ---"
curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"username":"compose_smoke"}'
echo; echo "--- frontend serves (:8080) ---"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080
echo "--- Socket.IO handshake CORS reflects CLIENT_ORIGIN (http://localhost:8080) ---"
curl -s -D - "http://localhost:3000/socket.io/?EIO=4&transport=polling" -H "Origin: http://localhost:8080" -o /dev/null | grep -i "access-control-allow-origin"
echo "--- Postgres must NOT be reachable on host :5432 ---"
(curl -s --max-time 3 http://localhost:5432 >/dev/null 2>&1; nc -z -w2 localhost 5432 2>/dev/null && echo "REACHABLE (FAIL)" || echo "not reachable on host (correct)")
```

Expected: login returns a JSON token; frontend returns `200`; the Socket.IO handshake response includes `Access-Control-Allow-Origin: http://localhost:8080`; port 5432 is NOT reachable on the host.

- [ ] **Step 5: Tear down the verification stack**

```bash
cd /home/huyendt/projects/chat-app
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```

Expected: services stop and are removed (the `pgdata` volume persists, which is correct).

- [ ] **Step 6: Commit**

```bash
cd /home/huyendt/projects/chat-app
git add docker-compose.prod.yml
git commit -m "feat: production docker-compose orchestration (db + backend + frontend)"
```

(Do NOT commit `.env.prod` — it is gitignored from Task 1.)

---

## Self-Review Notes (plan vs spec)

- **Spec coverage:** backend Dockerfile + .dockerignore (Task 1); env-driven synchronize (Task 1, with unit test); `.env.prod.example` + gitignore `.env.prod` (Task 1); frontend Dockerfile build arg + .dockerignore (Task 2); `docker-compose.prod.yml` with internal db, backend `:3000`, frontend `:8080`, env_file, build args (Task 3); `--env-file .env.prod` run command + interpolation gotcha (Task 3, Global Constraints); CORS verified via Socket.IO handshake header (Task 3); Postgres-not-exposed verified (Task 3). No CORS code change needed (already env-driven from prior work) — confirmed, no task required.
- **Type/value consistency:** env var names (`PORT, JWT_SECRET, JWT_EXPIRES, CLIENT_ORIGIN, DB_*, DB_SYNCHRONIZE, VITE_API_URL`) match across `.env.prod.example`, compose, and the Dockerfiles. Container port 3000 consistent; host ports 3000 (backend) / 8080 (frontend) consistent. `DB_SYNCHRONIZE !== 'false'` logic matches the test in Task 1.
- **Caveats** (no TLS, synchronize=true, single-host, baked VITE_API_URL) are documented in the spec; no task attempts to solve them (out of scope).
