---
name: design-check
description: Compare backend or frontend work against the two design PNGs at the repo root. Use when the user says "check the design" in a backend or frontend task, or when a task changes UI, SSE packets, or DRAFT/RESULT shape.
---

# Design check

1. Read both images in full:
   - `design-agents-planning.png` — live run: header bar, destination bar (weather, currency, local time),
     progress stepper (Brief → Flights → Hotel → Transfers → Itinerary → Budget check), Agent Chat with
     "Confirmed" decision chips and callouts, Trip Overview (budget bar, selected flight/hotel, map, day by day).
   - `design-trip-overview.png` — finished trip: budget-approved card, Agent Chat summary ("Confirmed by the
     agents"), Selected Flights with transfers, Selected Hotel, Map with day panel, Day by day cards.
2. Read only the matching spec section (`apps/web/SPEC.md`, or `apps/agent/SPEC.md`) and `ARCHITECTURE.md` §4.6 / §6 if packets are involved.
3. Frontend: list every element in the design the task touches and confirm the component, its data source
   (packet field) and its states exist. Backend: for each visible value (e.g. "saves $80", "Day 4 of 5",
   "try 1 of 2", "1 USD = 0.92 EUR") confirm which packet field supplies it.
4. Report mismatches as a short list: design says X, spec/code says Y, proposed resolution.
   The design wins over the spec; update the spec in the same change if you follow the design.
5. Check the same screen at 375 px when the task touches layout (the e2e `mobile` project, or a screenshot).
