<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Quality-Gates Wiring (Test Rollout Phase 4)

- **Plan**: context/changes/quality-gates-wiring/plan.md
- **Scope**: Full plan — Phase 1 (fast test job + deploy gating), Phase 2 (integration test job), Phase 3 (doc sync)
- **Date**: 2026-09-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria Verification

### Automated — all passed

| Phase | Checks | Result |
|---|---|---|
| 1 | 1.1 YAML valid + jobs have runs-on/steps; 1.2 `npm test` 43; 1.3 `npm run test:components` 6; 1.4 lint+build; 1.5 `deploy.needs: [ci, test]` | PASS (local) — SHA `f2831a8` |
| 2 | 2.1 YAML/`test-integration` shape; 2.2 `supabase status -o env` non-empty; 2.3 CI-path sim (`.dev.vars` hidden) `npm run test:integration` 72/0; 2.4 `deploy.needs: [ci, test, test-integration]`; 2.5 `deploy` diff = `needs:` line only | PASS (local) — SHA `616a74a` |
| 3 | 3.1 AGENTS.md has "Vitest", stale line gone; 3.2 "test-integration" in CLAUDE.md + test-plan.md; 3.3 §3 Phase 4 ≠ "not started"; 3.4 lint+build | PASS — SHA `ff92cb5` |

### Manual — verified in production CI

- **PR #8** (`pull_request` run `34446081761`): `ci` ✅ 1m14s, `test` ✅ 1m2s, `test-integration` ✅ 3m6s (`Tests 72 passed`, `Stopped supabase local development setup`), `deploy` ⏭️ skipped (PR guard). → 1.6, 1.7 (PR half), 2.6, 2.7, 2.9.
- **Merge run** (`push` on `master` `34447043314`): `ci` ✅, `test` ✅, `test-integration` ✅ (72/72), `deploy` ✅ — ran only after all three test jobs, executed `Push Supabase migrations` + `npm run build` + `wrangler deploy`. → 1.7 (master half), 2.8.
- **3.5 / 3.6** — docs read-through: `AGENTS.md`, `CLAUDE.md` §CI, `test-plan.md` §3/§6.6 read accurately; §6.6 Phase 4 note matches the Phase 1-3 style.
- **1.8** (concurrency-cancel) — left `[ ]`, not deliberately exercised; `concurrency: cancel-in-progress` is present in the committed workflow and is standard GH Actions behaviour. See F1 — its scope is the actual concern, not whether it fires.

## Findings

### F1 — Workflow-level `concurrency: cancel-in-progress` also covers the `deploy` job

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:11-13
- **Detail**: `concurrency` is declared at the workflow level with `group: ${{ github.workflow }}-${{ github.ref }}` and `cancel-in-progress: true`, so it applies to **every** job, `deploy` included. If a second push to `master` lands while a previous `master` run is still in its `deploy` job, GitHub cancels the older run mid-flight — potentially during `npx supabase db push --project-ref "$REF" --yes` or `wrangler deploy`. `wrangler deploy` is close to atomic, but a SIGKILL mid-`db push` interacts with the exact failure class `context/foundation/lessons.md` was written for (migrations half-applied against the cloud project). Actual damage is bounded — Postgres applies each migration in its own transaction, so an interrupted push rolls back the in-flight migration and the next successful run resumes — but "a production deploy can be silently cancelled" should be a conscious choice, not a side effect. The plan (Phase 1 Contract) deliberately put `concurrency` at workflow level for the PR-iteration benefit; it just didn't carve out `deploy`. Not caught earlier because 1.8 (the concurrency manual check) was never exercised and the merge run happened to have no follow-up push.
- **Fix A ⭐ Recommended**: Gate cancellation to PR runs — `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
  - Strength: One-line change; keeps the "supersede stale PR runs" benefit exactly where the expensive `test-integration` iteration happens, and lets every `push`→`master` run (which owns `deploy`) finish.
  - Tradeoff: Two rapid `master` pushes now queue a full ~6-min CI+deploy each instead of the later superseding the earlier — acceptable, `master` pushes are rare here.
  - Confidence: HIGH — standard GH Actions expression; `deploy` already guards on `github.event_name == 'push'` so the two conditions align.
  - Blind spot: None significant.
- **Fix B**: Move `concurrency` to job level on `test` + `test-integration` only, leaving `ci` and `deploy` uncovered.
  - Strength: Most explicit about which jobs are cancellable.
  - Tradeoff: More YAML; `ci` (lint+build on a PR) loses supersede behaviour for no strong reason.
  - Confidence: MED — equivalent outcome, more surface.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A) — `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` at `.github/workflows/ci.yml:11-14`, with a comment. YAML re-validated. `push`→`master` runs now always finish their `deploy`.

### F2 — `test-plan.md` edits went beyond the Phase 3 Contract (stale Phase 3 rows fixed)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/test-plan.md — §3 table row 3, §6.6 "Phase 3 —" paragraph
- **Detail**: Phase 3's Contract says update the §3 **Phase 4** row + append a §6.6 **Phase 4** note, and "do not touch §1–§5 or other §6 subsections". The shipped edit also corrected the stale **Phase 3** §3 row (`not started` / `—` → `complete` / archived path) and its §6.6 "in progress" → "complete, archived" line. Both are factually right — client-state-and-input-hardening was archived 2026-09-09 and its §3 row had simply never been updated — and they sit in the same table / subsection being edited, so this is the same benign staleness-correction pattern accepted as F4 in the client-state review. Flagged so `/10x-archive` and future readers see it was deliberate, not drift.
- **Fix**: None — keep the corrections. Recorded here.
- **Decision**: ACCEPTED — corrections kept (factually right; client-state archived 2026-09-09). Same benign staleness-fix pattern as F4 in the client-state review.

### F3 — Adjacent stale line in `AGENTS.md` left untouched

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: AGENTS.md:33
- **Detail**: The Phase 3 edit rewrote the two stale bullets in the "Testing, commits & CI" section that the plan named (the "no test framework" line + the CI-pipeline sentence). The third bullet in that same section — "Commit convention is not yet established — the repo has no history; agree a prefix style ... before the first batch of commits." — is also stale (the repo now has extensive Conventional-Commits history) but was outside the plan's Contract and left as-is. Correct scope discipline for this change; noted only so it isn't lost.
- **Fix**: Fix in a follow-up doc pass (or fold into the next `/10x-*` change that touches `AGENTS.md`).
- **Decision**: FIXED — `AGENTS.md:33` rewritten to state Conventional Commits + the husky/lint-staged pre-commit hooks (no `--no-verify`).

## Notes

- **No production/application code changed** — diff is `.github/workflows/ci.yml`, `AGENTS.md`, `CLAUDE.md`, `context/foundation/test-plan.md`, and the change folder. Confirmed against `git log --after=2026-09-10`.
- **`deploy` job integrity** — 2.5's automated check plus the merge-run logs confirm the `deploy` job's only change is its `needs:` line; `Push Supabase migrations` (`supabase db push --project-ref "$REF" --yes` + `SUPABASE_ACCESS_TOKEN`), `npm run build`, and `wrangler-action` are byte-for-byte intact and all ran green on the merge.
- **`eval "$(npx supabase status -o env)"`** in the env-export step is intentional, not a smell: `-o env` emits quoted `KEY="value"` lines that a raw `>> $GITHUB_ENV` would carry literal quotes into (breaking the handler's key). The `eval` + re-`echo` strips them; the step carries a comment explaining the `PUBLISHABLE_KEY ?? ANON_KEY` mirror. Input is the just-started local CLI, values are the static local JWTs — no untrusted-input exposure.
- **No `-x` service trim adopted** — plan flagged it as opt-in with a plain-`start` fallback; shipped plain. CI cold-start measured at ~1m12s (image pull) in the merge run — within the research estimate; Docker-image caching remains the documented follow-up.
- **Local `master` is 1 commit ahead of `origin/master`** — the epilogue `ef2ec2c` (change-folder only) is unpushed, per the 10x workflow's no-push rule. The Phase 1-3 commits reached `origin/master` via the PR #8 merge.
