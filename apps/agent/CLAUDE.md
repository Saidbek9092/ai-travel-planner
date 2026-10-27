# ai-travel-agent (backend)

Express 5 + LangGraph service; ESM, Node LTS, TypeScript strict, Zod everywhere.
Read on demand, only the § the task names: `PLAN.md` (Part 1 tickets B1–B25, Part 2 spec §1–§14 for this app),
`../../ARCHITECTURE.md` (system design, SSE protocol, contracts — source of truth).

## Commands
- From this folder: `pnpm dev` (tsx watch) · `pnpm build` · `pnpm lint` · `pnpm typecheck`
- Before calling a task done: `pnpm lint && pnpm typecheck` (no tests, see below)

## Conventions
- Graph: 5 nodes (supervisor, flight, hotel, planner, budget) in `src/agent/nodes/*.node.ts`; routers are pure.
- Every SSE packet goes through `utils/sseStreamer.ts` and is validated with `SseEventSchema`.
- Env is read once in `config.ts` (Zod). Never touch `process.env` elsewhere.
- Tools sit behind `TravelSearchTool` with a mock fallback (`TOOLS_MODE`); nodes never call vendors directly.
- Budget Auditor is pure and re-plans at most `MAX_BUDGET_RETRIES` (2) times.
- Errors: throw `AppError` (`utils/errors.ts`); if `res.headersSent` the handler only logs and ends.
- Cross-service types come only from `@ai-travel/contracts`; secrets and vendor calls stay here.
- Changing a packet shape means updating `packages/contracts`, `ARCHITECTURE.md` §5–§6 and the web spec.
- If code deviates from `PLAN.md` Part 2, update the spec in the same PR. Match surrounding code; no drive-by refactors.

## Design check
"Check the design" (or any task changing packets / DRAFT / RESULT): open BOTH
`../../design-agents-planning.png` and `../../design-trip-overview.png`, then use the
`design-check` skill. The design wins over the spec; report mismatches.

## TEMPORARY — no tests (agent)
All tests have been removed from `apps/agent` on purpose; a testing phase comes after the features are done.
- Do NOT write, add, edit, restore or run tests (unit, integration, e2e), fixtures or test helpers.
- Skip every "Tests:" bullet and test-only ticket in `PLAN.md` (e.g. B15); mark them "⏸ deferred" instead.
- Do not add test dependencies or test config. `pnpm test` is a no-op (`--passWithNoTests`).
- Verify with `pnpm lint && pnpm typecheck`, and a manual run (`pnpm dev`) when behaviour changes.
Remove this section when the user starts the testing phase.

## Workflow
Implementing a PLAN ticket → `implement-ticket` skill.
