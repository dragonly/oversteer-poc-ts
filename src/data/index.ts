import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  plans,
  tasks,
  planComments,
  taskComments,
  events,
  documents,
  type Plan,
  type Task,
  type PlanComment,
  type TaskComment,
  type Event,
  type Document,
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

// Edit a plan's intent. Records a plan_intent_edited event carrying the old→new
// diff so the change shows up in the activity stream and an agent polling ?since
// can detect "intent changed" and re-plan. No-op (returns row) if unchanged.
export async function updatePlanIntent(
  id: string,
  intent: string,
  author: string,
): Promise<Plan | undefined> {
  const prev = await getPlan(id);
  if (!prev) return undefined;
  if (prev.intent === intent) return prev;
  const [row] = await db
    .update(plans)
    .set({ intent, updatedAt: new Date() })
    .where(eq(plans.id, id))
    .returning();
  if (!row) return undefined;
  await addEvent({
    planId: id,
    kind: "plan_intent_edited",
    author,
    data: { old: prev.intent, new: row.intent },
  });
  return row;
}

// A plan with everything a reader (agent or human) needs in one shot.
export async function getPlanFull(id: string): Promise<
  | {
      plan: Plan;
      tasks: Task[];
      comments: PlanComment[];
      documents: Document[];
    }
  | undefined
> {
  const plan = await getPlan(id);
  if (!plan) return undefined;
  const [planTasks, comments, docs] = await Promise.all([
    listTasksByPlan(id),
    listPlanComments(id),
    listDocumentsByPlan(id),
  ]);
  return { plan, tasks: planTasks, comments, documents: docs };
}

// ---- tasks ----

export async function createTask(input: {
  planId: string;
  title: string;
  intent: string;
  author?: string;
}): Promise<Task> {
  const [row] = await db
    .insert(tasks)
    .values({ planId: input.planId, title: input.title, intent: input.intent })
    .returning();
  await addEvent({
    planId: row.planId,
    taskId: row.id,
    kind: "task_created",
    author: input.author ?? "agent",
    data: { title: row.title },
  });
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
  patch: { status?: Task["status"]; intent?: string; prRef?: string; author?: string },
): Promise<Task | undefined> {
  // Read the prior row so we can record what actually changed (the deltas the
  // current-state table would otherwise lose) into the append-only event log.
  const prev = await getTask(id);
  if (!prev) return undefined;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.intent !== undefined) set.intent = patch.intent;
  if (patch.prRef !== undefined) set.prRef = patch.prRef;
  const [row] = await db.update(tasks).set(set).where(eq(tasks.id, id)).returning();
  if (!row) return undefined;
  const author = patch.author ?? "agent";
  if (patch.status !== undefined && patch.status !== prev.status) {
    await addEvent({
      planId: row.planId,
      taskId: row.id,
      kind: "status_changed",
      author,
      data: { from: prev.status, to: row.status },
    });
  }
  if (patch.prRef !== undefined && patch.prRef !== prev.prRef) {
    await addEvent({
      planId: row.planId,
      taskId: row.id,
      kind: "pr_set",
      author,
      data: { ref: row.prRef },
    });
  }
  if (patch.intent !== undefined && patch.intent !== prev.intent) {
    await addEvent({
      planId: row.planId,
      taskId: row.id,
      kind: "task_intent_edited",
      author,
      data: { old: prev.intent, new: row.intent },
    });
  }
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

// ---- documents ----

export async function createDocument(input: {
  planId: string;
  title: string;
  kind?: string;
  body?: string;
  author?: string;
}): Promise<Document> {
  const [row] = await db
    .insert(documents)
    .values({
      planId: input.planId,
      title: input.title,
      kind: input.kind ?? "note",
      body: input.body ?? "",
    })
    .returning();
  await addEvent({
    planId: row.planId,
    documentId: row.id,
    kind: "document_created",
    author: input.author ?? "agent",
    data: { title: row.title, docKind: row.kind },
  });
  return row;
}

export async function listDocumentsByPlan(planId: string): Promise<Document[]> {
  return db
    .select()
    .from(documents)
    .where(eq(documents.planId, planId))
    .orderBy(asc(documents.createdAt));
}

export async function getDocument(id: string): Promise<Document | undefined> {
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  return row;
}

// Edit a document's body/title/kind. A body change records a document_edited
// event carrying the old→new body diff, so the edit shows up in the plan activity
// stream (and an agent polling ?since sees "the live doc changed"). Consistent
// with how plan/task intent edits are journaled.
export async function updateDocument(
  id: string,
  patch: { title?: string; kind?: string; body?: string; author?: string },
): Promise<Document | undefined> {
  const prev = await getDocument(id);
  if (!prev) return undefined;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.body !== undefined) set.body = patch.body;
  const [row] = await db.update(documents).set(set).where(eq(documents.id, id)).returning();
  if (!row) return undefined;
  const changedBody = patch.body !== undefined && patch.body !== prev.body;
  const changedTitle = patch.title !== undefined && patch.title !== prev.title;
  const changedKind = patch.kind !== undefined && patch.kind !== prev.kind;
  if (changedBody || changedTitle || changedKind) {
    await addEvent({
      planId: row.planId,
      documentId: row.id,
      kind: "document_edited",
      author: patch.author ?? "agent",
      data: {
        title: row.title,
        ...(changedBody ? { old: prev.body, new: row.body } : {}),
        ...(changedTitle ? { oldTitle: prev.title, newTitle: row.title } : {}),
        ...(changedKind ? { oldKind: prev.kind, newKind: row.kind } : {}),
      },
    });
  }
  return row;
}

// A document plus its own edit history (the document_* events scoped to it),
// time-ordered, so the CLI/web can show the living doc + how it evolved in one read.
export async function getDocumentFull(
  id: string,
): Promise<{ document: Document; history: Event[] } | undefined> {
  const document = await getDocument(id);
  if (!document) return undefined;
  const history = await db
    .select()
    .from(events)
    .where(eq(events.documentId, id))
    .orderBy(asc(events.createdAt));
  return { document, history };
}

// ---- comments ----

export async function addPlanComment(input: {
  planId: string;
  author: string;
  body: string;
  inReplyTo?: string | null;
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
  inReplyTo?: string | null;
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

// ---- events / unified activity stream ----

export async function addEvent(input: {
  planId: string;
  taskId?: string | null;
  documentId?: string | null;
  kind: Event["kind"];
  author: string;
  data?: Record<string, unknown>;
}): Promise<Event> {
  const [row] = await db
    .insert(events)
    .values({
      planId: input.planId,
      taskId: input.taskId ?? null,
      documentId: input.documentId ?? null,
      kind: input.kind,
      author: input.author,
      data: input.data ?? null,
    })
    .returning();
  return row;
}

// One row of the plan-level activity stream. Normalizes three sources (plan
// comments, task comments, state-change events) into a single time-ordered shape
// so a reader never has to cross-reference. `kind` tells the consumer how to
// render `body` (comments) vs `data` (state deltas).
export type Activity = {
  id: string; // underlying row id (comment id or event id)
  kind:
    | "plan_comment"
    | "task_comment"
    | Event["kind"];
  at: string; // ISO timestamp
  planId: string;
  taskId: string | null;
  taskTitle: string | null;
  documentId: string | null;
  documentTitle: string | null;
  author: string;
  body: string | null; // comment body, null for state events
  inReplyTo: string | null;
  data: Record<string, unknown> | null; // state-event payload
};

// The unified, incremental read. Returns every meaningful change anywhere under
// the plan (plan-level + all its tasks) strictly after `since`, time-ordered.
// This is the single endpoint the human UI and the agent's `--since` poll both
// read, replacing the "cross-reference 5 independent sources" problem.
export async function getPlanActivity(
  planId: string,
  since?: Date,
): Promise<Activity[]> {
  const afterPlan = since
    ? and(eq(planComments.planId, planId), gt(planComments.createdAt, since))
    : eq(planComments.planId, planId);
  const afterEvent = since
    ? and(eq(events.planId, planId), gt(events.createdAt, since))
    : eq(events.planId, planId);

  const [planTasks, pComments, tComments, evRows] = await Promise.all([
    listTasksByPlan(planId),
    db.select().from(planComments).where(afterPlan),
    // task comments joined to their task so we can scope by plan + tag with title
    db
      .select({ c: taskComments, taskTitle: tasks.title })
      .from(taskComments)
      .innerJoin(tasks, eq(taskComments.taskId, tasks.id))
      .where(
        since
          ? and(eq(tasks.planId, planId), gt(taskComments.createdAt, since))
          : eq(tasks.planId, planId),
      ),
    db.select().from(events).where(afterEvent),
  ]);

  const titleOf = new Map(planTasks.map((t) => [t.id, t.title] as const));
  const planDocs = await listDocumentsByPlan(planId);
  const docTitleOf = new Map(planDocs.map((d) => [d.id, d.title] as const));

  const stream: Activity[] = [
    ...pComments.map((c) => ({
      id: c.id,
      kind: "plan_comment" as const,
      at: new Date(c.createdAt).toISOString(),
      planId,
      taskId: null,
      taskTitle: null,
      documentId: null,
      documentTitle: null,
      author: c.author,
      body: c.body,
      inReplyTo: c.inReplyTo ?? null,
      data: null,
    })),
    ...tComments.map(({ c, taskTitle }) => ({
      id: c.id,
      kind: "task_comment" as const,
      at: new Date(c.createdAt).toISOString(),
      planId,
      taskId: c.taskId,
      taskTitle,
      documentId: null,
      documentTitle: null,
      author: c.author,
      body: c.body,
      inReplyTo: c.inReplyTo ?? null,
      data: null,
    })),
    ...evRows.map((e) => ({
      id: e.id,
      kind: e.kind,
      at: new Date(e.createdAt).toISOString(),
      planId,
      taskId: e.taskId,
      taskTitle: e.taskId ? (titleOf.get(e.taskId) ?? null) : null,
      documentId: e.documentId,
      documentTitle: e.documentId
        ? (docTitleOf.get(e.documentId) ?? ((e.data as Record<string, unknown>)?.title as string) ?? null)
        : null,
      author: e.author,
      body: null,
      inReplyTo: null,
      data: e.data,
    })),
  ];

  // Stable time order; id as tiebreaker so identical timestamps stay deterministic.
  stream.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  return stream;
}

// Plan-level attention summary, DERIVED from the stream + task statuses (no stored
// flag) so a human sees "is this on me or on the agent?" at a glance — in the plan
// list and at the top of the detail page — without reading every comment.
//
// Rule (first match wins):
//   waiting_human : the most recent comment anywhere under the plan is by an agent
//                   (agent said something last → ball is in the human's court).
//   agent_working : otherwise, some task is in_progress.
//   idle          : otherwise (no open work / nothing pending).
export type Attention = {
  state: "waiting_human" | "agent_working" | "idle";
  emoji: string;
  label: string;
};

export async function getPlanAttention(planId: string): Promise<Attention> {
  const [planTasks, activity] = await Promise.all([
    listTasksByPlan(planId),
    getPlanActivity(planId),
  ]);
  const comments = activity.filter(
    (a) => a.kind === "plan_comment" || a.kind === "task_comment",
  );
  const last = comments[comments.length - 1];
  if (last && last.author.startsWith("agent")) {
    return { state: "waiting_human", emoji: "⏳", label: "等你回复" };
  }
  if (planTasks.some((t) => t.status === "in_progress")) {
    return { state: "agent_working", emoji: "🤖", label: "agent 工作中" };
  }
  return { state: "idle", emoji: "✅", label: "无待办" };
}
