# ai-travel-agent — Service Specification

> Paths are relative to `apps/agent/`. System-wide design (graph, SSE protocol, contracts, deploy) is in
> [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md); this file specifies how the agent implements it.
> Open work is in [`PLAN.md`](./PLAN.md); finished tickets (B1–B25) are archived in
> [`../../docs/archive/agent-plan-2026-10.md`](../../docs/archive/agent-plan-2026-10.md).

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
│   │   ├── runAbort.ts            # + abort reasons / user-facing messages for timeout, shutdown, cancel
│   │   ├── messages.ts            # + pure builders for friendly chat messages (§8.5)
│   │   └── nodes/
│   │       ├── supervisor.node.ts
│   │       ├── flight.node.ts
│   │       ├── hotel.node.ts
│   │       ├── planner.node.ts
│   │       └── budget.node.ts
│   ├── tools/
│   │   ├── types.ts               # + SearchTool (flights, hotels) ⊂ TravelSearchTool (+ getForecast), query types, ToolUnavailableError
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
│   │   ├── fetchJson.ts           # + GET → JSON with 5 s timeout and one retry (trip-context providers)
│   │   └── logger.ts              # + structured JSON logger
│   ├── storage/
│   │   └── tripStore.ts           # + finished trips + chat for "My trips" (Postgres `trips` table / memory) (§11)
│   ├── app.ts                     # + createApp(deps): middlewares + routes, no listen
│   ├── server.ts                  # boot: loadConfig → createApp → listen, graceful shutdown
│   └── config.ts                  # Zod-validated env
├── .env.example                   # every variable from §4
├── package.json                   # name: ai-travel-agent
├── tsconfig.json                  # extends ../../tsconfig.base.json, NodeNext, src (typecheck)
├── tsconfig.build.json            # src only → dist/
└── eslint.config.js               # @eslint/js + typescript-eslint, Node globals
```

Files marked `+` are not in the blueprint tree; see ARCHITECTURE.md §14 for why they exist.

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
| dev: `typescript`, `tsx` | Build, watch mode |

Scripts:

```json
{
  "dev": "tsx watch src/server.ts",
  "build": "tsc -p tsconfig.build.json",
  "start": "node dist/server.js",
  "typecheck": "tsc --noEmit",
  "lint": "eslint ."
}
```

---

## 4. Configuration — `src/config.ts`

`parseConfig(env)` is a pure Zod parser; `loadConfig()` loads `.env`, parses `process.env`,
prints the issues and `process.exit(1)` on failure. `server.ts` calls `loadConfig()` once and **injects** the
typed `Config` (`createApp({ config, … })`, later `buildGraph`, `runTrip`), so importing a module never
triggers env parsing. Nothing outside `config.ts` reads `process.env`.

Blank values (`KEY=` copied from `.env.example`) count as unset. `WEB_ORIGIN` entries are normalised to
origins (`https://x.com/` → `https://x.com`) because CORS compares them to the browser's `Origin` exactly.

| Variable | Type / default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development \| production`, default `development` | |
| `PORT` | int; default `CONDUCTOR_PORT + 1` if set, else `4000` | Render sets `PORT` |
| `CONDUCTOR_PORT` | int, optional | Conductor workspace base port |
| `WEB_ORIGIN` | comma-separated URLs; default `http://localhost:${CONDUCTOR_PORT ?? 3000}` | CORS allow-list |
| `ANTHROPIC_API_KEY` | string, **required** | |
| `ANTHROPIC_MODEL` | default `claude-opus-5-5` | Primary model |
| `ANTHROPIC_FALLBACK_MODEL` | default `claude-sonnet-5-5` | Fallback model |
| `SERPAPI_API_KEY` | string, optional | Missing → mock tools in `auto` mode |
| `TAVILY_API_KEY` | string, optional | Optional place research for the planner |
| `TOOLS_MODE` | `auto \| live \| mock`, default `auto` | `auto` = live if key present, else mock |
| `DATABASE_URL` | URL, optional | Present → `PostgresSaver` and the Postgres `trips` table, else `MemorySaver` and an in-memory trip store. Required in production |
| `RUN_TIMEOUT_MS` | int, default `120000` | Whole-run timeout |
| `RUN_REPLAY_TTL_MS` | int, default `600000` (10 min) | How long a finished run's packets stay available for reconnects |
| `RUN_REPLAY_MAX_EVENTS` | int, default `500` | Replay buffer size per run (oldest packets dropped first) |
| `RATE_LIMIT_WINDOW_MS` | int, default `900000` (15 min) | |
| `RATE_LIMIT_MAX_RUNS` | int, default `10` | Max trip runs per IP per window |
| `RATE_LIMIT_DAILY_MAX_RUNS` | int, default `30` | Max trip runs per IP per 24 h, on top of the window (caps one address's LLM spend) |
| `SEARCH_CACHE_TTL_MS` | int, default `1800000` (30 min) | How long a flight / hotel search is reused |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY` | optional | LangGraph tracing |

Cross-field rules: in `production`, `WEB_ORIGIN` must be set explicitly (no localhost default);
`TOOLS_MODE=live` requires `SERPAPI_API_KEY`; `LANGSMITH_TRACING=true` requires `LANGSMITH_API_KEY`;
`DATABASE_URL` must be a `postgres://` / `postgresql://` URL.

---

## 5. HTTP layer — `src/server.ts`

### 5.1 Middleware order

1. `app.set('trust proxy', 1)` — Render sits behind one proxy; rate limiting needs the client IP.
2. `helmet()`
3. `cors({ origin: config.WEB_ORIGIN, methods: ['GET', 'POST'], exposedHeaders: ['X-Thread-Id', 'Retry-After'] })` (allowed request headers: `Content-Type`, `Accept`, `Last-Event-ID`, `Authorization`, `X-Owner-Id`). Under `/api`, `identify` reads `Authorization: Bearer` into `res.locals.user`: no header = guest, an invalid or expired token = `401 UNAUTHORIZED`. A stored trip with a `user_id` answers `404` to any other caller on `GET /api/trips/:id`, `…/record`, `…/resume`, `…/stream` and `…/cancel`; the `trips.user_id` column is added on boot
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
| `GET /readyz` | `200 { status: "ready" }`, or `503` with `problems` (database unreachable within 2 s, missing key in `live` mode). No rate limit. |
| `POST /api/trips` | `TripRequestSchema.safeParse(body)`; invalid → `400 VALIDATION_ERROR`. Otherwise `threadId = crypto.randomUUID()`, `registry.start({ threadId, request, ownerId })` (`ownerId` from a valid `X-Owner-Id` header, else `null`; never an error), open SSE and subscribe the response to the run. |
| `POST /api/auth/google` | `GoogleLoginRequestSchema`; `404` unless `GOOGLE_CLIENT_ID` and `SESSION_SECRET` are set. `auth/google.ts` has Google check the credential (`tokeninfo`: audience = our client id, Google issuer, not expired, verified email) → `401 UNAUTHORIZED` if not acceptable, `502` if Google cannot be reached. Returns `GoogleLoginResponse` with a 30-day HS256 session token (`auth/session.ts`). |
| `GET /api/trips` | Signed in (`Authorization: Bearer`): that account's trips. Guest: header `X-Owner-Id` must be a UUID, else `400 VALIDATION_ERROR`, and the list is that owner's trips that no account has claimed. Newest first, at most 50. |
| `POST /api/trips/claim` | Needs a session (`401` otherwise) and a valid `X-Owner-Id`; sets `user_id` on that owner's unclaimed trips and returns `{ claimed }`. |
| `POST /api/trips/:threadId/resume` | `threadId` must be a UUID and have a checkpoint (`graph.getState`), else `404`. If the run already reached `END` (`state.next` is empty), send its `RESULT` and close. Otherwise `registry.start({ threadId, resume: true })`, open SSE and subscribe. |
| `GET /api/trips/:threadId/stream` | Reconnect. Unknown or expired run → `404`. Otherwise open SSE, replay the buffered packets with an id greater than the `Last-Event-ID` header (all of them when absent), then follow the live run until its `RESULT`. |
| `POST /api/trips/:threadId/cancel` | Run in the registry → abort it (the stream ends with `RESULT failed: "Run stopped"`, the checkpoint stays) and answer `204`. Finished run → `204` (idempotent). Unknown → `404`. |
| `GET /api/trips/:threadId` | The trip store's result, else the latest checkpoint → `ResultPayload` JSON; `404` if neither knows it. |
| `GET /api/trips/:threadId/record` | Same sources → `TripRecord` (result, chat `messages`, timestamps). From a checkpoint the chat is `state.messages`. Used by the web app after a reload or on another device. |
| `GET /api/trip-context?destination=…` | `TripContextQuerySchema.safeParse(query)`; invalid → `400 VALIDATION_ERROR`. `lookupTripContext` (§10.1) → `TripContext` JSON; destination not found → `404 NOT_FOUND`. Plain JSON, no SSE, behind `generalLimiter` only. |

### 5.3 Errors — `utils/errors.ts`, `middlewares/errorHandler.ts`

```typescript
import type { ErrorCode } from '@ai-travel/contracts'; // VALIDATION_ERROR | NOT_FOUND | CONFLICT | RATE_LIMITED | INTERNAL
class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number, public retryAfterSeconds?: number) {}
}
```

- Response shape: `ErrorBody` from the contracts, `{ "error": { "code": "...", "message": "...", "retryAfterSeconds"?: number } }`. `retryAfterSeconds` is set only for `RATE_LIMITED`. `ZodError` → `400` with the
  flattened issues in `message`; unknown errors → `500 INTERNAL` with a generic message (stack only in logs).
- Body-parser errors keep the code set small: malformed JSON → `400 VALIDATION_ERROR`, body over 10 kb →
  `413 VALIDATION_ERROR`.
- **If `res.headersSent` is true (stream already open), the error handler must not write JSON.**
  Stream errors are handled inside `runTrip` (§7) — the handler only logs and ends the response.

### 5.4 Rate limiting — `middlewares/rateLimiter.ts`

| Limiter | Scope | Limit |
| --- | --- | --- |
| `generalLimiter` | `/api/*` | 100 requests / minute / IP |
| `runLimiter` (two limiters in a row) | `POST /api/trips`, `POST /api/trips/:id/resume` | `RATE_LIMIT_MAX_RUNS` / `RATE_LIMIT_WINDOW_MS` / IP, then `RATE_LIMIT_DAILY_MAX_RUNS` / 24 h / IP ("today's limit" message) |

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
- *Until the registry lands (B25) the streamer numbers packets itself (one streamer per run) and keeps `PROGRESS` monotonic; `send(event)` then takes no `id`.*
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
- Dependencies are injected (`buildGraph(deps)`).
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
- Missing `destination`, `origin`, `budget` or `durationDays` after merge → `{ status: 'failed', error: 'Please include …' }`
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
- Hotel cost = `hotels[0].pricePerNight × nights`, with `nights = max(1, durationDays − 1)` (`nightsFor()`); check-out and the flight's return date are `startDate + nights`.
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
- `computeTotalCost(state)` exported separately; round to 2 decimals. Formula: flight + hotel × nights + Σ transfers + daily × days.
- Every audit appends a `BudgetPass`: `{ pass: retryCount + 1, flight, hotel, transfers, daily, totalCost, flightLabel, hotelLabel }`
  (`flightLabel` "$500 direct" / "$420 via IST" from `outbound.stops`; `hotelLabel` "4 × $95").
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
  call them through `say(state, agent, text, { decision, callout })`. **Never ask the LLM to write chat text** — no extra tokens, deterministic output.
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
- `primary.withStructuredOutput(schema, { name, method: 'jsonSchema' }).withFallbacks([fallback.withStructuredOutput(schema, { name, method: 'jsonSchema' })])`.
  `method: 'jsonSchema'` is required: the default tool-call method forces `tool_choice` and returns HTTP 400 on Opus 5.5 (confirmed in a live run).
- Do not set `temperature` / `top_p` / `top_k`: Claude Opus 5.5 and Sonnet 5.5 reject non-default sampling values (HTTP 400).
  Thinking cannot be disabled on Opus 5.5 and its effort defaults to `medium`; forced `tool_choice` (`any` / `tool`) is also a 400,
  so structured output must use the API's JSON-schema output format, not a forced tool call (verify in the B2 spike).
- Structured outputs require every field to be present; model optional values as `nullable()`,
  not `optional()`.
- When the fallback model answers, add a `warn` log with `kind: 'llm-fallback'` (`Primary model unavailable, used claude-sonnet-5-5`);
  the web app turns it into the "Running on fallback model" banner.

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
- Deterministic: prices derived from a hash of `origin + destination + date`.
- Returns 3–5 flights and 3–5 hotels with `source: 'mock'`, fully populated (both legs with one stop, hotel area, check-in 15:00 / check-out 11:00,
  rating 6–9.5, `photoUrl: null`); `cheaper` mode returns options at least 15% below `maxPrice` when one is given.
- Small artificial delay (≈300 ms) so the UI stream looks realistic.

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
  (`TOOLS_MODE=mock`) returns fixed fixtures with `source: 'mock'` when running without live data (Paris: 12 °C, partly cloudy, 9–14 °C, "rain Saturday", EUR 0.92,
  `Europe/Paris`; `getForecast` returns five days with a rainy day 3).
- `createTravelTool` composes the search tool (SerpAPI / mock) with `getForecast`; the forecast is keyless, so it is live even when search falls back to mock, and only `TOOLS_MODE=mock` swaps it for the fixture.
- `GET /api/trip-context` lives in `routes/tripContext.ts`; a resume of a thread that is still running answers `409 CONFLICT`.
- Provider hosts are constants; `destination` and `origin` are always `encodeURIComponent`-ed. The final value is parsed with
  `TripContextSchema` before it is sent.

---

## 11. Persistence

- `config.DATABASE_URL` set → `PostgresSaver.fromConnString(url)`; call `await checkpointer.setup()` on boot
  (idempotent, creates tables).
- Not set → `new MemorySaver()` (dev only; log a warning at boot in `production`).
- Retention: not yet (see `PLAN.md`); checkpoints and `trips` rows are small.
- Resume uses `graph.getState({ configurable: { thread_id } })`; the trip lookups try the trip store first.

**Trip store** (`storage/tripStore.ts`, ARCHITECTURE.md §4.5): `createTripStore(config)` returns the Postgres store
when `DATABASE_URL` is set (a `pg` pool of 4, 5 s connection and statement timeouts; `CREATE TABLE IF NOT EXISTS trips`
on boot) and a memory store otherwise (newest 1,000 trips).

| Column | Type | Notes |
| --- | --- | --- |
| `thread_id` | `uuid` primary key | |
| `owner_id` | `uuid`, nullable | Index `(owner_id, created_at DESC)`; a later save never replaces a set owner |
| `result` | `jsonb` | `ResultPayload`; read back through `parseStoredResult` (the `schemaVersion` migration), unreadable rows are skipped |
| `messages` | `jsonb` | The chat (`MessagePayload[]`) |
| `created_at`, `updated_at` | `timestamptz` | `created_at` survives a resume; `updated_at` moves |

`runTrip` calls `onResult(result, state.messages)` once after the `RESULT` packet, on success and on failure; the
registry saves it under the run's owner. A save error is logged and never fails the run.

---

## 12. Logging

- Structured JSON to stdout: `{ level, msg, threadId, node, durationMs, fallback, outcome }`.
- One line per HTTP request and one summary line per run (`outcome: completed | failed | cancelled | timeout`,
  `retryCount`, `llmFallbackUsed`, `toolFallbackUsed`, `totalMs`).
- Never log API keys, full prompts in production (log the length), or raw third-party responses.

---

## 13. Rules for working in this package

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
- Every new external API gets a timeout, a fallback (mock data or a `null` field, never a failed run) and a `source`
  field on the data it produces (ARCHITECTURE.md §8).
- Run `pnpm --filter ai-travel-agent lint typecheck` before committing.

---

## 14. Decisions

Resolved questions from the build (2026-10-27), kept because the code relies on them.

1. **Model choice** — keep `claude-opus-5-5` (primary) and `claude-sonnet-5-5` (fallback); both worked in every live run. If cost matters, try Sonnet as the Planner's primary model.
2. **Zod 4 vs LangChain** — works against `@langchain/anthropic` with `method: 'jsonSchema'` (no forced `tool_choice`) in live runs; the fallback model is handled in `llm.ts`.
3. **Hotel nights** — `durationDays − 1` nights (at least 1): the last day is the departure day. Implemented as `nightsFor()` in the agent (cost, labels, hotel check-out, flight return date) and in the web cards, top bar and budget summary.
4. **SerpAPI plan** — mock-only for previews / staging, live search in production only; the per-IP run limit stays.
5. **Render tier** — paid instance (and paid Postgres) for production; free tier only for demos (it sleeps, and its database expires).
6. **Exchange-rate provider** — resolved: open.er-api.com (keyless, lists UZS, USD base).
7. **Weather scope** — resolved by the design: the destination bar shows current weather plus today's range and an outlook, and the Planner reads the per-day forecast (≤ 16 days ahead; later dates get no weather).
8. **Hotel photos and transit** — no transit lookup for now; `Hotel.transit` stays `null` for live data and the UI hides the row. Revisit if users ask.
9. **Planner cost** — one call per day, planned in parallel (`DAY_CONCURRENCY` 4) on the fast model since TP-31; the numbers below are from before that change. Measured live (Paris, 5 days, no re-plan): 43.6 s per run, of which the Planner is 40.7 s (6 calls, ≈ 6.8 s each); a re-plan re-runs only the transfers and the hotel-anchored days, so the worst case stays well under `RUN_TIMEOUT_MS` (120 s). Token cost is **not** measured; switch to a single call for all days if the timeout or the bill becomes a problem.
10. **Replay buffer scope** — in-process is fine for one Render instance: after a restart `resume` continues from the checkpoint, only the missed packets are not replayed. Add a shared store (Redis) before running more than one instance.
