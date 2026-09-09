---
change_id: testing-critical-path-coverage
title: Bootstrap test suite and cover cross-user access and auth-gating risks
status: implementing
created: 2026-09-09
updated: 2026-09-09
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Critical-path coverage".
Risks covered: #1, #4. Test types planned: unit + integration.
Risk response intent:
- #1: prove a user can never retrieve, modify, or delete another user's flashcard via any exposed route, even by guessing/crafting IDs; must challenge that authentication alone proves authorization.
- #4: prove an unauthenticated request to any protected route/endpoint is redirected/rejected while an authenticated user is never blocked; must challenge that a rendering page implies the auth check ran.
After creating the folder, follow the downstream continuation rule.
