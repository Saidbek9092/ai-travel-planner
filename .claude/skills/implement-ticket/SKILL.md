---
name: implement-ticket
description: Implement one item of open work from PROJECT.md §18 (or a Notion ticket). Use when the user names a ticket or says "do the next ticket".
---

# Implement an open-work item

1. Find the item in `PROJECT.md` §18 (or the Notion ticket); note its goal and the `PROJECT.md` sections it touches. Finished tickets in `docs/archive/` are history only.
2. Confirm dependencies are merged (`git log --oneline`); stop and say so if not.
3. Read only the `PROJECT.md` sections the item touches (and any `ARCHITECTURE.md` sections it lists).
   If the task touches UI or packets, run the `design-check` skill first.
4. Implement exactly the ticket scope. One ticket = one branch = one PR; no drive-by refactors.
5. If the implementation deviates from `PROJECT.md`, update it in the same change. When the item is done, delete it from `PROJECT.md` §18 and record the outcome in the section it belongs to.
6. Run `pnpm lint && pnpm typecheck` (filter to the app).
7. Commit and open a PR only when the user asks.
