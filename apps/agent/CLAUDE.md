# ai-travel-agent — Backend Technical Specification

> All paths below are relative to `apps/agent/`.
> System-wide design (graph, SSE protocol, contracts, deploy) is in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md);
> this file specifies how the agent service implements it.

---

## 1. Responsibilities

- Expose the trip API over HTTP and stream progress as typed SSE packets: technical `LOG`s, friendly
  `MESSAGE`s (some flagged as confirmed decisions), `PROGRESS`, `DRAFT` (the trip so far) and one `RESULT`.
- Keep each run independent of the HTTP connection (`RunRegistry`): a dropped stream reconnects and replays
  what it missed; "Stop run" cancels on purpose.
- Serve the web destination bar: `GET /api/trip-context` returns weather, currency rate and time zones.
- Run the 5-node LangGraph workflow with checkpointing, bounded re-planning and fallbacks. The Planner also
  chooses airport transfers and reads the daily forecast.
- Own every secret and every external call (Anthropic, SerpAPI, Tavily, Open-Meteo, the exchange-rate API, PostgreSQL).
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
│   │   ├── llm.ts                 # + ChatAnthropic factory with Opus 5.5 → Sonnet 5.5 fallback
│   │   ├── runTrip.ts             # + maps graph stream → SSE packets (stream controller)
│   │   ├── runRegistry.ts         # + active runs, replay buffer, reconnect / cancel (§7)
│   │   ├── messages.ts            # + pure builders for friendly chat messages (§8.5)
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
│   │   ├── index.ts               # + withFallback(primary, mock) + tool selection by TOOLS_MODE
│   │   ├── weather.ts             # + Open-Meteo geocoding, current weather, daily forecast (§10.1)
│   │   ├── exchangeRate.ts        # + USD → destination currency rate (§10.1)
│   │   ├── currencies.ts          # + country code → ISO 4217 table (§10.1)
│   │   └── tripContext.ts         # + lookupTripContext(): geocode → weather ∥ rate, cached (§10.1)
│   ├── middlewares/
│   │   ├── errorHandler.ts        # global error → JSON (pre-stream only)
│   │   └── rateLimiter.ts         # express-rate-limit instances
│   ├── utils/
│   │   ├── sseStreamer.ts         # SSE writer, validates every packet with SseEventSchema
│   │   ├── errors.ts              # + AppError + error codes
│   │   ├── ttlCache.ts            # + tiny in-process TTL cache for the trip-context lookups
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
| `@langchain/anthropic`, `@langchain/core` | `ChatAnthropic`, `withStructuredOutput`, `withFallbacks` |
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
| `ANTHROPIC_API_KEY` | string, **required** | |
| `ANTHROPIC_MODEL` | default `claude-opus-5-5` | Primary model |
| `ANTHROPIC_FALLBACK_MODEL` | default `claude-sonnet-5-5` | Fallback model |
| `SERPAPI_API_KEY` | string, optional | Missing → mock tools in `auto` mode |
| `TAVILY_API_KEY` | string, optional | Optional place research for the planner |
| `TOOLS_MODE` | `auto \| live \| mock`, default `auto` | `auto` = live if key present, else mock; tests use `mock` |
| `DATABASE_URL` | URL, optional | Present → `PostgresSaver`, else `MemorySaver` |
| `RUN_TIMEOUT_MS` | int, default `120000` | Whole-run timeout |
| `RUN_REPLAY_TTL_MS` | int, default `600000` (10 min) | How long a finished run's packets stay available for reconnects |
| `RUN_REPLAY_MAX_EVENTS` | int, default `500` | Replay buffer size per run (oldest packets dropped first) |
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
3. `cors({ origin: config.WEB_ORIGIN, methods: ['GET', 'POST'], exposedHeaders: ['X-Thread-Id', 'Retry-After'] })`
4. `express.json({ limit: '10kb' })`
5. `generalLimiter` on all `/api` routes; `runLimiter` additionally on the two run-starting routes (not on `stream` or `cancel`)
6. Routes
7. 404 handler → `AppError('NOT_FOUND')`
8. `errorHandler` (last)

**Do not add `compression()`** — it buffers the response and breaks SSE.

### 5.2 Routes

| Route | Behaviour |
| --- | --- |
| `GET /health` | `200 { status: "ok" }`. No rate limit. |
| `POST /api/trips` | `TripRequestSchema.safeParse(body)`; invalid → `400 VALIDATION_ERROR`. Otherwise `threadId = crypto.randomUUID()`, `registry.start({ threadId, request })`, open SSE and subscribe the response to the run. |
| `POST /api/trips/:threadId/resume` | `threadId` must be a UUID and have a checkpoint (`graph.getState`), else `404`. If the run already reached `END` (`state.next` is empty), send its `RESULT` and close. Otherwise `registry.start({ threadId, resume: true })`, open SSE and subscribe. |
| `GET /api/trips/:threadId/stream` | Reconnect. Unknown or expired run → `404`. Otherwise open SSE, replay the buffered packets with an id greater than the `Last-Event-ID` header (all of them when absent), then follow the live run until its `RESULT`. |
| `POST /api/trips/:threadId/cancel` | Run in the registry → abort it (the stream ends with `RESULT failed: "Run stopped"`, the checkpoint stays) and answer `204`. Finished run → `204` (idempotent). Unknown → `404`. |
| `GET /api/trips/:threadId` | Latest checkpoint → `ResultPayload` JSON, `404` if unknown. Used by the web app after a reload. |
| `GET /api/trip-context?destination=…` | `TripContextQuerySchema.safeParse(query)`; invalid → `400 VALIDATION_ERROR`. `lookupTripContext` (§10.1) → `TripContext` JSON; destination not found → `404 NOT_FOUND`. Plain JSON, no SSE, behind `generalLimiter` only. |

### 5.3 Errors — `utils/errors.ts`, `middlewares/errorHandler.ts`

```typescript
type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'RATE_LIMITED' | 'INTERNAL';
class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number, public retryAfterSeconds?: number) {}
}
```

- Response shape: `{ "error": { "code": "...", "message": "...", "retryAfterSeconds"?: number } }`. `retryAfterSeconds` is set only for `RATE_LIMITED`. `ZodError` → `400` with the
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
standard error shape and code `RATE_LIMITED` (`429`), `retryAfterSeconds` taken from the limiter's reset time
(the same value as the `Retry-After` header). The web form turns it into a countdown ("Plan trip in 0:42"). In-memory store is acceptable for a single
Render instance; switch to a shared store (e.g. Redis) before scaling horizontally.

### 5.5 Startup & shutdown

- Boot: validate config → create checkpointer (`PostgresSaver.fromConnString(url)` + `await setup()`) →
  compile graph → `listen(config.PORT)`.
- `SIGTERM`/`SIGINT`: stop accepting connections, abort all runs in the registry (their streams end with
  `RESULT failed: "Server restarting, resume to continue"`), close the Postgres pool, exit within 10 s.
  The checkpoint makes these runs resumable.

---

## 6. SSE writer — `src/utils/sseStreamer.ts`

```typescript
class SseStreamer {
  constructor(res: Response);
  open(threadId: string): void;                 // headers + flushHeaders() + start heartbeat
  send(event: SseEvent, id: number): void;      // SseEventSchema.parse → "id: n\ndata: <json>\n\n"
  close(): void;                                // stop heartbeat, res.end()
  get isClosed(): boolean;                      // client gone or closed by us
}
```

- Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`, `X-Thread-Id: <threadId>`.
- Heartbeat: write `: ping\n\n` every 15 s.
- `send` validates with `SseEventSchema.parse`. A validation failure is a server bug: it throws, and the run
  turns it into a failed `RESULT`.
- `id` is the run's event sequence number (assigned by the registry), so `Last-Event-ID` means the same thing on
  every connection to that run.
- `send` after close is a no-op (never throws on a closed socket).
- Progress monotonicity is enforced by the registry before a packet is stored: a `PROGRESS` with a lower percent
  than the last one is raised to the last value, so replays are monotonic too.

---

## 7. Stream controller — `src/agent/runTrip.ts`, `src/agent/runRegistry.ts`

A run belongs to the registry, not to the HTTP request. Connections only *subscribe* to it.

```typescript
class RunRegistry {
  start(args: { threadId: string; request?: TripRequest; resume?: boolean }): Run;   // runs runTrip detached
  get(threadId: string): Run | undefined;                                            // active, or finished within RUN_REPLAY_TTL_MS
  abortAll(reason: string): void;                                                    // shutdown
}
interface Run {
  readonly done: boolean;
  subscribe(streamer: SseStreamer, lastEventId?: number): void;   // replay buffered packets > lastEventId, then follow live
  cancel(): void;                                                  // user pressed "Stop run"
}

async function runTrip(args: {
  graph: CompiledTravelGraph;
  emit: (event: SseEventInput) => void;   // the registry stores the packet, assigns the id, fans out to subscribers
  threadId: string;
  request?: TripRequest;                  // new run
  resume?: boolean;                       // continue from last checkpoint
  signal: AbortSignal;                    // cancel / timeout / shutdown (NOT client disconnect)
}): Promise<void>;
```

Registry rules:

- Every emitted packet is validated, stored in a ring buffer of `RUN_REPLAY_MAX_EVENTS` and sent to all
  current subscribers. Subscribers that disconnect are simply removed; **the run keeps going**.
- A finished run stays in the registry for `RUN_REPLAY_TTL_MS` so a late reconnect still gets the `RESULT`.
- A run nobody is subscribed to is still bounded by `RUN_TIMEOUT_MS`.
- At most one live run per `threadId`; `start` for a thread that is still running throws `AppError('VALIDATION_ERROR')`.

`runTrip` steps:

1. `emit(PROGRESS { 5, "parsing", pass: 1, run })`; `run` = `{ model: config.ANTHROPIC_MODEL, checkpointer, lastCheckpointStep: null }`.
2. `const signal = AbortSignal.any([cancelSignal, AbortSignal.timeout(config.RUN_TIMEOUT_MS)])`.
3. Input: new run → `initialState(request)`; resume → `null`.
4. `for await (const [mode, chunk] of await graph.stream(input, { configurable: { thread_id: threadId }, streamMode: ['updates', 'custom'], recursionLimit: 20, signal }))`
   - `mode = 'updates'`: `chunk` is `{ [nodeName]: partialUpdate }`.
     - Each entry in `partialUpdate.logs ?? []` → `LOG` packet (only the node's new logs).
     - Then each entry in `partialUpdate.messages ?? []` → `MESSAGE` packet (`text`, `decision`, `callout`, same `step`).
     - Then a `DRAFT` packet: the trip fields merged so far (§8.1 `toDraft(values)`), omitting fields that are still empty.
     - Then a checkpoint `LOG` (`System`, `kind: 'checkpoint'`, "State saved after step N · PostgresSaver") and `PROGRESS` from the
       table in ARCHITECTURE.md §6.3, keyed by node name and the update's `status`, with `pass = retryCount + 1`
       and `run.lastCheckpointStep = N`.
   - `mode = 'custom'`: the Planner's per-day writer events. `{ kind: 'day', day, of, itinerary }` →
     `PROGRESS { detail: "Day 4 of 5" }` (percent interpolated 55 → 75) and `DRAFT { itinerary }`.
5. After the loop: `const { values } = await graph.getState(config)` → `RESULT` built by `buildResultPayload(threadId, values)`
   (`status: values.status === 'failed' ? 'failed' : 'completed'`), then the registry marks the run done.
6. `catch`:
   - Cancelled by the user → `RESULT { status: "failed", error: "Run stopped" }` from the latest checkpoint (partial data is fine).
   - Shutdown → `RESULT failed` "Server restarting, resume to continue".
   - Timeout or any other error → `LOG { agent: "System", level: "error" }` and
     `RESULT { status: "failed", error: <safe message> }` built from the latest checkpoint, then done.
     Never leak stack traces or API keys in `error`.

`buildResultPayload` also fills `transfers`, `replans = retryCount`, `passes`, and `suggestions` (§8.4 Budget Auditor).

---

## 8. LangGraph implementation

### 8.1 State — `src/agent/state.ts`

```typescript
import { Annotation } from '@langchain/langgraph';
import type {
  BudgetPass, Callout, DecisionTopic, Flight, Hotel, ItineraryDay, LogKind, Suggestions, Transfer, TripRequest, TripStatus, AgentName,
} from '@ai-travel/contracts';

export interface LogEntry { timestamp: string; agent: AgentName; message: string; step: number; level: 'info' | 'warn' | 'error'; kind: LogKind }
export interface ChatMessage { timestamp: string; agent: AgentName; text: string; step: number; decision: DecisionTopic | null; callout: Callout | null }

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
  transfers: replace<Transfer[]>(() => []),
  itinerary: replace<ItineraryDay[]>(() => []),
  dailyExpensesEstimate: replace<number>(() => 0),

  totalCost: replace<number>(() => 0),
  retryCount: replace<number>(() => 0),
  searchMode: replace<'standard' | 'cheaper'>(() => 'standard'),
  overBudgetBy: replace<number>(() => 0),
  passes: append<BudgetPass>(),
  suggestions: replace<Suggestions | null>(() => null),
  confirmed: append<DecisionTopic>(),
  status: replace<TripStatus>(() => 'parsing'),
  error: replace<string | null>(() => null),
  warnings: append<string>(),
  logs: append<LogEntry>(),
  messages: append<ChatMessage>(),
});

export type TravelAgentState = typeof TravelAgentStateAnnotation.State;
export type TravelAgentUpdate = typeof TravelAgentStateAnnotation.Update;
export const MAX_BUDGET_RETRIES = 2;
```

Helpers in the same file: `initialState(request)`, `nextStep(state)` (= last log's `step` + 1, or 1),
`log(state, agent, message, level?, kind?)` that builds a `LogEntry` with the current ISO timestamp (`kind` defaults to `'log'`),
`say(state, agent, text, { decision?, callout? })` that builds a `ChatMessage` the same way (both default to `null`), and
`toDraft(values)` that picks the `DraftPayload` fields from state and leaves out empty ones.

### 8.2 Graph — `src/agent/graph.ts`

```typescript
export function buildGraph(deps: { checkpointer: BaseCheckpointSaver; tools: TravelSearchTool; llm: LlmFactory }) {
  return new StateGraph(TravelAgentStateAnnotation)
    .addNode('supervisorAgent', supervisorNode(deps), { retryPolicy: { maxAttempts: 2 } })
    .addNode('flightAgent', flightNode(deps))
    .addNode('hotelAgent', hotelNode(deps))
    .addNode('itineraryPlanner', plannerNode(deps), { retryPolicy: { maxAttempts: 2 } })   // reads the daily forecast (deps.tools)
    .addNode('budgetAuditor', budgetNode)
    .addEdge(START, 'supervisorAgent')
    .addConditionalEdges('supervisorAgent', routeAfterSupervisor, ['flightAgent', END])
    .addEdge('flightAgent', 'hotelAgent')
    .addEdge('hotelAgent', 'itineraryPlanner')
    .addEdge('itineraryPlanner', 'budgetAuditor')
    .addConditionalEdges('budgetAuditor', routeAfterAudit, ['flightAgent', END])
    .compile({ checkpointer: deps.checkpointer });
}

export const routeAfterSupervisor = (s: TravelAgentState) => (s.status === 'failed' ? END : 'flightAgent');
export const routeAfterAudit      = (s: TravelAgentState) => (s.status === 'searching' ? 'flightAgent' : END);
```

- Routers are **pure** and only read state; all decisions and counters are written by nodes.
- The Planner runs on every pass: a re-plan re-chooses transfers and re-routes the days around the new hotel (§8.4).
- Dependencies are injected (`buildGraph(deps)`) so tests can pass a fake LLM and mock tools.
- Node names must never equal a state key (LangGraph throws at compile time).

### 8.3 Node contract

Every node is `(state: TravelAgentState) => Promise<TravelAgentUpdate>` and:

- returns **only** the keys it changes, including its own `logs` (1–3 entries, same `step`) and, where §8.5
  says so, `messages` (0–4 entries, same `step`);
- never mutates `state`;
- throws only for unrecoverable errors (after its own fallbacks), which ends the run as `failed` and
  leaves the previous checkpoint intact for resume;
- uses `AgentName` values from contracts in logs: `Supervisor`, `FlightAgent`, `HotelAgent`,
  `Planner`, `BudgetAuditor` (the graph node is `itineraryPlanner`; the UI shows "Itinerary Planner");
- appends the topic to `confirmed` whenever it emits a `decision` message.

### 8.4 Nodes

**`supervisor.node.ts` — Supervisor** (LLM)
- Structured output schema: `{ origin: string | null, destination: string | null, budget: number | null, durationDays: number | null, startDate: string | null }`.
- System prompt: extract trip parameters only; never invent a budget or duration; return `null` when absent.
- Merge: request `overrides` win over parsed values. Default `startDate` = today + 30 days.
- Missing `destination`, `budget` or `durationDays` after merge → `{ status: 'failed', error: 'Please include …' }`
  with a `warn` log. This is a user-input failure, not a crash (the graph ends normally, `RESULT` has `status: failed`).
- Success → `status: 'searching'`, log e.g. `Planning 5 days in Paris from Tashkent, budget $1,000.`
- Messages: success → decision `trip` ("Got it — 5 days in Paris from Tashkent, 12–17 November, $1,000 all-in. @Flight Agent and @Hotel Agent, you're up.");
  failure → an ordinary message asking for the missing details. The first `DRAFT` (destination, origin, budget, days, start date) follows this node, which is what lets the web app load the destination bar.

**`flight.node.ts` — Flight Agent** (no LLM)
- `tools.searchFlights({ origin, destination, departDate, returnDate, mode: searchMode, maxPrice })`.
  `returnDate = startDate + durationDays`. In `cheaper` mode `maxPrice = flights[0].price` (exclusive).
- Sort ascending by price. In `cheaper` mode, if nothing cheaper came back, keep the previous `flights`
  and log `No cheaper flight found, keeping $500 option.`
- Log e.g. `Found a $500 flight on the Tashkent -> Paris route.` Fallback to mock → extra `warn` log with
  `kind: 'search-fallback'` and a `warnings` entry.
- Messages — first pass (ordinary): `I found 4 flights — the best option is Uzbekistan Airways at $500. Direct, but that is half the budget.`
  (the last clause only when the price is over 40% of the budget). Mock data adds "Live prices weren't available, so these are estimates."
  Re-plan pass: decision `flight` — `Turkish Airlines via Istanbul is $420. The layover at Istanbul Airport is 1 h 50 m — enough to change gates without rushing. It lands at CDG Terminal 1 at 13:55.`
  with the saving ("saves $80") built from the previous selection. Layover and terminal come from `outbound.stops` / `outbound.terminal`.

**`hotel.node.ts` — Hotel Agent** (no LLM)
- `tools.searchHotels({ destination, checkIn, checkOut, mode, maxPricePerNight })`.
- Ordering: among hotels with `rating >= 7` (0–10 scale), cheapest first; if none qualify, cheapest overall. `[0]` is selected.
- Hotel cost = `hotels[0].pricePerNight × durationDays` (blueprint formula).
- Same "never more expensive in cheaper mode" rule as flights.
- `status: 'planning'` (the Planner always runs next).
- Messages — first pass (ordinary): `Hôtel Lumière in Le Marais is $95/night — that pushes the budget.`; re-plan pass: decision `hotel` —
  `Found a great stay near République for $66/night! Rated 8.2, saving us $145.` (saving = previous nightly price − new, × `durationDays`;
  the `transit` field fills the closing sentence when present).

**`planner.node.ts` — Planner** (LLM; display name "Itinerary Planner")
- Inputs: selected flight (arrival time, terminal), selected hotel (`area`, `location`, `transit`), dates, `searchMode`.
- **Forecast.** `tools.getForecast(destination, startDate, durationDays)` (§10.1) returns one `DayWeather | null` per day. Dates more than
  16 days ahead, or any provider failure, give `null` for every day; the node carries on without weather.
- **Transfers + spend** (1 structured call): `{ dailyExpensesEstimate, transfers: Transfer[] }` — exactly two transfers: airport → hotel on day 1 and
  hotel → airport on the last day, mode from `TransferModeSchema`, `priceUsd` for the whole leg in USD (the prompt converts local fares and keeps the
  local figure in `note`, e.g. "Fixed fare €56"). `standard` mode: the practical choice (a taxi after a late arrival with bags). `cheaper` mode: the
  cheapest viable mode per leg (train, metro, bus over taxi); never more expensive than the previous pass.
- **Days** (one structured call per day, sequential): `{ title, places: Place[] }` validated with `ItineraryDaySchema` (2–5 places, `note` such as
  "Morning"). Each call gets the hotel location, the transfers of that day, the previous days (so places are not repeated) and that day's forecast:
  for `rain`, `snow` or `storm` the prompt asks for indoor stops and the title says so. After each day the node validates it (coordinate guard below),
  then writes a custom event `config.writer({ kind: 'day', day, of: N, itinerary })` so the stream shows "Day 4 of 5" and a growing `DRAFT`.
- **Coordinate guard.** Drop places whose coordinates are more than ~100 km from the day's median point; a day that ends up empty keeps its title
  and an empty `places` array. Fill `date` from `startDate + day − 1`.
- **Re-plan pass.** The planner keeps the existing days' places. It re-chooses transfers, then asks the model — per day, only when the hotel `area`
  changed or the day touches a transfer — to re-order or swap the stops anchored to the hotel ("Re-routing day 3 around the new hotel"). Other days
  are copied unchanged. The `itinerary` decision is not repeated (it is already in `confirmed`).
- Optional: when `TAVILY_API_KEY` is set, fetch top attractions first and pass them as context.
- `status: 'auditing'`.
- Messages: first pass — an ordinary transfer proposal ("Landing at 13:55 with bags, a taxi is the simplest way in. Paris airport taxis charge a fixed €56…"),
  an ordinary weather message with callout `{ tone: 'info', label: 'Weather prep · Day 3 moved indoors' }` for each day moved indoors, and decision
  `itinerary` ("Your 5-day plan is ready: Louvre, Eiffel Tower and more."). Re-plan pass — decision `transfers` ("Taxi in, RER B out. About $75 for both.").

**`budget.node.ts` — Budget Auditor** (pure, no I/O)
- `computeTotalCost(state)` exported separately for unit tests; round to 2 decimals. Formula: flight + hotel × days + Σ transfers + daily × days.
- Every audit appends a `BudgetPass`: `{ pass: retryCount + 1, flight, hotel, transfers, daily, totalCost, flightLabel, hotelLabel }`
  (`flightLabel` "$500 direct" / "$420 via IST" from `outbound.stops`; `hotelLabel` "5 × $95").
- Applies the three conditions from ARCHITECTURE.md §4.3:
  - ≤ budget → `{ status: 'completed', totalCost }`, log `Total $975 fits the $1,000 budget.`
  - over & `retryCount < MAX_BUDGET_RETRIES` → `{ status: 'searching', retryCount: +1, searchMode: 'cheaper', overBudgetBy, totalCost }`,
    log `Over budget by $125, re-planning (attempt 1/2).`
  - over & retries exhausted → `{ status: 'completed', totalCost, warnings: ['Budget exceeded by $84'], suggestions }`, `warn` log.
    `suggestions = { raiseBudgetTo: next multiple of 100 above totalCost, tryDays: max(1, durationDays − 1) }`.
- Messages: re-plan → one ordinary message ("That comes to $1,125 against $1,000. We need to find about $125 before we lock anything in.") with callout
  `{ tone: 'warn', label: 'Over budget by $125 · re-plan 1 of 2' }`. Conditions 1 and 3 → confirm every topic from `flight`, `hotel`, `transfers`
  that is not yet in `confirmed`, in that order, then `budget` ("All in, that's $975 of $1,000 with $25 to spare. Approved!" /
  "Best I could do is $1,084, $84 over budget."); condition 3 adds an ordinary "This is the cheapest combination I could find." first.

### 8.5 Chat messages — `src/agent/messages.ts`

`logs` stay technical; `messages` are the friendly stream for the chat panel (ARCHITECTURE.md §4.6).

- Pure functions `(state-derived values) => string`, one per message in the ARCHITECTURE.md §4.6 table. Nodes
  call them through `say(state, agent, text, { decision, callout })`. **Never ask the LLM to write chat text** — no extra tokens, deterministic tests.
- All money goes through one `formatUsd()` helper; English only. `@Name` tokens use the agents' display names ("@Flight Agent"); the web app highlights them.
- A message with `decision: <topic>` is a **confirmed decision**. The first pass only proposes flight, hotel and transfers; the agents confirm their pick in a
  re-plan pass, and the Budget Auditor confirms whatever is still unconfirmed at the end. A later re-plan may confirm a topic again; the web app shows the newest.
  Do not add a "superseded" concept.
- Messages are live-only (plus the replay buffer, ARCHITECTURE.md §6.5): they are not part of `ResultPayload` and are not replayed by `GET /api/trips/:threadId`.

---

## 9. LLM layer — `src/agent/llm.ts`

```typescript
export interface LlmFactory {
  structured<T extends z.ZodType>(schema: T, name: string): Runnable<BaseMessageLike[], z.infer<T>>;
}
```

- Primary: `new ChatAnthropic({ model: config.ANTHROPIC_MODEL, maxRetries: 2, timeout: 30_000 })`.
- Fallback: same with `config.ANTHROPIC_FALLBACK_MODEL`.
- `primary.withStructuredOutput(schema, { name }).withFallbacks([fallback.withStructuredOutput(schema, { name })])`.
- Do not set `temperature` / `top_p` / `top_k`: Claude Opus 5.5 and Sonnet 5.5 reject non-default sampling values (HTTP 400).
  Thinking cannot be disabled on Opus 5.5 and its effort defaults to `medium`; forced `tool_choice` (`any` / `tool`) is also a 400,
  so structured output must use the API's JSON-schema output format, not a forced tool call (verify in the B2 spike).
- Structured outputs require every field to be present; model optional values as `nullable()`,
  not `optional()`.
- When the fallback model answers, add a `warn` log with `kind: 'llm-fallback'` (`Primary model unavailable, used claude-sonnet-5-5`);
  the web app turns it into the "Running on fallback model" banner.
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
- Map responses through `FlightSchema` / `HotelSchema` (`source: 'serpapi'`); drop items that fail parsing. Flights keep both legs
  (airports, times, terminal, layovers) and the fare link; hotels keep area, photo, check-in/out times, coordinates and link. Google Hotels'
  0–5 rating is doubled to the contract's 0–10 scale (one decimal). `transit` is `null` unless the provider returns nearby stations.
- Zero valid results or exhausted retries → `ToolUnavailableError`.

**`mockTravel.tool.ts`**
- Deterministic: prices derived from a hash of `origin + destination + date`, so tests are stable.
- Returns 3–5 flights and 3–5 hotels with `source: 'mock'`, fully populated (both legs with one stop, hotel area, check-in 15:00 / check-out 11:00,
  rating 6–9.5, `photoUrl: null`); `cheaper` mode returns options at least 15% below `maxPrice` when one is given.
- Small artificial delay (≈300 ms, `0` when `NODE_ENV=test`) so the UI stream looks realistic.

**`index.ts`**
- `withFallback(primary, mock, onFallback)` → a `TravelSearchTool` that catches `ToolUnavailableError`
  (and timeouts) from the primary, calls `onFallback(reason)` and retries on the mock.
- `createTravelTool(config)`: `mock` → mock; `live` → SerpAPI (fails hard); `auto` → SerpAPI with mock fallback
  if `SERPAPI_API_KEY` is set, otherwise mock.
- Nodes call tools directly in code. Tools are **not** exposed to the LLM for tool-calling.

### 10.1 Trip context lookup (destination bar) — `tools/tripContext.ts`

Not part of the graph and not a `TravelSearchTool`: a standalone service behind `GET /api/trip-context`
(ARCHITECTURE.md §7.1). No API keys and no new env variables; the TTLs are constants in the tool modules.

```typescript
export async function lookupTripContext(
  query: { destination: string; origin?: string },
  deps: { fetch: typeof fetch; mode: 'live' | 'mock'; now: () => Date },
): Promise<TripContext>;
export async function getForecast(destination: string, startDate: string | null, days: number, deps): Promise<(DayWeather | null)[]>;
```

- **Geocode** (`weather.ts`): Open-Meteo geocoding → `{ name, country, countryCode, lat, lng, timezone }`; no match → `AppError('NOT_FOUND')`.
  The same call for `origin` (when given) supplies `originTimeZone`; an unknown origin gives `null`, never an error.
- **Weather** (`weather.ts`): current temperature and weather code plus today's min/max → `{ temperatureC, condition, icon, todayLowC, todayHighC, outlook }`
  through one code → label/icon table. `outlook` is built by code from the next 7 daily codes ("rain Saturday"); `null` when nothing notable.
- **Forecast** (`getForecast`): Open-Meteo daily forecast for `startDate … startDate + days − 1`, mapped to `DayWeather` (high, low, label, icon).
  Open-Meteo answers about 16 days ahead; dates beyond that, a missing `startDate`, or a failed call → `null` for every day.
  The Planner calls it once per run (the result is cached with the weather TTL).
- **Currency and rate** (`exchangeRate.ts` + `currencies.ts`): `countryCode` → ISO 4217 code and symbol via the static table, then USD →
  currency. Unknown country or a USD destination → `currency: null, exchangeRate: null`; a failed rate call → `exchangeRate: null` only.
- Weather and rate run in parallel with `Promise.allSettled`; each call has `AbortSignal.timeout(5_000)` and one
  retry on network / 429 / 5xx. A rejected call becomes `null` for that field — the lookup itself still resolves.
- `utils/ttlCache.ts`, keyed by the normalised destination (trim, lower-case, collapsed spaces): geocode 24 h,
  weather and forecast 30 min, rate 6 h. Failures are never cached.
- **No mock fallback on failure** — a made-up temperature or rate would look real. `mode: 'mock'`
  (`TOOLS_MODE=mock`) returns fixed fixtures with `source: 'mock'` for tests and e2e (Paris: 12 °C, partly cloudy, 9–14 °C, "rain Saturday", EUR 0.92,
  `Europe/Paris`; `getForecast` returns five days with a rainy day 3).
- Provider hosts are constants; `destination` and `origin` are always `encodeURIComponent`-ed. The final value is parsed with
  `TripContextSchema` before it is sent.

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
- One line per HTTP request and one summary line per run (`outcome: completed | failed | cancelled | timeout`,
  `retryCount`, `llmFallbackUsed`, `toolFallbackUsed`, `totalMs`).
- Never log API keys, full prompts in production (log the length), or raw third-party responses.

---

## 13. Testing

| File | What it proves |
| --- | --- |
| `test/budget.node.test.ts` | Cost formula incl. transfers; condition 1, 2 (retry increments, `searchMode='cheaper'`, pass recorded), 3 (warning, stops, `suggestions`); confirms only unconfirmed topics |
| `test/graph.routes.test.ts` | Each router for every relevant status combination; hotel always leads to the planner |
| `test/nodes/*.test.ts` | Supervisor merge + missing-field failure; flight/hotel sorting and "never more expensive" rule; planner transfers (two legs, cheaper mode), per-day loop and writer events, rain day moved indoors, no forecast → no weather callout, coordinate guard, re-plan keeps unchanged days |
| `test/tools.test.ts` | SerpAPI mapping from fixture JSON; retry on 429/5xx; fallback to mock and `onFallback` call |
| `test/runTrip.test.ts` | Full run with `MemorySaver`, fake LLM, mock tools: packets parse with `SseEventSchema`, exactly one `RESULT`, progress monotonic, over-budget scenario loops twice then warns with `suggestions`; per node the order is `LOG → MESSAGE → DRAFT → checkpoint LOG → PROGRESS`; the planner emits one `PROGRESS.detail` + `DRAFT` per day; a completed run confirms `trip, flight, hotel, transfers, itinerary, budget` at least once each and the re-plan scenario confirms flight/hotel/transfers in the re-plan pass |
| `test/runRegistry.test.ts` | Subscriber disconnect does not stop the run; reconnect with `Last-Event-ID` replays exactly the missed packets and then follows live; finished run replayable until the TTL; buffer cap drops the oldest; `cancel` ends with `RESULT failed: Run stopped` and the run can be resumed; unknown thread → 404 |
| `test/resume.test.ts` | Inject a failure in `itineraryPlanner`, assert `RESULT failed`, resume → completes without re-running supervisor/flight/hotel |
| `test/server.test.ts` | supertest: 400 on bad body, 429 on limit with `retryAfterSeconds` and `Retry-After`, CORS headers incl. `X-Thread-Id` / `Retry-After` exposure, `/health` |
| `test/messages.test.ts` | Exact text per message builder, USD rounding |
| `test/tripContext.test.ts` | Stubbed `fetch`: weather-only / rate-only failure, USD destination, unknown country, unknown city → 404, unknown origin → `originTimeZone: null`, `outlook` wording, cache hit and no failure caching, timeout → `null`; `getForecast` in range / beyond 16 days / failure; route `400`/`404`/`200` shapes |

No test may hit Anthropic or SerpAPI. Use `TOOLS_MODE=mock` and the fake `LlmFactory`.

---

## 14. Rules for working in this package

- Import shared types from `@ai-travel/contracts`; never redefine `Flight`, `Hotel`, `ItineraryDay`, SSE packets.
  A contract change goes into `packages/contracts` first, then both apps are updated in the same PR.
- Never read `process.env` outside `config.ts`.
- Every outgoing packet goes through `SseStreamer.send` (validated). Never `res.write` packets by hand.
- Keep routers pure and nodes side-effect free except for their injected tools/LLM.
- Any new loop in the graph must have an explicit counter in state and a max constant.
- Chat text comes from `agent/messages.ts`, never from the LLM; flight, hotel and transfers are confirmed by their own agent in a re-plan pass, anything left by the Budget Auditor.
- A run never depends on its HTTP connection: do not abort the graph on `res.on('close')`; only cancel, timeout and shutdown abort it.
- The trip-context lookup must never fail a run or throw past its route: provider errors become `null` fields, not mock data.
- ESM with `NodeNext`: relative imports use the `.js` extension (`./state.js`).
- Run `pnpm --filter ai-travel-agent test typecheck` before committing.

---

## 15. Implementation plan

> Step-by-step plan for building this service from the spec in §1–§14 and
> [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md). Each ticket is one branch / one PR, small enough to
> review on its own.

---

### Overview

| Milestone | Tickets | Outcome |
| --- | --- | --- |
| **M1 · Foundation** | B1 – B4 | Monorepo, shared contracts, Express app with config, errors, CORS, rate limits and `/health` |
| **M2 · Streaming skeleton** | B5 – B7 | `POST /api/trips` streams real SSE packets from a graph of stub nodes — the web app can switch from its mock agent |
| **M3 · Agent brain** | B8 – B15 | Tools, LLM factory and all five real nodes; full graph runs end to end in tests with no network |
| **M4 · Persistence & resilience** | B16 – B18 | PostgreSQL checkpoints, resume, trip lookup, abort/timeout/shutdown, structured logs |
| **M5 · Ship** | B19 – B20 | CI, Render deploy with Postgres, web app wired to the real agent |
| **M6 · Chat & top bar** | B21 – B23 | Agents send friendly chat messages with confirmed decisions (`MESSAGE` packet); `GET /api/trip-context` serves weather, currency rate and time zones. Land before B20 so the integration pass covers them |
| **M7 · Live trip & reconnect** | B24 – B25 | Design alignment: `DRAFT` packet, progress detail, checkpoint rows, run registry with reconnect / cancel, rate-limit countdown. Land before B20 |

#### Dependency graph

```mermaid
flowchart LR
  B1[B1 Monorepo] --> B2[B2 Contracts]
  B1 --> B3[B3 Agent scaffold + config]
  B2 --> B3
  B3 --> B4[B4 HTTP skeleton]
  B4 --> B5[B5 SseStreamer]
  B3 --> B6[B6 State + graph skeleton]
  B5 --> B7[B7 runTrip + POST /api/trips]
  B6 --> B7
  B6 --> B8[B8 Tool layer + mock]
  B8 --> B9[B9 SerpAPI tool]
  B6 --> B10[B10 LLM factory]
  B6 --> B11[B11 Budget Auditor]
  B8 --> B12[B12 Flight + Hotel]
  B10 --> B13[B13 Supervisor]
  B10 --> B14[B14 Itinerary Planner]
  B7 & B11 & B12 & B13 & B14 --> B15[B15 Full-graph integration]
  B15 --> B16[B16 Postgres + resume + lookup]
  B15 --> B17[B17 Abort / timeout / shutdown]
  B15 --> B18[B18 Observability]
  B16 & B17 & B18 --> B19[B19 CI + Render]
  B9 --> B19
  B19 --> B20[B20 Web ↔ agent integration]
  B2 --> B21[B21 Contracts: MESSAGE + TripContext]
  B15 & B21 --> B22[B22 Chat messages + decisions]
  B4 & B21 --> B23[B23 Trip context endpoint]
  B15 & B21 --> B24[B24 DRAFT + progress detail + log kinds]
  B7 & B15 --> B25[B25 Run registry + reconnect + cancel]
  B22 & B23 & B24 & B25 --> B20
```

**Parallel work:** after B7 is merged, B8, B10 and B11 can start at the same time in separate
Conductor workspaces. After B8 and B10, B9 / B12 / B13 / B14 touch separate files and can also run
in parallel.

**Why a stub graph first (B6–B7):** the riskiest parts of the backend are the streaming plumbing
(SSE headers, heartbeats, packet validation, progress mapping) and the graph wiring (routers,
re-plan loop, checkpointer). Building them with stub nodes that return canned data proves the whole
pipe end to end on day 3, gives the frontend a real server to talk to, and lets each real node later
replace its stub without touching anything else.

**Shared with the web plan:** B1 and B2 are the same work as web T1 and T2
([`../web/CLAUDE.md`](../web/CLAUDE.md) §12). They landed on `main` through the web branch (PR #1), so the
backend builds on that setup. Shared files follow the ownership rules in ARCHITECTURE.md §12.6.

#### Definition of done (every ticket)

- `pnpm --filter ai-travel-agent typecheck lint test` passes (and `build` from B3 on).
- Cross-service types come only from `@ai-travel/contracts`; `process.env` is read only in `src/config.ts`.
- No test calls Anthropic, SerpAPI, Tavily or a real database (fake `LlmFactory`, `TOOLS_MODE=mock`, `MemorySaver`).
- Relative imports use the `.js` extension (ESM + `NodeNext`).
- New behaviour has tests as listed in the ticket.
- If the implementation has to deviate from the spec in §1–§14, update the spec in the same PR.

Size: **S** ≈ half a day · **M** ≈ 1 day · **L** ≈ 2 days.

#### Status

| Ticket | Status |
| --- | --- |
| B1 – B2 | ✅ Done as web T1 / T2 (PR #1); the Zod 4 ↔ LangChain check from B2 was done here |
| B3 – B4 | ✅ Done |
| B5 – B20 | ⬜ Not started |
| B21 | ✅ Contracts landed with the design alignment (`packages/contracts`: richer `Flight`/`Hotel`, `Transfer`, per-day weather, `MESSAGE`, `DRAFT`, trip context); the web reducer changes are web T18 |
| B22 – B25 | ⬜ Not started (specified in ARCHITECTURE.md §4.6, §5, §6.5, §7) |

---

### M1 · Foundation

#### B1 — Monorepo foundation · S

**Goal:** one `pnpm install` and `pnpm dev` at the repo root (ARCHITECTURE.md §12). *Same as web T1.*

**Depends on:** —

**Tasks**
- Root `package.json` (`private`, `packageManager: pnpm@<exact>`, scripts `dev/build/test/typecheck/lint` → `turbo run …`, `turbo` dev dependency).
- `pnpm-workspace.yaml` with `apps/*`, `packages/*` and the `catalog` (`typescript`, `zod`, `vitest`).
- `turbo.json` and `tsconfig.base.json` exactly as in ARCHITECTURE.md §12.2.
- `.gitignore` (`node_modules`, `dist`, `.next`, `.turbo`, `.env*` except `.env.example`), `.nvmrc` (Node LTS, ≥ 20 for `AbortSignal.any`).
- Conductor setup script `pnpm install`, run script `pnpm dev`.

**Acceptance**
- Fresh clone → `pnpm install` succeeds; `pnpm build` runs. Lockfile committed.

---

#### B2 — Shared contracts package (`@ai-travel/contracts`) · M

**Goal:** the single source of cross-service types (ARCHITECTURE.md §5). *Same as web T2.*

**Depends on:** B1

**Tasks**
- `packages/contracts/package.json`: name `@ai-travel/contracts`, `"type": "module"`, `exports` → `dist/index.js` + `.d.ts`, scripts `build: tsc`, `dev: tsc --watch`, `test`, `typecheck`.
- `src/trip.ts`, `src/sse-events.ts`, `src/index.ts` exactly as in §5.1 / §5.2.
- **Zod 4 check:** confirm the pinned `zod` version works with `@langchain/core` / `@langchain/anthropic` `withStructuredOutput` (a 10-line spike is enough). If not, pin the catalog to a compatible version now — both apps depend on this choice.
- Tests: blueprint example packets parse; malformed packets rejected (wrong `type`, missing fields, percent > 100, bad coordinates, non-UUID `threadId`); `TripRequestSchema` bounds.

**Acceptance**
- `pnpm --filter @ai-travel/contracts build test` passes; `dist/` contains JS + `.d.ts`.

---

#### B3 — Agent scaffold + validated config · M

**Goal:** an empty `ai-travel-agent` that builds, starts on the right port and refuses bad env (§1–§4).

**Depends on:** B1, B2

**Tasks**
- `apps/agent/package.json`: name `ai-travel-agent`, `"type": "module"`, dependencies and scripts from §3, `@ai-travel/contracts: workspace:*`.
- `tsconfig.json` extending the base with `module`/`moduleResolution: NodeNext`, `outDir: dist`.
- ESLint flat config (`typescript-eslint`), Vitest config (`environment: node`, `NODE_ENV=test`).
- `src/config.ts`: Zod schema for every variable in §4 — `PORT` derived from `CONDUCTOR_PORT + 1` / 4000, `WEB_ORIGIN` comma list with the localhost default (required in `production`), `TOOLS_MODE`, `RUN_TIMEOUT_MS`, rate-limit values, optional keys. Print issues and `process.exit(1)` on failure. Export a pure `parseConfig(env)` for tests.
- `.env.example` with every variable and a one-line comment each.
- Placeholder `src/server.ts` that logs the port and listens.
- Tests: `test/config.test.ts` — defaults, `CONDUCTOR_PORT` derivation, `PORT` wins, `WEB_ORIGIN` list parsing, production without `WEB_ORIGIN` fails, missing `ANTHROPIC_API_KEY` fails.

**Acceptance**
- `pnpm dev` from the root starts the agent on `$CONDUCTOR_PORT + 1` (or 4000) next to the web app.
- `pnpm --filter ai-travel-agent build typecheck lint test` passes; `node dist/server.js` starts.

---

#### B4 — HTTP skeleton: middlewares, errors, `/health` · M

**Goal:** the Express app with everything except the trip routes (§5.1, §5.3, §5.4).

**Depends on:** B3

**Tasks**
- Split `server.ts` into `createApp(deps)` (pure, testable with supertest) and a `main()` that boots and listens.
- Middleware order from §5.1: `trust proxy`, `helmet`, `cors` (allow-list + `exposedHeaders: ['X-Thread-Id']`), `express.json({ limit: '10kb' })`, limiters, routes, 404, `errorHandler`. No `compression()`.
- `utils/errors.ts`: `AppError`, `ErrorCode`, helpers (`notFound()`, `validation(zodError)`).
- `middlewares/errorHandler.ts`: standard JSON shape; `ZodError` → 400; unknown → 500 generic; if `res.headersSent`, only log and end.
- `middlewares/rateLimiter.ts`: `generalLimiter` (100/min) and `runLimiter` (config values), `draft-7` headers, `429 RATE_LIMITED` body.
- `GET /health` (no rate limit).
- Tests: `test/server.test.ts` — `/health`, unknown route 404 shape, CORS allowed vs. rejected origin, `X-Thread-Id` in `Access-Control-Expose-Headers`, body > 10 kb rejected, 429 after the limit (with a low test limit).

**Acceptance**
- `curl /health` → `{"status":"ok"}`; all error responses use the standard shape.

---

### M2 · Streaming skeleton

#### B5 — `SseStreamer` · S

**Goal:** the only way packets reach the wire (§6, ARCHITECTURE.md §6.1).

**Depends on:** B4

**Tasks**
- `utils/sseStreamer.ts`: `open(threadId)` (headers incl. `X-Accel-Buffering: no` and `X-Thread-Id`, `flushHeaders()`, 15 s `: ping` heartbeat), `send(event)` (`SseEventSchema.parse` → `id: n\ndata: <json>\n\n`), `close()`, `isClosed`.
- Progress monotonicity enforced in `send`; `send` after close is a no-op; listens to `res.on('close')` to mark closed.
- Heartbeat interval injectable (or use fake timers) for tests.
- Tests: `test/sseStreamer.test.ts` — headers, wire format, sequence ids, invalid packet throws, lower progress raised, heartbeat written, no write after close.

**Acceptance**
- Output of a test stream parses back with `SseEventSchema` packet by packet.

---

#### B6 — State, graph wiring and stub nodes · M

**Goal:** the real `StateGraph` with real routers and loop, running on placeholder nodes (§8.1–§8.3).

**Depends on:** B3

**Tasks**
- `agent/state.ts`: `TravelAgentStateAnnotation` (replace / append reducers), `MAX_BUDGET_RETRIES`, `initialState(request)`, `nextStep(state)`, `log(state, agent, message, level?)`.
- `agent/graph.ts`: `buildGraph(deps)` with the five nodes, edges and the two pure routers exactly as in §8.2; `retryPolicy` on supervisor and planner; export `CompiledTravelGraph` type.
- `createCheckpointer(config)` returning `MemorySaver` for now (Postgres in B16).
- Stub node factories in `agent/nodes/*.node.ts` that return canned, contract-valid data and logs — each later ticket replaces one stub.
- Tests: `test/graph.routes.test.ts` — every router for every relevant status / itinerary combination; `test/state.test.ts` — reducers (logs/warnings append, others replace), `nextStep` across re-plans; a compile test proving no node name collides with a state key.

**Acceptance**
- `graph.invoke(initialState(req), { configurable: { thread_id } })` with stubs reaches `END` with `status: 'completed'`.

---

#### B7 — `runTrip` stream controller + `POST /api/trips` · M

**Goal:** a real SSE stream from the API, end to end (§5.2, §7; ARCHITECTURE.md §6.3).

**Depends on:** B5, B6

**Tasks**
- `agent/runTrip.ts`: `emit(PROGRESS 5/parsing)`, `graph.stream(..., { streamMode: ['updates', 'custom'], recursionLimit: 20, signal })`, node logs → `LOG` packets, node + status → `PROGRESS` per the §6.3 table, final `getState` → exactly one `RESULT`. It takes an `emit` callback; B7 wires it straight to one `SseStreamer`, B25 puts the registry in between.
- `buildResultPayload(threadId, values)` as a separate pure function (reused by B16's `GET /api/trips/:id`); includes `transfers`, `replans`, `passes`, `suggestions`.
- Error path: `System` error `LOG` + `RESULT failed` built from the latest checkpoint; safe error messages only (no stack, no keys).
- `POST /api/trips`: validate with `TripRequestSchema` → 400; `threadId = crypto.randomUUID()`; `runLimiter`. (Client disconnect handling is B25: the run must not die with the connection.)
- Tests: `test/runTrip.test.ts` (stub graph) — every packet parses, exactly one `RESULT` and it is last, progress monotonic and ends at 100, a node that throws ends in `RESULT failed`; supertest: 400 on bad body, `X-Thread-Id` header present.

**Acceptance**
- `curl -N -X POST localhost:4000/api/trips -H 'content-type: application/json' -d '{"prompt":"5 days in Paris"}'` prints a valid stream.
- The web app's `useAgentStream` (web T7) works against this server, not only against its mock.

---

### M3 · Agent brain

#### B8 — Tool layer + mock travel engine · M

**Goal:** a `TravelSearchTool` the nodes can call, working fully offline (§10).

**Depends on:** B6

**Tasks**
- `tools/types.ts`: `FlightQuery`, `HotelQuery`, `TravelSearchTool`, `ToolUnavailableError`.
- `tools/mockTravel.tool.ts`: deterministic prices from a hash of the query, 3–5 flights / 3–5 hotels, `source: 'mock'`, `cheaper` mode ≥ 15% below `maxPrice`, ~300 ms delay (0 in tests), respects `signal`.
- `tools/index.ts`: `withFallback(primary, mock, onFallback)`, `createTravelTool(config)` for `mock | live | auto` (SerpAPI slot throws "not implemented" until B9).
- Tests: `test/tools.test.ts` — determinism, schema validity of every result, cheaper-mode bound, fallback calls `onFallback` and returns mock data, `TOOLS_MODE` selection.

**Acceptance**
- All mock output parses with `FlightSchema` / `HotelSchema`.

---

#### B9 — SerpAPI tool (live flights & hotels) · L

**Goal:** real prices from Google Flights / Google Hotels with safe degradation (§10).

**Depends on:** B8

**Tasks**
- `tools/serpApi.tool.ts`: `engine=google_flights` (round trip, `currency=USD`) and `engine=google_hotels` via `fetch`.
- City → airport code: city name first, small lookup map for common cities as fallback (incl. Tashkent `TAS`).
- `AbortSignal.any([run signal, AbortSignal.timeout(10_000)])`; retry 2× on network / 429 / 5xx with 500 ms → 1500 ms backoff + jitter; no retry on other 4xx.
- Map items through `FlightSchema` / `HotelSchema` with `source: 'serpapi'`; drop items that fail; zero valid items → `ToolUnavailableError`.
- Record real responses once (keys stripped) as fixtures in `test/fixtures/serpapi/`.
- Tests: mapping from fixtures, retry/backoff (fake timers + mocked `fetch`), no retry on 400, timeout → `ToolUnavailableError`, `auto` mode falls back to mock.
- Manual check: one live call with a real key, documented in the PR.

**Acceptance**
- With `SERPAPI_API_KEY` set and `TOOLS_MODE=auto`, a run returns `source: 'serpapi'` options; with a bad key it falls back to mock with a warning.

---

#### B10 — LLM factory + fake factory · S

**Goal:** one place that builds structured-output models with fallback (§9).

**Depends on:** B6

**Tasks**
- `agent/llm.ts`: `LlmFactory.structured(schema, name, opts?)` → primary `ChatAnthropic` (`maxRetries: 2`, `timeout: 30_000`; no `temperature`) `.withStructuredOutput(schema, { name })` `.withFallbacks([fallback…])`.
- Report which model answered (so nodes can add the "used claude-sonnet-5-5" `warn` log) — e.g. return `{ data, model }` or expose an `onFallback` callback.
- `test/helpers/fakeLlm.ts`: fake factory returning canned objects per schema name, with an option to throw (for fallback/failure tests).
- Tests: fallback is used when the primary throws (with fake chat models), strict-schema helper rejects `optional()` fields.

**Acceptance**
- No node constructs `ChatAnthropic` directly; everything goes through `LlmFactory`.

---

#### B11 — Budget Auditor node · S

**Goal:** the deterministic cost check and re-plan decision (§8.4, ARCHITECTURE.md §4.3), including transfers, per-pass records and over-budget suggestions.

**Depends on:** B6

**Tasks**
- `agent/nodes/budget.node.ts`: export `computeTotalCost(state)` (2-decimal rounding) and `budgetNode`.
- The three conditions with the exact state updates and log texts from the spec; `MAX_BUDGET_RETRIES` from `state.ts`. Formula includes `Σ transfers`.
- Append a `BudgetPass` per audit (labels "$420 via IST", "5 × $66"); condition 3 sets `suggestions` (`raiseBudgetTo`, `tryDays`).
- Replace the B6 stub.
- Tests: `test/budget.node.test.ts` — formula, exact-budget boundary, condition 1, condition 2 (retry++ / `searchMode: 'cheaper'` / `overBudgetBy`), condition 3 (warning text, stops), no I/O.

**Acceptance**
- 100% branch coverage of `budget.node.ts`.

---

#### B12 — Flight Agent + Hotel Agent nodes · M

**Goal:** search, sort and select flights and hotels, honouring cheaper mode (§8.4).

**Depends on:** B8

**Tasks**
- `flight.node.ts`: build `FlightQuery` (`returnDate = startDate + durationDays`), `maxPrice` in cheaper mode, sort ascending, keep previous selection if nothing cheaper, fallback warning + `warnings` entry.
- `hotel.node.ts`: `checkIn/checkOut`, rating ≥ 7 (0–10 scale) preference, cheapest-first, same "never more expensive" rule, `status: 'planning'`.
- Both nodes carry the richer contract fields through (flight legs and stops, hotel area / check-in / location); first-pass messages are proposals, re-plan-pass messages are `flight` / `hotel` decisions with the saving (§8.4).
- Shared date helper (`addDays(isoDate, n)`) with tests.
- Replace the B6 stubs.
- Tests: `test/nodes/flight.node.test.ts`, `test/nodes/hotel.node.test.ts` — sorting, rating rule, cheaper mode never increases price, "keeping $X option" log, fallback warning, `step` numbering.

**Acceptance**
- Over three rounds against the mock tool, selected flight and hotel prices never go up.

---

#### B13 — Supervisor node · M

**Goal:** turn free text into a structured trip, safely (§8.4, ARCHITECTURE.md §9).

**Depends on:** B10

**Tasks**
- Structured schema (all fields `nullable`), system prompt: extract only, never invent budget/duration.
- Merge: request overrides win; default `startDate` = today + 30 days (clock injectable for tests); reject past dates.
- Missing `destination`, `budget` or `durationDays` → `status: 'failed'`, user-friendly `error` ("Please include …"), `warn` log — graph ends normally.
- Success log e.g. `Planning 5 days in Paris from Tashkent, budget $1,000.`
- Replace the B6 stub.
- Tests: `test/nodes/supervisor.node.test.ts` (fake LLM) — overrides win, each missing field, default date, fallback-model `warn` log.
- Manual eval: 10 sample prompts (EN + a few with typos / mixed currency) against the real model, results pasted in the PR.

**Acceptance**
- A prompt without a budget ends the run with `RESULT failed` and a helpful message, not a crash.

---

#### B14 — Planner node (transfers, forecast, day by day) · L

**Goal:** airport transfers, a per-day forecast, and a day-by-day plan with real coordinates and a daily spend estimate, produced one day at a time (§8.4).

**Depends on:** B10, B8 (weather client in B23 provides `getForecast`; stub it until then)

**Tasks**
- Structured schemas (strict-compatible versions of the contract schemas): `{ dailyExpensesEstimate, transfers }` and `{ title, places }` per day.
- Transfers call: exactly two legs, USD `priceUsd`, `note` for local fares; `cheaper` mode picks the cheapest viable modes and never raises the price.
- Day loop: one call per day with hotel location, that day's transfers, previous days and the forecast; rain / snow / storm → indoor stops. After each day: validate, coordinate guard, fill `date` / `weather`, `config.writer({ kind: 'day', … })`.
- Post-validation: exactly `durationDays` days numbered 1..N (fail → treat as model failure → fallback), drop places > ~100 km from the day's median point (haversine helper).
- Re-plan pass: reuse existing days, re-choose transfers, re-route only hotel-anchored days (§8.4); the `itinerary` decision is emitted once.
- Optional Tavily context when `TAVILY_API_KEY` is set (top attractions passed into the prompts; skipped silently on error).
- Messages and callouts from §8.4 (transfer proposal, `Weather prep` callout per indoor day, `itinerary` and `transfers` decisions).
- Replace the B6 stub.
- Tests: `test/nodes/planner.node.test.ts` — day count, renumbering/rejection, transfers on the right days, cheaper mode never costs more, rain day moved indoors + callout, `null` forecast → no callout, one writer event per day, coordinate guard, re-plan keeps unchanged days, Tavily on/off with a fake client.
- Manual eval: 3 destinations (Paris, Tokyo, Samarkand) against the real model; spot-check coordinates on a map and the cost of the per-day calls (report tokens in the PR).

**Acceptance**
- Planner output always passes `ItineraryDaySchema` and the guard; a first pass makes `1 + N` model calls, a re-plan only as many as it has hotel-anchored days.

---

#### B15 — Full-graph integration tests · M

**Goal:** prove the real graph behaves as the architecture says, with no network (§13).

**Depends on:** B7, B11, B12, B13, B14

**Tasks**
- `test/runTrip.test.ts` with the real nodes, fake LLM, mock tools, `MemorySaver`:
  - happy path within budget — node order, packet sequence, progress 5 → 100, `RESULT completed`;
  - over budget — two re-plans that skip `itineraryPlanner`, then completed with `Budget exceeded by $X`;
  - becomes affordable on retry 1 — stops after one re-plan;
  - supervisor input failure — `RESULT failed` with the user message;
  - every packet parses with `SseEventSchema`; exactly one `RESULT`; `step` strictly increasing.
- Remove all remaining stub code.

**Acceptance**
- The suite runs in < 10 s and is the regression net for every later ticket.

---

### M4 · Persistence & resilience

#### B16 — PostgreSQL checkpointer, resume and trip lookup · L

**Goal:** runs survive failures and reloads (§5.2, §11; ARCHITECTURE.md §4.5).

**Depends on:** B15

**Tasks**
- `createCheckpointer(config)`: `PostgresSaver.fromConnString(DATABASE_URL)` + `await setup()` on boot; `MemorySaver` otherwise (boot warning in `production`).
- `POST /api/trips/:threadId/resume`: UUID check, 404 if no checkpoint, finished run → send its `RESULT` and close, else `runTrip({ resume: true })`.
- `GET /api/trips/:threadId`: latest checkpoint → `buildResultPayload` JSON, 404 if unknown.
- Local Postgres for development: `docker-compose.yml` (or documented `docker run`) + `.env.example` entry.
- Tests: `test/resume.test.ts` — inject a failure in `itineraryPlanner`, assert `RESULT failed`, resume → completes without re-running supervisor/flight/hotel (spy on nodes); resume of a finished run; 404s; GET lookup shape.
- Optional: one Postgres-backed test behind an env flag (`TEST_DATABASE_URL`), skipped by default.

**Acceptance**
- With Postgres, restarting the server mid-run and calling resume finishes the trip.

---

#### B17 — Abort, timeout and graceful shutdown · M

**Goal:** no wasted LLM/tool spend and no hung streams (ARCHITECTURE.md §8, §5.5, §7).

**Depends on:** B15

**Tasks**
- Cancel (B25) and timeout abort the graph and in-flight `fetch`/LLM calls (signal threaded into tools and `ChatAnthropic` calls). A closed connection alone does not.
- `RUN_TIMEOUT_MS` via `AbortSignal.timeout` → `RESULT failed` "Trip planning took too long, resume to continue".
- `SIGTERM`/`SIGINT` → stop accepting, `registry.abortAll`, abort runs with "Server restarting, resume to continue", close Postgres pool, exit ≤ 10 s.
- Tests: abort mid-run stops further node execution (spy), timeout path with a slow fake node, shutdown sends failed `RESULT` to open streams.

**Acceptance**
- Closing the browser tab mid-run produces no further Anthropic/SerpAPI requests (verified in logs).

---

#### B18 — Observability · S

**Goal:** every run is traceable by `threadId` (§12, ARCHITECTURE.md §10).

**Depends on:** B15

**Tasks**
- `utils/logger.ts`: tiny structured JSON logger (or `pino`) — `{ level, msg, threadId, node, durationMs, … }`. *Spec update: add the file to §2.*
- Request log line per HTTP request; run summary line (`outcome`, `retryCount`, `llmFallbackUsed`, `toolFallbackUsed`, `totalMs`); per-node duration.
- Redaction: never log keys or full prompts in production (length only).
- LangSmith tracing enabled through config (`LANGSMITH_TRACING`, `LANGSMITH_API_KEY`) and documented.
- Tests: summary line fields for completed / failed / aborted runs; redaction.

**Acceptance**
- One grep on a `threadId` shows the full story of a run.

---

### M5 · Ship

#### B19 — CI and Render deployment · M

**Goal:** green CI and a production agent with Postgres (ARCHITECTURE.md §13).

**Depends on:** B9, B16, B17, B18

**Tasks**
- GitHub Actions (shared with web T17 if it exists): pnpm cache, `pnpm install --frozen-lockfile`, `pnpm turbo run lint typecheck test build`.
- Render web service: root = repo root, build/start commands and build filters from §13, health check `/health`, Corepack pnpm version.
- Render Postgres instance; `DATABASE_URL` linked.
- Env vars: `ANTHROPIC_API_KEY`, `SERPAPI_API_KEY`, `WEB_ORIGIN` (production + preview domains), `NODE_ENV=production`, optional Tavily / LangSmith.
- Smoke test after deploy: `/health`, one real trip, one resume.
- `apps/agent/README.md`: run locally, env vars, deploy notes.

**Acceptance**
- Merging to `main` deploys the agent; a real trip from `curl` completes in production.

---

#### B20 — Web ↔ agent integration · S

**Goal:** the deployed frontend talks to the real backend.

**Depends on:** B19, B22, B23, B24, B25 (and web T16/T17/T19/T20/T22/T24)

**Tasks**
- Point Vercel `NEXT_PUBLIC_AGENT_URL` at the Render URL; confirm CORS for production and preview domains.
- Run the web Playwright suite against the real agent with `TOOLS_MODE=mock` and the fake LLM (or a test-only `LLM_MODE=fake` flag — *spec update if added*).
- Retire the web mock agent from previews.

**Acceptance**
- Production: submit a trip in the browser → logs stream → result cards, timeline and map render.

---

### M6 · Chat & top bar

> Two features the original blueprint did not cover: friendly chat messages with confirmed decisions, and
> the weather / exchange-rate lookup for the web top bar. Design: ARCHITECTURE.md §4.6, §5.2–§5.3, §7.1.

#### B21 — Contracts: design alignment, chat messages and trip context · S · ✅ Done

**Goal:** the shared schemas for the design's data (ARCHITECTURE.md §5.1–§5.3). *Same as web T18.*

**Depends on:** B2

**Delivered in `packages/contracts`** (source and tests; ARCHITECTURE.md §5 embeds the files)
- `trip.ts`: `AirportSchema`, `FlightStopSchema`, `FlightLegSchema`, richer `FlightSchema` / `HotelSchema` (rating 0–10), `TransferSchema`, `DayWeatherSchema`, `PlaceSchema.note`, `ItineraryDaySchema.date/weather`, `AgentName` `Planner`, `DecisionTopicSchema` (+ `transfers`).
- `sse-events.ts`: `LogPayload.kind`, `MessagePayload` (`decision`, `callout`), `ProgressPayload` (`detail`, `pass`, `run`), `DraftPayload` / `DraftEvent`, `BudgetPassSchema`, `SuggestionsSchema`, `ResultPayload` (`transfers`, `replans`, `passes`, `suggestions`); `SseEventSchema` has five members.
- `trip-context.ts`: `TripContextQuerySchema` (+ `origin`), `WeatherSchema` (today range, `outlook`), `CurrencySchema`, `ExchangeRateSchema`, `TripContextSchema` (`currency`, `timeZone`, `originTimeZone`).
- Tests in `packages/contracts/test/schemas.test.ts` (48 cases).
- Cross-app (ARCHITECTURE.md §12.6): the union gained members, so the web reducer needs `MESSAGE` and `DRAFT` cases to keep type-checking — web T18.

**Acceptance**
- `pnpm --filter @ai-travel/contracts build test` passes; `pnpm typecheck` passes for both apps.

---

#### B22 — Chat messages and confirmed decisions from the nodes · M

**Goal:** every node speaks to the user in plain language, and final choices are flagged (§8.5, ARCHITECTURE.md §4.6).

**Depends on:** B15, B21

**Tasks**
- `agent/state.ts`: `ChatMessage` type, `messages` (append reducer), `say(state, agent, text, decision?)` helper (same `step` rule as `log`).
- `agent/messages.ts`: pure text builders for every message in the ARCHITECTURE.md §4.6 table (money through one `formatUsd`); no LLM involved.
- `confirmed` in state (append); `say(..., { decision, callout })` adds the topic.
- Update the five nodes to return `messages` next to `logs`: first-pass flight / hotel / transfer messages are proposals; re-plan-pass messages are the `flight`, `hotel`, `transfers` decisions with the saving; the Budget Auditor confirms whatever is still unconfirmed, then `budget`, on conditions 1 and 3, and sends the `Over budget` callout on a re-plan.
- `agent/runTrip.ts`: after a node's `LOG` packets send its `MESSAGE` packets, then `DRAFT` and `PROGRESS` (B24).
- Tests: `test/messages.test.ts` (exact text per builder, rounding, savings); node tests assert messages, `decision` topics and callouts; extend `test/runTrip.test.ts` — `MESSAGE` packets parse, order is `LOG → MESSAGE → …` per node, same `step` as the node's logs, a no-re-plan run emits `trip, itinerary` early and `flight, hotel, transfers, budget` from the auditor, an over-budget run emits `flight, hotel, transfers` in the re-plan pass (not twice for the same pass), supervisor failure emits no decision.

**Acceptance**
- A completed run's `MESSAGE` packets confirm each of `trip, flight, hotel, transfers, itinerary, budget` (a topic can repeat only across re-plan passes); a failed run contains none.

---

#### B23 — Trip context endpoint (weather + exchange rate) · M

**Goal:** `GET /api/trip-context` for the web destination bar, and the forecast the Planner uses (§10.1, ARCHITECTURE.md §7.1).

**Depends on:** B4, B21

**Tasks**
- `tools/weather.ts`: Open-Meteo geocoding (incl. time zone) + current weather with today's range + daily forecast (`getForecast`); map weather codes to `condition` + `icon`; build `outlook`.
- `tools/exchangeRate.ts`: USD → currency rate from the chosen keyless provider (open question 7).
- `tools/currencies.ts`: static country code → ISO 4217 code + symbol table.
- `utils/ttlCache.ts` + `tools/tripContext.ts`: normalised-destination cache (geocode 24 h, weather 30 min, rate 6 h, failures not cached), `Promise.allSettled` for weather ∥ rate, 5 s timeout and one retry per call.
- Optional `origin`: geocode it for `originTimeZone` (unknown origin → `null`, not an error).
- Route in `app.ts` behind `generalLimiter`: validate with `TripContextQuerySchema` → `400`; geocode miss → `404 NOT_FOUND`; parse the response with `TripContextSchema` before sending.
- `TOOLS_MODE=mock` returns fixed fixtures with `source: 'mock'`.
- Record provider responses once as fixtures in `test/fixtures/trip-context/`.
- Tests: `test/tripContext.test.ts` with a stubbed `fetch` — happy path, weather-only failure, rate-only failure, USD destination (`currency` and `exchangeRate` `null`), unknown country code, unknown city (`404`), unknown origin, `outlook` wording, forecast in range / beyond 16 days / failure, cache hit makes no second call, failure is not cached, timeout → `null`; supertest for `400`/`404`/`200` shapes.
- Manual check: one live call per provider, documented in the PR.

**Acceptance**
- `curl 'localhost:4000/api/trip-context?destination=Paris'` returns a valid `TripContext`; with one provider blocked, the other field is still returned.

---

### M7 · Live trip & reconnect

> The design's live Trip Overview, run details, reconnecting stream and rate-limit countdown (Web-Live, Main, States boards).
> Design: ARCHITECTURE.md §6.2–§6.5, §7.

#### B24 — `DRAFT` packet, progress detail, checkpoint rows and log kinds · M

**Goal:** the browser can show the trip as it takes shape (§7, ARCHITECTURE.md §6.2–§6.3).

**Depends on:** B15, B21

**Tasks**
- `toDraft(values)` in `state.ts`; `runTrip` sends `DRAFT` after each node's `MESSAGE`s, then a checkpoint `LOG` (`System`, `kind: 'checkpoint'`) and `PROGRESS`.
- `PROGRESS` carries `pass = retryCount + 1` and `run` (`model`, `checkpointer`, `lastCheckpointStep`); the Planner's custom writer events become `PROGRESS.detail` ("Day 4 of 5") and a `DRAFT` with the itinerary so far, with the percent interpolated 55 → 75.
- Fallback logs use `kind: 'llm-fallback'` / `'search-fallback'` (LLM factory and tool `onFallback`).
- Tests: extend `test/runTrip.test.ts` — packet order per node, `DRAFT` fills in field by field and never contains an empty array for a field not yet produced, `pass` increases on a re-plan, `detail` appears only while the Planner runs, checkpoint rows carry the step number.

**Acceptance**
- In a mock run the first `DRAFT` (right after the Supervisor) has `destination`, `budget`, `durationDays`; the last `DRAFT` equals the `RESULT` trip fields.

---

#### B25 — Run registry, reconnect, cancel and rate-limit countdown · L

**Goal:** a run survives its connection; the user can reconnect or stop it (§7, ARCHITECTURE.md §6.5, §7).

**Depends on:** B7, B15

**Tasks**
- `agent/runRegistry.ts`: `RunRegistry` / `Run` as in §7 — ring buffer (`RUN_REPLAY_MAX_EVENTS`), TTL after completion (`RUN_REPLAY_TTL_MS`), id assignment, monotonic progress, fan-out to subscribers, one live run per thread.
- Wire `POST /api/trips` and `POST …/resume` through the registry; remove the `res.on('close')` abort. Add `GET /api/trips/:threadId/stream` (honours `Last-Event-ID`) and `POST /api/trips/:threadId/cancel`.
- `AppError.retryAfterSeconds`; the rate-limit handler fills it; CORS exposes `Retry-After`.
- Config: `RUN_REPLAY_TTL_MS`, `RUN_REPLAY_MAX_EVENTS` in `config.ts`, `.env.example` and tests.
- Tests: `test/runRegistry.test.ts` (see §13), supertest for the two new routes (404s, replay from an id, 204 cancel idempotent), 429 body has `retryAfterSeconds`.

**Acceptance**
- Start a run with `curl -N`, kill `curl` mid-run, then `curl -N -H 'Last-Event-ID: 12' …/stream` prints the missed packets and ends with one `RESULT`.

---

### Open questions

1. **Model choice** — the spec defaults to `claude-opus-5-5` / `claude-sonnet-5-5`. Confirm these are still the models you want (and still available) before B10, or change the `ANTHROPIC_MODEL` defaults.
2. **Zod 4 vs LangChain** — the B2 spike was run against the OpenAI package; re-run it against `@langchain/anthropic`. It must confirm that `withStructuredOutput` works with Zod 4 **without a forced `tool_choice`** (a 400 on Opus 5.5 / Sonnet 5.5), that `withFallbacks` works, and that malformed output is rejected with a `ZodError`.
3. **Hotel nights** — keep `durationDays` nights (blueprint) or switch to `durationDays - 1` (ARCHITECTURE.md §15)? Affects B11/B12 and the web cards.
4. **SerpAPI plan** — the free tier has a low monthly quota; is mock-only acceptable for previews/staging, with live search only in production?
5. **Render tier** — the free tier sleeps and cold-starts (slow first stream) and its Postgres expires; use a paid instance for production?
6. ~~**Docs on `main`**~~ — resolved: the specs landed on `main` with PR #1.
7. **Exchange-rate provider** — pick one free, keyless API with USD base and coverage of the currencies we care about (UZS in particular; not every ECB-based API lists it). Check its terms (attribution, rate limits) before B23.
8. ~~**Weather scope**~~ — resolved by the design: the destination bar shows current weather plus today's range and an outlook, and the Planner reads the per-day forecast (≤ 16 days ahead; later dates get no weather).
9. **Hotel photos and transit** — Google Hotels returns thumbnails and links but not metro lines. `Hotel.transit` stays `null` for live data unless a provider is added; the design's "Metro · lines 3, 5, 8, 9, 11" row is then mock-only. Is a separate transit lookup worth it?
10. **Planner cost** — day-by-day generation makes `1 + N` model calls per first pass (Opus 5.5). Measure in B14; if too slow or costly, generate all days in one call and keep the `Day N of M` progress as a timed estimate.
11. **Replay buffer scope** — the registry is in-process, so a restart or a second Render instance loses it (the checkpoint still allows `resume`). Acceptable for now?
