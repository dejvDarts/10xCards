#!/usr/bin/env bash
# PostToolUse (Write|Edit): run ONLY the tests whose module graph includes the
# edited file (`vitest related`). exit 0 = pass / nothing related ; exit 2 = a
# related test failed.
#
# Highest-risk area — context/foundation/test-plan.md Risk #1 (a user reaching
# another user's flashcards) and Risk #4 (auth/session gating): src/pages/api/**
# and src/middleware.ts. Those are defended by the `integration` project, which
# needs a local Supabase (`npx supabase start`). For a risk-area edit we add a
# second `vitest related` pass over that project, but only when the local stack
# answers a health check — a stopped Docker then means "fewer tests ran", never
# a false failure. (The integration project can't share one CLI invocation with
# the others — its Astro/Cloudflare config breaks multi-project init — so it is
# a separate call.)
source "$(dirname "$0")/_shared.sh"

case "$REL" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac
case "$REL" in
  src/* | tests/*) ;;
  *) exit 0 ;;
esac

# vitest >= 4.1 emits compact, agent-friendly output when AI_AGENT=1.
# Harmless on the pinned 3.2.x.
export AI_AGENT=1

rc=0

# Pass 1 — always: the Docker-free projects.
npx vitest related "$REL" --run --project unit --project components 1>&2 || rc=$?

# Pass 2 — risk area only, and only if the local Supabase is reachable.
case "$REL" in
  src/pages/api/* | src/middleware.ts)
    if curl -sf --max-time 1 http://127.0.0.1:54321/auth/v1/health >/dev/null 2>&1; then
      npx vitest related "$REL" --run --project integration 1>&2 || rc=$?
    else
      echo "note: local Supabase down — skipped integration tests for $REL (run \`npx supabase start\`)." >&2
    fi
    ;;
esac

if [ "$rc" -ne 0 ]; then
  echo "" >&2
  echo "A test related to $REL failed — fix it before continuing." >&2
  exit 2
fi
