import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as data from "../data/index.js";
import { PlanListPage, PlanDetailPage } from "./views/plans.js";
import { TaskDetailPage } from "./views/tasks.js";

const app = new Hono();

// ---- routes ----

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

// plan detail: tasks + plan comments
app.get("/plans/:id", async (c) => {
  const full = await data.getPlanFull(c.req.param("id"));
  if (!full) return c.text("plan not found", 404);
  return c.html(<PlanDetailPage {...full} />);
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
  return c.html(<TaskDetailPage {...full} />);
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
