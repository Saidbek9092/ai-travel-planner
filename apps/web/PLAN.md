# ai-travel-web — Open work

> Only work that is not done yet. How the app is built: [`SPEC.md`](./SPEC.md); system design:
> [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md); finished tickets T1–T26:
> [`../../docs/archive/web-plan-2026-10.md`](../../docs/archive/web-plan-2026-10.md).
> When an item is done, delete it here and record the outcome in the spec or ARCHITECTURE.md, not in this file.

| # | Item | Why | Notes |
| --- | --- | --- | --- |
| 1 | **Unit tests** for `lib/sse.ts` and the `useAgentStream` reducer | Only the Playwright smoke test (TP-33 D17) covers the web app today | Vitest; SSE chunks split at arbitrary byte boundaries, replayed packets deduped by id, `HTTP_ERROR` → countdown |
| 2 | **Mobile boards, detail pass** | TP-36 made the start page, live run, finished trip and My trips usable at 375 px (e2e `mobile` project) | Not yet matched element by element to the Mobile-Live / Mobile-Result boards: "latest two log lines + Show all logs", an "Open map" sheet |
| 3 | **Live check on a phone** (Notion TP-37) | The e2e mobile project runs Chromium at 375 px, not Safari on a device | iOS Safari: start page, a live run, the finished trip, "Copy link for another device" |
