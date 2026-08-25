#!/usr/bin/env bash
#
# ModelMesh — one-shot developer setup.
#
# Everything here is a check plus the minimum action to fix it. Nothing is
# hard-coded: hosts and ports come from the environment (repo `.env`, then the
# shell), which is the same precedence `apps/api/src/config.ts` uses.
#
# Postgres and Redis are *optional*. The backend runs `PERSISTENCE=auto` and
# `CACHE_BACKEND=auto`, falling back to in-process implementations, and the
# deterministic mock provider covers the pipeline with zero API keys — so a
# missing datastore is a warning, not a failure.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

readonly REQUIRED_NODE_MAJOR=20
readonly REQUIRED_PNPM_MAJOR=11
readonly API_FILTER='@modelmesh/api'

warnings=0

info() { printf '\033[36m›\033[0m %s\n' "$1"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$1"; }
warn() {
  printf '\033[33m!\033[0m %s\n' "$1"
  warnings=$((warnings + 1))
}
fail() {
  printf '\033[31m✗\033[0m %s\n' "$1" >&2
  exit 1
}

section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── 1. Toolchain ─────────────────────────────────────────────────────────────
section "Toolchain"

command -v node >/dev/null 2>&1 || fail "Node is not installed. ModelMesh needs Node >= ${REQUIRED_NODE_MAJOR}."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt "$REQUIRED_NODE_MAJOR" ]; then
  fail "Node $(node --version) is too old; >= ${REQUIRED_NODE_MAJOR} is required."
fi
ok "Node $(node --version)"

if ! command -v pnpm >/dev/null 2>&1; then
  fail "pnpm is not installed. Run: corepack enable && corepack prepare pnpm@11.23.0 --activate"
fi
pnpm_major="$(pnpm --version | cut -d. -f1)"
if [ "$pnpm_major" -lt "$REQUIRED_PNPM_MAJOR" ]; then
  fail "pnpm $(pnpm --version) is too old; >= ${REQUIRED_PNPM_MAJOR} is required (see package.json packageManager)."
fi
ok "pnpm $(pnpm --version)"

# ── 2. Environment file ──────────────────────────────────────────────────────
section "Environment"

if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from .env.example (no provider keys — the mock provider will be used)"
else
  ok ".env present"
fi

# Same precedence as config.ts: the file provides defaults, the shell wins.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# ── 3. Dependencies ──────────────────────────────────────────────────────────
section "Dependencies"

info "pnpm install"
pnpm install
ok "Workspace dependencies installed"

# ── 4. Datastores (optional) ─────────────────────────────────────────────────
section "Datastores"

url_host() {
  local rest="${1#*://}"
  rest="${rest#*@}"
  rest="${rest%%/*}"
  rest="${rest%%\?*}"
  printf '%s' "${rest%%:*}"
}

url_port() {
  local rest="${1#*://}"
  rest="${rest#*@}"
  rest="${rest%%/*}"
  rest="${rest%%\?*}"
  if [ "$rest" = "${rest%%:*}" ]; then
    printf '%s' "$2"
  else
    printf '%s' "${rest##*:}"
  fi
}

tcp_probe() {
  timeout 3 bash -c "exec 3<>/dev/tcp/$1/$2" >/dev/null 2>&1
}

postgres_up=0
if [ -n "${DATABASE_URL:-}" ]; then
  pg_host="$(url_host "$DATABASE_URL")"
  pg_port="$(url_port "$DATABASE_URL" 5432)"
  if tcp_probe "$pg_host" "$pg_port"; then
    postgres_up=1
    ok "Postgres reachable at ${pg_host}:${pg_port}"
  else
    warn "Postgres not reachable at ${pg_host}:${pg_port} — the API will run with PERSISTENCE=memory. Start it with: docker compose up -d postgres"
  fi
else
  warn "DATABASE_URL is not set — the API will run with the in-process store"
fi

if [ -n "${REDIS_URL:-}" ]; then
  redis_host="$(url_host "$REDIS_URL")"
  redis_port="$(url_port "$REDIS_URL" 6379)"
  if tcp_probe "$redis_host" "$redis_port"; then
    ok "Redis reachable at ${redis_host}:${redis_port}"
  else
    warn "Redis not reachable at ${redis_host}:${redis_port} — cache and queue fall back to in-process. Start it with: docker compose up -d redis"
  fi
else
  warn "REDIS_URL is not set — cache and queue will run in-process"
fi

# ── 5. Prisma ────────────────────────────────────────────────────────────────
section "Prisma"

info "prisma generate"
pnpm --filter "$API_FILTER" exec prisma generate >/dev/null
ok "Prisma client generated"

if [ "$postgres_up" -eq 1 ]; then
  info "prisma migrate dev (this may prompt if the schema has drifted)"
  pnpm --filter "$API_FILTER" exec prisma migrate dev --name init
  ok "Database migrated"
else
  warn "Skipped prisma migrate — no reachable Postgres. Run ./scripts/setup.sh again after starting it."
fi

# ── 6. Verify the backend ────────────────────────────────────────────────────
section "Backend"

info "pnpm --filter $API_FILTER test"
pnpm --filter "$API_FILTER" test
ok "Backend test suite passed"

# ── 7. Next steps ────────────────────────────────────────────────────────────
section "Next steps"

cat <<'STEPS'
Backend
  pnpm --filter @modelmesh/api dev          # http://localhost:3000, API under /api/v1
  ./scripts/test-providers.ts               # end-to-end smoke test (works with the mock provider)
  pnpm run seed                             # register real provider keys from .env, if you have any

Android  (needs JDK 17, Android SDK 35, Android Studio Ladybug or newer)
  cd apps/android
  gradle wrapper --gradle-version 8.11.1    # gradlew/gradle-wrapper.jar are binaries and are not committed
  ./gradlew :app:assembleDebug
  # Point the app at a backend by adding to apps/android/local.properties:
  #   MODELMESH_API_BASE_URL=http://10.0.2.2:3000/api/v1/
  #   MODELMESH_WS_BASE_URL=http://10.0.2.2:3000
  #   MODELMESH_API_KEY=<the same value as API_SECRET in .env>
  # A physical device needs your machine's LAN IP in both URLs *and* in
  # apps/android/app/src/main/res/xml/network_security_config.xml.
STEPS

if [ "$warnings" -gt 0 ]; then
  printf '\n\033[33mSetup finished with %d warning(s).\033[0m The stack still runs: memory persistence, in-process cache, mock provider.\n' "$warnings"
else
  printf '\n\033[32mSetup complete.\033[0m\n'
fi
