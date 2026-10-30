# AI Travel Planner

Describe a trip in one sentence and five AI agents plan it live in front of you: flights, a hotel, a day-by-day
itinerary on a map, and a cost check against your budget.

> *"5 days in Paris from Tashkent in mid-November, $2,500 all-in. Museums and good food."*

![Live run: five agents planning a trip](./design-agents-planning.png)

## What it does

- **Natural-language input.** One sentence in; the app shows what it understood (destination, home city, days,
  budget, dates) and lets you correct any field before you start.
- **Five cooperating agents.** A Supervisor parses the request, then Flight, Hotel and Itinerary agents build the
  trip and a Budget Auditor checks the total cost.
- **Budget-aware re-planning.** If the trip is over budget, the auditor sends it back for a cheaper search, at most
  twice, and then returns the best result found with a clear warning.
- **Watch it think.** Every step streams to the browser live: an agent chat with plain-language decisions, progress,
  and the trip taking shape as it is built.
- **A finished trip you can use.** Flights, hotel, airport transfers, per-day weather, an interactive map and a cost
  breakdown, plus a destination bar with live weather, currency rate and local time.
- **Resilient runs.** A run is not tied to your connection. If the stream drops it reconnects and replays what it
  missed, and a failed run resumes from its last checkpoint instead of starting over.
- **My trips and usage limits.** Optional Google sign-in saves finished trips to your account. Each account gets 3
  trip plans (`USER_MAX_RUNS`), shown in a card above the Plan button; resuming a stopped trip is free.

![A finished trip](./design-trip-overview.png)

## How it works

```mermaid
flowchart LR
  Web["Next.js web app<br/>(Vercel)"] -- "POST /api/trips" --> Agent["Express agent API<br/>(Render)"]
  Agent -- "SSE: LOG · MESSAGE · PROGRESS · DRAFT · RESULT" --> Web
  Agent --> Graph["LangGraph<br/>5 agent nodes"]
  Graph --> LLM["Claude Opus 5.5<br/>fallback: Sonnet 5.5"]
  Graph --> Tools["SerpAPI flights & hotels<br/>offline mock fallback"]
  Graph <--> CP[("Checkpointer<br/>memory / PostgreSQL")]
```

```mermaid
flowchart LR
  S((Start)) --> SUP[Supervisor] --> FL[Flights] --> HO[Hotels] --> PL[Itinerary planner] --> BA{Budget auditor}
  BA -- "within budget" --> E((End))
  BA -- "over budget, retry < 2" --> FL
  BA -- "over budget, retry = 2" --> E
```

The language model is used only where language understanding is needed (parsing the request, planning each day,
breaking ties between soft preferences). Searching, ranking and the budget audit are deterministic code, which keeps
runs cheaper, faster and testable.

Full design, the stream protocol and the contracts: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Tech stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript 5 (strict), Zod for runtime validation everywhere |
| Monorepo | pnpm workspaces + Turborepo |
| Web | Next.js 16 (App Router), React 19, Tailwind CSS v4, shadcn/ui, Framer Motion, Mapbox GL |
| Agent API | Node.js 24, Express 5, Helmet, `express-rate-limit` |
| Orchestration | LangGraph (`StateGraph`, conditional edges, checkpointer) |
| LLM | Anthropic Claude Opus 5.5 with Claude Sonnet 5.5 fallback, via LangChain |
| Data | SerpAPI (Google Flights / Hotels) with an offline mock engine, Open-Meteo, Wikipedia photos |
| Persistence | PostgreSQL (optional): LangGraph checkpoints and the "My trips" table |
| Deploy | Vercel (web) + Render (agent), CI on GitHub Actions |

## Repository layout

```
apps/
  web/          Next.js app: streaming dashboard, trip form, map, My trips
  agent/        Express + LangGraph service: agents, tools, SSE streaming, auth, storage
packages/
  contracts/    Zod schemas and types shared by both apps (requests, SSE packets, results)
docs/archive/   Finished tickets (history, not kept current)
ARCHITECTURE.md System design and source of truth
```

Each app has its own `SPEC.md` (what it does) and `PLAN.md` (open work).

## Getting started

**Requirements:** Node.js 24 (see `.nvmrc`) and pnpm 10.

```bash
pnpm install
cp apps/agent/.env.example apps/agent/.env       # add ANTHROPIC_API_KEY (the only required secret)
cp apps/web/.env.example apps/web/.env.local     # optional, see below
pnpm dev                                         # starts the agent and the web app
```

Open the URL the web app prints. The agent listens on `http://localhost:4000` by default and the web app finds it
there.

Everything except the Anthropic key is optional and degrades gracefully:

| Not set | What happens |
| --- | --- |
| `SERPAPI_API_KEY` | Flights and hotels come from the offline mock engine (`TOOLS_MODE=auto`) |
| `DATABASE_URL` | Checkpoints and "My trips" are kept in memory and lost on restart |
| `GOOGLE_CLIENT_ID` + `SESSION_SECRET` | No sign-in; everyone is a guest, limited per browser |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | The map shows a placeholder |
| `NEXT_PUBLIC_AGENT_URL` (empty) | The web app runs in UI-only mode with the submit button disabled |

For a local Postgres run `docker compose up -d` in `apps/agent` and set
`DATABASE_URL=postgres://postgres:postgres@localhost:5432/travel`.

### Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the agent and the web app with hot reload |
| `pnpm lint` | ESLint in every package |
| `pnpm typecheck` | TypeScript in every package |
| `pnpm build` | Production build of everything |

CI runs lint, typecheck and build on every pull request.

## API at a glance

| Endpoint | Purpose |
| --- | --- |
| `POST /api/trips` | Start a run; the response is an SSE stream and `X-Thread-Id` names the run |
| `GET /api/trips/:threadId/stream` | Reconnect to a run and replay missed packets (`Last-Event-ID`) |
| `POST /api/trips/:threadId/resume` · `/cancel` | Continue a failed run from its checkpoint · stop a run |
| `GET /api/trips` · `/api/trips/:threadId` | Saved trips and one stored result |
| `GET /api/usage` | How many of the account's plans are left |
| `GET /api/trip-context` | Destination bar: weather, currency rate, local time |
| `GET /health` · `/readyz` | Liveness and readiness |

The browser calls the agent directly, because proxying a long-lived stream through a serverless function would hit
duration limits. The agent is a CORS-restricted public API with per-IP rate limits and a body size cap.

## Deployment

- **Web:** Vercel, root directory `apps/web`. Steps and environment variables: [`apps/web/DEPLOY.md`](./apps/web/DEPLOY.md).
- **Agent:** Render, with `WEB_ORIGIN` listing the web domains. See `ARCHITECTURE.md` §13.

## Contributing

Branch from `main`, keep changes focused, and run `pnpm lint && pnpm typecheck` before opening a pull request. If
behaviour changes, update the relevant `SPEC.md` in the same PR.
