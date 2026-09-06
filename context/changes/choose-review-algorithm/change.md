---
change_id: choose-review-algorithm
title: Choose review algorithm
status: new
created: 2026-09-06
updated: 2026-09-06
archived_at: null
---

## Notes

Decision: adopt **FSRS via `ts-fsrs`** (npm, MIT, zero runtime deps) as the review algorithm for FR-009 / S-05.

Rationale (see `research.md` for full comparison):
- Satisfies the PRD non-goal of using an *existing* algorithm rather than a bespoke one.
- Compatible with the Cloudflare Workers (`workerd`) deployment target — zero dependencies, no Node-only built-ins, ships ESM/CJS/UMD.
- Most downloaded and most actively maintained option researched (~583k downloads/mo, released 2026-09-01), and statistically outperforms the SM-2 fallback (`supermemo` package) — ~4% recall-prediction error vs ~14%, 20-30% fewer daily reviews at equal retention.
