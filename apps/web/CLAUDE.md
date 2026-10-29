@AGENTS.md

# ai-travel-web (frontend)

Next.js 16 App Router + Tailwind v4 + shadcn/ui (`base-nova`) + Framer Motion + Mapbox GL; TypeScript strict.
Read on demand, only the § the task names: `SPEC.md` (this app), `PLAN.md` (open work only),
`../../ARCHITECTURE.md` (system design, SSE protocol, contracts — source of truth). Finished tickets are history in
`../../docs/archive/`; don't update them.

## Commands
- From this folder: `pnpm dev` (port `${CONDUCTOR_PORT:-3000}`) · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm mock-agent` (fake agent on `CONDUCTOR_PORT + 1`) · `pnpm e2e` (Playwright; starts its own mock agent and app on ports 3100/3101)
- Before calling a task done: `pnpm lint && pnpm typecheck`, and `pnpm e2e` when a user flow changes

## Conventions
- Server components by default; `"use client"` only for the streaming dashboard and interactive pieces.
- Run state lives in one hook fed by `readSseData()`; components stay presentational.
- Parse every incoming SSE packet with the contracts schema before use.
- Types come from `@ai-travel/contracts`; never redeclare them. No API calls from the browser except the agent and Mapbox.
- Color is never the only signal (e.g. "Confirmed" = badge + check icon + accent border).
- shadcn/ui primitives before custom ones; icons from `lucide-react`.
- `NEXT_PUBLIC_AGENT_URL` unset = UI-only mode; `NEXT_PUBLIC_MAPBOX_TOKEN` unset = map disabled.
- **Every new external API needs a timeout, a fallback and a `source` field** (the UI shows "Estimate" / hides the chip
  instead of failing). See `ARCHITECTURE.md` §8.
- Error codes come from `@ai-travel/contracts` (`ErrorCode`); `ERROR_MESSAGES` must have a message for each.
- Works at 375 px: no sideways scroll, 44 px touch targets (the e2e `mobile` project checks every screen).
- If code deviates from `SPEC.md`, update the spec in the same PR. Match surrounding code; no drive-by refactors.

## Design check
Visual design: `../../design-agents-planning.png` (live run) and `../../design-trip-overview.png`
(finished trip). "Check the design" (or any UI task): open BOTH, then use the `design-check` skill.
The design wins over the spec; report mismatches.

## Tests
- Playwright end-to-end tests in `e2e/` against the mock agent (`SPEC.md` §10); a new user flow gets a spec there.
- `test/mock-agent/` and `test/fixtures/` serve both `pnpm mock-agent` and the e2e tests; when the agent gains an
  endpoint, the mock agent gets it too.
- Also verify by running the app (`pnpm dev` + `pnpm mock-agent`) and `pnpm build`.

## Workflow
Implementing a PLAN ticket → `implement-ticket` skill.
