---
name: implement-ticket
description: Implement one item of open work from apps/agent/PLAN.md or apps/web/PLAN.md (or a Notion ticket). Use when the user names a ticket or says "do the next ticket".
---

# Implement a PLAN ticket

1. Find the item in `apps/<app>/PLAN.md` (or the Notion ticket); note its goal and the SPEC § it touches. Finished tickets in `docs/archive/` are history only.
2. Confirm dependencies are merged (`git log --oneline`); stop and say so if not.
3. Read only the cited spec sections (`apps/web/SPEC.md`, or `apps/agent/SPEC.md`) and the `ARCHITECTURE.md` sections the ticket lists.
   If the task touches UI or packets, run the `design-check` skill first.
4. Implement exactly the ticket scope. One ticket = one branch = one PR; no drive-by refactors.
5. If the implementation deviates from the SPEC, update the SPEC in the same change. When the item is done, delete it from `PLAN.md` and record the outcome in the SPEC or `ARCHITECTURE.md`.
6. Run `pnpm lint && pnpm typecheck` (filter to the app).
7. Commit and open a PR only when the user asks.
