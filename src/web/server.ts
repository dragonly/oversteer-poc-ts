import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { marked } from "marked";
import * as data from "../data/index.js";
import type { Plan, Task, PlanComment, TaskComment } from "../db/schema.js";

// Render a comment body as markdown. POC threat model: authors are the local
// human + trusted agents, so we don't sanitize marked's HTML output.
marked.setOptions({ breaks: true, gfm: true });
function md(src: string): string {
  return marked.parse(src, { async: false }) as string;
}

const app = new Hono();

// ---- tiny HTML helpers (no template engine; POC) ----
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · oversteer</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1 { font-size: 1.4rem; }
  .muted { color: #888; font-size: 0.85em; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; background: #eee; color: #333; font-size: 0.8em; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem 1rem; margin: 0.5rem 0; }
  .intent { white-space: pre-wrap; color: #444; }
  form { margin: 1rem 0; display: grid; gap: 0.5rem; }
  input, textarea { font: inherit; padding: 0.5rem; border: 1px solid #ccc; border-radius: 6px; width: 100%; box-sizing: border-box; }
  button { font: inherit; padding: 0.5rem 1rem; border: 0; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; width: fit-content; }
  .comment { border-left: 3px solid #ddd; padding: 0.25rem 0 0.25rem 0.75rem; margin: 0.5rem 0; }
  .comment .body > :first-child { margin-top: 0.25rem; }
  .comment .body > :last-child { margin-bottom: 0; }
  .comment .body code { background: #8881; padding: 0.1em 0.3em; border-radius: 4px; font-size: 0.9em; }
  .comment .body pre { background: #8881; padding: 0.6rem 0.8rem; border-radius: 6px; overflow-x: auto; }
  .comment .body pre code { background: none; padding: 0; }
  .comment .body ol, .comment .body ul { padding-left: 1.4rem; }
  nav { margin-bottom: 1rem; }
</style>
</head>
<body>
<nav><a href="/">&larr; all plans</a></nav>
${body}
</body>
</html>`;
}

function statusBadge(s: string): string {
  return `<span class="badge">${esc(s)}</span>`;
}

function commentBlock(c: PlanComment | TaskComment): string {
  return `<div class="comment"><div class="muted">${esc(c.author)} · ${c.createdAt.toISOString()}</div><div class="body">${md(c.body)}</div></div>`;
}

// ---- routes ----

// plan list + create
app.get("/", async (c) => {
  const plans = await data.listPlans();
  const rows = plans
    .map(
      (p: Plan) =>
        `<div class="card"><a href="/plans/${p.id}">${esc(p.title)}</a> ${statusBadge(p.status)}<div class="muted">${p.id}</div></div>`,
    )
    .join("");
  const body = `
<h1>Plans</h1>
${rows || "<p class='muted'>(no plans yet)</p>"}
<h2>New plan</h2>
<form method="post" action="/plans">
  <input name="title" placeholder="title" required />
  <textarea name="intent" placeholder="intent: why / what / acceptance" rows="4" required></textarea>
  <button type="submit">Create plan</button>
</form>`;
  return c.html(page("Plans", body));
});

app.post("/plans", async (c) => {
  const form = await c.req.formData();
  const title = String(form.get("title") ?? "").trim();
  const intent = String(form.get("intent") ?? "").trim();
  if (!title || !intent) return c.text("title and intent required", 400);
  const plan = await data.createPlan({ title, intent });
  return c.redirect(`/plans/${plan.id}`);
});

// plan detail: tasks + plan comments
app.get("/plans/:id", async (c) => {
  const full = await data.getPlanFull(c.req.param("id"));
  if (!full) return c.text("plan not found", 404);
  const { plan, tasks, comments } = full;
  const taskRows = tasks
    .map(
      (t: Task) =>
        `<div class="card"><a href="/tasks/${t.id}">${esc(t.title)}</a> ${statusBadge(t.status)}${t.prRef ? ` <span class="muted">${esc(t.prRef)}</span>` : ""}</div>`,
    )
    .join("");
  const body = `
<h1>${esc(plan.title)} ${statusBadge(plan.status)}</h1>
<div class="intent">${esc(plan.intent)}</div>
<div class="muted">${plan.id}</div>

<h2>Tasks (${tasks.length})</h2>
${taskRows || "<p class='muted'>(no tasks yet — agents create these via CLI)</p>"}

<h2>Comments (${comments.length})</h2>
${comments.map(commentBlock).join("") || "<p class='muted'>(none)</p>"}
<form method="post" action="/plans/${plan.id}/comments">
  <input name="author" value="human:yilongli" />
  <textarea name="body" placeholder="comment" rows="2" required></textarea>
  <button type="submit">Comment</button>
</form>`;
  return c.html(page(plan.title, body));
});

app.post("/plans/:id/comments", async (c) => {
  const planId = c.req.param("id");
  const form = await c.req.formData();
  const author = String(form.get("author") ?? "human:web").trim() || "human:web";
  const body = String(form.get("body") ?? "").trim();
  if (!body) return c.text("body required", 400);
  await data.addPlanComment({ planId, author, body });
  return c.redirect(`/plans/${planId}`);
});

// task detail: task + task comments
app.get("/tasks/:id", async (c) => {
  const full = await data.getTaskFull(c.req.param("id"));
  if (!full) return c.text("task not found", 404);
  const { task, comments } = full;
  const body = `
<nav><a href="/plans/${task.planId}">&larr; back to plan</a></nav>
<h1>${esc(task.title)} ${statusBadge(task.status)}</h1>
<div class="intent">${esc(task.intent)}</div>
${task.prRef ? `<p>PR: <span class="muted">${esc(task.prRef)}</span></p>` : ""}
<div class="muted">${task.id}</div>

<h2>Comments (${comments.length})</h2>
${comments.map(commentBlock).join("") || "<p class='muted'>(none)</p>"}
<form method="post" action="/tasks/${task.id}/comments">
  <input name="author" value="human:yilongli" />
  <textarea name="body" placeholder="comment" rows="2" required></textarea>
  <button type="submit">Comment</button>
</form>`;
  return c.html(page(task.title, body));
});

app.post("/tasks/:id/comments", async (c) => {
  const taskId = c.req.param("id");
  const form = await c.req.formData();
  const author = String(form.get("author") ?? "human:web").trim() || "human:web";
  const body = String(form.get("body") ?? "").trim();
  if (!body) return c.text("body required", 400);
  await data.addTaskComment({ taskId, author, body });
  return c.redirect(`/tasks/${taskId}`);
});

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`oversteer web on http://localhost:${info.port}`);
});
