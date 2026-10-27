@AGENTS.md

# ai-travel-web (frontend)

Next.js 16 App Router + Tailwind v4 + shadcn/ui (`base-nova`) + Framer Motion + Mapbox GL; TypeScript strict.
Read on demand, only the § the task names: `SPEC.md` (this app), `PLAN.md` (tickets),
`../../ARCHITECTURE.md` (system design, SSE protocol, contracts — source of truth).

## Commands
- From this folder: `pnpm dev` (port `${CONDUCTOR_PORT:-3000}`) · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm mock-agent` (fake agent on `CONDUCTOR_PORT + 1`)
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

## No tests in this app
This app has no tests, test runner or test configuration (unit, component and e2e were removed to save time).
- Do NOT write, add or restore tests, test dependencies (vitest, Testing Library, jsdom, Playwright, axe) or test configs.
- Skip "Tests:" lines in tickets and the test sections of `SPEC.md` / `PLAN.md`; they are out of scope.
- Verify by running the app (`pnpm dev` + `pnpm mock-agent`) and by `pnpm lint && pnpm typecheck && pnpm build`.
- `test/mock-agent/` and `test/fixtures/` are dev tooling for `pnpm mock-agent`, not tests; keep them.
- Remove this section only when the user brings tests back.

## Workflow
Implementing a PLAN ticket → `implement-ticket` skill.
