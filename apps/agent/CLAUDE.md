# ai-travel-agent (backend)

Express 5 + LangGraph service; ESM, Node LTS, TypeScript strict, Zod everywhere.
Read on demand, only the § the task names: `SPEC.md` (this app), `PLAN.md` (tickets),
`../../ARCHITECTURE.md` (system design, SSE protocol, contracts — source of truth).

## Commands
- From this folder: `pnpm dev` (tsx watch) · `pnpm build` · `pnpm lint` · `pnpm typecheck`
- Before calling a task done: `pnpm lint && pnpm typecheck`

## Conventions
- Graph: 5 nodes (supervisor, flight, hotel, planner, budget) in `src/agent/nodes/*.node.ts`; routers are pure.
- Every SSE packet goes through `utils/sseStreamer.ts` and is validated with `SseEventSchema`.
- Env is read once in `config.ts` (Zod). Never touch `process.env` elsewhere.
- Tools sit behind `TravelSearchTool` with a mock fallback (`TOOLS_MODE`); nodes never call vendors directly.
- Budget Auditor is pure and re-plans at most `MAX_BUDGET_RETRIES` (2) times.
- Errors: throw `AppError` (`utils/errors.ts`); if `res.headersSent` the handler only logs and ends.
- Cross-service types come only from `@ai-travel/contracts`; secrets and vendor calls stay here.
- Changing a packet shape means updating `packages/contracts`, `ARCHITECTURE.md` §5–§6 and the web spec.
- If code deviates from `SPEC.md`, update the spec in the same PR. Match surrounding code; no drive-by refactors.

## Design check
"Check the design" (or any task changing packets / DRAFT / RESULT): open BOTH
`../../design-agents-planning.png` and `../../design-trip-overview.png`, then use the
`design-check` skill. The design wins over the spec; report mismatches.

## TEMPORARY — no tests
Do NOT write, add or edit tests (unit, integration, e2e) or test tickets. Existing tests may be run.
Remove this section when the user lifts the rule.

## Workflow
Implementing a PLAN ticket → `implement-ticket` skill.
