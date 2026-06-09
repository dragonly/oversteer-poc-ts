import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  plans,
  tasks,
  planComments,
  taskComments,
  type Plan,
  type Task,
  type PlanComment,
  type TaskComment,
} from "../db/schema.js";

// ---- plans ----

export async function createPlan(input: { title: string; intent: string }): Promise<Plan> {
  const [row] = await db.insert(plans).values(input).returning();
  return row;
}

export async function listPlans(): Promise<Plan[]> {
  return db.select().from(plans).orderBy(desc(plans.createdAt));
}

export async function getPlan(id: string): Promise<Plan | undefined> {
  const [row] = await db.select().from(plans).where(eq(plans.id, id));
  return row;
}

export async function setPlanStatus(id: string, status: Plan["status"]): Promise<Plan | undefined> {
  const [row] = await db
    .update(plans)
    .set({ status, updatedAt: new Date() })
    .where(eq(plans.id, id))
    .returning();
  return row;
}

// A plan with everything a reader (agent or human) needs in one shot.
export async function getPlanFull(id: string): Promise<
  | {
      plan: Plan;
      tasks: Task[];
      comments: PlanComment[];
    }
  | undefined
> {
  const plan = await getPlan(id);
  if (!plan) return undefined;
  const [planTasks, comments] = await Promise.all([
    listTasksByPlan(id),
    listPlanComments(id),
  ]);
  return { plan, tasks: planTasks, comments };
}

// ---- tasks ----

export async function createTask(input: {
  planId: string;
  title: string;
  intent: string;
}): Promise<Task> {
  const [row] = await db.insert(tasks).values(input).returning();
  return row;
}

export async function listTasksByPlan(planId: string): Promise<Task[]> {
  return db.select().from(tasks).where(eq(tasks.planId, planId)).orderBy(asc(tasks.createdAt));
}

export async function getTask(id: string): Promise<Task | undefined> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  return row;
}

export async function updateTask(
  id: string,
  patch: { status?: Task["status"]; intent?: string; prRef?: string },
): Promise<Task | undefined> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.intent !== undefined) set.intent = patch.intent;
  if (patch.prRef !== undefined) set.prRef = patch.prRef;
  const [row] = await db.update(tasks).set(set).where(eq(tasks.id, id)).returning();
  return row;
}

export async function getTaskFull(
  id: string,
): Promise<{ task: Task; comments: TaskComment[] } | undefined> {
  const task = await getTask(id);
  if (!task) return undefined;
  const comments = await listTaskComments(id);
  return { task, comments };
}

// ---- comments ----

export async function addPlanComment(input: {
  planId: string;
  author: string;
  body: string;
}): Promise<PlanComment> {
  const [row] = await db.insert(planComments).values(input).returning();
  return row;
}

export async function listPlanComments(planId: string): Promise<PlanComment[]> {
  return db
    .select()
    .from(planComments)
    .where(eq(planComments.planId, planId))
    .orderBy(asc(planComments.createdAt));
}

export async function addTaskComment(input: {
  taskId: string;
  author: string;
  body: string;
}): Promise<TaskComment> {
  const [row] = await db.insert(taskComments).values(input).returning();
  return row;
}

export async function listTaskComments(taskId: string): Promise<TaskComment[]> {
  return db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt));
}
