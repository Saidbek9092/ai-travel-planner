---
name: implement-ticket
description: Implement one ticket from apps/agent/PLAN.md (B*) or apps/web/PLAN.md (T*). Use when the user names a ticket or says "do the next ticket".
---

# Implement a PLAN ticket

1. Find the ticket in `apps/<app>/PLAN.md`; note its Goal, Depends on, and the SPEC § it cites.
2. Confirm dependencies are merged (`git log --oneline`); stop and say so if not.
3. Read only the cited spec sections (`apps/web/SPEC.md`, or `apps/agent/PLAN.md` Part 2) and the `ARCHITECTURE.md` sections the ticket lists.
   If the task touches UI or packets, run the `design-check` skill first.
4. Implement exactly the ticket scope. One ticket = one branch = one PR; no drive-by refactors.
5. If the implementation deviates from the SPEC, update the SPEC in the same change.
6. Run `pnpm lint && pnpm typecheck` (filter to the app). Do not add tests (temporary project rule).
7. Commit and open a PR only when the user asks.
