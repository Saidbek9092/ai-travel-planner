# ai-travel-agent (backend)

Express 5 + LangGraph service; ESM, Node LTS, TypeScript strict, Zod everywhere.
Read on demand, only the § the task names: `../../PROJECT.md` (the project spec: §5 communication, §7 this service,
§8 agents, §9 tools, §13 config, §18 open work) and `../../ARCHITECTURE.md` (design rationale). Finished tickets are
history in `../../docs/archive/`; don't update them.

## Commands
- From this folder: `pnpm dev` (tsx watch) · `pnpm build` · `pnpm lint` · `pnpm typecheck`
- Before calling a task done: `pnpm lint && pnpm typecheck`

## Conventions
- Graph: 5 nodes (supervisor, flight, hotel, planner, budget) in `src/agent/nodes/*.node.ts`; routers are pure.
- Every SSE packet goes through `utils/sseStreamer.ts` and is validated with `SseEventSchema`.
- Env is read once in `config.ts` (Zod). Never touch `process.env` elsewhere.
- Tools sit behind `TravelSearchTool` with a mock fallback (`TOOLS_MODE`); nodes never call vendors directly.
- **Every new external API needs a timeout, a fallback and a `source` field** on the data it produces (fallback = mock
  data or a `null` field, never a failed run). See `PROJECT.md` §11.
- Budget Auditor is pure and re-plans at most `MAX_BUDGET_RETRIES` (2) times.
- Errors: throw `AppError` (`utils/errors.ts`); if `res.headersSent` the handler only logs and ends.
- Cross-service types come only from `@ai-travel/contracts`; secrets and vendor calls stay here.
- Changing a packet shape means updating `packages/contracts` and `PROJECT.md` §5–§6 (and `ARCHITECTURE.md` §5–§6). A change that would
  break a stored `ResultPayload` bumps `RESULT_SCHEMA_VERSION` and adds a step to `upgradeResultPayload`.
- If code deviates from `PROJECT.md`, update it in the same PR. Match surrounding code; no drive-by refactors.

## Design check
"Check the design" (or any task changing packets / DRAFT / RESULT): open BOTH
`../../design-agents-planning.png` and `../../design-trip-overview.png`, then use the
`design-check` skill. The design wins over the spec; report mismatches.

## Workflow
Implementing an open-work item (`PROJECT.md` §18) → `implement-ticket` skill.
