@AGENTS.md

# ai-travel-web (frontend)

Next.js 16 App Router + Tailwind v4 + shadcn/ui (`base-nova`) + Framer Motion + Mapbox GL; TypeScript strict.
Read on demand, only the § the task names: `SPEC.md` (this app), `PLAN.md` (tickets),
`../../ARCHITECTURE.md` (system design, SSE protocol, contracts — source of truth).

## Commands
- From this folder: `pnpm dev` (port `${CONDUCTOR_PORT:-3000}`) · `pnpm build` · `pnpm lint` · `pnpm typecheck`
- Before calling a task done: `pnpm lint && pnpm typecheck`

## Conventions
- Server components by default; `"use client"` only for the streaming dashboard and interactive pieces.
- Run state lives in one hook fed by `readSseData()`; components stay presentational.
- Parse every incoming SSE packet with the contracts schema before use.
- Types come from `@ai-travel/contracts`; never redeclare them. No API calls from the browser except the agent and Mapbox.
- Color is never the only signal (e.g. "Confirmed" = badge + check icon + accent border).
- shadcn/ui primitives before custom ones; icons from `lucide-react`.
- `NEXT_PUBLIC_AGENT_URL` unset = UI-only mode; `NEXT_PUBLIC_MAPBOX_TOKEN` unset = map disabled.
- If code deviates from `SPEC.md`, update the spec in the same PR. Match surrounding code; no drive-by refactors.

## Design check
Visual design: `../../design-agents-planning.png` (live run) and `../../design-trip-overview.png`
(finished trip). "Check the design" (or any UI task): open BOTH, then use the `design-check` skill.
The design wins over the spec; report mismatches.

## TEMPORARY — no tests
Do NOT write, add or edit tests (unit, component, e2e) or test tickets. Existing tests may be run.
Remove this section when the user lifts the rule.

## Workflow
Implementing a PLAN ticket → `implement-ticket` skill.
