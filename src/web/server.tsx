import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as data from "../data/index.js";
import { PlanListPage, PlanDetailPage } from "./views/plans.js";
import { TaskDetailPage } from "./views/tasks.js";

const app = new Hono();

// ---- routes ----

// Resolve a bare id to its page. Autolinked ids in comments/intent point here
// because a uuid alone doesn't say whether it's a plan or a task.
app.get("/go/:id", async (c) => {
  const id = c.req.param("id");
  try {
    if (await data.getPlan(id)) return c.redirect(`/plans/${id}`);
    if (await data.getTask(id)) return c.redirect(`/tasks/${id}`);
  } catch {
    // malformed id (not a uuid) — fall through to 404
  }
  return c.text(`not found: ${id}`, 404);
});

// plan list + create
app.get("/", async (c) => {
  const plans = await data.listPlans();
  return c.html(<PlanListPage plans={plans} />);
});

app.post("/plans", async (c) => {
  const form = await c.req.formData();
  const title = String(form.get("title") ?? "").trim();
  const intent = String(form.get("intent") ?? "").trim();
  if (!title || !intent) return c.text("title and intent required", 400);
  const plan = await data.createPlan({ title, intent });
  return c.redirect(`/plans/${plan.id}`);
});

// plan detail: tasks + unified activity stream
app.get("/plans/:id", async (c) => {
  const full = await data.getPlanFull(c.req.param("id"));
  if (!full) return c.text("plan not found", 404);
  const activity = await data.getPlanActivity(c.req.param("id"));
  return c.html(<PlanDetailPage {...full} activity={activity} />);
});

app.post("/plans/:id/comments", async (c) => {
  const planId = c.req.param("id");
  const form = await c.req.formData();
  const author = String(form.get("author") ?? "human:web").trim() || "human:web";
  const body = String(form.get("body") ?? "").trim();
  if (!body) return c.text("body required", 400);
  const inReplyTo = String(form.get("inReplyTo") ?? "").trim() || null;
  await data.addPlanComment({ planId, author, body, inReplyTo });
  return c.redirect(`/plans/${planId}`);
});

// task detail: task + task comments
app.get("/tasks/:id", async (c) => {
  const full = await data.getTaskFull(c.req.param("id"));
  if (!full) return c.text("task not found", 404);
  return c.html(<TaskDetailPage {...full} />);
});

app.post("/tasks/:id/comments", async (c) => {
  const taskId = c.req.param("id");
  const form = await c.req.formData();
  const author = String(form.get("author") ?? "human:web").trim() || "human:web";
  const body = String(form.get("body") ?? "").trim();
  if (!body) return c.text("body required", 400);
  const inReplyTo = String(form.get("inReplyTo") ?? "").trim() || null;
  await data.addTaskComment({ taskId, author, body, inReplyTo });
  return c.redirect(`/tasks/${taskId}`);
});

// ---- JSON HTTP API (consumed by the CLI; the HTML pages above are unaffected) ----
// The CLI is a thin HTTP client over these endpoints, so it no longer talks to
// Postgres directly — the server is the single process that owns the DB.
const api = new Hono();

// Any uncaught error in an /api route (e.g. a malformed-uuid DB error) becomes a
// JSON body so the CLI always gets parseable output instead of an HTML 500 page.
api.onError((err, c) => c.json({ error: err.message }, 500));

api.get("/plans", async (c) => c.json(await data.listPlans()));

api.get("/plans/:id", async (c) => {
  const full = await data.getPlanFull(c.req.param("id"));
  if (!full) return c.json({ error: `plan not found: ${c.req.param("id")}` }, 404);
  return c.json(full);
});

api.get("/plans/:id/tasks", async (c) => c.json(await data.listTasksByPlan(c.req.param("id"))));

api.post("/plans/:id/tasks", async (c) => {
  const planId = c.req.param("id");
  if (!(await data.getPlan(planId))) return c.json({ error: `plan not found: ${planId}` }, 404);
  const b = await c.req.json().catch(() => ({}) as Record<string, string>);
  if (!b.title || !b.intent) return c.json({ error: "title and intent required" }, 400);
  return c.json(await data.createTask({ planId, title: b.title, intent: b.intent, author: b.author }), 201);
});

api.get("/plans/:id/comments", async (c) => c.json(await data.listPlanComments(c.req.param("id"))));

// Unified, incremental activity stream: every change anywhere under the plan
// (plan + all tasks), time-ordered, optionally only what's new since ?since=<ISO>.
api.get("/plans/:id/activity", async (c) => {
  const planId = c.req.param("id");
  if (!(await data.getPlan(planId))) return c.json({ error: `plan not found: ${planId}` }, 404);
  const sinceRaw = c.req.query("since");
  let since: Date | undefined;
  if (sinceRaw) {
    since = new Date(sinceRaw);
    if (Number.isNaN(since.getTime())) return c.json({ error: `invalid since: ${sinceRaw}` }, 400);
  }
  return c.json(await data.getPlanActivity(planId, since));
});

api.post("/plans/:id/comments", async (c) => {
  const planId = c.req.param("id");
  if (!(await data.getPlan(planId))) return c.json({ error: `plan not found: ${planId}` }, 404);
  const b = await c.req.json().catch(() => ({}) as Record<string, string>);
  if (!b.author || !b.body) return c.json({ error: "author and body required" }, 400);
  return c.json(await data.addPlanComment({ planId, author: b.author, body: b.body, inReplyTo: b.inReplyTo }), 201);
});

api.get("/tasks/:id", async (c) => {
  const full = await data.getTaskFull(c.req.param("id"));
  if (!full) return c.json({ error: `task not found: ${c.req.param("id")}` }, 404);
  return c.json(full);
});

api.patch("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}) as Record<string, string>);
  if (b.status && !["todo", "in_progress", "done"].includes(b.status)) {
    return c.json({ error: `invalid status: ${b.status} (todo | in_progress | done)` }, 400);
  }
  const t = await data.updateTask(id, {
    status: b.status as never,
    intent: b.intent,
    prRef: b.prRef,
    author: b.author,
  });
  if (!t) return c.json({ error: `task not found: ${id}` }, 404);
  return c.json(t);
});

api.get("/tasks/:id/comments", async (c) => c.json(await data.listTaskComments(c.req.param("id"))));

api.post("/tasks/:id/comments", async (c) => {
  const taskId = c.req.param("id");
  if (!(await data.getTask(taskId))) return c.json({ error: `task not found: ${taskId}` }, 404);
  const b = await c.req.json().catch(() => ({}) as Record<string, string>);
  if (!b.author || !b.body) return c.json({ error: "author and body required" }, 400);
  return c.json(await data.addTaskComment({ taskId, author: b.author, body: b.body, inReplyTo: b.inReplyTo }), 201);
});

app.route("/api", api);

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`oversteer web on http://localhost:${info.port}`);
});
