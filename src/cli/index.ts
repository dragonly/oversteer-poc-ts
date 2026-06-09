import { Command } from "commander";
import type { Plan, Task, PlanComment, TaskComment } from "../db/schema.js";

// The CLI is a thin HTTP client over the server's /api/* endpoints. It no longer
// imports the data layer or touches Postgres — the server owns the DB. Point it
// at a non-default server with OVERSTEER_API.
const BASE = (process.env.OVERSTEER_API ?? "http://localhost:4000").replace(/\/+$/, "");

// Dual-mode output: --json for agent hosts, human-readable text otherwise.
let JSON_MODE = false;

function out(human: () => void, json: unknown) {
  if (JSON_MODE) {
    console.log(JSON.stringify(json, null, 2));
  } else {
    human();
  }
}

function die(msg: string): never {
  if (JSON_MODE) console.log(JSON.stringify({ error: msg }));
  else console.error(`error: ${msg}`);
  process.exitCode = 1;
  throw new ExitSignal();
}

class ExitSignal extends Error {}

// One place that talks HTTP. Maps transport failures and API error bodies to die().
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    die(`cannot reach oversteer server at ${BASE} (is it running? \`npm run web\`)`);
  }
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // Non-JSON body (e.g. an upstream error page) — surface it raw.
      if (!res.ok) die(text.trim() || `HTTP ${res.status} ${method} ${path}`);
    }
  }
  if (!res.ok) die(json?.error ?? `HTTP ${res.status} ${method} ${path}`);
  return json as T;
}

type PlanFull = { plan: Plan; tasks: Task[]; comments: PlanComment[] };
type TaskFull = { task: Task; comments: TaskComment[] };

function ts(v: string | Date): string {
  return new Date(v).toISOString();
}

function fmtPlan(p: Plan): string {
  return `plan ${p.id}  [${p.status}]\n  title:  ${p.title}\n  intent: ${p.intent}`;
}

function fmtTask(t: Task): string {
  const pr = t.prRef ? `  pr: ${t.prRef}` : "";
  return `task ${t.id}  [${t.status}]${pr}\n  title:  ${t.title}\n  intent: ${t.intent}`;
}

function fmtComment(c: PlanComment | TaskComment): string {
  return `  - ${c.author} @ ${ts(c.createdAt)}\n    ${c.body}`;
}

const program = new Command();
program
  .name("oversteer")
  .description("oversteer.ai POC CLI — agent reads plans, works tasks, comments")
  .option("--json", "machine-readable JSON output")
  .hook("preAction", (thisCmd) => {
    JSON_MODE = Boolean(thisCmd.opts().json);
  });

// ---- plan ----
const plan = program.command("plan").description("read plans");

plan
  .command("list")
  .description("list all plans")
  .action(async () => {
    const rows = await req<Plan[]>("GET", "/plans");
    out(() => {
      if (rows.length === 0) return console.log("(no plans)");
      for (const p of rows) console.log(`${p.id}  [${p.status}]  ${p.title}`);
    }, rows);
  });

plan
  .command("get <planId>")
  .description("read a plan with its tasks and comments")
  .action(async (planId: string) => {
    const full = await req<PlanFull>("GET", `/plans/${planId}`);
    out(() => {
      console.log(fmtPlan(full.plan));
      console.log(`\ntasks (${full.tasks.length}):`);
      for (const t of full.tasks) console.log(`  ${t.id}  [${t.status}]  ${t.title}`);
      console.log(`\ncomments (${full.comments.length}):`);
      for (const c of full.comments) console.log(fmtComment(c));
    }, full);
  });

// ---- task ----
const task = program.command("task").description("read and write tasks");

task
  .command("list")
  .description("list tasks of a plan")
  .requiredOption("--plan <planId>", "plan id")
  .action(async (opts: { plan: string }) => {
    const rows = await req<Task[]>("GET", `/plans/${opts.plan}/tasks`);
    out(() => {
      if (rows.length === 0) return console.log("(no tasks)");
      for (const t of rows) console.log(`${t.id}  [${t.status}]  ${t.title}`);
    }, rows);
  });

task
  .command("get <taskId>")
  .description("read a task with its comments")
  .action(async (taskId: string) => {
    const full = await req<TaskFull>("GET", `/tasks/${taskId}`);
    out(() => {
      console.log(fmtTask(full.task));
      console.log(`\ncomments (${full.comments.length}):`);
      for (const c of full.comments) console.log(fmtComment(c));
    }, full);
  });

task
  .command("create")
  .description("create a task under a plan")
  .requiredOption("--plan <planId>", "plan id")
  .requiredOption("--title <title>", "task title")
  .requiredOption("--intent <intent>", "what this task does")
  .action(async (opts: { plan: string; title: string; intent: string }) => {
    const t = await req<Task>("POST", `/plans/${opts.plan}/tasks`, {
      title: opts.title,
      intent: opts.intent,
    });
    out(() => console.log(fmtTask(t)), t);
  });

task
  .command("update <taskId>")
  .description("update a task's status / intent / pr-ref")
  .option("--status <status>", "todo | in_progress | done")
  .option("--intent <intent>", "new intent")
  .option("--pr-ref <ref>", "PR reference, e.g. owner/repo#42")
  .action(
    async (
      taskId: string,
      opts: { status?: string; intent?: string; prRef?: string },
    ) => {
      const t = await req<Task>("PATCH", `/tasks/${taskId}`, {
        status: opts.status,
        intent: opts.intent,
        prRef: opts.prRef,
      });
      out(() => console.log(fmtTask(t)), t);
    },
  );

// ---- comment ----
const comment = program.command("comment").description("comment on a plan or task");

comment
  .command("plan <planId>")
  .description("comment on a plan")
  .requiredOption("--author <author>", "e.g. agent:dev-1")
  .requiredOption("--text <text>", "comment body")
  .action(async (planId: string, opts: { author: string; text: string }) => {
    const c = await req<PlanComment>("POST", `/plans/${planId}/comments`, {
      author: opts.author,
      body: opts.text,
    });
    out(() => console.log(fmtComment(c)), c);
  });

comment
  .command("task <taskId>")
  .description("comment on a task")
  .requiredOption("--author <author>", "e.g. agent:dev-1")
  .requiredOption("--text <text>", "comment body")
  .action(async (taskId: string, opts: { author: string; text: string }) => {
    const c = await req<TaskComment>("POST", `/tasks/${taskId}/comments`, {
      author: opts.author,
      body: opts.text,
    });
    out(() => console.log(fmtComment(c)), c);
  });

// ---- comments (read threads) ----
const comments = program.command("comments").description("read a plan/task comment stream");

comments
  .command("plan <planId>")
  .action(async (planId: string) => {
    const rows = await req<PlanComment[]>("GET", `/plans/${planId}/comments`);
    out(() => rows.forEach((c) => console.log(fmtComment(c))), rows);
  });

comments
  .command("task <taskId>")
  .action(async (taskId: string) => {
    const rows = await req<TaskComment[]>("GET", `/tasks/${taskId}/comments`);
    out(() => rows.forEach((c) => console.log(fmtComment(c))), rows);
  });

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (!(err instanceof ExitSignal)) {
      console.error(err);
      process.exitCode = 1;
    }
  }
}

main();
