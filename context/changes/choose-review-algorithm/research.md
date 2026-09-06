---
change_id: choose-review-algorithm
researched_at: 2026-09-06
inputs:
  - context/foundation/roadmap.md (F-02, S-05)
  - context/foundation/tech-stack.md
search_tool: WebSearch (Exa MCP server connected but not yet loaded in this session — see note below)
---

## Constraint recap

- **PRD non-goal:** must use an *existing* spaced-repetition algorithm/library — no bespoke algorithm (roadmap "Parked" list, F-02 risk note).
- **Tech-stack hard constraints** (`context/foundation/tech-stack.md`): Astro 6 SSR + React 19 islands + TypeScript, deployed as **Cloudflare Workers** (`workerd` runtime, not Node.js), npm package manager. Any candidate must:
  - run under `workerd` (no Node-only built-ins like `fs`, native `crypto` module, etc.)
  - be plain TS/JS installable via npm
  - ideally have zero/minimal runtime dependencies to keep the Worker bundle small

## Candidates researched

| Library | Algorithm | Runtime deps | Module formats | License | npm downloads/mo | Last release | Edge/Workers fit |
|---|---|---|---|---|---|---|---|
| **[ts-fsrs](https://www.npmjs.com/package/ts-fsrs)** | FSRS (v4/v6) | **0** | ESM + CJS + UMD | MIT | ~583,400 | 2026-09-01 (v5.4.2, 84 releases) | Pure TS/JS, no Node built-ins; community reports (e.g. `@squeakyrobot/fsrs`, a Workers-focused fork of the same algorithm) confirm it runs on Cloudflare Workers, Vercel Edge, Deno Deploy |
| **[supermemo](https://www.npmjs.com/package/supermemo)** ([VienDinhCom](https://github.com/VienDinhCom/supermemo)) | SM-2 | 0 | ESM + CJS | MIT | ~12,400 | v2.0.23 | Pure TS port of the original Delphi SM-2, no Node built-ins — should run fine, but far less battle-tested at scale |
| `supermemo2` | SM-2 | — | — | — | low | — | Minor alternative SM-2 port; not evaluated in depth given `ts-fsrs` and `supermemo` already cover both algorithm families |
| `@squeakyrobot/fsrs` | FSRS v4.5/v6 | — | — | — | low | — | Explicitly markets itself as edge-runtime-ready, but is a thin wrapper around the same FSRS algorithm with far smaller adoption than `ts-fsrs` itself |

## Algorithm comparison (FSRS vs SM-2)

- **SM-2**: fixed-multiplier interval growth, the original Anki/SuperMemo algorithm from 1987. Simple, predictable, easy to explain in a PRD/README.
- **FSRS**: models forgetting as a continuous function fit to review history; per current research, ~4% recall-prediction error vs SM-2's ~14%, and users typically see 20-30% fewer daily reviews at the same retention target. It's the algorithm Anki itself now ships (added in 23.10, still opt-in as of 2026). Actively maintained by the Open Spaced Repetition org.

## Recommendation

**`ts-fsrs`** — implements FSRS, zero runtime dependencies, ships ESM/CJS/UMD, MIT-licensed, by far the most downloaded and most actively maintained option, and has confirmed edge-runtime compatibility (matches the Cloudflare Workers deployment target in `tech-stack.md`). It satisfies the PRD's "existing algorithm" non-goal directly — no bespoke scheduling logic needs to be written, only integration code (persist `Card` state per flashcard per user, call `fsrs().next()` on each review).

**Fallback**: `supermemo` (SM-2) if a simpler, more explainable algorithm is preferred over FSRS's statistical model — same integration shape, much smaller and simpler state per card (`interval`, `repetition`, `efactor` vs. FSRS's richer memory-state fields).

## Note on tooling

This research used the built-in `WebSearch`/`WebFetch` tools, not Exa. The `exa` MCP server is configured and shows "Connected" via `claude mcp list`, but its tools weren't registered in this Claude Code session (likely needs a client restart to pick up the newly added server — matches Exa's own troubleshooting guidance). Re-run with Exa's tools after a restart if a second source is wanted.

## Open question for the user

Confirm: adopt **FSRS via `ts-fsrs`** for F-02, or prefer **SM-2 via `supermemo`**? This choice unblocks F-02 and S-05, and resolves Open Roadmap Question 1.
