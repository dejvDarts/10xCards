---
change_id: client-state-and-input-hardening
title: "Test rollout Phase 3: client-state integrity + server-side input hardening"
status: implementing
created: 2026-09-09
updated: 2026-09-09
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of `context/foundation/test-plan.md`: "Client-state
& input hardening". Risks covered: #5, #6. Test types planned: integration + component.

Risk response intent:

- **#5 (optimistic-update rollback drift).** Prove that after an edit, delete, or create —
  **including a failed one** — the list shown matches what is actually persisted, with no
  stuck stale card or phantom entry. Must challenge that "the UI updated immediately" means
  the server accepted the change. Cheapest layer: integration/component test on the client
  hook — simulate a failing mutation and assert the rollback (and pagination bookkeeping
  after a delete). Avoid testing only the successful-mutation path.
- **#6 (untrusted input bypassing server-side validation).** Prove that an oversized,
  malformed, or boundary-violating payload sent **directly to an API route** (bypassing the
  UI) is rejected and never persisted. Must challenge that "the UI form prevents bad input"
  means the route independently validates it. Cheapest layer: integration — POST adversarial
  payloads straight to the route. Avoid testing only through the UI, and avoid copying the
  validation logic into the test as the expected value (assert the boundary/behavior, not
  the reimplemented rule).

Builds on the harness from rollout Phases 1–2 (`tests/integration/helpers/`, the `unit` /
`integration` Vitest projects). Component testing of client hooks is a **new layer** —
`test-plan.md` §4 lists "component tests on client hooks" as required after this phase, and
§6.5 is still a TBD stub. Client hooks live in `src/components/hooks/`.
