# ai-travel-agent — Open work

> Only work that is not done yet. How the service is built: [`SPEC.md`](./SPEC.md); system design:
> [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md); finished tickets B1–B25:
> [`../../docs/archive/agent-plan-2026-10.md`](../../docs/archive/agent-plan-2026-10.md).
> When an item is done, delete it here and record the outcome in the spec or ARCHITECTURE.md, not in this file.

| # | Item | Why | Notes |
| --- | --- | --- | --- |
| 1 | **Live verification of TP-30 / TP-31 / TP-32 / TP-33–36** (Notion TP-37) | Those changes were checked with mock tools only | Real keys, real Render deploy, Postgres. Includes the Postgres trip store on the production database |
| 2 | **Retention** | Checkpoints and `trips` rows grow forever | Periodic delete of threads and trips older than 30 days, once production volume is known |
| 3 | **Dollar cost per run** | `run summary` logs tokens but not money | Needs per-model prices in config; decide in TP-37 (B7) |
| 4 | **Shared run store** (only before a second instance) | `RunRegistry`, the replay buffer, rate limits and the memory trip store are per process | Redis or Postgres-backed registry; until then run exactly one instance (ARCHITECTURE.md §6.5) |
