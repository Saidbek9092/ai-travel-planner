# ai-travel-web — Implementation Plan

> Step-by-step plan for building the frontend described in [`SPEC.md`](./SPEC.md)
> (web spec) and [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) (system design).
> Each ticket is one branch / one PR, small enough to review on its own.

---

## Overview

> **No tests for now.** Test tasks, "Tests:" lines and test-only tickets (T16) are out of scope until the user brings tests back.

| Milestone | Tickets | Outcome | Status |
| --- | --- | --- | --- |
| **M1 · Foundation** | T1 – T4 | Monorepo, shared contracts, empty Next.js app with UI kit running on `pnpm dev` | ✅ Done (2026-10-27) |
| **M2 · Data layer** | T5 – T7 | Mock agent, SSE parser and `useAgentStream` hook, fully tested without any UI | ✅ Done (2026-10-27) |
| **M3 · UI** | T8 – T13 | Dashboard and all its components, driven by the mock agent | ✅ Done (2026-10-27) |
| **M4 · Resilience & ship** | T14 – T17 | Failure/resume/deep links, polish, end-to-end tests, CI and Vercel deploy | ✅ Done in code (2026-10-27); T16 dropped (no tests); the Vercel project itself is a manual step, see `DEPLOY.md` |
| **M5 · Chat & top bar** | T18 – T20 | `MESSAGE` packets in the hook, `AgentChat` with "Confirmed" decisions, destination bar with weather, rate and local time | ✅ Done (2026-10-27) |
| **M6 · Design v2** | T21 – T26 | The design's look and live Trip Overview: tokens and layout, `DRAFT` handling, agent board and banners, reconnect / cancel / countdown, mobile layouts, My trips | ✅ Web done (2026-10-28): T21–T24, T26; T25 (mobile) not started |

### Dependency graph

```mermaid
flowchart LR
  T1[T1 Monorepo] --> T2[T2 Contracts]
  T1 --> T3[T3 Next.js scaffold]
  T3 --> T4[T4 UI kit + lib]
  T2 --> T5[T5 Mock agent]
  T2 --> T6[T6 SSE parser]
  T6 --> T7[T7 useAgentStream]
  T5 --> T7
  T4 --> T8[T8 Dashboard shell]
  T7 --> T8
  T8 --> T9[T9 Form]
  T8 --> T10[T10 Terminal logs]
  T8 --> T11[T11 Cards + budget]
  T8 --> T12[T12 Timeline]
  T8 --> T13[T13 Map]
  T9 & T10 & T11 & T12 & T13 --> T14[T14 Failure / resume / deep link]
  T14 --> T15[T15 Polish + a11y]
  T15 --> T16[T16 E2E]
  T16 --> T17[T17 CI + Vercel]
  T2 --> T18[T18 Contracts: MESSAGE + TripContext]
  T18 --> T19[T19 Chat]
  T10 --> T19
  T18 --> T20[T20 Top bar]
  T8 --> T20
  T19 & T20 --> T15
  T4 --> T21[T21 Design tokens + layout]
  T18 --> T22[T22 DRAFT + Trip Overview]
  T21 --> T22
  T22 --> T23[T23 Agent board + banners]
  T7 --> T24[T24 Reconnect / cancel / countdown]
  T22 & T23 --> T25[T25 Mobile layouts]
  T22 --> T26[T26 My trips + share]
```

**Design v2 (M6):** the design (`.context/design`) added a live Trip Overview, an agent board, transfers, per-day weather, run banners and a reconnecting
stream after the first versions of T8–T20 were written. Those tickets keep their scope; T21–T26 apply the design on top of them. Build T21 early
(right after T8) so later components are styled once. Where a ticket below disagrees with §6–§8, §6–§8 win.

**Parallel work:** once T8 is merged, T9–T13 touch separate files and can run in separate
Conductor workspaces at the same time. After T18, T19 and T20 are independent of each other.

**Why a mock agent (T5):** the backend does not exist yet. A small scripted SSE server that speaks
the exact contract lets the frontend be built and tested now — **locally and in CI only**. Deployed
builds don't use it: until the agent is deployed, Vercel runs in UI-only mode (no `NEXT_PUBLIC_AGENT_URL`).
When the real agent lands, only the URL changes. The e2e suite then also runs against the real agent in `TOOLS_MODE=mock`.

### Definition of done (every ticket)

- `pnpm --filter ai-travel-web typecheck lint test` passes (and `build` from T3 on).
- Cross-service types come only from `@ai-travel/contracts`; `process.env` is read only in `lib/env.ts` / `next.config.ts`.
- New behaviour has tests as listed in the ticket.
- If the implementation has to deviate from `SPEC.md`, the spec is updated in the same PR.

Size: **S** ≈ half a day · **M** ≈ 1 day · **L** ≈ 2 days.

---

## M1 · Foundation

### T1 — Monorepo foundation · S · ✅ Done

> Implemented with pnpm 10.34.9 (via Corepack), Turborepo 2.11, Node 24. Conductor config is
> `.conductor/settings.toml` (setup: `corepack enable pnpm && pnpm install`).

**Goal:** one `pnpm install` and `pnpm dev` at the repo root (ARCHITECTURE.md §12).

**Depends on:** —

**Tasks**
- Root `package.json` (`private`, `packageManager: pnpm@<exact>`, scripts `dev/build/test/typecheck/lint` → `turbo run …`, `turbo` dev dependency).
- `pnpm-workspace.yaml` with `apps/*`, `packages/*` and the `catalog` (`typescript`, `zod`, `vitest`).
- `turbo.json` exactly as in ARCHITECTURE.md §12.2 (incl. `build.env` and `dev.passThroughEnv`).
- `tsconfig.base.json` from §12.2.
- `.gitignore` (`node_modules`, `dist`, `.next`, `.turbo`, `.env*` except `.env.example`, `test-results`, `playwright-report`), `.npmrc` if needed.
- Conductor `.conductor/settings.toml`: setup `corepack enable pnpm && pnpm install`, run action `pnpm dev`.
- Written by hand from ARCHITECTURE.md §12 (no `create-turbo`: it adds example apps we'd only delete).
- `.nvmrc`: current Node LTS (Next.js 16 needs ≥ 20.9); `engines.node` in the root `package.json` to match.

**Acceptance**
- Fresh clone → `pnpm install` succeeds; `pnpm build` runs (no packages yet = no-op).
- Lockfile committed.

---

### T2 — Shared contracts package (`@ai-travel/contracts`) · M · ✅ Done

> Zod 4 API (`z.iso.*`, `z.uuid()`); 24 schema tests. Added `DataSourceSchema`, per-packet event schemas
> and `SseEventInput` type.

**Goal:** the single source of types for both apps (ARCHITECTURE.md §5).

**Depends on:** T1

**Tasks**
- `packages/contracts/package.json`: name `@ai-travel/contracts`, `"type": "module"`, `exports` → `dist/index.js` + `dist/index.d.ts`, scripts `build: tsc`, `dev: tsc --watch`, `test`, `typecheck`.
- `src/trip.ts`, `src/sse-events.ts`, `src/index.ts` exactly as specified in SPEC.md §5.1 / §5.2 (incl. the added RESULT fields `origin`, `destination`, `durationDays`, `startDate`).
- `tsconfig.json` extending the base, `module`/`moduleResolution: NodeNext`.
- Tests: blueprint example packets parse; malformed packets (wrong `type`, missing fields, percent > 100, bad coordinates, non-UUID `threadId`) are rejected; `TripRequestSchema` bounds.

**Acceptance**
- `pnpm --filter @ai-travel/contracts build test` passes; `dist/` contains JS + `.d.ts`.
- Remove the `.gitkeep` in `packages/contracts/src`.

---

### T3 — Next.js 16 app scaffold · M · ✅ Done

> Generated with `create-next-app@16.4.3` (`--no-react-compiler --no-agents-md`), kept its defaults:
> Cache Components + Partial Prefetching on, Tailwind via `@tailwindcss/turbopack`, `jsx: react-jsx`.

**Goal:** an empty `ai-travel-web` that starts on the right port and imports the contracts.

**Depends on:** T1 (T2 for the import check)

**How:** generate with the official `create-next-app`, then adapt it to the monorepo. It can't run
inside `apps/web/` (the folder already holds `SPEC.md`, `PLAN.md`, `.gitkeep`s), so generate into a
temporary folder and copy in without overwriting:

```bash
# from the repo root
pnpm create next-app@16 .tmp-web --ts --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-pnpm --skip-install --disable-git --yes
rsync -a --ignore-existing --exclude node_modules .tmp-web/ apps/web/
rm -rf .tmp-web
```

**Tasks — after generating**
- Delete what the monorepo owns or we don't want: nested `pnpm-lock.yaml` / `pnpm-workspace.yaml`
  (move any `onlyBuiltDependencies` entries to the root `pnpm-workspace.yaml`), generated `README.md`,
  any generated `AGENTS.md`, demo SVGs in `public/`, and the demo content of `page.tsx`.
- `package.json`: name `ai-travel-web`, add `@ai-travel/contracts: workspace:*`, `zod: catalog:`,
  remaining deps from SPEC.md §3, scripts from SPEC.md §3 (`dev` on `${CONDUCTOR_PORT:-3000}`, `lint: eslint .`, `typecheck`, `test`).
- `tsconfig.json` extends `../../tsconfig.base.json` with the options in §4.2.
- `next.config.ts` as in §4.1 (phase-based `NEXT_PUBLIC_AGENT_URL` default for `next dev` only).
- Keep the generated Tailwind v4 setup (`@tailwindcss/turbopack` loader, `globals.css`) and ESLint flat config.
- `layout.tsx`: Geist Sans/Mono, metadata, `<html lang="en">`. Placeholder `page.tsx` renders a value
  typed from `@ai-travel/contracts` (proves the workspace link).
- Vitest + jsdom + React Testing Library (`vitest.config.ts`, `test/setup.ts`) with one smoke test.
- `.env.example` with `NEXT_PUBLIC_AGENT_URL`, `NEXT_PUBLIC_MAPBOX_TOKEN` (both commented, both optional).
- `pnpm install` once from the repo root; remove the `.gitkeep` files in folders that now have content.

**Acceptance**
- `pnpm dev` from the root serves the page on `$CONDUCTOR_PORT` (or 3000) with Turbopack.
- `pnpm --filter ai-travel-web build typecheck lint test` passes.

---

### T4 — UI kit, design tokens and `lib/` helpers · S · ✅ Done

> shadcn 4 default preset is `base-nova` (Base UI primitives); `field` used instead of the empty `form`.
> Web turns off `exactOptionalPropertyTypes` (generated shadcn code). 14 web tests.

**Goal:** everything components will need, before any component exists.

**Depends on:** T3

**Decision:** no custom branding — shadcn defaults (`base-nova`, `neutral`, light theme), Geist fonts,
text wordmark "AI Travel Planner" + lucide `Plane` icon (SPEC.md §8).

**Commands**

```bash
cd apps/web
pnpm dlx shadcn@latest init -d --no-monorepo -y   # default preset base-nova, base colour neutral
pnpm dlx shadcn@latest add card input textarea field label progress badge \
  scroll-area skeleton alert separator tooltip sonner -y
```

**Tasks**
- `<Toaster />` (sonner) and `TooltipProvider` in `layout.tsx`; header with the wordmark.
- `lib/utils.ts`: `cn()` (generated by shadcn), plus `formatUsd(n)`, `formatTime(iso)` (`HH:mm:ss`), `formatDate(iso)`.
- `lib/env.ts`: Zod-validated `env` → `agentUrl: string | null`, `mapboxToken: string | null` (§4.1).
- Agent colour map (`AgentName` → Tailwind classes) and status label map (`TripStatus` → text) in one place (`lib/labels.ts`).
- Tests for formatters and `env` parsing (set / unset / invalid URL).

**Acceptance**
- shadcn components render in the placeholder page; formatter and env tests pass.

---

## M2 · Data layer

### T5 — Mock agent + packet fixtures · M

**Goal:** develop and test the whole UI without the backend.

**Depends on:** T2

**Tasks**
- `test/fixtures/packets.ts`: builders (`logPacket()`, `progressPacket()`, `resultPacket()`) that run every fixture through `SseEventSchema.parse`, so fixtures cannot drift from the contract.
- Scenarios as packet scripts with delays:
  - `happy` — full run Paris from Tashkent, within budget;
  - `overBudget` — two re-plan rounds, completed with a warning;
  - `mockData` — results with `source: 'mock'`;
  - `failed` — stream ends with `RESULT { status: 'failed' }`;
  - `dropped` — stream closes without a `RESULT`;
  - `invalidPacket` — one malformed packet in the middle;
  - `validationError` / `rateLimited` — JSON `400` / `429` before the stream.
- `test/mock-agent/server.ts`: small Node HTTP server implementing `POST /api/trips`, `POST /api/trips/:id/resume`, `GET /api/trips/:id`, CORS + `Access-Control-Expose-Headers: X-Thread-Id`, `: ping` heartbeats. Scenario picked by a keyword in the prompt (e.g. `#fail`) or `MOCK_SCENARIO` env.
- Script `pnpm --filter ai-travel-web mock-agent` on the agent port (`CONDUCTOR_PORT + 1` / 4000).

**Acceptance**
- `curl -N -X POST …/api/trips` prints a valid SSE stream for every scenario.
- Dev-only: not imported by any file under `src/`.

---

### T6 — SSE parser (`lib/sse.ts`) · S

**Goal:** framework-free `readSseData()` (SPEC.md §5.1).

**Depends on:** T2

**Tasks**
- `TextDecoderStream` + buffer, split on blank lines (`\n\n` and `\r\n\r\n`), join `data:` lines, skip `:` comments and `id/event/retry` fields, stop on `signal` abort, release the reader in `finally`.
- `test/sse.test.ts`: fixture stream split at **every** byte offset; `\r\n`; multi-line `data:`; heartbeats ignored; multibyte UTF-8 (e.g. "Tashkent → Paris") split mid-character; trailing event without final blank line.

**Acceptance**
- All parser tests pass; no React/Zod imports in the module.

---

### T7 — `useAgentStream` hook · L

**Goal:** the single client-side source of run state (SPEC.md §5.2).

**Depends on:** T5, T6

**Tasks**
- Exported pure reducer + action types: `START`, `CONNECTED(threadId)`, `PACKET(event)`, `STREAM_ENDED`, `HTTP_ERROR(code, message)`, `ABORTED`, `RESET`.
- Monotonic progress (`max(previous, next)`), `RESULT` sets final status, end-without-RESULT → `failed` "Connection lost".
- Hook: `start`, `resume`, `cancel`, `reset`; `AbortController` in a ref, aborted on new run and on unmount; runs only from user actions (Strict-Mode safe).
- Reads `X-Thread-Id`; writes `?trip=<id>` with `history.replaceState`.
- `JSON.parse` + `SseEventSchema.safeParse` per packet; invalid → dropped with `console.warn` in dev.
- Error mapping table (`VALIDATION_ERROR`, `RATE_LIMITED`, `NOT_FOUND`, `INTERNAL`, network error) → user-facing messages.
- Accepts `initial` (`threadId`, `result`) for the deep-link case.
- Tests: `test/useAgentStream.reducer.test.ts` and `test/useAgentStream.test.tsx` (mocked `fetch` returning `ReadableStream`s built from T5 fixtures, every scenario).

**Acceptance**
- Every T5 scenario ends in the expected `status`, `logs`, `progress`, `result`, `error`.
- A temporary debug page (removed in T8) can run a real trip against the mock agent.

---

## M3 · UI

### T8 — Dashboard shell, page and progress · M

**Goal:** the screen skeleton wired to the hook (SPEC.md §6, §9).

**Depends on:** T4, T7

**Tasks**
- `page.tsx` (Server Component) renders `<TripDashboard initialThreadId={null} initialResult={null} />` (deep link comes in T14).
- `TripDashboard.tsx` (`'use client'`): owns `useAgentStream` + `activeDay`; two-column layout at `lg`, stacked below; header.
- Progress bar + status label (from T4 label map), Cancel button while `connecting`/`streaming`.
- Right column states: empty state when `idle`, skeletons while `streaming`, slots for result components.
- UI-only mode (`env.agentUrl === null`): info banner "Preview — the planning agent isn't connected yet", submit disabled, `start`/`resume` no-ops.
- Slots for form / logs / cards / timeline / map with temporary placeholders so T9–T13 can be built in parallel.

**Acceptance**
- With a stub submit button, a run against the mock agent moves the progress bar to 100 and swaps skeletons for placeholders.
- `next build && next start` without `NEXT_PUBLIC_AGENT_URL` shows the UI-only banner and never calls `localhost`.
- Layout correct at 375 px, 768 px, 1280 px.

---

### T9 — `TripInputForm` · M

**Depends on:** T8 · Spec: SPEC.md §7

**Tasks**
- `react-hook-form` + `zodResolver(TripRequestSchema)`; `prompt` textarea with 1,000-char counter; collapsible "Details": `origin`, `budget`, `durationDays`, `startDate` (≥ today).
- Strip empty optional fields (no `""` / `NaN` in the payload); number inputs coerced correctly.
- 3 example-prompt chips; ⌘/Ctrl + Enter submits; disabled while a run is active.
- Tests: validation messages, payload shape, disabled state, keyboard submit.

**Acceptance:** submitting starts a real run against the mock agent.

---

### T10 — `AgentTerminalLogs` · M

**Depends on:** T8 · Spec: SPEC.md §7

**Tasks**
- Dark terminal panel in `ScrollArea` (~320 px), line format `HH:mm:ss  [step]  Agent  message`, agent colours, `warn`/`error` colours **plus** an icon/prefix (not colour alone).
- Framer Motion line entrance (≤150 ms), disabled under `prefers-reduced-motion`.
- Stick-to-bottom auto-scroll; "Jump to latest" button when the user scrolled up; blinking cursor while `streaming`.
- `role="log"`, `aria-live="polite"`.
- Tests: rendering of levels, auto-scroll behaviour, role/aria.

**Acceptance:** logs stream smoothly through the `overBudget` scenario (re-plan steps visible).

---

### T11 — `FlightHotelCards` + budget summary · M

> Design update: flight legs and layovers, transfer rows, hotel photo / area / check-in / 0–10 rating, and `BudgetMeter` with the passes table are specified in §7; build them here. Budget breakdown includes transfers.

**Depends on:** T8 · Spec: SPEC.md §6, §7

**Tasks**
- Flight and hotel card grids; index `0` highlighted with "Selected" badge.
- Hotel total = `pricePerNight × durationDays`; half-star rating; "Estimated" badge + tooltip for `source: 'mock'`.
- Budget summary in `TripDashboard`: `totalCost` vs `budget` bar, display-only breakdown, amber `Alert` per warning.
- Staggered entrance animation.
- Tests: selected badges, hotel total, mock badge, over-budget warning rendering.

**Acceptance:** `happy`, `overBudget` and `mockData` scenarios render correctly.

---

### T12 — `ItineraryTimeline` · S

> Design update: day tabs with date and weather, "drafting" / "waiting" days and per-day transfers (§7) replace the plain vertical timeline.

**Depends on:** T8 · Spec: SPEC.md §7

**Tasks**
- Vertical timeline "Day N — title" with places; day items are buttons; click toggles `activeDay`; active styling + focus ring.
- Tests: selection callback, toggle off, keyboard activation.

**Acceptance:** selecting a day updates `activeDay` in the dashboard (visible to the map in T13).

---

### T13 — `MapboxViewer` · L

> Design update: add the hotel marker, faded markers for other days and the legend (§7).

**Depends on:** T8 · Spec: SPEC.md §7

**Tasks**
- `next/dynamic` with `ssr: false` + `Skeleton` fallback; `mapbox-gl` CSS imported in the component.
- `react-map-gl/mapbox` map; numbered markers coloured per day; per-day `LineString` route layer.
- `fitBounds` to all places on result and to the active day on change (padding 48, animated); popup with place name + "Day N".
- Placeholder card listing places when there is no token or no places.
- Mapbox token: create a URL-restricted public token (localhost + Vercel domains).
- Tests: placeholder path (no token); GeoJSON/bounds helper functions as pure unit tests (WebGL is not tested in jsdom).

**Acceptance:** map follows timeline selection; no hydration warnings; page works without a token.

---

## M4 · Resilience & ship

### T14 — Failure, resume and deep links · M · ✅ Done

**Depends on:** T9–T13 · Spec: SPEC.md §5.3, §6

**Tasks**
- `page.tsx`: skip the fetch in UI-only mode; otherwise read `searchParams` (Promise in Next.js 16 — must be awaited), `fetchTripResult(threadId)` → `GET /api/trips/:id` with `cache: 'no-store'`, `null` on any error; pass `initialThreadId` / `initialResult`.
- Completed deep link → results render immediately; unfinished → "Resume" button.
- Failed state: destructive `Alert` with `error`, `threadId` (copy button) and Resume; `dropped` scenario → "Connection lost" + Resume.
- Pre-stream HTTP errors (`400`, `429`) → inline form error / toast; `aborted` shows no error.
- `app/error.tsx` and `app/not-found.tsx` boundaries.
- Tests: each failure scenario's UI; resume flow against the mock agent.

**Acceptance:** reloading during and after a run never loses a completed result; every failure has a visible next step.

---

### T15 — Polish, accessibility and performance · M · ✅ Done (axe: 0 serious at 375/768/1280/1536 px and Lighthouse idle page perf 93 / a11y 100 / best-practices 100 / SEO 100, both checked before the tests were removed)

**Depends on:** T14

**Tasks**
- Consistent animation timings (≤300 ms) and `prefers-reduced-motion` across all components.
- Accessibility pass: labels, focus order, focus return after submit/result, contrast, axe check (`vitest-axe` or Playwright axe) with zero serious issues.
- Responsive pass at 375 / 768 / 1280 / 1536 px; long names and 30-day itineraries don't break layout.
- Metadata (title, description, Open Graph), favicon.
- Bundle check: map code only in its own chunk; Lighthouse ≥ 90 for performance and accessibility on the idle page.

**Acceptance:** checklist above signed off with screenshots in the PR.

---

### T16 — End-to-end tests (Playwright) · M · ⏹ Dropped (the app has no tests for now)

**Depends on:** T15

**Tasks**
- `playwright.config.ts` with `webServer` starting the mock agent (T5) and `next start`, with `NEXT_PUBLIC_AGENT_URL` set explicitly to the mock agent.
- One spec for UI-only mode (build without `NEXT_PUBLIC_AGENT_URL`): banner visible, submit disabled.
- `test/e2e/trip.spec.ts`: submit → logs appear → progress hits 100 → cards, timeline and map/placeholder render.
- Additional specs: over-budget warning, failed + resume, rate-limit message, deep-link reload.
- Once the real agent exists: a second project that runs the same spec against it with `TOOLS_MODE=mock`.

**Acceptance:** `pnpm --filter ai-travel-web test:e2e` passes locally and headless in CI.

---

### T17 — CI and Vercel deployment · S · ✅ CI + `vercel.json` done; creating the Vercel project and env vars is manual (`DEPLOY.md`)

**Depends on:** T16

**Tasks**
- GitHub Actions: pnpm cache, `pnpm install --frozen-lockfile`, `pnpm turbo run lint typecheck test build`, Playwright job.
- Vercel project `ai-travel-web`: root `apps/web`, build `turbo run build`, Ignored Build Step `npx turbo-ignore`.
- Env vars: `NEXT_PUBLIC_MAPBOX_TOKEN` for Preview + Production. **Do not set `NEXT_PUBLIC_AGENT_URL`** until
  the agent is deployed — previews and production run in UI-only mode.
- Preview deployments per PR; add the preview domain pattern to the Mapbox token.
- Later (when the backend ships): set `NEXT_PUBLIC_AGENT_URL`, add the Vercel domains to the agent's `WEB_ORIGIN`, redeploy.

**Acceptance:** merging to `main` deploys production; PRs get previews showing the UI with the "agent not connected" banner; CI is green.

---

## M5 · Chat & top bar

> Two features the original blueprint did not cover: a friendly chat with confirmed decisions, and a top bar
> with the destination's weather and exchange rate. Design: ARCHITECTURE.md §4.6, §5.2–§5.3, §7.1. The agent
> side is in [`../agent/PLAN.md`](../agent/PLAN.md), tickets B21–B23. Both new components ship after the mock agent is extended,
> so they can be built before the backend work lands.

### T18 — Contracts: design alignment, chat messages and trip context · S · ✅ Contracts done

**Goal:** the shared schemas for the design's data. *Same as agent B21 — one PR, not two.*

**Depends on:** T2

**Tasks**
- Contracts: done — `packages/contracts` has `MESSAGE`, `DRAFT`, the richer flight / hotel / transfer / day-weather types, `PROGRESS` detail / pass / run, `LOG.kind`, `RESULT` passes / suggestions and `trip-context.ts` (see agent B21 and ARCHITECTURE.md §5).
- Web side of the same PR (ARCHITECTURE.md §12.6): `useAgentStream` state gains `messages`, `decisions` and `draft`; the reducer handles `MESSAGE` and `DRAFT` so the app keeps type-checking.
- `test/fixtures/packets.ts`: `messagePacket()`, `draftPacket()` and `tripContextFixture()` builders that run through the contracts schemas, plus a Paris `ResultPayload` fixture matching the design (flight via Istanbul, two transfers, five days, two passes).

**Acceptance**
- `pnpm typecheck` passes for both apps; the reducer test covers `MESSAGE` append and `DRAFT` merge.

---

### T19 — `AgentChat` + `MESSAGE` handling · M · ✅ Done

**Goal:** a conversation view where agents talk in plain language and confirmed decisions stand out (SPEC.md §7, ARCHITECTURE.md §4.6).

**Depends on:** T10, T18

**Tasks**
- Extend the mock agent (T5): `MESSAGE` packets in every scenario (`happy` confirms `trip, itinerary, flight, hotel, transfers, budget`; `overBudget` proposes flight/hotel/transfers in the first pass with an `Over budget` callout, then confirms them in the re-plan pass; `failed` has an ordinary "could you tell me…" message and no decision).
- `lib/labels.ts`: `decisionLabels: Record<DecisionTopic, string>` and display names per `AgentName`.
- `hooks/useStickToBottom.ts`: extract the auto-scroll / "Jump to latest" logic from `AgentTerminalLogs` and use it in both components.
- `components/AgentChat.tsx` as specified in SPEC.md §7: agent name + time + text; `decision !== null` → "Confirmed" badge with the topic label, check icon and accent border (not colour alone); typing indicator while `streaming`; `role="log"` with `aria-label="Conversation"`.
- `TripDashboard`: chat above the terminal in the left column; the terminal becomes a collapsed "Technical log" section (open by default in dev).
- Tests: ordinary vs decision rendering, badge text per topic, indicator only while streaming, auto-scroll shared hook, reducer.

**Acceptance:** the `happy` scenario shows six "Confirmed" messages; `overBudget` shows none for flight/hotel/transfers until the re-plan pass.

---

### T20 — Top bar: weather, currency and local time · M · ✅ Done

**Goal:** show the destination, current weather, currency rate and local time under the header (SPEC.md §5.4, §7; ARCHITECTURE.md §7.1).

**Depends on:** T8, T18

**Tasks**
- Extend the mock agent (T5): `GET /api/trip-context` with fixtures; keywords for `#noweather`, `#norate`, `#unknowncity` (404) scenarios.
- `hooks/useTripContext.ts`: `fetch` + `TripContextSchema.safeParse`, `AbortController` per destination, module-level cache per destination + origin, silent on errors; guarded no-op when `env.agentUrl === null`.
- `lib/labels.ts`: weather `icon` → lucide icon map; formatters for temperature (`Intl.NumberFormat` unit `celsius`) and rate (`1 USD = 0.92 EUR`). `lib/time.ts`: local time and the difference to the origin zone.
- `components/TopBar.tsx` as specified in SPEC.md §7; rendered by `TripDashboard` under the header with `draft.destination ?? result?.destination` (so it appears during the run) and `draft.origin`.
- Tests: hook (loading → ready, error → hidden, 404, destination change aborts the previous call), component (a `null` chip is hidden, both `null` renders nothing, skeleton while loading, `aria-label`s).

**Acceptance:** in the `happy` scenario the bar appears right after the first `DRAFT` and shows place, temperature, currency and local time; with `#noweather` only the other chips remain; the run is never affected by a failing lookup.

---

## M6 · Design v2

> The look and the live behaviour from the design project (`.context/design`): Foundations, Components, Web-Live, Web-Trip, States, Mobile-Live,
> Mobile-Result. The agent side is B24 – B25 in [`../agent/PLAN.md`](../agent/PLAN.md). Extend the mock agent with `DRAFT`, `PROGRESS.detail` /
> `pass` / `run`, checkpoint log rows, a dropped-stream scenario (`#drop`) and a rate-limit scenario (`#ratelimit`) as each ticket needs them.

### T21 — Design tokens and layout shell · M · ✅ Done

**Goal:** the "Departure board" look and the two-column live layout (SPEC.md §6, §8).

**Depends on:** T4, T8

**Tasks**
- `globals.css`: override the shadcn variables with the §8 token table; add `--live`, `--success`, budget-segment and day colours; Geist Sans / Mono via `next/font`; radius and control-height scale.
- `lib/labels.ts`: agent display names and colours (`Planner` → "Itinerary Planner"), day colours, phase labels, `ratingWords`.
- `TripDashboard`: header with nav ("Plan a trip", "My trips"), `TripActions`, `TopBar` slot, left / right columns as in §6 with empty states; form collapse to the brief summary.
- Tests: token contrast check (labels on ground ≥ 4.5:1) as a unit test over the hex values; layout renders both columns at `lg` and stacked below.

**Acceptance:** `pnpm dev` shows the design's palette and type; no raw colours outside `globals.css` and `lib/labels.ts`.

---

### T22 — `DRAFT` handling and the live Trip Overview · L · ✅ Done

> Mock agent `happy` now plays the design's run: pass 1 over budget → re-plan with flight / hotel / transfers confirmations → weather prep →
> days 1…5 drafted one by one → budget approved. Without a Mapbox token the map is a schematic plot (`SchematicMap`).

**Goal:** the right column fills in as agents decide (SPEC.md §6, §7).

**Depends on:** T18, T21 (and T11 – T13 for the cards, timeline and map)

**Tasks**
- Reducer: `DRAFT` merge, `decisions` map (done in T18); `TripOverview` reads `result ?? draft`.
- `BudgetMeter` with breakdown, "Final check pending", and the passes table; `FlightHotelCards` with legs, transfers and "Confirmed" tags; `ItineraryTimeline` day tabs with "drafting" / "waiting"; map follows `activeDay`.
- Mock agent: `DRAFT` after each node and one per planner day.
- Tests: `test/BudgetMeter.test.tsx`, overview sections appear one by one from a packet fixture, "Confirmed" only after the decision message, day state "drafting" from `progress.detail`.

**Acceptance:** in the `happy` scenario the overview goes empty → flight → hotel + transfers → days 1…5 → final, matching the Web-Live and Web-Trip boards.

---

### T23 — Agent board, run banners and run details · M · ✅ Done

> The board, run details and terminal open from the chat's "Technical log" button (the design has no board in the column). "Trip ready" is a toast.
> `#fallback` scenario shows the fallback-model banner.

**Goal:** the status furniture around the chat (SPEC.md §7).

**Depends on:** T21, T22

**Tasks**
- `AgentBoard` (derived status per pass), `RunBanners` (fallback model, estimates, over budget, paused, reconnecting, trip ready), `RunDetails`, phase chips and the ETA in the progress area.
- Over-budget buttons call `start({ ...lastRequest, budget | durationDays })`; "Start over" = `start(lastRequest)`.
- Tests: `test/AgentBoard.test.tsx`, `test/RunBanners.test.tsx` (see §10).

**Acceptance:** the `overBudget` scenario shows the board flipping to "pass 2", the warn callout in the chat, and the "Over budget after 2 re-plans" banner with its three actions at the end.

---

### T24 — Reconnect, cancel and rate-limit countdown · M · ✅ Done

> Mock agent keeps runs in a registry: `#drop` cuts the connection mid-run (and refuses the first two reattaches so the banner is visible),
> `#dropped` loses the run (reconnect → 404 → "Connection lost"), `#ratelimit` returns 429 with `retryAfterSeconds: 42`.

**Goal:** the resilience states from the design that depend on the connection (SPEC.md §5.2, §7).

**Depends on:** T7, agent B25 (mock agent first)

**Tasks**
- `readSseEvents` returns ids; hook: `reconnecting` state, backoff, `Last-Event-ID` resume, dedupe by id, `reconnectNow`, `cancel` calls the cancel route, `retryAt` from `retryAfterSeconds`.
- `useCountdown`; `TripInputForm` countdown button; reconnect banner.
- Mock agent: replay buffer with ids, `GET …/stream`, `POST …/cancel`, `#drop` and `#ratelimit` scenarios.
- Tests: hook reconnect (dropped stream → replay → no duplicate lines), 404 and five failures → failed, countdown with fake timers, cancel route called once.

**Acceptance:** kill the connection mid-run in the browser's network panel — the banner shows "Reconnecting · attempt 1", the log catches up, no line appears twice.

---

### T25 — Mobile layouts · M · ⏸ Not started (web first, by request)

**Goal:** the Mobile-Live and Mobile-Result boards (SPEC.md §6).

**Depends on:** T22, T23

**Tasks**
- Live run: brief title, progress, compact agent list, latest two log lines + "Show all logs", "Stop run".
- Trip ready: headline with total and day tabs, selected day's stops, flight / hotel summary rows, "Open map" sheet, "Share trip".
- 44–48 px touch targets; no horizontal scroll at 390 px.
- Tests: component tests with a 390 px viewport class; Playwright mobile project in T16.

**Acceptance:** both mobile screens match the boards at 390 × 844.

---

### T26 — My trips and share · S · ✅ Done

**Goal:** the header's "My trips" and "Share trip" (SPEC.md §7).

**Depends on:** T14, T22

**Tasks**
- `useTripHistory` (localStorage, max 20), `/trips` page, "No longer available" state for a 404 trip.
- `TripActions` Share (clipboard + toast), Re-plan (`start(lastRequest)`).
- Tests: `test/useTripHistory.test.tsx`, share copies the link, the page lists newest first.

**Acceptance:** finishing a trip adds it to `/trips`; the shared link reopens its results.

---

## Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | Next.js 15 or 16? | **Next.js 16** (current stable line; 15 only receives backports). Turbopack by default, ESLint CLI instead of `next lint`, async-only request APIs. Specs updated. |
| 2 | Vercel previews before the backend exists | **UI only.** No hosted mock agent; deployed builds run without `NEXT_PUBLIC_AGENT_URL` and show an "agent not connected" banner. The mock agent stays local/CI-only. |
| 3 | Branding | **The design's "Departure board" system** (§8): custom palette over the shadcn `base-nova` variables, Geist fonts, text wordmark + lucide `Route` icon in a navy square. Replaces the earlier "shadcn defaults, no branding" decision. |
| 4 | Chat vs terminal | **Separate `MESSAGE` packet.** `LOG` stays technical for the terminal; the chat shows friendly text and a "Confirmed" badge for decisions. The terminal becomes a collapsible "Technical log". |
| 5 | When the destination bar loads | **As soon as the destination is known**: from the first `DRAFT` (right after the Supervisor) during a run, or from the `RESULT` when a stored trip reopens. Straight from the browser to the agent. Replaces "after the `RESULT`" — the design shows the bar while agents plan. |
| 6 | Lookup failure | **Hide the chip.** No mock weather or rate — fake values in the header would look real. |
| 7 | Live Trip Overview | **New `DRAFT` packet** (the trip so far) instead of rebuilding it from `LOG`/`MESSAGE` text. Sections show a "Confirmed" tag when their decision message has arrived. |
| 8 | Dropped stream | **Reconnect and catch up** (`Last-Event-ID`), as in the design's "Stream dropped — reconnecting" state. The run no longer dies with the connection (agent B25). |
| 9 | Accounts, avatar, run history | **Not in v1.** The design's avatar is left out; "My trips" is a `localStorage` list of thread ids. Revisit with auth. |
| 10 | Stack labels in the design | The design boards say "Next.js 15" and "OpenAI GPT-4o". The repo stays on **Next.js 16** and **Anthropic Claude**; those labels are stale in the design. |
| 11 | Hotel rating scale | **0–10** (design "8.2 · Very good"); the agent doubles Google Hotels' 0–5. |
