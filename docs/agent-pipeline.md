# Coder Agent + AI Reviewer pipeline

Automates: Notion task → Coder Agent opens a PR → CI + AI Reviewer Agent →
auto-merge on approval, or feedback looped back to the Coder Agent (max 3
rounds, then flagged `needs-human`).

```
Notion task  ──webhook bridge──▶  repository_dispatch(notion-task)
                                            │
                                            ▼
                              agent-implement.yml (Coder Agent)
                                            │ opens PR, label "ai-agent"
                                            ▼
                     ┌──────────────────────┴──────────────────────┐
                     ▼                                             ▼
              ci.yml (lint/typecheck/build)          agent-review.yml (AI Reviewer)
                     │                                             │
                     └──────────────────────┬──────────────────────┘
                                   both pass │  either fails
                                             ▼                ▼
                                       auto-merge      agent-fix.yml re-invokes
                                                        the Coder Agent on the
                                                        same branch (max 3x)
```

## Files

- `.github/workflows/agent-implement.yml` — Coder Agent. Takes a ticket
  (from Notion via `repository_dispatch`, or `workflow_dispatch` for a manual
  run), follows `.claude/skills/implement-ticket/SKILL.md`, commits, opens a
  PR labeled `ai-agent`, and requests auto-merge.
- `.github/workflows/agent-review.yml` — AI Reviewer Agent. Runs on every
  push to an `ai-agent`-labeled PR, reviews the diff against
  `PROJECT.md`/`ARCHITECTURE.md`, and submits a real `gh pr review` (approve
  or request-changes) using the default `GITHUB_TOKEN`.
- `.github/workflows/agent-fix.yml` — on `REQUEST_CHANGES`, re-invokes the
  Coder Agent with the reviewer's comment as input, pushing a fixup commit
  to the same PR. Stops after 3 rounds and adds `needs-human`.

All three use Anthropic's official [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action).

## One-time setup (you need to do these — none of them are code)

1. **Secrets** (repo Settings → Secrets and variables → Actions):
   - `ANTHROPIC_API_KEY` — used by both agents.
   - `AGENT_PAT` — a fine-grained PAT (contents: write, pull requests: write)
     from a real GitHub account. Required because a PR opened with the
     default `GITHUB_TOKEN` does **not** trigger `pull_request` workflows —
     `agent-review.yml` would never fire. Using a PAT for the *open* and
     *fixup-push* steps avoids that; the *review* step deliberately keeps
     using the default token, so the review comes from a different identity
     than the PR author (needed for required-approval branch protection,
     below).

2. **Repo setting**: Settings → General → Pull Requests → check "Allow
   auto-merge". (I tried to flip this via the API from here and it was
   correctly blocked as a shared-settings change outside a PR — this one's
   yours to click.)

3. **Branch protection on `main`**: Settings → Branches → add a rule
   requiring:
   - Status check `check` (the existing CI job)
   - 1 approving review (the AI Reviewer's `gh pr review --approve` satisfies
     this, since it's a different identity from the PR author)

   With both set, GitHub auto-merges the PR itself the moment they're green —
   no extra workflow needed for that part.

4. **Notion → GitHub bridge**: Notion's native "Send webhook" automation
   can't be reshaped into GitHub's `repository_dispatch` body on its own, so
   it needs a thin relay. A Vercel Edge Function / Cloudflare Worker is
   enough:

   ```ts
   // relay for Notion automation → GitHub repository_dispatch
   export default async function handler(req: Request) {
     const page = await req.json(); // Notion's webhook payload
     const props = page.data.properties;
     await fetch("https://api.github.com/repos/saidbek9092/ai-travel-planner/dispatches", {
       method: "POST",
       headers: {
         Authorization: `Bearer ${process.env.GH_PAT}`,
         Accept: "application/vnd.github+json",
       },
       body: JSON.stringify({
         event_type: "notion-task",
         client_payload: {
           ticket_id: page.data.id,
           title: props.Name.title[0].plain_text,
           body: props.Description?.rich_text?.[0]?.plain_text ?? "",
         },
       }),
     });
     return new Response("ok");
   }
   ```

   In Notion: Automations → "When status changes to Ready for Dev" → "Send
   webhook" → the relay's URL. Adjust property names to your actual Notion
   schema.

## Testing without Notion wired up yet

Run the Coder Agent by hand from the Actions tab (`workflow_dispatch` on
`agent-implement.yml`) with a ticket id, title and body — e.g. lift one row
straight out of `PROJECT.md` §12. That exercises the whole chain (PR → CI +
review → merge-or-fix-back) without needing the Notion bridge at all.

## Guardrails already in the workflows

- One ticket = one PR = one branch (`implement-ticket` skill's own rule).
- The Coder Agent only touches the `PROJECT.md`/`ARCHITECTURE.md` sections
  the ticket names, and runs `design-check` first for UI/packet changes.
- The reviewer re-runs lint/typecheck itself rather than trusting the PR.
- Fix loop is capped at 3 rounds; a disputed review (reviewer wrong, not the
  code) stops the loop instead of forcing a bad fix, via `AGENT_STATUS:
  DISPUTED`.
- `ci.yml` is untouched — this sits alongside it, not instead of it.
