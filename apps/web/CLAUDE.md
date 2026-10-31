@AGENTS.md

# ai-travel-web (frontend)

Next.js 16 App Router + Tailwind v4 + shadcn/ui (`base-nova`) + Motion + Mapbox GL; TypeScript strict.
Read on demand, only the § the task names: `../../PROJECT.md` (the project overview: §7 communication,
§6 this app, §9 config, §12 open work) and `../../ARCHITECTURE.md` (design rationale). Finished tickets are history
in `../../docs/archive/`; don't update them.

## Commands
- From this folder: `pnpm dev` (port `${WEB_PORT:-55360}`) · `pnpm build` · `pnpm lint` · `pnpm typecheck`
- Before calling a task done: `pnpm lint && pnpm typecheck`

## Conventions
- Server components by default; `"use client"` only for the streaming dashboard and interactive pieces.
- Run state lives in one hook fed by `readSseEvents()`; components stay presentational.
- Parse every incoming SSE packet with the contracts schema before use.
- Types come from `@ai-travel/contracts`; never redeclare them. No API calls from the browser except the agent, Mapbox and Google Identity.
- Color is never the only signal (e.g. "Confirmed" = badge + check icon + accent border).
- shadcn/ui primitives before custom ones; icons from `lucide-react`.
- `NEXT_PUBLIC_AGENT_URL` unset = UI-only mode; `NEXT_PUBLIC_MAPBOX_TOKEN` unset = schematic map.
- **Every new external API needs a timeout, a fallback and a `source` field** (the UI shows "Estimate" / hides the chip
  instead of failing). See `PROJECT.md` §8.
- Error codes come from `@ai-travel/contracts` (`ErrorCode`); `ERROR_MESSAGES` must have a message for each.
- Works at 375 px: no sideways scroll, 44 px touch targets.
- If code deviates from `PROJECT.md`, update it in the same PR. Match surrounding code; no drive-by refactors.

## Design check
Visual design: `../../design-agents-planning.png` (live run) and `../../design-trip-overview.png`
(finished trip). "Check the design" (or any UI task): open BOTH, then use the `design-check` skill.
The design wins over the spec; report mismatches.

## Workflow
Implementing an open-work item (`PROJECT.md` §12) → `implement-ticket` skill.
