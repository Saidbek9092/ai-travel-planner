# ai-travel-agent — Backend Technical Specification

> All paths below are relative to `apps/agent/`.
> System-wide design (graph, SSE protocol, contracts, deploy) is in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md);
> this file specifies how the agent service implements it.

---

## 1. Responsibilities

- Expose the trip API over HTTP and stream progress as typed SSE packets.
- Run the 5-node LangGraph workflow with checkpointing, bounded re-planning and fallbacks.
- Own every secret and every external call (OpenAI, SerpAPI, Tavily, PostgreSQL).
- Validate everything that crosses a boundary with Zod: env, request bodies, LLM outputs, outgoing packets.

Package name `ai-travel-agent`, ESM (`"type": "module"`), Node.js LTS, Express 5.

---

## 2. Folder structure

```text
apps/agent/
├── src/
│   ├── agent/
│   │   ├── state.ts               # Annotation.Root state, reducers, initial state
│   │   ├── graph.ts               # StateGraph wiring, routers, checkpointer, compile()
│   │   ├── llm.ts                 # + ChatOpenAI factory with GPT-4o → GPT-4o-mini fallback
│   │   ├── runTrip.ts             # + maps graph stream → SSE packets (stream controller)
│   │   └── nodes/
│   │       ├── supervisor.node.ts
│   │       ├── flight.node.ts
│   │       ├── hotel.node.ts
│   │       ├── planner.node.ts
│   │       └── budget.node.ts
│   ├── tools/
│   │   ├── types.ts               # + TravelSearchTool interface, query types, ToolUnavailableError
│   │   ├── serpApi.tool.ts        # live SerpAPI implementation
│   │   ├── mockTravel.tool.ts     # deterministic offline implementation
│   │   └── index.ts               # + withFallback(primary, mock) + tool selection by TOOLS_MODE
│   ├── middlewares/
│   │   ├── errorHandler.ts        # global error → JSON (pre-stream only)
│   │   └── rateLimiter.ts         # express-rate-limit instances
│   ├── utils/
│   │   ├── sseStreamer.ts         # SSE writer, validates every packet with SseEventSchema
│   │   ├── errors.ts              # + AppError + error codes
│   │   └── logger.ts              # + structured JSON logger
│   ├── app.ts                     # + createApp(deps): middlewares + routes, no listen (supertest)
│   ├── server.ts                  # boot: loadConfig → createApp → listen, graceful shutdown
│   └── config.ts                  # Zod-validated env
├── test/                          # Vitest unit + integration tests
├── .env.example                   # every variable from §4
├── package.json                   # name: ai-travel-agent
├── tsconfig.json                  # extends ../../tsconfig.base.json, NodeNext, src + test (typecheck)
├── tsconfig.build.json            # src only → dist/
└── eslint.config.js               # @eslint/js + typescript-eslint, Node globals
```

Files marked `+` are not in the blueprint tree; see ARCHITECTURE.md §15 for why they exist.

---

## 3. Dependencies

| Package | Purpose |
| --- | --- |
| `@ai-travel/contracts` (`workspace:*`) | Shared Zod schemas & types — the only source of cross-service types |
| `express` (v5) | HTTP server; v5 forwards rejected async handlers to the error handler |
| `cors`, `helmet` | CORS allow-list, security headers |
| `express-rate-limit` | Per-IP throttling |
| `@langchain/langgraph` | `StateGraph`, `Annotation`, `MemorySaver`, `START`/`END` |
| `@langchain/langgraph-checkpoint-postgres` | `PostgresSaver` for production |
| `@langchain/openai`, `@langchain/core` | `ChatOpenAI`, `withStructuredOutput`, `withFallbacks` |
| `zod` (`catalog:`) | Validation |
| `dotenv` | Load `apps/agent/.env` in development (`loadDotenv({ quiet: true })` inside `loadConfig()`) |
| dev: `typescript`, `tsx`, `vitest`, `supertest` | Build, watch mode, tests |

Scripts:

```json
{
  "dev": "tsx watch src/server.ts",
  "build": "tsc -p tsconfig.build.json",
  "start": "node dist/server.js",
  "test": "vitest run",
  "typecheck": "tsc --noEmit",
  "lint": "eslint ."
}
```

---

## 4. Configuration — `src/config.ts`

`parseConfig(env)` is a pure Zod parser (unit-tested); `loadConfig()` loads `.env`, parses `process.env`,
prints the issues and `process.exit(1)` on failure. `server.ts` calls `loadConfig()` once and **injects** the
typed `Config` (`createApp({ config, … })`, later `buildGraph`, `runTrip`), so importing a module never
triggers env parsing. Nothing outside `config.ts` reads `process.env`.

Blank values (`KEY=` copied from `.env.example`) count as unset. `WEB_ORIGIN` entries are normalised to
origins (`https://x.com/` → `https://x.com`) because CORS compares them to the browser's `Origin` exactly.

| Variable | Type / default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development \| test \| production`, default `development` | |
| `PORT` | int; default `CONDUCTOR_PORT + 1` if set, else `4000` | Render sets `PORT` |
| `CONDUCTOR_PORT` | int, optional | Conductor workspace base port |
| `WEB_ORIGIN` | comma-separated URLs; default `http://localhost:${CONDUCTOR_PORT ?? 3000}` | CORS allow-list |
| `OPENAI_API_KEY` | string, **required** | |
| `OPENAI_MODEL` | default `gpt-4o` | Primary model |
| `OPENAI_FALLBACK_MODEL` | default `gpt-4o-mini` | Fallback model |
| `SERPAPI_API_KEY` | string, optional | Missing → mock tools in `auto` mode |
| `TAVILY_API_KEY` | string, optional | Optional place research for the planner |
| `TOOLS_MODE` | `auto \| live \| mock`, default `auto` | `auto` = live if key present, else mock; tests use `mock` |
| `DATABASE_URL` | URL, optional | Present → `PostgresSaver`, else `MemorySaver` |
| `RUN_TIMEOUT_MS` | int, default `120000` | Whole-run timeout |
| `RATE_LIMIT_WINDOW_MS` | int, default `900000` (15 min) | |
| `RATE_LIMIT_MAX_RUNS` | int, default `10` | Max trip runs per IP per window |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY` | optional | LangGraph tracing |

Cross-field rules: in `production`, `WEB_ORIGIN` must be set explicitly (no localhost default);
`TOOLS_MODE=live` requires `SERPAPI_API_KEY`; `LANGSMITH_TRACING=true` requires `LANGSMITH_API_KEY`;
`DATABASE_URL` must be a `postgres://` / `postgresql://` URL.

---

## 5. HTTP layer — `src/server.ts`

### 5.1 Middleware order

1. `app.set('trust proxy', 1)` — Render sits behind one proxy; rate limiting needs the client IP.
2. `helmet()`
3. `cors({ origin: config.WEB_ORIGIN, methods: ['GET', 'POST'], exposedHeaders: ['X-Thread-Id'] })`
4. `express.json({ limit: '10kb' })`
5. `generalLimiter` on all `/api` routes; `runLimiter` additionally on the two run-starting routes
6. Routes
7. 404 handler → `AppError('NOT_FOUND')`
8. `errorHandler` (last)

**Do not add `compression()`** — it buffers the response and breaks SSE.

### 5.2 Routes

| Route | Behaviour |
| --- | --- |
| `GET /health` | `200 { status: "ok" }`. No rate limit. |
| `POST /api/trips` | `TripRequestSchema.safeParse(body)`; invalid → `400 VALIDATION_ERROR`. Otherwise `threadId = crypto.randomUUID()`, open SSE, call `runTrip({ threadId, request })`. |
| `POST /api/trips/:threadId/resume` | `threadId` must be a UUID and have a checkpoint (`graph.getState`), else `404`. If the run already reached `END` (`state.next` is empty), send its `RESULT` and close. Otherwise open SSE and call `runTrip({ threadId, resume: true })`. |
| `GET /api/trips/:threadId` | Latest checkpoint → `ResultPayload` JSON, `404` if unknown. Used by the web app after a reload. |

### 5.3 Errors — `utils/errors.ts`, `middlewares/errorHandler.ts`

```typescript
type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'RATE_LIMITED' | 'INTERNAL';
class AppError extends Error { constructor(public code: ErrorCode, message: string, public status: number) }
```

- Response shape: `{ "error": { "code": "...", "message": "..." } }`. `ZodError` → `400` with the
  flattened issues in `message`; unknown errors → `500 INTERNAL` with a generic message (stack only in logs).
- Body-parser errors keep the code set small: malformed JSON → `400 VALIDATION_ERROR`, body over 10 kb →
  `413 VALIDATION_ERROR`.
- **If `res.headersSent` is true (stream already open), the error handler must not write JSON.**
  Stream errors are handled inside `runTrip` (§7) — the handler only logs and ends the response.

### 5.4 Rate limiting — `middlewares/rateLimiter.ts`

| Limiter | Scope | Limit |
| --- | --- | --- |
| `generalLimiter` | `/api/*` | 100 requests / minute / IP |
| `runLimiter` | `POST /api/trips`, `POST /api/trips/:id/resume` | `RATE_LIMIT_MAX_RUNS` / `RATE_LIMIT_WINDOW_MS` / IP |

Use `standardHeaders: 'draft-7'`, `legacyHeaders: false`, and a handler that responds with the
standard error shape and code `RATE_LIMITED` (`429`). In-memory store is acceptable for a single
Render instance; switch to a shared store (e.g. Redis) before scaling horizontally.

### 5.5 Startup & shutdown

- Boot: validate config → create checkpointer (`PostgresSaver.fromConnString(url)` + `await setup()`) →
  compile graph → `listen(config.PORT)`.
- `SIGTERM`/`SIGINT`: stop accepting connections, abort all active runs (their streams end with
  `RESULT failed: "Server restarting, resume to continue"`), close the Postgres pool, exit within 10 s.
  The checkpoint makes these runs resumable.

---

## 6. SSE writer — `src/utils/sseStreamer.ts`

```typescript
class SseStreamer {
  constructor(res: Response);
  open(threadId: string): void;   // headers + flushHeaders() + start heartbeat
  send(event: SseEvent): void;    // SseEventSchema.parse → "id: n\ndata: <json>\n\n"
  close(): void;                  // stop heartbeat, res.end()
  get isClosed(): boolean;        // client gone or closed by us
}
```

- Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`, `X-Thread-Id: <threadId>`.
- Heartbeat: write `: ping\n\n` every 15 s.
- `send` validates with `SseEventSchema.parse`. A validation failure is a server bug: it throws, and
  `runTrip` turns it into a failed `RESULT`.
- `send` after close is a no-op (never throws on a closed socket).
- Progress monotonicity is enforced here: a `PROGRESS` with a lower percent than the last one sent is
  raised to the last value.

---

## 7. Stream controller — `src/agent/runTrip.ts`

```typescript
async function runTrip(args: {
  graph: CompiledTravelGraph;
  streamer: SseStreamer;
  threadId: string;
  request?: TripRequest;   // new run
  resume?: boolean;        // continue from last checkpoint
  signal: AbortSignal;     // client disconnect
}): Promise<void>;
```

1. `streamer.open(threadId)`; send `PROGRESS { 5, "parsing" }`.
2. `const signal = AbortSignal.any([clientAbort, AbortSignal.timeout(config.RUN_TIMEOUT_MS)])`.
   `clientAbort` comes from an `AbortController` aborted on `res.on('close')` when the response did not finish.
3. Input: new run → `initialState(request)`; resume → `null`.
4. `for await (const chunk of graph.stream(input, { configurable: { thread_id: threadId }, streamMode: 'updates', recursionLimit: 20, signal }))`
   - `chunk` is `{ [nodeName]: partialUpdate }`.
   - For each entry in `partialUpdate.logs ?? []` → `LOG` packet (these are only the node's new logs).
   - Then `PROGRESS` from the table in ARCHITECTURE.md §6.3, keyed by node name and the update's `status`.
5. After the loop: `const { values } = await graph.getState(config)` → send `RESULT` built from `values`
   (`status: values.status === 'failed' ? 'failed' : 'completed'`), then `streamer.close()`.
6. `catch`:
   - Aborted by client → just close (nobody is listening); log `outcome=aborted`.
   - Timeout or any other error → send `LOG { agent: "System", level: "error" }` and
     `RESULT { status: "failed", error: <safe message>, ... }` built from the latest checkpoint (partial
     data is fine), then close. Never leak stack traces or API keys in `error`.

---

## 8. LangGraph implementation

### 8.1 State — `src/agent/state.ts`

```typescript
import { Annotation } from '@langchain/langgraph';
import type { Flight, Hotel, ItineraryDay, TripStatus, AgentName, TripRequest } from '@ai-travel/contracts';

export interface LogEntry { timestamp: string; agent: AgentName; message: string; step: number; level: 'info' | 'warn' | 'error' }

const replace = <T>(fallback: () => T) => Annotation<T>({ reducer: (_prev, next) => next, default: fallback });
const append = <T>() => Annotation<T[]>({ reducer: (prev, next) => prev.concat(next), default: () => [] });

export const TravelAgentStateAnnotation = Annotation.Root({
  prompt: replace<string>(() => ''),
  overrides: replace<Omit<TripRequest, 'prompt'>>(() => ({})),
  origin: replace<string | null>(() => null),
  destination: replace<string>(() => ''),
  budget: replace<number>(() => 0),
  durationDays: replace<number>(() => 0),
  startDate: replace<string | null>(() => null),

  flights: replace<Flight[]>(() => []),
  hotels: replace<Hotel[]>(() => []),
  itinerary: replace<ItineraryDay[]>(() => []),
  dailyExpensesEstimate: replace<number>(() => 0),

  totalCost: replace<number>(() => 0),
  retryCount: replace<number>(() => 0),
  searchMode: replace<'standard' | 'cheaper'>(() => 'standard'),
  overBudgetBy: replace<number>(() => 0),
  status: replace<TripStatus>(() => 'parsing'),
  error: replace<string | null>(() => null),
  warnings: append<string>(),
  logs: append<LogEntry>(),
});

export type TravelAgentState = typeof TravelAgentStateAnnotation.State;
export type TravelAgentUpdate = typeof TravelAgentStateAnnotation.Update;
export const MAX_BUDGET_RETRIES = 2;
```

Helpers in the same file: `initialState(request)`, `nextStep(state)` (= last log's `step` + 1, or 1),
and `log(state, agent, message, level?)` that builds a `LogEntry` with the current ISO timestamp.

### 8.2 Graph — `src/agent/graph.ts`

```typescript
export function buildGraph(deps: { checkpointer: BaseCheckpointSaver; tools: TravelSearchTool; llm: LlmFactory }) {
  return new StateGraph(TravelAgentStateAnnotation)
    .addNode('supervisorAgent', supervisorNode(deps), { retryPolicy: { maxAttempts: 2 } })
    .addNode('flightAgent', flightNode(deps))
    .addNode('hotelAgent', hotelNode(deps))
    .addNode('itineraryPlanner', plannerNode(deps), { retryPolicy: { maxAttempts: 2 } })
    .addNode('budgetAuditor', budgetNode)
    .addEdge(START, 'supervisorAgent')
    .addConditionalEdges('supervisorAgent', routeAfterSupervisor, ['flightAgent', END])
    .addEdge('flightAgent', 'hotelAgent')
    .addConditionalEdges('hotelAgent', routeAfterHotel, ['itineraryPlanner', 'budgetAuditor'])
    .addEdge('itineraryPlanner', 'budgetAuditor')
    .addConditionalEdges('budgetAuditor', routeAfterAudit, ['flightAgent', END])
    .compile({ checkpointer: deps.checkpointer });
}

export const routeAfterSupervisor = (s: TravelAgentState) => (s.status === 'failed' ? END : 'flightAgent');
export const routeAfterHotel      = (s: TravelAgentState) => (s.itinerary.length > 0 ? 'budgetAuditor' : 'itineraryPlanner');
export const routeAfterAudit      = (s: TravelAgentState) => (s.status === 'searching' ? 'flightAgent' : END);
```

- Routers are **pure** and only read state; all decisions and counters are written by nodes.
- Dependencies are injected (`buildGraph(deps)`) so tests can pass a fake LLM and mock tools.
- Node names must never equal a state key (LangGraph throws at compile time).

### 8.3 Node contract

Every node is `(state: TravelAgentState) => Promise<TravelAgentUpdate>` and:

- returns **only** the keys it changes, including its own `logs` (1–3 entries, same `step`);
- never mutates `state`;
- throws only for unrecoverable errors (after its own fallbacks), which ends the run as `failed` and
  leaves the previous checkpoint intact for resume;
- uses `AgentName` values from contracts in logs: `Supervisor`, `FlightAgent`, `HotelAgent`,
  `ItineraryPlanner`, `BudgetAuditor`.

### 8.4 Nodes

**`supervisor.node.ts` — Supervisor** (LLM)
- Structured output schema: `{ origin: string | null, destination: string | null, budget: number | null, durationDays: number | null, startDate: string | null }`.
- System prompt: extract trip parameters only; never invent a budget or duration; return `null` when absent.
- Merge: request `overrides` win over parsed values. Default `startDate` = today + 30 days.
- Missing `destination`, `budget` or `durationDays` after merge → `{ status: 'failed', error: 'Please include …' }`
  with a `warn` log. This is a user-input failure, not a crash (the graph ends normally, `RESULT` has `status: failed`).
- Success → `status: 'searching'`, log e.g. `Planning 5 days in Paris from Tashkent, budget $1,000.`

**`flight.node.ts` — Flight Agent** (no LLM)
- `tools.searchFlights({ origin, destination, departDate, returnDate, mode: searchMode, maxPrice })`.
  `returnDate = startDate + durationDays`. In `cheaper` mode `maxPrice = flights[0].price` (exclusive).
- Sort ascending by price. In `cheaper` mode, if nothing cheaper came back, keep the previous `flights`
  and log `No cheaper flight found, keeping $500 option.`
- Log e.g. `Found a $500 flight on the Tashkent -> Paris route.` Fallback to mock → extra `warn` log and
  a `warnings` entry.

**`hotel.node.ts` — Hotel Agent** (no LLM)
- `tools.searchHotels({ destination, checkIn, checkOut, mode, maxPricePerNight })`.
- Ordering: among hotels with `rating >= 3.5`, cheapest first; if none qualify, cheapest overall. `[0]` is selected.
- Hotel cost = `hotels[0].pricePerNight × durationDays` (blueprint formula).
- Same "never more expensive in cheaper mode" rule as flights.
- `status`: `planning` if `itinerary` is empty, else `auditing`.

**`planner.node.ts` — Itinerary Planner** (LLM)
- Structured output: `{ dailyExpensesEstimate: number, days: ItineraryDay[] }`, validated with
  `ItineraryDaySchema` from contracts; exactly `durationDays` days, `day` = 1..N, 2–5 places per day.
- Prompt asks for real, well-known places with accurate coordinates near the destination, and a
  realistic per-day spend (food, local transport, entry fees) in USD for one traveller.
- Post-validation: drop places whose coordinates are more than ~100 km from the day's median point
  (hallucination guard); if a day ends up empty, keep the title and an empty `places` array.
- Optional: when `TAVILY_API_KEY` is set, fetch top attractions first and pass them as context.
- `status: 'auditing'`.

**`budget.node.ts` — Budget Auditor** (pure, no I/O)
- `computeTotalCost(state)` exported separately for unit tests; round to 2 decimals.
- Applies the three conditions from ARCHITECTURE.md §4.3:
  - ≤ budget → `{ status: 'completed', totalCost }`, log `Total $900 fits the $1,000 budget.`
  - over & `retryCount < MAX_BUDGET_RETRIES` → `{ status: 'searching', retryCount: +1, searchMode: 'cheaper', overBudgetBy, totalCost }`,
    log `Over budget by $120, re-planning (attempt 1/2).`
  - over & retries exhausted → `{ status: 'completed', totalCost, warnings: ['Budget exceeded by $120'] }`, `warn` log.

---

## 9. LLM layer — `src/agent/llm.ts`

```typescript
export interface LlmFactory {
  structured<T extends z.ZodType>(schema: T, name: string): Runnable<BaseMessageLike[], z.infer<T>>;
}
```

- Primary: `new ChatOpenAI({ model: config.OPENAI_MODEL, temperature: 0, maxRetries: 2, timeout: 30_000 })`.
- Fallback: same with `config.OPENAI_FALLBACK_MODEL`.
- `primary.withStructuredOutput(schema, { name, strict: true }).withFallbacks([fallback.withStructuredOutput(schema, { name, strict: true })])`.
- Planner may use `temperature: 0.4`; Supervisor stays at `0`.
- Strict structured outputs require every field to be present; model optional values as `nullable()`,
  not `optional()`.
- When the fallback model answers, add a `warn` log (`Primary model unavailable, used gpt-4o-mini`).
- Tests inject a fake factory returning canned objects — no network calls in tests.

---

## 10. Tool layer — `src/tools/`

```typescript
// types.ts
export interface FlightQuery { origin: string; destination: string; departDate: string; returnDate: string; mode: 'standard' | 'cheaper'; maxPrice?: number }
export interface HotelQuery  { destination: string; checkIn: string; checkOut: string; mode: 'standard' | 'cheaper'; maxPricePerNight?: number }
export interface TravelSearchTool {
  readonly name: 'serpapi' | 'mock';
  searchFlights(q: FlightQuery, signal?: AbortSignal): Promise<Flight[]>;
  searchHotels(q: HotelQuery, signal?: AbortSignal): Promise<Hotel[]>;
}
export class ToolUnavailableError extends Error {}
```

**`serpApi.tool.ts`**
- Google Flights (`engine=google_flights`, round trip, `currency=USD`) and Google Hotels
  (`engine=google_hotels`) via `fetch`.
- City → airport code: try the city name first; keep a small lookup map for common cities as a fallback.
- Per request `AbortSignal.timeout(10_000)` combined with the run signal.
- Retry 2× on network errors, `429` and `5xx` with exponential backoff (500 ms, 1500 ms) + jitter; no retry on `4xx`.
- Map responses through `FlightSchema` / `HotelSchema` (`source: 'serpapi'`); drop items that fail parsing.
- Zero valid results or exhausted retries → `ToolUnavailableError`.

**`mockTravel.tool.ts`**
- Deterministic: prices derived from a hash of `origin + destination + date`, so tests are stable.
- Returns 3–5 flights and 3–5 hotels with `source: 'mock'`; `cheaper` mode returns options at least
  15% below `maxPrice` when one is given.
- Small artificial delay (≈300 ms, `0` when `NODE_ENV=test`) so the UI stream looks realistic.

**`index.ts`**
- `withFallback(primary, mock, onFallback)` → a `TravelSearchTool` that catches `ToolUnavailableError`
  (and timeouts) from the primary, calls `onFallback(reason)` and retries on the mock.
- `createTravelTool(config)`: `mock` → mock; `live` → SerpAPI (fails hard); `auto` → SerpAPI with mock fallback
  if `SERPAPI_API_KEY` is set, otherwise mock.
- Nodes call tools directly in code. Tools are **not** exposed to the LLM for tool-calling.

---

## 11. Persistence

- `config.DATABASE_URL` set → `PostgresSaver.fromConnString(url)`; call `await checkpointer.setup()` on boot
  (idempotent, creates tables).
- Not set → `new MemorySaver()` (dev/test only; log a warning at boot in `production`).
- Retention: checkpoints are small; add a periodic cleanup of threads older than 30 days once in production.
- `GET /api/trips/:threadId` and resume both use `graph.getState({ configurable: { thread_id } })`.

---

## 12. Logging

- Structured JSON to stdout: `{ level, msg, threadId, node, durationMs, fallback, outcome }`.
- One line per HTTP request and one summary line per run (`outcome: completed | failed | aborted | timeout`,
  `retryCount`, `llmFallbackUsed`, `toolFallbackUsed`, `totalMs`).
- Never log API keys, full prompts in production (log the length), or raw third-party responses.

---

## 13. Testing

| File | What it proves |
| --- | --- |
| `test/budget.node.test.ts` | Cost formula; condition 1, 2 (retry increments, `searchMode='cheaper'`), 3 (warning, stops) |
| `test/graph.routes.test.ts` | Each router for every relevant status / itinerary combination |
| `test/nodes/*.test.ts` | Supervisor merge + missing-field failure; flight/hotel sorting and "never more expensive" rule; planner day count + coordinate guard |
| `test/tools.test.ts` | SerpAPI mapping from fixture JSON; retry on 429/5xx; fallback to mock and `onFallback` call |
| `test/runTrip.test.ts` | Full run with `MemorySaver`, fake LLM, mock tools: packets parse with `SseEventSchema`, exactly one `RESULT`, progress monotonic, over-budget scenario loops twice then warns |
| `test/resume.test.ts` | Inject a failure in `itineraryPlanner`, assert `RESULT failed`, resume → completes without re-running supervisor/flight/hotel |
| `test/server.test.ts` | supertest: 400 on bad body, 429 on limit, CORS headers incl. `X-Thread-Id` exposure, `/health` |

No test may hit OpenAI or SerpAPI. Use `TOOLS_MODE=mock` and the fake `LlmFactory`.

---

## 14. Rules for working in this package

- Import shared types from `@ai-travel/contracts`; never redefine `Flight`, `Hotel`, `ItineraryDay`, SSE packets.
  A contract change goes into `packages/contracts` first, then both apps are updated in the same PR.
- Never read `process.env` outside `config.ts`.
- Every outgoing packet goes through `SseStreamer.send` (validated). Never `res.write` packets by hand.
- Keep routers pure and nodes side-effect free except for their injected tools/LLM.
- Any new loop in the graph must have an explicit counter in state and a max constant.
- ESM with `NodeNext`: relative imports use the `.js` extension (`./state.js`).
- Run `pnpm --filter ai-travel-agent test typecheck` before committing.
