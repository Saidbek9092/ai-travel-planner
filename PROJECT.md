# AI Travel Planner — Project Specification

> The complete description of the project as built: what it does, how the frontend, backend and agents are put
> together, how they talk to each other, how to run, configure and deploy them, the rules for changing them, and the
> open work. It replaces the former `apps/agent/SPEC.md`, `apps/agent/PLAN.md`, `apps/web/SPEC.md` and
> `apps/web/PLAN.md`.
>
> - Where this file and the code disagree, the code is right: fix this file in the same PR.
> - [`ARCHITECTURE.md`](./ARCHITECTURE.md) is the longer design narrative (why things are the way they are).
> - The visual design is the two PNGs at the repo root (`design-agents-planning.png`, `design-trip-overview.png`).
>   **The design wins over this document** for anything visual.
> - `docs/archive/` holds finished tickets (B1–B25, T1–T26). History only, not kept current.

---

## Contents

1. [Product](#1-product)
2. [System overview](#2-system-overview)
3. [Repository layout](#3-repository-layout)
4. [Tech stack](#4-tech-stack)
5. [How the pieces communicate](#5-how-the-pieces-communicate)
6. [Shared contracts — `packages/contracts`](#6-shared-contracts--packagescontracts)
7. [Backend — `apps/agent`](#7-backend--appsagent)
8. [The agents — LangGraph workflow](#8-the-agents--langgraph-workflow)
9. [Tools and external data](#9-tools-and-external-data)
10. [Frontend — `apps/web`](#10-frontend--appsweb)
11. [Resiliency and fallbacks](#11-resiliency-and-fallbacks)
12. [Security and identity](#12-security-and-identity)
13. [Configuration reference](#13-configuration-reference)
14. [Local development](#14-local-development)
15. [Deployment and operations](#15-deployment-and-operations)
16. [Engineering rules](#16-engineering-rules)
17. [Decisions](#17-decisions)
18. [Open work](#18-open-work)

---

## 1. Product

The traveller describes a trip in one sentence ("5 days in Paris from Tashkent in mid-November, $2,500 all-in.
Museums and good food.") and five AI agents plan it live in the browser:

- **Supervisor** reads the sentence and extracts origin, destination, days, budget, dates, pace and interests.
- **Flight Agent** searches round-trip flights, ranks them, and confirms the real return leg.
- **Hotel Agent** searches hotels and ranks them on price, rating, location and transit.
- **Itinerary Planner** chooses airport transfers, reads the per-day forecast and plans every day, with each stop
  checked on Google Maps for existence and opening hours.
- **Budget Auditor** adds everything up. Over budget, it sends the trip back for a cheaper search, at most twice,
  then returns the best result with a warning and two ready-made fixes (raise the budget, try one day less).

Everything streams live: a plain-language agent chat with "Confirmed" decisions, a progress bar with six phases,
and a Trip Overview that fills in as the agents decide (budget, flight with transfers, hotel, map, day by day). A
destination bar shows the place, live weather, the currency rate and local time.

Runs survive dropped connections (reconnect and replay) and server restarts (resume from the last checkpoint).
Optional Google sign-in keeps "My trips" per account. Each account gets `USER_MAX_RUNS` (default 3) plans; resuming
a stopped trip is free.

Single traveller, USD only, English only.

---

## 2. System overview

```mermaid
flowchart LR
  subgraph Browser["Browser — ai-travel-web (Next.js on Vercel)"]
    UI[TripDashboard<br/>Form · Chat · Progress · Trip Overview · Map · TopBar]
    Hook[useAgentStream<br/>fetch + SSE parser + Zod]
    Ctx[useTripContext / usePlaceSearch / useUsage]
    UI <--> Hook
    UI <--> Ctx
  end

  subgraph Agent["ai-travel-agent (Express on Render)"]
    MW[Middlewares<br/>helmet · CORS · rate limit · identify]
    Routes[Routes<br/>trips · auth · trip-context · places]
    Reg[RunRegistry<br/>replay buffer · fan-out]
    Graph[LangGraph StateGraph<br/>5 agent nodes]
    Tools[Tool layer<br/>SerpAPI → mock fallback]
    LLM[LLM factory<br/>Opus 5.5 ⇄ Sonnet 5.5]
    Store[(Trip store)]
    CP[(Checkpointer)]
    MW --> Routes --> Reg --> Graph
    Graph --> Tools
    Graph --> LLM
    Graph <--> CP
    Reg --> Store
  end

  subgraph External["External services"]
    Anthropic[(Anthropic)]
    Serp[(SerpAPI: Google Flights / Hotels / Maps / autocomplete)]
    Meteo[(Open-Meteo, open.er-api.com, Wikipedia, Tavily)]
    PG[(PostgreSQL)]
    Google[(Google Identity)]
    Mapbox[(Mapbox tiles)]
  end

  Hook -- "POST /api/trips (JSON) → SSE" --> MW
  Ctx -- "GET JSON" --> MW
  LLM --> Anthropic
  Tools --> Serp
  Tools --> Meteo
  CP --> PG
  Store --> PG
  UI --> Mapbox
  UI --> Google
```

**The browser talks to the agent directly**, never through a Next.js route handler or server action: a trip run is a
long-lived stream and a Vercel function would cut it off. The agent is a public, CORS-restricted, rate-limited API.
The one server-side call from Next.js is the short `GET /api/trips/:id/record` for a deep link.

### Request lifecycle

1. The traveller submits the form. `useAgentStream` sends `POST /api/trips` with a `TripRequest` (validated in the
   browser with the shared Zod schema).
2. The agent validates it again, checks sign-in and the plan allowance, creates a `threadId` (UUID), opens an SSE
   response with an `X-Thread-Id` header, and starts the run in the `RunRegistry`. **The run belongs to the
   registry, not to the HTTP request.**
3. Each finished graph node produces a state update. `runTrip` turns it into `LOG` packets (technical),
   `MESSAGE` packets (chat), a `DRAFT` packet (the trip so far), a checkpoint `LOG` and a `PROGRESS` packet. The
   Planner also emits a `PROGRESS` + `DRAFT` per finished day. Every packet is validated, numbered, stored in the
   run's replay buffer and sent to every subscriber.
4. At `END` the agent reads the final state from the checkpointer, sends one `RESULT` packet, saves the trip
   (result + chat) to the trip store and closes the stream.
5. A failure after the stream opened ends with `RESULT { status: "failed" }`. The checkpoint holds the last good
   node, so `POST /api/trips/:id/resume` continues from there.
6. If the connection drops the run keeps going. The browser reconnects with `GET /api/trips/:id/stream` and
   `Last-Event-ID`; the agent replays what was missed, then follows the live run.
7. Separately, once the first `DRAFT` names the destination, the browser calls `GET /api/trip-context` for the
   destination bar. That call never affects the run.

---

## 3. Repository layout

```text
ai-travel-planner/
├── apps/
│   ├── agent/                      # ai-travel-agent: Express 5 + LangGraph service → Render
│   │   ├── src/
│   │   │   ├── server.ts           # boot: config → tools → checkpointer → graph → trip store → registry → listen; shutdown
│   │   │   ├── app.ts              # createApp(deps): middlewares + routes, no listen
│   │   │   ├── config.ts           # Zod-validated env; the only reader of process.env
│   │   │   ├── agent/
│   │   │   │   ├── graph.ts        # StateGraph wiring, pure routers, createCheckpointer()
│   │   │   │   ├── state.ts        # Annotation.Root state, reducers, initialState, log()/say(), toDraft()
│   │   │   │   ├── llm.ts          # ChatAnthropic factory: structured output, primary/fast tiers, fallback, token metrics
│   │   │   │   ├── runTrip.ts      # graph stream → SSE packets; buildResultPayload(); run summary log
│   │   │   │   ├── runRegistry.ts  # live runs, replay ring buffer, subscribe/cancel/abortAll, saves finished trips
│   │   │   │   ├── runAbort.ts     # abort reasons → user-facing messages (timeout, shutdown, cancel)
│   │   │   │   ├── messages.ts     # pure builders for the friendly chat text
│   │   │   │   ├── ranking.ts      # deterministic flight/hotel filters and scores
│   │   │   │   ├── pick.ts         # preferences; LLM pick among the top 5 when the traveller gave soft notes
│   │   │   │   └── nodes/          # supervisor · flight · hotel · planner · budget (*.node.ts)
│   │   │   ├── tools/
│   │   │   │   ├── types.ts        # SearchTool ⊂ TravelSearchTool, query types, ToolUnavailableError, UnknownAirportError
│   │   │   │   ├── index.ts        # createTravelTool(): mode selection, mock fallback, place check, forecast, photos, centre
│   │   │   │   ├── serpApi.tool.ts # Google Flights / Hotels / Maps via SerpAPI
│   │   │   │   ├── mockTravel.tool.ts # deterministic offline engine
│   │   │   │   ├── searchCache.ts  # reuses flight/hotel searches for SEARCH_CACHE_TTL_MS
│   │   │   │   ├── airports.ts     # city → IATA table
│   │   │   │   ├── priceBaseline.ts # per-city price tier → daily spend and transfer prices
│   │   │   │   ├── weather.ts      # Open-Meteo geocoding, current weather, daily forecast
│   │   │   │   ├── exchangeRate.ts # USD → destination currency (open.er-api.com)
│   │   │   │   ├── currencies.ts   # country code → ISO 4217 + symbol
│   │   │   │   ├── tripContext.ts  # lookupTripContext(): geocode → weather ∥ rate, cached
│   │   │   │   ├── places.ts       # city/country suggestions (Open-Meteo geocoder) for the web dropdowns
│   │   │   │   ├── placeAliases.ts # names the geocoder does not know as places ("England")
│   │   │   │   ├── placePhotos.ts  # Wikipedia photos for itinerary stops
│   │   │   │   └── tavily.ts       # optional top-attractions context for the Planner
│   │   │   ├── routes/             # trips.ts · auth.ts · tripContext.ts · places.ts
│   │   │   ├── middlewares/        # auth.ts (identify, requireSignIn) · rateLimiter.ts · errorHandler.ts
│   │   │   ├── auth/               # google.ts (verify ID token) · session.ts (HS256 session tokens)
│   │   │   ├── storage/tripStore.ts # finished trips + chat + plan usage (Postgres or memory)
│   │   │   └── utils/              # sseStreamer · errors · logger · fetchJson · ttlCache · circuitBreaker · runMetrics · dates · geo · hours
│   │   ├── .env.example            # every variable from §13.1
│   │   ├── docker-compose.yml      # local Postgres 17
│   │   ├── eslint.config.js
│   │   ├── tsconfig.json           # typecheck (NodeNext)
│   │   └── tsconfig.build.json     # src → dist/
│   └── web/                        # ai-travel-web: Next.js 16 app → Vercel
│       ├── src/
│       │   ├── app/                # layout.tsx · page.tsx · trips/page.tsx · auth/google/route.ts · error.tsx · not-found.tsx · globals.css
│       │   ├── components/         # dashboard, form, chat, overview, maps, banners, account (§10.6)
│       │   │   └── ui/             # shadcn/ui generated primitives (do not hand-edit)
│       │   ├── hooks/              # useAgentStream · useTripContext · usePlaceSearch · useUsage · useSession · useTripHistory · …
│       │   └── lib/                # api · auth · env · owner · sse · trip · labels · links · map · time · parseTrip · pendingTrip · dom · utils
│       ├── public/examples/        # example-prompt photos
│       ├── components.json         # shadcn config (style base-nova)
│       ├── next.config.ts          # dev agent-URL default, Cache Components, Tailwind loader
│       ├── vercel.json             # install/build/ignore commands
│       └── DEPLOY.md               # one-time Vercel setup
├── packages/
│   └── contracts/                  # @ai-travel/contracts: Zod schemas + types shared by both apps
│       └── src/                    # index · trip · sse-events · trip-context · stored-trips · auth · errors
├── scripts/check-no-hardcoded-trip-data.sh  # CI guard: no city names/prices hard-coded in web components
├── docs/archive/                   # finished tickets (history)
├── .github/workflows/ci.yml        # lint · typecheck · build on every PR and on main
├── .conductor/settings.toml        # Conductor setup/run scripts
├── .claude/                        # Claude Code settings and skills (design-check, implement-ticket)
├── design-agents-planning.png      # design: live run
├── design-trip-overview.png        # design: finished trip
├── ARCHITECTURE.md · README.md · PROJECT.md
├── package.json                    # root scripts → turbo; packageManager pnpm@10.34.9; Node ≥ 24
├── pnpm-workspace.yaml             # apps/*, packages/* + version catalog
├── turbo.json                      # task graph
└── tsconfig.base.json              # shared strict compiler options
```

---

## 4. Tech stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript 5.9 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Zod 4 at every boundary |
| Monorepo | pnpm 10 workspaces + version catalog, Turborepo 2 |
| Runtime | Node.js 24 (`.nvmrc`, `engines >= 24`) |
| Backend | Express 5, helmet, cors, express-rate-limit, dotenv, pg |
| Orchestration | `@langchain/langgraph` (`StateGraph`, conditional edges, `MemorySaver` / `PostgresSaver`) |
| LLM | `@langchain/anthropic`: Claude Opus 5.5 (`claude-opus-5-5`) and Claude Sonnet 5.5 (`claude-sonnet-5-5`) |
| Travel data | SerpAPI (Google Flights, Google Hotels, Google Maps, flights autocomplete), deterministic mock engine |
| Other data | Open-Meteo (geocoding, place suggestions, weather, forecast; keyless), open.er-api.com (FX; keyless), Wikipedia (photos), Tavily (optional) |
| Frontend | Next.js 16 (App Router, Turbopack, Cache Components), React 19 |
| UI | Tailwind CSS v4, shadcn/ui (`base-nova`, Base UI primitives), `lucide-react`, `motion`, `sonner` |
| Maps | Mapbox GL via `react-map-gl/mapbox`; a schematic SVG map without a token |
| Persistence | PostgreSQL: LangGraph checkpoints, `trips`, `user_runs` |
| Auth | Google Identity Services ID token → agent-issued HS256 session token |
| Deploy | Vercel (web), Render (agent + Postgres), GitHub Actions CI |

---

## 5. How the pieces communicate

### 5.1 Channels

| From → to | Transport | What |
| --- | --- | --- |
| Browser → agent | `fetch` POST, response read as SSE | Start a run (`POST /api/trips`), resume (`POST …/resume`) |
| Browser → agent | `fetch` GET, SSE | Reconnect / follow a run (`GET …/stream` + `Last-Event-ID`) |
| Browser → agent | `fetch` JSON | Trip context, place suggestions, usage, My trips, claim, delete, cancel, Google sign-in |
| Next.js server → agent | `fetch` JSON (`cache: 'no-store'`) | `GET /api/trips/:id/record` for a `/?trip=<id>` deep link |
| Agent → Anthropic / SerpAPI / Open-Meteo / … | HTTPS | All vendor calls; all secrets live on the agent |
| Agent ↔ Postgres | `pg` pool | Checkpoints, finished trips, plan usage |
| Browser → Google | Google Identity Services | ID token for sign-in (popup on desktop, redirect on phones via `/auth/google`) |
| Browser → Mapbox | Mapbox GL | Map tiles (public, URL-restricted token) |

**Why POST + streamed body instead of `EventSource`:** `EventSource` cannot send a JSON body (or an
`Authorization` header). The web app reads the `fetch` body with its own parser (`lib/sse.ts`); the wire format is
standard SSE.

**Headers in play.** Request: `Content-Type`, `Accept: text/event-stream`, `Last-Event-ID`,
`Authorization: Bearer <session>`, `X-Owner-Id: <uuid>`. Response (exposed through CORS): `X-Thread-Id`,
`Retry-After`.

### 5.2 HTTP API (agent)

All `/api` routes are behind `generalLimiter` (100 req/min/IP) and `identify`. Errors before a stream opens are
JSON `ErrorBody` (§5.5).

| Method & path | Auth / headers | Behaviour |
| --- | --- | --- |
| `GET /health` | — | `200 {"status":"ok"}`. Liveness, no rate limit. Render's health check |
| `GET /readyz` | — | `200 {"status":"ready"}` or `503 {"status":"unavailable","problems":[…]}` (DB not answering within 2 s, `SERPAPI_API_KEY` missing in `live` mode). For an external monitor only |
| `POST /api/auth/google` | body `GoogleLoginRequest` | `200 GoogleLoginResponse` (`token`, `expiresAt`, `user`). `401` Google refused it, `502` Google unreachable, `404` sign-in not configured |
| `GET /api/usage` | `Authorization` or `X-Owner-Id` | `200 UsageResponse { used, max, remaining }`. Read-only |
| `POST /api/trips` | sign-in required when configured; `runLimiter`; optional `X-Owner-Id` | Body `TripRequest` (`400` if invalid). Consumes one plan (`429 RATE_LIMITED` without `retryAfterSeconds` when used up). `200 text/event-stream` + `X-Thread-Id` |
| `GET /api/trips` | `Authorization`, else `X-Owner-Id` (UUID, else `400`) | `200 TripListResponse`: the account's trips, or the guest owner's unclaimed trips. Newest first, max 50 |
| `POST /api/trips/claim` | `Authorization` (`401` otherwise) + `X-Owner-Id` | `200 { claimed }`: this browser's guest trips now belong to the account |
| `GET /api/trips/:id` | access check | `200 ResultPayload` from the trip store, else rebuilt from the checkpoint; `404` |
| `GET /api/trips/:id/record` | access check | `200 TripRecord` (result + chat + timestamps), same sources; `404` |
| `POST /api/trips/:id/resume` | sign-in when configured; `runLimiter`; access check | `404` without a checkpoint; `409` if still running; finished → one `RESULT` and close; else continue from the checkpoint as SSE. Free (no plan consumed) |
| `GET /api/trips/:id/stream` | access check; `Last-Event-ID` | Replay packets with a higher id, then follow live until `RESULT`. `404` if the run is not (or no longer) in the registry |
| `POST /api/trips/:id/cancel` | access check | `204`, aborts the run (ends with `RESULT failed "Run stopped"`, checkpoint kept). Idempotent; `404` if unknown |
| `DELETE /api/trips/:id` | account trip: that account; guest trip: the browser that planned it | `204`; `404` if not allowed or unknown; `409` while running |
| `GET /api/trip-context?destination=&origin=` | — | `200 TripContext`, `400` bad query, `404` destination not found. 15 s budget |
| `GET /api/places?q=` | — | `200 PlacesResponse`: city/country suggestions (fixtures in `mock` mode) |

**Access check:** a stored trip with a `user_id` answers `404` to anyone else. Guest trips are capabilities: anyone
with the link can open them.

### 5.3 SSE wire format

```
id: 7
data: {"type":"LOG","payload":{"step":2,"agent":"FlightAgent","message":"Found a $500 flight on the Tashkent -> Paris route.","timestamp":"2026-10-25T10:25:00Z","level":"info","kind":"log"}}

id: 8
data: {"type":"MESSAGE","payload":{"step":2,"agent":"FlightAgent","text":"I found 4 flights — the best option is Uzbekistan Airways at $500.","timestamp":"2026-10-25T10:25:00Z","decision":null,"callout":null}}

id: 9
data: {"type":"DRAFT","payload":{"flights":[{"airline":"Uzbekistan Airways","price":500,"…":"…"}]}}

id: 10
data: {"type":"PROGRESS","payload":{"progressPercent":35,"currentStatus":"searching","detail":null,"pass":1,"run":{"model":"claude-opus-5-5","checkpointer":"postgres","lastCheckpointStep":2}}}

: ping

```

- One JSON object per `data:` line, one event per blank-line-terminated block.
- `id` is the run's packet sequence number, assigned by the registry, so `Last-Event-ID` means the same thing on
  every connection to that run.
- `: ping` every 15 s keeps proxies from closing idle streams; clients ignore comments.
- Response headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`, `X-Thread-Id`.
- **Exactly one `RESULT` is the last packet of every stream**, success or failure.
- Every packet is validated with `SseEventSchema` before it is sent (a failure is a server bug and fails the run) and
  again in the browser (an invalid packet is dropped, never crashes the UI).

### 5.4 Packet types

| Type | When | Payload (see `sse-events.ts`) | Consumer |
| --- | --- | --- | --- |
| `LOG` | For each log entry a node adds; checkpoint rows after each node | `step`, `agent`, `message`, `timestamp`, `level` (`info`/`warn`/`error`), `kind` (`log`/`checkpoint`/`llm-fallback`/`search-fallback`) | Technical log, agent board, banners |
| `MESSAGE` | For each chat message a node adds, right after that node's `LOG`s | `step`, `agent`, `text`, `timestamp`, `decision` (`DecisionTopic` or `null`), `callout` (`{tone, label}` or `null`) | Agent chat; a `decision` renders "Confirmed" |
| `DRAFT` | After every node and after each Planner day | The trip fields that exist so far (shallow-merged by the client) | Live Trip Overview, destination bar |
| `PROGRESS` | On open, after every node, per Planner day | `progressPercent`, `currentStatus`, `detail` ("Day 4 of 5"), `pass` (1–3), `run` (`model`, `checkpointer`, `lastCheckpointStep`) | Progress card, phase steps, run details |
| `RESULT` | Once, last | `ResultPayload` (§6) | Final Trip Overview |

**Progress mapping** (monotonic: the registry raises any lower value to the last one, replays included):

| Moment | `currentStatus` | `progressPercent` |
| --- | --- | --- |
| Stream opened | `parsing` | 5 |
| `supervisorAgent` done | `searching` | 15 |
| `flightAgent` done | `searching` | 35 |
| `hotelAgent` done | `planning` | 55 |
| Planner working | `planning` | 55 → 75 in equal steps per finished day |
| `itineraryPlanner` done | `auditing` | 75 |
| `budgetAuditor` re-plan | `searching`, `pass + 1` | unchanged |
| `budgetAuditor` final | `completed` | 95 |
| `RESULT` | `completed` / `failed` | 100 |

**`step`** is the 1-based index of the node execution in the run (`last log's step + 1`), so it keeps counting
through re-plans and survives a resume. A node's `MESSAGE`s share its `LOG`s' `step`.

### 5.5 Errors

`ErrorBody`: `{ "error": { "code": ErrorCode, "message": string, "retryAfterSeconds"?: number } }`.
`ErrorCode` = `VALIDATION_ERROR | UNAUTHORIZED | NOT_FOUND | CONFLICT | RATE_LIMITED | INTERNAL`.

- `ZodError` → `400` with flattened issues; malformed JSON → `400`; body over 10 kb → `413 VALIDATION_ERROR`; unknown
  → `500 INTERNAL` with a generic message (stack only in logs).
- `retryAfterSeconds` (and `Retry-After`) only on per-IP `429`s; the form turns it into "Plan trip in 0:42". The
  per-account plan cap is a `429` without it.
- **After the stream opens, errors are a `RESULT { status: "failed", error }`.** The error handler never writes
  JSON once `res.headersSent`; it only logs and ends the response. Errors never leak stacks or keys.
- The web app maps every code in `ERROR_MESSAGES` (`useAgentStream.ts`), typed `Record<ErrorCode | 'NETWORK' | 'CONNECTION_LOST', string>`,
  so a new code fails the type check until it has a message.

### 5.6 Reconnect, replay and following a run

- The `RunRegistry` keeps each run's packets in a ring buffer (`RUN_REPLAY_MAX_EVENTS`, default 500) while it runs
  and for `RUN_REPLAY_TTL_MS` (default 10 min) after it ends. Subscribers that disconnect are dropped; **the run
  keeps going**. Only cancel, the run timeout (`RUN_TIMEOUT_MS`, 120 s) or shutdown abort it.
- The browser reconnects up to 5 times (1 s, 2 s, 4 s, 8 s, 15 s, or at once with "Reconnect now") with
  `Last-Event-ID`. Packets with an id ≤ the last one seen are ignored, so nothing is duplicated. `404` or five
  failures → `failed`, "Connection lost", Resume available.
- The same stream lets the browser **follow a run it did not start**: a trip opened from a link or "My trips" before it
  finished, a "Resume" answered with `409` (still running), or a page left mid-run and shown again (Next.js keeps
  hidden pages in `<Activity>`; hiding aborts the stream, showing re-attaches with `Last-Event-ID`).
- After a process restart the buffer is gone; the run is recovered with `resume` from its checkpoint.
- `LOG` and `DRAFT` are live-only. The chat (`MESSAGE`s) is stored with the finished trip, so `…/record` returns it.

---

## 6. Shared contracts — `packages/contracts`

`@ai-travel/contracts`, consumed by both apps as `workspace:*`, built with `tsc` to `dist/` (ESM + `.d.ts`; `dev` is
`tsc --watch`). **The only place cross-service types are defined; never redeclare them in an app.** Each field
carries a doc comment in the source.

| File | Holds |
| --- | --- |
| `trip.ts` | `TripRequest` (prompt 3–1000 chars; optional `origin`, `budget`, `durationDays` 1–30, `startDate`, `when`, `interests` ≤ 6), `Flight` / `FlightLeg` / `FlightStop` / `Airport`, `Hotel`, `Transfer` / `TransferMode`, `Place`, `ItineraryDay` / `DayWeather` / `WeatherIcon`, `DataSource` (`serpapi`/`mock`), `AgentName`, `DecisionTopic`, `PickReason`, `Interest`, `TripStatus` |
| `sse-events.ts` | `LOG` / `MESSAGE` / `PROGRESS` / `DRAFT` / `RESULT` payloads, `SseEventSchema`, `BudgetPass`, `Suggestions`, `RESULT_SCHEMA_VERSION`, `upgradeResultPayload`, `StoredResultSchema`, `parseStoredResult` |
| `trip-context.ts` | `TripContextQuery`, `TripContext` (location, weather, currency, exchange rate, time zones, `source`), `PlacesQuery`, `PlacesResponse` |
| `stored-trips.ts` | `OWNER_ID_HEADER` (`X-Owner-Id`), `OwnerIdSchema`, `TripSummary`, `TripListResponse`, `TripRecord` |
| `auth.ts` | `AuthUser`, `GoogleLoginRequest` / `GoogleLoginResponse`, `UsageResponse`, `ClaimTripsResponse` |
| `errors.ts` | `ErrorCode`, `ErrorBody` |
| `index.ts` | Re-exports everything |

Rules:

- **Zod 4 API** (`z.iso.datetime()`, `z.iso.date()`, `z.uuid()`, `z.url()`). New optional fields use `.nullish()` so
  older payloads still parse.
- **Result versioning.** `ResultPayload.schemaVersion` is `1`. Results outlive the code (the `trips` table, shared
  links), so a change that would break an old result bumps `RESULT_SCHEMA_VERSION` and adds a step to
  `upgradeResultPayload`, the single migration point (the agent reads `trips` rows and the web app loads trips by id
  through `StoredResultSchema` / `parseStoredResult`). Live `RESULT`s always carry the current version.
- Hotel rating is on a **0–10** scale (the agent doubles Google Hotels' 0–5).
- `AgentName` values: `Supervisor`, `FlightAgent`, `HotelAgent`, `Planner`, `BudgetAuditor`, `System`. Display names:
  "Supervisor", "Flight Agent", "Hotel Agent", "Itinerary Planner", "Budget Auditor".
- A contracts change is a cross-app change: contracts first, then both apps in the same PR.

---

## 7. Backend — `apps/agent`

Package `ai-travel-agent`. ESM (`"type": "module"`, `NodeNext`, relative imports end in `.js`), Express 5 (rejected
async handlers reach the error handler).

Responsibilities: expose the trip API and stream typed packets; keep each run independent of its HTTP connection;
run the 5-node graph with checkpoints, bounded re-planning and fallbacks; serve the destination bar and place
suggestions; own every secret and every external call; validate everything that crosses a boundary (env, request
bodies, LLM output, outgoing packets).

### 7.1 Boot and shutdown — `server.ts`

1. `loadConfig()` (exits with the issues on invalid env) → `createLogger()`.
2. `createTravelTool(config, onFallback)`.
3. `createCheckpointer()`: `PostgresSaver.fromConnString(url)` + `setup()` (idempotent) when `DATABASE_URL` is set,
   else `MemorySaver` (refused in production).
4. `buildGraph({ checkpointer, tools, llm: createLlmFactory(config), tavilyApiKey? })`.
5. `createTripStore()` (creates its tables on boot), `new RunRegistry(...)`, `createApp(...)`, `listen(PORT)`.
   A single-instance warning is logged at startup.
6. `SIGTERM` / `SIGINT`: stop accepting connections, abort every run (each ends with `RESULT failed` "Server
   restarting, resume to continue"; the checkpoint makes it resumable), close the Postgres pools, exit within 10 s.

Dependencies are injected (`createApp(deps)`, `buildGraph(deps)`); importing a module never parses env.

### 7.2 Middleware order — `app.ts`

1. `trust proxy = 1` (Render's proxy; rate limiting needs the client IP); `x-powered-by` off.
2. `helmet()` (`crossOriginResourcePolicy: cross-origin`).
3. `cors({ origin: WEB_ORIGIN, methods: GET/POST/DELETE, allowedHeaders: Content-Type, Accept, Last-Event-ID, Authorization, X-Owner-Id, exposedHeaders: X-Thread-Id, Retry-After })`.
4. `express.json({ limit: '10kb' })`.
5. One structured log line per request (not for `/health`, `/readyz`).
6. `/health`, `/readyz`.
7. `/api`: `generalLimiter` → `identify` → routers (auth, trips, trip-context, places).
8. 404 → `AppError('NOT_FOUND')`; `errorHandler` last.

**Never add `compression()`**: it buffers responses and breaks SSE.

### 7.3 Limits — `middlewares/rateLimiter.ts`, `storage/tripStore.ts`

| Limit | Scope | Default |
| --- | --- | --- |
| `generalLimiter` | every `/api` request, per IP | 100 / minute |
| `runLimiter` (two in a row) | `POST /api/trips`, `POST …/resume`, per IP | `RATE_LIMIT_MAX_RUNS` (10) per `RATE_LIMIT_WINDOW_MS` (15 min), then `RATE_LIMIT_DAILY_MAX_RUNS` (30) per 24 h |
| Plan allowance | per account (else per `X-Owner-Id`), `user_runs` table, `POST /api/trips` only | `USER_MAX_RUNS` (3) ever; a re-plan is a new plan; resume is free |
| Body size / prompt | every request | 10 kb / 1,000 chars |

Limiters use `standardHeaders: 'draft-7'`, `legacyHeaders: false` and answer with `RATE_LIMITED` plus
`retryAfterSeconds` from the reset time. Their store is in memory (one instance only, §15.4). On boot, trips stored
before the plan allowance existed are counted as plans already used.

### 7.4 SSE writer — `utils/sseStreamer.ts`

`open(threadId)` writes the headers, `flushHeaders()` and starts the 15 s heartbeat; `send(event, id)` validates
with `SseEventSchema.parse` and writes `id: n\ndata: <json>\n\n`; `close()` stops the heartbeat and ends the
response; `send` after close is a no-op. **Never `res.write` packets by hand.**

### 7.5 Run registry and stream controller — `agent/runRegistry.ts`, `agent/runTrip.ts`

```typescript
class RunRegistry {
  start(args: { threadId; request?: TripRequest; resume?: boolean; ownerId: string | null; userId: string | null }): Run;
  get(threadId): Run | undefined;   // active, or finished within RUN_REPLAY_TTL_MS
  abortAll(): void;                 // shutdown
  readonly size: number;
}
// Run: done, subscribe(streamer, lastEventId?), cancel()
```

- Every emitted packet is validated, numbered, made monotonic (`PROGRESS`), stored in the ring buffer and fanned out.
- At most one live run per `threadId`.
- When a run ends, completed or failed, the registry saves `onResult(result, messages)` to the trip store under the
  run's owner and account. A save error is logged and never fails the run.

`runTrip` steps:

1. Emit `PROGRESS 5 parsing`; `signal = AbortSignal.any([cancel/shutdown, AbortSignal.timeout(RUN_TIMEOUT_MS)])`.
2. Input: `initialState(request)` for a new run, `null` to resume.
3. `graph.stream(input, { configurable: { thread_id }, streamMode: ['updates', 'custom'], recursionLimit: 20, signal })`:
   - `updates`: per node, its new `logs` → `LOG`s, its new `messages` → `MESSAGE`s, `toDraft(values)` → `DRAFT`, a
     checkpoint `LOG` ("State saved after step N · PostgresSaver") and `PROGRESS` (§5.4).
   - `custom`: the Planner's `{ kind: 'day', day, of, itinerary }` → `PROGRESS { detail: "Day 4 of 5" }` + `DRAFT`.
4. After the loop, `graph.getState()` → `RESULT` from `buildResultPayload(threadId, values)` (fills `transfers`,
   `replans = retryCount`, `passes`, `suggestions`).
5. On abort or error: a `System` error `LOG` and `RESULT failed` built from the latest checkpoint (partial data is
   fine), with a safe message: "Run stopped" (cancel), "Server restarting, resume to continue" (shutdown), "Trip
   planning took too long, resume to continue" (timeout). In `TOOLS_MODE=live` missing data says what failed
   ("No airport could be found for "X"…", "Live travel data was not available (…), so nothing was estimated…").
6. One `run summary` log line: outcome (`completed | failed | cancelled | timeout`), resumed, retry count, LLM calls,
   input/output tokens, models used, LLM fallbacks, SerpAPI calls, durations.

### 7.6 LLM layer — `agent/llm.ts`

- The only place that builds `ChatAnthropic` (`maxRetries: 2`, 30 s request timeout).
- `structured(schema, name, tier)` returns a model that answers with `withStructuredOutput(schema, { name, method: 'jsonSchema' })`
  and is re-parsed with Zod. `method: 'jsonSchema'` is required: forced `tool_choice` is an HTTP 400 on Opus 5.5.
- **Tiers.** `primary` tries `ANTHROPIC_MODEL` (Opus 5.5) then `ANTHROPIC_FALLBACK_MODEL` (Sonnet 5.5). `fast` tries
  Sonnet first, then Opus; the Planner's transfer and per-day calls use it.
- **No `temperature` / `top_p` / `top_k`**: both models reject non-default sampling values.
- Structured outputs need every field present: model optional values with `.nullable()`, never `.optional()`.
- When the second model answered, nodes add a `warn` log with `kind: 'llm-fallback'`.
- Token usage is recorded per run (`utils/runMetrics.ts`, async context) for the run summary.

### 7.7 Persistence — `agent/graph.ts`, `storage/tripStore.ts`

| Store | With `DATABASE_URL` | Without (development only) |
| --- | --- | --- |
| Checkpoints | `PostgresSaver` (tables via `setup()` on boot) | `MemorySaver`, lost on restart |
| Trips + usage | Postgres pool of 4, 5 s connection and statement timeouts | In memory, newest 1,000 trips |

Tables created on boot (`CREATE … IF NOT EXISTS`):

| Table | Columns |
| --- | --- |
| `trips` | `thread_id uuid` PK · `owner_id uuid` nullable (index `(owner_id, created_at DESC)`; a later save never replaces a set owner) · `user_id text` (index `(user_id, created_at DESC)`) · `result jsonb` (`ResultPayload`, read through `parseStoredResult`; unreadable rows skipped) · `messages jsonb` (the chat) · `created_at` (survives a resume) / `updated_at timestamptz` |
| `user_runs` | `user_id` PK (an account id, or `owner:<uuid>` for a browser) · `runs` |

One run = one `thread_id`; a checkpoint is written after every node. `recursionLimit: 20` is a safety net (the longest
valid path is 14 node executions). The trip lookups try the trip store first, then the checkpoint. No retention yet
(§18).

### 7.8 Logging

Structured JSON lines (`utils/logger.ts`): one per HTTP request and one summary per run, carrying `threadId`,
durations, outcome and fallbacks. Never log API keys, full prompts or raw third-party responses. Optional LangSmith
tracing with `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY`.

---

## 8. The agents — LangGraph workflow

### 8.1 Graph — `agent/graph.ts`

```mermaid
flowchart TD
  S((START)) --> SUP[supervisorAgent<br/>parse prompt → structured trip]
  SUP -- "status = failed" --> E((END))
  SUP -- "ok" --> FL[flightAgent<br/>search, rank, complete return]
  FL --> HO[hotelAgent<br/>search, rank]
  HO --> PL[itineraryPlanner<br/>transfers + forecast + days + place check]
  PL --> BA[budgetAuditor<br/>totalCost vs budget]
  BA -- "1 · total ≤ budget → completed" --> E
  BA -- "2 · over & retryCount < 2 → cheaper search" --> FL
  BA -- "3 · over & retryCount = 2 → completed + warning + suggestions" --> E
```

- Retry policy `maxAttempts: 2` on `supervisorAgent` and `itineraryPlanner`.
- Routers are **pure** (`routeAfterSupervisor`, `routeAfterAudit`); all decisions and counters are written by nodes.
- Node names carry a suffix because LangGraph rejects node names equal to state keys (`budget`, `flights`, …).
- **The LLM is used only where language is needed** (parsing, planning days, choosing transfer modes, a preference
  pick). Searching, ranking and the audit are deterministic code: cheaper, faster, testable.
- Tools are called by code, never exposed to the model for tool-calling.

### 8.2 State — `agent/state.ts`

```typescript
// Annotation.Root; `append` keys concat, everything else is last-write-wins.
prompt, overrides (request fields), origin, destination, budget, durationDays, startDate, preferences
flights[], hotels[]            // sorted, [0] = selected
transfers[], itinerary[], dailyExpensesEstimate
totalCost, retryCount, searchMode ('standard' | 'cheaper'), overBudgetBy
passes[]      (append)  // one BudgetPass per audit
suggestions | null
confirmed[]   (append)  // DecisionTopics already confirmed in chat
status: 'parsing' | 'searching' | 'planning' | 'auditing' | 'completed' | 'failed'
error | null, warnings[] (append), logs[] (append), messages[] (append)
MAX_BUDGET_RETRIES = 2
```

Helpers: `initialState(request)`, `log(state, agent, message, level?, kind?)`, `say(state, agent, text, { decision?, callout? })`,
`toDraft(values)` (the `DraftPayload` fields that are not empty).

### 8.3 Node contract

Every node is `(state) => Promise<update>` and returns **only** the keys it changes, including 1–3 `logs` and 0–4
`messages` with the same `step`; never mutates state; throws only for unrecoverable errors (after its own fallbacks),
which fails the run and keeps the previous checkpoint for resume; appends to `confirmed` whenever it emits a
`decision` message.

### 8.4 Nodes

**Supervisor** (`supervisor.node.ts`, LLM)
- Structured output: `origin, destination, budget, durationDays, startDate, directOnly, maxStops, pace, interests, notes`.
  Prompt: extract only, never invent a budget or duration, `null` when absent.
- Request fields override the parse; interests from the form and the prompt are merged; default `startDate` = today + 30.
- Missing destination, origin, budget or days → `status: 'failed'`, `error: 'Please include …'`, a `warn` log and an
  ordinary message asking for them (a user-input failure; the graph ends normally).
- Success → `status: 'searching'` and decision `trip` ("Got it — 5 days in Paris from Tashkent, 12–17 November,
  $1,000 all-in. @Flight Agent and @Hotel Agent, you're up."). The first `DRAFT` follows, which loads the
  destination bar.

**Flight Agent** (`flight.node.ts`; LLM only for a preference pick)
- `searchFlights({ origin, destination, departDate, returnDate, mode, maxPrice })`, `returnDate = startDate + nights`.
- Ranking (`ranking.ts`): hard filters (direct only / max stops, very long layovers, cheaper mode: below the current
  price), then a score from price vs budget, total flying time, stops, long layovers, red-eyes and early arrivals.
  Top 5 shortlist; without soft notes the top score wins, with them the LLM returns an index and reason tags
  (`Flight.picked`); an invalid answer or error falls back to the top score.
- **Return leg.** Google Flights lists outbound legs only, so `completeReturn` runs a second search for the chosen
  outbound (cheapest, then 10:00–22:00 departure, then shortest). It fills `return`, flight numbers, the pair's price
  and booking link. On failure the return stays `null` with a warning, and no node may borrow the outbound times. A
  cheaper pass whose completed pair is not cheaper keeps the previous flight.
- Messages: first pass ordinary ("I found 4 flights — the best option is … at $500."; "Live prices weren't available,
  so these are estimates." on mock data). Re-plan: decision `flight` with layover, terminal and saving.

**Hotel Agent** (`hotel.node.ts`; LLM only for a preference pick)
- `searchHotels({ destination, checkIn, checkOut, mode, maxPricePerNight })`.
- Ranking: price, rating (preferred ≥ 7/10), distance to the centre, transit. Same top-5 / preference pick as flights.
  Never more expensive in cheaper mode.
- Nights = `max(1, durationDays − 1)` (`nightsFor()`): the last day is the departure day.
- `status: 'planning'`. Messages: first pass ordinary; re-plan decision `hotel` ("Found a great stay near République
  for $66/night! Rated 8.2, saving us $145.").

**Itinerary Planner** (`planner.node.ts`, LLM on the `fast` tier)
- **Free hours.** The arrival day is the day the outbound lands (day 2 after an overnight flight). Free from landing +
  60 min + the ride; on the last day until the hotel departure (return departure − 3 h − ride − 30 min). Without a
  confirmed return the last day stays light. Under 90 free minutes → 0–1 places.
- **Forecast.** `getForecast(destination, startDate, days)`: one `DayWeather | null` per day (≤ 16 days ahead, else
  `null`). Rain, snow or storm days get indoor stops.
- **Transfers + spend** (1 call): exactly two transfers (airport → hotel on arrival, hotel → airport on the last day).
  The model only chooses the mode (`cheaper`: the cheapest viable, never dearer than the previous pass). **Prices and
  `dailyExpensesEstimate` come from `tools/priceBaseline.ts`** (per-city tier: budget / mid / premium; unknown cities
  are mid; cheaper pass × 0.85 daily), so the same trip always costs the same. Ride times use Google's taxi/transit
  minutes when the hotel's airport is the flight's. The departure note is computed; a model note with a number is
  dropped.
- **Days** (one call per day, 4 in parallel): `{ title, places }` with 2–4 / 5 / 6 places for relaxed / balanced /
  packed. Each call gets the hotel, that day's transfers, earlier days (no repeats), the forecast and the free hours.
  Optional Tavily top attractions as context. After each day a custom event drives "Day 4 of 5" and the growing
  `DRAFT`.
- **Coordinate guard.** Places more than ~100 km from the day's median are dropped; the airport, taxi ranks and the
  hotel are never places.
- **Place check.** Each stop is looked up on Google Maps (max 60 per pass, 8 s each, cached 24 h). Rejected when not
  found nearby, closed temporarily/permanently, closed that weekday, closing within an hour of the arrival-day start or
  opening within an hour of the departure-day end. Rejections go back to the model once with reasons; still-rejected
  stops are dropped. Kept stops take Google's name, coordinates, website, hours and `source: 'serpapi'`; unchecked ones
  have no `source` (the UI says "Hours not checked"). Photos come from Wikipedia (3 s cap, cached).
- **Re-plan pass.** Keeps the existing places, re-chooses transfers, and re-plans only the arrival and departure days
  when the hotel or flight times changed.
- `status: 'auditing'`. Messages: transfer proposal, weather callouts ("Weather prep · Day 3 moved indoors"), the
  place-check swaps, decision `itinerary` once per run, and decision `transfers` on a re-plan.

**Budget Auditor** (`budget.node.ts`, pure)

```
totalCost = flights[0].price + hotels[0].pricePerNight × nights + Σ transfers.priceUsd + dailyExpensesEstimate × durationDays
```

| Condition | Action |
| --- | --- |
| 1 · `totalCost ≤ budget` | `status: 'completed'` → END |
| 2 · over and `retryCount < 2` | `retryCount + 1`, `searchMode: 'cheaper'`, `overBudgetBy`, `status: 'searching'` → Flight Agent |
| 3 · over and `retryCount = 2` | `status: 'completed'`, warning "Budget exceeded by $X", `suggestions = { raiseBudgetTo: next $100 above total, tryDays: max(1, days − 1) }` → END |

Every audit appends a `BudgetPass` (flight, hotel, transfers, daily, total, `flightLabel` "$420 via IST",
`hotelLabel` "4 × $95"). At most three search rounds; in cheaper mode nothing gets more expensive, so condition 3
returns the cheapest combination found. Messages: a re-plan explains the gap with callout "Over budget by $125 ·
re-plan 1 of 2"; conditions 1 and 3 confirm every unconfirmed topic (`flight`, `hotel`, `transfers`) and then
`budget` ("All in, that's $975 of $1,000 with $25 to spare. Approved!" / "Best I could do is $1,084, $84 over
budget.").

### 8.5 Chat messages and confirmed decisions — `agent/messages.ts`

- `logs` are technical (terminal); `messages` are the friendly stream for the chat.
- **Chat text is built by code from state, never by the LLM**: no extra tokens, deterministic, English. Money goes
  through one `formatUsd()`. `@Name` tokens use display names; the web app highlights them.
- A message with `decision: <topic>` is a confirmed decision. At most six per run: `trip`, `flight`, `hotel`,
  `transfers`, `itinerary`, `budget`. The first pass only *proposes* flight, hotel and transfers; agents confirm in a
  re-plan pass, and the Budget Auditor confirms what is left. A later re-plan may confirm again; the UI shows the
  newest. There is no "superseded" state and **no user approval step** (no human-in-the-loop `interrupt`).

---

## 9. Tools and external data

### 9.1 Travel search — `tools/index.ts`

```typescript
interface SearchTool { name: 'serpapi' | 'mock'; searchFlights; completeReturn; searchHotels }
interface TravelSearchTool extends SearchTool { getForecast; getPlacePhoto; getCenter; checkPlace }
```

| `TOOLS_MODE` | Search | Forecast / photos / centre / place check |
| --- | --- | --- |
| `auto` (default) | SerpAPI with mock fallback when `SERPAPI_API_KEY` is set, else mock | Live (keyless); place check only with a key |
| `live` | SerpAPI only, failures are failures | Live |
| `mock` | Mock | Fixtures / `null` |

- `withFallback(primary, mock, onFallback)` catches `ToolUnavailableError` and timeouts, logs, and answers from the
  mock (`kind: 'search-fallback'` log + warning). `completeReturn` has **no** fallback: a mock return on a live
  outbound would be an invented flight.
- `withSearchCache` reuses flight/hotel searches for `SEARCH_CACHE_TTL_MS` (30 min), keyed by route/place and dates,
  so a cheaper re-plan reuses the first search. Failures are not cached.
- `utils/circuitBreaker.ts`: after a provider fails for good, calls to it are refused for 60 s so later calls fall
  back at once (SerpAPI and every `fetchJson` host).

**SerpAPI** (`serpApi.tool.ts`): Google Flights (`engine=google_flights`, round trip, USD) and Google Hotels;
city → airport via `airports.ts` or a 3-letter code, else `google_flights_autocomplete` (cached 7 days; nothing found →
`UnknownAirportError`). Per request 10 s timeout combined with the run signal; 2 retries on network errors, 429 and
5xx (500 ms, 1500 ms + jitter); no retry on other 4xx. Responses are mapped through `FlightSchema` / `HotelSchema`
(bad items dropped). `departure_token`s are kept (max 500) for `completeReturn`. Hotels keep area, photo, times,
coordinates, link, and the listed airport with Google's taxi/transit minutes; `transit` is set only for a nearby
place whose name says it is a station (≤ 15 min walk). The place check uses `engine=google_maps`.

**Mock engine** (`mockTravel.tool.ts`): deterministic prices from a hash of origin + destination + date; 3–5 flights
and hotels with `source: 'mock'`, fully populated; cheaper mode returns options ≥ 15% below the cap; ~300 ms delay so
the stream looks real.

### 9.2 Destination bar — `tools/tripContext.ts` (`GET /api/trip-context`)

Not part of the graph, no API keys, never fails a run.

1. Geocode the destination (Open-Meteo; aliases in `placeAliases.ts`). No match → `404`. The origin, when given, only
   supplies `originTimeZone` (unknown → `null`).
2. Weather (current, today's low/high, a 7-day `outlook` such as "rain Saturday") ∥ currency (`currencies.ts`
   country → ISO code + symbol) and USD rate (open.er-api.com). `Promise.allSettled`, 5 s timeout and one retry each;
   a failure is `null` for that field only. USD destination or unknown country → `currency: null, exchangeRate: null`.
3. In-process TTL cache keyed by the normalised destination: geocode 24 h, weather and forecast 30 min, rate 6 h.
   Failures are not cached.
4. **No mock fallback on failure** (a fake temperature or rate would look real); the UI hides the chip.
   `TOOLS_MODE=mock` returns fixtures with `source: 'mock'`.
5. Provider hosts are constants; `destination` / `origin` are URL-encoded (2–100 chars), so the route cannot be used
   to fetch arbitrary URLs. The response is parsed with `TripContextSchema` before it is sent.

**Place suggestions** (`tools/places.ts`, `GET /api/places`): Open-Meteo geocoder hits filtered by GeoNames feature
code to countries, first-level regions and populated places, de-duplicated, up to 8, cached 1 h; aliases such as
"England" lead with their country; 10 s budget; fixtures in mock mode.

---

## 10. Frontend — `apps/web`

Package `ai-travel-web`. Next.js 16 App Router, React 19, TypeScript strict (`exactOptionalPropertyTypes` off: the
generated shadcn files don't compile with it), path alias `@/*` → `src/*`.

Responsibilities: collect the request; render the stream live (chat, progress, Trip Overview, map); show the
destination bar; survive a dropped connection, a rate limit and an over-budget result; validate every packet with the
shared schemas. It holds **no secrets and no business logic**: costs, retries, search, decisions, suggestions,
rates and budget passes all come from the agent and are only displayed.

### 10.1 Next.js 16 specifics

- Turbopack is the default for `dev` and `build`. Lint with `eslint .` (no `next lint`), flat config from `eslint-config-next`.
- Request APIs are async: `searchParams`, `params`, `cookies()`, `headers()` must be awaited.
- **Cache Components** (`cacheComponents: true`) and `partialPrefetching` are on: anything that reads request data
  must sit inside `<Suspense>` or the build fails.
- Tailwind v4 runs through the `@tailwindcss/turbopack` loader in `next.config.ts` (no PostCSS config).
- `PageProps<'/'>` / `LayoutProps<'/'>` are generated by `next typegen` (part of `pnpm typecheck`).
- Next keeps pages the user left in a hidden `<Activity>`; hooks must clean up and re-attach (§5.6).
- `apps/web/AGENTS.md` is written by `next dev`: read the bundled Next docs before relying on older knowledge.

### 10.2 Configuration — `lib/env.ts`, `next.config.ts`

`lib/env.ts` validates the public variables once with Zod and exports `env`; components never read `process.env`.

| `env` field | From | `null` / off means |
| --- | --- | --- |
| `agentUrl` | `NEXT_PUBLIC_AGENT_URL` | **UI-only mode**: a "Preview — the planning agent isn't connected yet" notice, the form disabled, `start`/`resume` and every agent call no-ops |
| `mapboxToken` | `NEXT_PUBLIC_MAPBOX_TOKEN` | The schematic map instead of Mapbox |
| `googleClientId` | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | No sign-in; everyone is a guest |
| `showTechLog` | `NEXT_PUBLIC_SHOW_TECH_LOG === 'true'` | No "Technical log" button (LOG packets still stream; in development they print to the console) |

`next.config.ts` derives a local agent URL **only for `next dev`** (`http://localhost:${CONDUCTOR_PORT + 1 || 4000}`),
so deployed builds never point at localhost. `NEXT_PUBLIC_*` values are inlined at build time: redeploy after
changing them.

### 10.3 Pages and rendering

| Route | What |
| --- | --- |
| `/` (`app/page.tsx`) | Server Component. Inside `<Suspense fallback={<PageSkeleton />}>` it awaits `?trip=` and `fetchStoredTrip`, then renders `DeepLinkedTrip` → `TripDashboard` |
| `/trips` | "My trips" (`TripHistoryList`) |
| `POST /auth/google` | Route handler for Google's redirect sign-in on phones: checks the `g_csrf_token` cookie against the form field, then redirects to `/#gsi=<credential>` (the credential stays in the fragment, never on a server); `AccountMenu` trades it for a session |
| `error.tsx`, `not-found.tsx` | Error and 404 pages |

`layout.tsx` (Server Component): Geist Sans / Mono via `next/font`, the sticky header (wordmark, `SiteNav`, a slot
for `TripActions`, `AccountMenu`), `SkipLink`, `TooltipProvider`, `<Toaster theme="light">`. Interactivity starts at
`TripDashboard` (`'use client'`). No global state library: state lives in `useAgentStream`, the other hooks and
`TripDashboard`.

### 10.4 Data layer

**SSE parser — `lib/sse.ts`.** `readSseEvents(body, signal)` decodes with `TextDecoderStream`, splits events on
blank lines (`\n\n` or `\r\n\r\n`), skips comments, joins `data:` lines and yields `{ id, data }`. Handles events
split at any byte. Pure: no React, no Zod.

**Run hook — `hooks/useAgentStream.ts`.** One `useReducer`:

```typescript
type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'reconnecting' | 'completed' | 'failed' | 'aborted';
state: { status, threadId, logs, messages, decisions /* newest per topic */, draft, progress, result, error,
         retryAt /* epoch ms the 429 lifts */, reconnect { attempt, max: 5, nextAt }, lastRequest, startedAt, passStart }
actions: start(request), resume(), reconnectNow(), cancel(), reset(), plus attaching to a run it did not start
```

1. `start` aborts any in-flight run, sends `POST /api/trips` (owner + auth headers), remembers `lastRequest`.
2. Non-2xx → the JSON error is mapped to a message; `RATE_LIMITED` sets `retryAt`.
3. On 200: read `X-Thread-Id`, `history.replaceState` to `?trip=<threadId>`.
4. Per packet: `JSON.parse` → `SseEventSchema.safeParse` (invalid → dropped). `LOG` appends; `MESSAGE` appends and,
   with a `decision`, sets `decisions[topic]`; `DRAFT` shallow-merges; `PROGRESS` replaces (percent never goes down);
   `RESULT` sets `result` and the final status.
5. Stream ends without `RESULT` or a network error → reconnect (§5.6). Abort → `aborted`, no error.
6. Runs start only from user actions, never from effects (Strict Mode safe); the `AbortController` and timers are
   cleared on unmount.

**Other hooks and helpers**

| Module | What |
| --- | --- |
| `lib/api.ts` | `fetchStoredTrip` (deep link: `…/record`, falling back to `GET /api/trips/:id`, through `StoredResultSchema`; `'not-found'` when both are `404`, `null` when there is no usable answer), `fetchMyTrips`, `deleteTrip`, `fetchUsage` |
| `hooks/useTripContext.ts` | `GET /api/trip-context` as soon as the destination is known (first `DRAFT`, or the reopened `RESULT`); module-level cache per destination + origin; aborts on change; **failures are silent** (the bar just hides) |
| `hooks/usePlaceSearch.ts` | Suggestions for the From / To dropdowns; failures leave a free-text field |
| `hooks/useUsage.ts` | "2 of 3 plans left" for the header and `PlansCard`; one shared copy, refreshed after a run starts or ends |
| `lib/auth.ts`, `hooks/useSession.ts` | Session in `localStorage`; `authHeaders()` adds `Authorization: Bearer`; a `401` drops the session |
| `lib/owner.ts` | Anonymous owner id: a random UUID in the first-party cookie `ai-travel-owner` (400 days), sent as `X-Owner-Id` |
| `lib/pendingTrip.ts` | A trip requested while signed out waits in `sessionStorage` and starts after sign-in |
| `hooks/useTripHistory.ts` | Local copy of "My trips" (max 20), for trips the server does not know |
| `hooks/useHomeCity.ts` | The traveller's home city in `localStorage` |
| `hooks/useCountdown.ts`, `useNow.ts`, `useStickToBottom.ts` | Rate-limit countdown, ticking clock, chat auto-scroll |
| `lib/trip.ts` | View data derived from packets: budget parts, agent rows, phase states, ETA, decision summaries |
| `lib/parseTrip.ts` | Start-page preview of what the Supervisor will read (the Supervisor's parse wins) |
| `lib/labels.ts`, `links.ts`, `map.ts`, `time.ts`, `utils.ts`, `dom.ts` | Display names and colours, safe external links (https + allow-listed hosts), map bounds, `Intl` time-zone maths, `formatUsd` / `formatTime` / `cn`, DOM ids and the "new trip" event |

**Deep link.** `/?trip=<id>` reopens a finished trip with its result and chat (summary first, "Open full chat"). The
start page says which case it is: "This trip didn't finish" + Resume, "We couldn't find this trip", or "This trip
didn't load" + Try again. An unfinished trip that is still live is followed (§5.6). The server-side lookup has no
token, so `DeepLinkedTrip` asks again from the browser when a signed-in user got "not found". "Share trip" copies
the `?trip=` link.

### 10.5 Screens

- **Start (idle):** a dark hero, the "Plan a trip" card (`TripInputForm`) and "How it works". The form is one
  sentence plus "What the agents understood" (From, To, Days, Budget, When; each a button that opens its field),
  interests, three example prompts (Istanbul, Tokyo, Paris), `PlansCard` and the Plan button. Validation uses
  `TripRequestSchema`; empty optional fields are left out; errors say what to do. A guest pressing Plan with sign-in
  configured gets `SignInDialog`, and the trip starts after sign-in. While `retryAt` is in the future the button reads
  "Plan trip in 0:42" (screen readers get "about 2 minutes"). ⌘/Ctrl+Enter submits.
- **Live run** (`design-agents-planning.png`): `RunBanners`, a full-width `RunProgress` ("Planning your trip · 82% ·
  about 20 s left" and six phase steps Brief → Flights → Hotel → Transfers → Itinerary → Budget check; its heading is
  the page `h1`), then Agent Chat (7/12) and the live Trip Overview (5/12): budget, selected flight, hotel, map, day
  list. A phase is done when its decision exists **or its data is already in the draft**. A failed or stopped run
  stays visible, greyed out with `grayscale` (not opacity, to keep AA contrast).
- **Finished trip** (`design-trip-overview.png`): "Trip overview", "5 days in Paris" and the compact `BudgetMeter`;
  a 12-column grid with the chat summary (confirmed decisions with "Open full chat"), flights with transfers, the
  hotel, the map with the selected-day panel, and day cards. "Trip ready · $35 to spare" is a toast.
- **Header actions** (`TripActions`, portalled into the header): "Stop planning" while live; "New trip",
  "Re-plan" and "Share trip" when finished. "Plan a trip" in the nav resets an open dashboard.
- **Page title** follows the view ("5 days in Paris · AI Travel Planner", "Planning your trip · …").
- **Mobile (375 px and up):** columns stack; the destination band becomes a 2-column grid without icons; the Trip
  Overview uses Flight / Hotel / Transfer / Days tabs; header actions become icon buttons; nothing scrolls sideways.

### 10.6 Components

| Component | Role |
| --- | --- |
| `TripDashboard` | Owns `useAgentStream`, `useTripContext` and the selected day; lays out every state |
| `DeepLinkedTrip` | Mounts a fresh dashboard for a link to another trip; keeps a live run you came back to |
| `TripInputForm`, `PlaceInput`, `PlansCard`, `SignInDialog`, `StartExtras` | Start page pieces (§10.5) |
| `TopBar` | Destination band: place + dates + nights, weather (+ today's range and outlook), currency + `1 USD = 0.92 EUR`, local time + difference to the origin. Each chip renders only with data; skeletons while loading; nothing on error. `aria-label` sentences, decorative icons |
| `RunProgress` | Percent, ETA (hidden below 15% and after completion) and the six phase steps |
| `RunBanners` | Trip-level outcomes, **one banner at a time, most urgent first**: paused/failed at a step (Resume / Start over), over budget after 2 re-plans ("Raise to $1,100", "Try 4 days", "Keep it"), stopped by you, warnings. A dropped stream is a "Reconnecting…" toast; a model fallback shows nothing; estimated prices carry an inline "Estimated" badge |
| `AgentChat` | The primary feed: avatars grouped per agent, `HH:mm`, `@Name` highlighting, "Flight confirmed · …" chips (check icon; "Budget checked · over budget" in amber), callout tags, "Itinerary Planner is drafting Day 4", "Jump to latest", `role="log"`. Never infers a decision from text. Compact summary variant on a finished trip |
| `AgentBoard`, `AgentTerminalLogs`, `RunDetails` | The technical view behind "Technical log" (`showTechLog`): one row per agent with derived status (done / running / waiting / failed, "pass 2"), the dark terminal of `LOG`s (copy, auto-scroll toggle), and thread / checkpointer / last checkpoint / model / re-plans. The "What changed on re-plan" table (`PassesTable`) lives here too |
| `TripOverview` | Reads `result ?? draft`; sections appear as data arrives, each with "Confirmed" once its decision exists and "Final check pending" until `budget`. Sticky section tabs |
| `BudgetMeter` | Total vs budget ("$975 of $1,000", "Approved · $25 to spare", "Over by $84"), stacked bar in one hue (flights, hotel, transfers, daily, left) with a tick at the budget, rescaling past 100% |
| `FlightHotelCards` | Flight: airline (links to the fare), "round trip", price, stops, a route strip per leg (`TAS 06:40 ┄ IST 1 h 50 m ┄ CDG 13:55 · T1`, `+1 day`, flight numbers), transfers below. Hotel: photo or placeholder, name, area, rating /10 with a word (≥ 9 Superb, ≥ 8 Very good, ≥ 7 Good, else Fair), check-in/out, transit, `$66 × 5 nights = $330` (links to rooms). `source: 'mock'` → "Estimate" badge |
| `ItineraryTimeline` | Day strip ("Day 1 · Thu", weather, stop count; drafting/waiting) with arrow-key navigation; the selected day's stops with notes, Google hours ("Open 9 AM–6 PM · Google Maps") or "Hours not checked", photos, that day's transfer rows and "Daily spend ~$30" |
| `MapboxViewer` / `SchematicMap` / `MapPins` | Client-only map (`next/dynamic`, `ssr: false`): numbered pins per day in the day's colour (others small and faded), hotel marker, straight-leg route for the selected day, `fitBounds` on change. Without a token the schematic plot draws the same pins and dashed routes |
| `TripHistoryList` | "My trips": the agent's list (skeleton while loading), merged with local entries the server does not know (checked once; `404` → "No longer available"). "Didn't finish" label, delete. Guests get "Copy link for another device" (`/trips?owner=<id>`, adopted in the other browser with a "Trips linked" toast). With sign-in configured a guest sees a sign-in prompt instead |
| `AccountMenu` | Google's button (icon-only on phones; redirect mode on iPhone Safari), avatar and "Sign out"; claims this browser's guest trips after sign-in |
| `Notice` | The one notice component: info / success / warning / error × inline / banner / toast. Every toast goes through `notify()` |
| `SiteNav`, `SkipLink`, `PageSkeleton`, `Tags`, `AgentAvatar`, `ExternalLink` | Header nav, skip link (focuses the visible `<main>`), page-shaped loading skeleton, status chips, agent badges, safe "View on …" links |
| `ui/*` | shadcn/ui primitives: `button`, `dialog`, `input`, `textarea`, `skeleton`, `sonner`, `tooltip`. Add new ones with `pnpm dlx shadcn@latest add <name>`; don't hand-edit |

### 10.7 Design system — "Departure board"

Cool paper ground, navy ink, one blue for actions and amber only for what is live right now. Geist Sans for the
interface, Geist Mono for anything the agents produce (prices, codes, logs). Light theme only. Wordmark: "AI Travel
Planner" next to a navy rounded square with the lucide `Route` icon. Tokens override the shadcn `base-nova`
variables in `globals.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#F2F3F5` | Page ground |
| `--card` | `#FFFFFF` | Cards, inputs |
| `--border` | `#DDE1E6` | Borders |
| `--foreground` | `#0B1726` | Text, terminal ground |
| ink 2 / `--muted-foreground` | `#3D4A5C` / `#5F6B7A` | Secondary text / labels |
| `--primary`, `--ring` | `#2952CC` | Buttons, links, route line |
| `--live`, `--live-foreground` | `#F2A60D`, `#8A5300` | Running, pending, warn |
| `--success` | `#0F7B5F` | Completed, under budget |
| `--destructive` | `#C2361F` | Failed, over budget |
| Budget segments | `#1F3FA3` flights · `#4F78E0` hotel · transfers · `#A9BDF0` daily · `#EEF0F3` left | `BudgetMeter` |
| Day colours 1–5 | `#2952CC` `#C46A00` `#7A4CD9` `#0F7B5F` `#C2361F` | Day tabs, map pins |

Type: Display 36/40·600, Heading 20/28·600, Body 15/22, Small 13/18, Label Mono 11/16 caps, Figure Mono 36/40·600,
Log Mono 13/20. 4-pt spacing; radius 8 controls, 12 cards, 14 on mobile, pill chips.

Rules: Tailwind utilities with theme tokens, merged with `cn()`; money only through `formatUsd()`, dates through
`Intl.DateTimeFormat`; every async state has a visible representation; animations ≤ 300 ms (`motion`), off under
`prefers-reduced-motion`.

**Accessibility (WCAG 2.2 AA):** labelled inputs and visible focus; colour is never the only signal ("Confirmed" =
chip + check icon + border; pins carry numbers); never fade text with `opacity` (grey it out); pointer cursor on
everything clickable; 40 px controls, 44 px on touch (`pointer-coarse:`), text links get a 44 px tap box; the skip
link is the first Tab stop; `scroll-padding-top` keeps focus clear of sticky bars; the Re-plan modal traps Tab
(`keepTabInside`); toasts are not Sonner-dismissible so focus does not jump; live regions are polite except errors.

---

## 11. Resiliency and fallbacks

| Failure | Handling |
| --- | --- |
| Anthropic error / timeout / 429 | SDK retries (2), then the other model; both fail → node throws → `RESULT failed`, resumable |
| LLM output fails the schema | Counts as a model failure → the other model |
| SerpAPI error / timeout (10 s) / 429 | 2 retries with backoff + jitter, then the mock engine (`auto`), a `search-fallback` log, a warning and "Estimate" badges; the provider is skipped for 60 s |
| No SerpAPI key | Mock engine directly |
| `TOOLS_MODE=live` and no answer | Nothing estimated: `RESULT failed` names what was missing |
| Return-flight search fails | `return: null` + warning; the last day stays light; no mock fallback |
| Place check fails / times out (8 s) / cap of 60 | The stop is kept unchecked ("Hours not checked"); a live run adds a warning |
| Forecast unavailable or > 16 days ahead | Planned without weather; `weather: null`, no weather callout |
| Weather / FX provider error (5 s) | One retry, then `null` for that field; the chip is hidden; the run is unaffected |
| Destination cannot be geocoded | `404`; the bar shows nothing |
| Budget never satisfiable | Condition 3 after 2 re-plans: best result + warning + suggestions |
| Client disconnects | Run keeps going; reconnect with `Last-Event-ID` replays the gap |
| User presses "Stop" | `POST …/cancel`; checkpoint kept; Resume available |
| Run too long | `RUN_TIMEOUT_MS` (120 s) → `RESULT failed`, resumable |
| Server restart / deploy | Runs end with "Server restarting, resume to continue"; resume from the checkpoint |
| Trip store unreachable | Saving is best effort (logged, 5 s timeout); the run ends normally |
| Abuse / LLM bill | Per-IP 10 runs / 15 min **and** 30 / 24 h, per-account plan allowance, 10 kb bodies, 1,000-char prompts, sign-in required to plan when configured |

**Rule for every new external API:** a **timeout**, a **fallback** (mock data, a `null` field or a hidden chip, never
a failed run) and a **`source`** field on the data it produces, so the UI can say where a value came from.

---

## 12. Security and identity

- **Secrets only on the agent** (`ANTHROPIC_API_KEY`, `SERPAPI_API_KEY`, `TAVILY_API_KEY`, `DATABASE_URL`,
  `SESSION_SECRET`), in Render env vars. The web app has only public `NEXT_PUBLIC_*` values (the Mapbox token is
  URL-restricted).
- **CORS** allows only `WEB_ORIGIN`. `helmet` sets security headers. Env is validated on boot (the agent refuses to
  start with a bad configuration; production requires `WEB_ORIGIN` and `DATABASE_URL`).
- **Validation at both ends** with the same Zod schemas; the agent never trusts the client.
- **Prompt injection containment:** user text reaches the Supervisor (strict output schema), the preference pick
  (index + tags only) and the Planner as notes. Tools are called by code, so a prompt cannot trigger tool use.
- **Owner id** (`X-Owner-Id`): a random UUID, not tied to a person, in a first-party cookie on the web domain (an
  agent cookie would be third-party). It works like a bearer token for a guest's "My trips", so it is only revealed
  through "Copy link for another device". Trip ids are capabilities too.
- **Google sign-in** (on when `GOOGLE_CLIENT_ID` + `SESSION_SECRET` are set on the agent and
  `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on the web):
  1. The browser gets a Google ID token (popup, or redirect through `/auth/google` on phones with the CSRF check).
  2. `POST /api/auth/google`: the agent has Google verify it (`oauth2.googleapis.com/tokeninfo`) and checks audience
     = our client id, Google issuer, expiry and a verified email.
  3. The agent returns its own HS256 session token (30 days, signed with `SESSION_SECRET`, timing-safe compare).
     The browser keeps it in `localStorage` and sends `Authorization: Bearer`.
  4. The account id is Google's `sub` from the verified token only. A bad or expired token is `401` and the web app
     drops it. With sign-in configured, **starting or resuming a run requires an account**.
  5. A signed-in traveller's trips get `user_id`; reads, stream, resume, cancel and delete answer `404` to anyone
     else. After sign-in `POST /api/trips/claim` moves this browser's guest trips to the account.

---

## 13. Configuration reference

Blank values (`KEY=` copied from `.env.example`) count as unset everywhere.

### 13.1 Agent — `apps/agent/.env` (read only by `config.ts`)

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `production` |
| `PORT` | `CONDUCTOR_PORT + 1`, else `4000` | Render sets it |
| `CONDUCTOR_PORT` | — | Conductor workspace base port |
| `WEB_ORIGIN` | `http://localhost:${CONDUCTOR_PORT ?? 3000}` | Comma-separated CORS allow-list, normalised to origins. **Required in production** |
| `ANTHROPIC_API_KEY` | — | **Required** |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Primary model |
| `ANTHROPIC_FALLBACK_MODEL` | `claude-sonnet-5-5` | Fallback, and first choice of the `fast` tier |
| `SERPAPI_API_KEY` | — | Live flights/hotels/place checks. Required for `TOOLS_MODE=live` |
| `TAVILY_API_KEY` | — | Optional attraction context for the Planner |
| `TOOLS_MODE` | `auto` | `auto` \| `live` \| `mock` (§9.1) |
| `DATABASE_URL` | — | `postgres://` / `postgresql://`. Enables `PostgresSaver` and the Postgres trip store. **Required in production** |
| `GOOGLE_CLIENT_ID` | — | Turns on sign-in; needs `SESSION_SECRET` |
| `SESSION_SECRET` | — | ≥ 32 chars (`openssl rand -base64 48`) |
| `RUN_TIMEOUT_MS` | `120000` | Whole-run timeout |
| `RUN_REPLAY_TTL_MS` | `600000` | How long a finished run stays replayable |
| `RUN_REPLAY_MAX_EVENTS` | `500` | Replay buffer size per run |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_RUNS` | `900000` / `10` | Per-IP run window |
| `RATE_LIMIT_DAILY_MAX_RUNS` | `30` | Per-IP runs per 24 h |
| `USER_MAX_RUNS` | `3` | Plans per account (or browser), ever |
| `SEARCH_CACHE_TTL_MS` | `1800000` | Flight/hotel search reuse |
| `LANGSMITH_TRACING` / `LANGSMITH_API_KEY` | `false` / — | Tracing; `true` requires the key |

### 13.2 Web — `apps/web/.env.local` (read only by `lib/env.ts` and `next.config.ts`)

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_AGENT_URL` | Agent base URL. Unset in a deployed build → UI-only mode. `next dev` defaults to `http://localhost:${CONDUCTOR_PORT + 1 or 4000}` |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | URL-restricted public token; unset → schematic map |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same value as the agent's `GOOGLE_CLIENT_ID`; unset → no sign-in |
| `NEXT_PUBLIC_SHOW_TECH_LOG` | `true` shows the Technical log |
| `WEB_PORT` | Dev server port, default `55360` (fixed so it can be registered as a Google OAuth origin) |

---

## 14. Local development

**Requirements:** Node.js 24 (`.nvmrc`) and pnpm 10 (Corepack: `corepack enable pnpm`).

```bash
pnpm install
cp apps/agent/.env.example apps/agent/.env      # set ANTHROPIC_API_KEY (the only required secret)
cp apps/web/.env.example apps/web/.env.local    # optional
pnpm dev                                        # builds contracts, then runs contracts (watch), agent and web
```

- The web dev server listens on `http://localhost:55360` (`WEB_PORT`), the agent on `4000` (or `CONDUCTOR_PORT + 1`).
  The agent's default CORS origin is `http://localhost:3000` (or `CONDUCTOR_PORT`), so set
  `WEB_ORIGIN=http://localhost:55360` in `apps/agent/.env` (and add that origin to the Google OAuth client for sign-in).
- Postgres locally: `docker compose up -d` in `apps/agent`, then
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/travel`.
- Without `SERPAPI_API_KEY` everything runs on the offline mock engine; `TOOLS_MODE=mock` also fixes the weather,
  rate and place fixtures.
- Turborepo's strict env mode hides shell variables from tasks: put agent secrets in `apps/agent/.env` (dotenv reads
  it from disk), not in the shell.

| Command (repo root) | Effect |
| --- | --- |
| `pnpm dev` | contracts (watch) + agent (`tsx watch`) + web (`next dev`) |
| `pnpm build` | contracts → (agent ∥ web), cached |
| `pnpm lint` / `pnpm typecheck` | All packages, cached |
| `pnpm dev --filter=ai-travel-agent...` | Agent and its dependencies only |
| `./scripts/check-no-hardcoded-trip-data.sh` | Fails if city names appear in web source outside comments and the example prompts |

Per package: `pnpm --filter ai-travel-agent lint typecheck`, `pnpm --filter ai-travel-web lint typecheck build`.

**Monorepo tooling.** `pnpm-workspace.yaml`: workspaces, the catalog (`zod`, `typescript`, `@types/node`; referenced
as `"catalog:"`), skipped native postinstall scripts. `turbo.json`: `build` and `typecheck` depend on `^build`
(contracts first); build outputs; `NEXT_PUBLIC_*` in the cache key; `CONDUCTOR_PORT` / `PORT` passed to `dev`. Don't
set a custom `cacheDir` (it breaks cache sharing between worktrees). `tsconfig.base.json` holds the strict options;
agent and contracts use `NodeNext`, web uses `Bundler`.

**Conductor.** `.conductor/settings.toml`: setup `corepack enable pnpm && pnpm install && pnpm --filter
@ai-travel/contracts build`; run action `pnpm dev`; `run_mode = "concurrent"`. `.worktreeinclude` copies every
`.env*` into new workspaces. The app reads the settings from `main` on the remote.

**CI** (`.github/workflows/ci.yml`, every PR and push to `main`): `pnpm install --frozen-lockfile`, the hard-coded
data check, `pnpm turbo run lint typecheck build`. There is no automated test suite (removed in #40).

---

## 15. Deployment and operations

### 15.1 Targets

| | `ai-travel-web` (Vercel) | `ai-travel-agent` (Render) |
| --- | --- | --- |
| Root directory | `apps/web` | repo root (so contract changes redeploy it) |
| Install / build | `vercel.json`: `cd ../.. && pnpm install --frozen-lockfile`, `pnpm turbo run build --filter=ai-travel-web` | `pnpm install --frozen-lockfile && pnpm turbo run build --filter=ai-travel-agent` |
| Start | Vercel | `pnpm --filter ai-travel-agent start` (`node dist/server.js`) |
| Rebuild only when | `npx turbo-ignore` | Build filters: `apps/agent/**`, `packages/contracts/**`, `pnpm-lock.yaml` |
| Env | §13.2 | §13.1 (`NODE_ENV=production`, `WEB_ORIGIN`, `DATABASE_URL`, keys) |
| Health | — | `GET /health` |

Production branch `main`; every PR gets a Vercel preview. One-time Vercel steps (Mapbox URL restrictions, Google
OAuth origins, preview domains in `WEB_ORIGIN`) are in [`apps/web/DEPLOY.md`](./apps/web/DEPLOY.md). Render must use
the pnpm version from `packageManager` (Corepack). Live demo: https://ai-travel-planner-test.vercel.app.

### 15.2 Database

Managed PostgreSQL (Render Postgres, paid tier for production; the free one expires) for checkpoints, `trips` and
`user_runs`; all tables are created on boot.

### 15.3 Health checks

Point **Render's** health check at `/health` (liveness). With one instance and in-memory runs, a short Postgres
outage would make `/readyz` return `503`, Render would restart the instance and every live run and replay buffer would
be lost although the process was fine. Point an **external monitor** (e.g. UptimeRobot) at `/readyz`: it alerts and
restarts nothing.

### 15.4 Run exactly one agent instance

The `RunRegistry`, replay buffers, rate-limit counters, the circuit breaker and the caches are in process memory. A
second instance would not find the other's runs. Scaling out needs a shared store first (§18).

### 15.5 Production checklist

- [ ] Render: paid instance, `NODE_ENV=production`, `DATABASE_URL`, `WEB_ORIGIN` (production + preview domains),
      `ANTHROPIC_API_KEY`, `SERPAPI_API_KEY` (`TOOLS_MODE=auto` or `live`), optional `TAVILY_API_KEY`.
- [ ] Sign-in: `GOOGLE_CLIENT_ID` + `SESSION_SECRET` (agent), `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (web), origins in Google
      Cloud Console.
- [ ] Vercel: `NEXT_PUBLIC_AGENT_URL`, `NEXT_PUBLIC_MAPBOX_TOKEN` (URL-restricted); redeploy after changes.
- [ ] Render health check on `/health`; external monitor on `/readyz`; exactly one instance.
- [ ] Review `USER_MAX_RUNS` and the per-IP limits against the SerpAPI plan and the LLM budget.

---

## 16. Engineering rules

**Both apps**

- Cross-service types and schemas come only from `@ai-travel/contracts`. A packet or result change goes into the
  contracts first, then both apps in the same PR; a change that would break a stored result bumps
  `RESULT_SCHEMA_VERSION` and adds an `upgradeResultPayload` step.
- `process.env` is read only in `apps/agent/src/config.ts`, `apps/web/src/lib/env.ts` and `apps/web/next.config.ts`.
- Every new external API gets a timeout, a fallback and a `source` field (§11).
- Error codes exist only in `ErrorCodeSchema`; `ERROR_MESSAGES` has one for each.
- Before calling a change done: `pnpm lint && pnpm typecheck` (and `pnpm build` for the web app).
- If code changes behaviour described here, update this file in the same PR. Match the surrounding code; no drive-by
  refactors. One ticket = one branch = one PR.
- `main` is the source of truth: branch from the latest `main`, rebase before a PR. Shared files (root config,
  `packages/contracts`, the docs) change in small focused PRs.

**Agent**

- Every outgoing packet goes through `SseStreamer.send`; never write packets by hand. Never add `compression()`.
- Routers are pure; nodes are side-effect free except their injected tools and LLM.
- Any new graph loop gets an explicit counter in state and a max constant.
- Chat text comes from `agent/messages.ts`, never from the LLM.
- A run never depends on its HTTP connection: never abort the graph on `res.on('close')`.
- The trip-context lookup never fails a run and never throws past its route; provider errors become `null` fields,
  never mock data.
- Throw `AppError` (`utils/errors.ts`); the error handler never writes JSON after headers are sent.
- ESM with `NodeNext`: relative imports end in `.js`.

**Web**

- Server Components by default; `'use client'` only for the dashboard and interactive pieces. The browser talks to
  the agent directly; no streaming through route handlers or server actions.
- Run state lives in `useAgentStream`; components stay presentational. Parse every packet with the contracts schema.
- No business logic: display decisions, callouts, rates, suggestions and passes, never derive them (agent status and
  phase states are presentation derived from packets).
- No secrets; only public `NEXT_PUBLIC_*` values. No API calls from the browser except the agent, Mapbox and Google
  Identity.
- shadcn/ui primitives before custom ones (add with the CLI, don't hand-edit `components/ui/`); icons from
  `lucide-react`; toasts through `notify()`.
- No hard-coded trip data (cities, prices, rates) in components; CI checks it.
- Works at 375 px with no sideways scroll and 44 px touch targets.

**Design check** (the `design-check` skill): for UI work or any change to packets, `DRAFT` or `RESULT`, open both
design PNGs, map every visible value to its packet field, report mismatches; the design wins.

---

## 17. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| 1 | **Claude Opus 5.5 primary, Sonnet 5.5 fallback**; the Planner's many calls use Sonnet first (`fast`) | Both worked in every live run; Sonnet first keeps the Planner fast and cheaper |
| 2 | **Structured output with `method: 'jsonSchema'`**, no sampling params | Forced `tool_choice` and non-default sampling are HTTP 400 on these models; Zod 4 works with `@langchain/core` 1.3 |
| 3 | **Hotel nights = `durationDays − 1`** (min 1) | The last day is the departure day; check-out and the flight return are `startDate + nights` |
| 4 | **Prices of transfers and daily spend from a static per-city baseline**, the LLM only picks the mode | Reruns of the same trip cost the same; no unchecked fares from the model |
| 5 | **One Planner call per day, 4 in parallel**; a re-plan redoes only transfers and the hotel-anchored days | Measured before parallelism: 43.6 s per run, 40.7 s of it the Planner. Worst case stays under the 120 s timeout. Token cost per run is logged, dollar cost is not |
| 6 | **SerpAPI live only in production**; mock for previews/staging | SerpAPI plan cost; per-IP run limits stay |
| 7 | **Render paid instance and paid Postgres for production**; free tier for demos only | The free instance sleeps and the free database expires |
| 8 | **open.er-api.com** for FX | Keyless, USD base, lists UZS |
| 9 | **Destination bar: current weather + today's range + outlook; the Planner reads the per-day forecast** (≤ 16 days) | The design; later dates get no weather |
| 10 | **`Hotel.transit` only for a named nearby station**, else `null` (row hidden) | Google Hotels mixes stations, sights and airports without labels |
| 11 | **In-process replay buffer and rate limits; one instance** | After a restart, resume continues from the checkpoint; only missed packets are lost. Shared store before scaling out |
| 12 | **POST + fetch stream parsing**, not `EventSource` | `EventSource` cannot POST a body or send `Authorization` |
| 13 | **Separate `MESSAGE` packet** for the chat; `LOG` stays technical | The chat and the terminal evolve independently; decisions are an explicit flag |
| 14 | **Messages built by code; agents confirm their own pick in a re-plan pass**, the Auditor confirms the rest | No extra LLM cost, deterministic; the design shows "Flight confirmed" during the re-plan |
| 15 | **`DRAFT` packet** for the live overview | The design's overview "fills in as agents decide" and the bar appears during the run |
| 16 | **Destination bar loads as soon as the destination is known**, straight from the browser | The design shows it while the agents plan |
| 17 | **No mock weather or rates; hide the chip** | Fake values in the header would look real |
| 18 | **Reconnect and catch up** with `Last-Event-ID`; runs outlive connections | The design's "Stream dropped — reconnecting" state |
| 19 | **Next.js 16** | Current stable line; the design boards' "Next.js 15" / "GPT-4o" labels are stale |
| 20 | **UI-only mode** for builds without `NEXT_PUBLIC_AGENT_URL`; no hosted mock agent | Previews deploy before (or without) the agent |
| 21 | **"Departure board" design system** over shadcn `base-nova` | The design's Foundations board |
| 22 | **Optional Google sign-in; guests keep an anonymous owner id** (cookie, shareable by link) | "My trips" across devices without forcing accounts; a signed token from the web app was rejected (the browser would have to hold its secret) |
| 23 | **Per-account plan allowance (`USER_MAX_RUNS`) + per-IP daily cap** | A public LLM endpoint needs a spending ceiling |
| 24 | **Mobile usable at 375 px** | TP-36 |
| 25 | **The traveller does not swap individual agent picks** (2026-10-29) | A swap would need another audit and usually a Planner re-route (about one re-plan of tokens and SerpAPI calls) and brings back human-in-the-loop. They steer with the prompt, the fields and the over-budget actions. Revisit: "swap among the five options already found" + audit-only pass |
| 26 | **Rating 0–10** | Design "8.2 · Very good"; the agent doubles Google's 0–5 |
| 27 | **Fixed web dev port 55360** | A stable origin to register with Google OAuth |

---

## 18. Open work

Only what is not done. When an item is done, delete it here and record the outcome in the relevant section.

| # | Area | Item | Why | Notes |
| --- | --- | --- | --- | --- |
| 1 | Agent | **Live verification of TP-30 / TP-31 / TP-32 / TP-33–36** (Notion TP-37) | Those changes were checked with mock tools only | Real keys, a real Render deploy and Postgres, including the Postgres trip store on the production database |
| 2 | Agent | **Retention** | Checkpoints and `trips` rows grow forever | Periodic delete of threads and trips older than 30 days, once production volume is known |
| 3 | Agent | **Dollar cost per run** | The run summary logs tokens but not money | Needs per-model prices in config; decide in TP-37 |
| 4 | Agent | **Shared run store** (only before a second instance) | `RunRegistry`, the replay buffer, rate limits and the memory trip store are per process | Redis- or Postgres-backed registry; until then run exactly one instance (§15.4) |
| 5 | Web | **Mobile boards, detail pass** | TP-36 made the start page, live run, finished trip and My trips usable at 375 px | Not yet matched element by element to the Mobile-Live / Mobile-Result boards: "latest two log lines + Show all logs", an "Open map" sheet |
| 6 | Web | **Live check on a phone** (Notion TP-37) | Not yet checked in Safari on a device | iOS Safari: start page, a live run, the finished trip, "Copy link for another device" |
| 7 | Both | **Automated tests** | The test suite was removed (#40); CI runs lint, typecheck and build only | At least the pure parts: Budget Auditor, ranking, `upgradeResultPayload`, the SSE parser, the stream reducer |
