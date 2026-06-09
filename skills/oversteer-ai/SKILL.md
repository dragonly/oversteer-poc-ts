---
name: oversteer-ai
description: Use the oversteer POC CLI to read plans created by humans, break them into tasks, work and update those tasks, and comment on plans/tasks. Use whenever the agent is asked to "work on an oversteer plan", "pick up a task from oversteer", "check oversteer for what to do", "update the oversteer task", "comment on the plan/task in oversteer", or any variation that involves the `oversteer` command-line tool. Covers only the current POC surface (plan/task/comment over Postgres); there is no claim/escalate/steering/events yet.
---

# oversteer-ai

oversteer.ai is an AI execution-orchestration platform. This is its **POC**: humans create
**plans** (goals/intent) in a web UI; **agents use this `oversteer` CLI** to read plans, break
them into **tasks**, work the tasks, and **comment** on plans/tasks. Postgres stores everything.

You (the agent) interact with oversteer **only through the `oversteer` CLI**. Always pass `--json`
when you need to parse output programmatically; omit it for human-readable text.

## The model (what exists in the POC)

- **plan** — a goal defined by a human. Fields: `id` (uuid), `title`, `intent` (why/what/acceptance),
  `status` (`open` | `done`). Flat — no parent/child. Agents do **not** create plans.
- **task** — a unit of work an agent does to advance a plan. Belongs to exactly one plan. Fields:
  `id` (uuid), `planId`, `title`, `intent`, `status` (`todo` | `in_progress` | `done`),
  `prRef` (optional, e.g. `owner/repo#42`).
- **comment** — a note on a plan or a task, by anyone (`author` is free text like `agent:dev-1`).
  No threading.

## Standard agent loop

1. **See what to do**: `oversteer plan list`, then read a plan in full.
2. **Read the plan**: `oversteer plan get <planId>` — shows the plan's intent, its tasks, and its comments.
3. **Decompose**: create one or more tasks under the plan (`task create`).
4. **Claim & work**: mark a task `in_progress` (`task update <taskId> --status in_progress`).
5. **Discuss when unsure**: `oversteer comment task <taskId> --author agent:<you> --text "..."`
   (in the POC there is no escalation/blocking — a comment is how you raise a question or note a decision).
6. **Finish**: `oversteer task update <taskId> --status done --pr-ref owner/repo#NN`.

## Commands (the entire POC surface)

All commands accept `--json` (place it right after `oversteer`, e.g. `oversteer --json plan get <id>`).

Read plans:
```
oversteer plan list                       # all plans: id [status] title
oversteer plan get <planId>               # plan + its tasks + its comments
```

Read/write tasks:
```
oversteer task list --plan <planId>       # tasks of a plan
oversteer task get <taskId>               # task + its comments
oversteer task create --plan <planId> --title "..." --intent "..."
oversteer task update <taskId> [--status todo|in_progress|done] [--intent "..."] [--pr-ref owner/repo#42]
```

Comment (on a plan or a task):
```
oversteer comment plan <planId> --author agent:dev-1 --text "..."
oversteer comment task <taskId> --author agent:dev-1 --text "..."
oversteer comments plan <planId>          # read a plan's comment stream
oversteer comments task <taskId>          # read a task's comment stream
```

## `--json` output shapes

- `plan list` → `Plan[]`
- `plan get <id>` → `{ plan: Plan, tasks: Task[], comments: PlanComment[] }`
- `task list --plan <id>` → `Task[]`
- `task get <id>` → `{ task: Task, comments: TaskComment[] }`
- `task create` / `task update` → `Task`
- `comment plan|task` → the created comment
- `comments plan|task` → comment array

```
Plan        { id, title, intent, status: 'open'|'done', createdAt, updatedAt }
Task        { id, planId, title, intent, status: 'todo'|'in_progress'|'done', prRef, createdAt, updatedAt }
PlanComment { id, planId, author, body, createdAt }
TaskComment { id, taskId,  author, body, createdAt }
```

On error the CLI prints `{ "error": "..." }` (with `--json`) or `error: ...` to stderr, and exits non-zero.

## Setup / availability

The CLI is a global command installed via `npm link` from the project. If `oversteer` is not found:
```
cd ~/agent/oversteer-poc-ts && npm link
```
It talks to a local Postgres (`DATABASE_URL`, default `postgres://yilongli@localhost:5432/oversteer`),
loaded from the project's `.env` regardless of your current directory — so you can run `oversteer`
from anywhere.

## Boundaries — do NOT assume these exist (not in the POC)

The POC is deliberately minimal. There is **no**:
- agent registration / identity table — `--author` is just free text you choose.
- `claim` command — to take a task, just set its status to `in_progress`.
- `escalate` / `decide` / blocking / `blocked_on_human` — raise questions via `comment`.
- steering / cursors / events / "what changed since last time" — to see current state, just
  `plan get` / `task get` again (read full each time).
- plan hierarchy (no sub-plans) or task↔multi-plan links — a task belongs to one plan.
- comment threading (`--reply-to`).

If a workflow seems to need one of these, say so and use a `comment` to record it — don't invent flags.
