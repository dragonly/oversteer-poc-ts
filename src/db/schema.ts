import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

// status enums kept minimal per POC doc (open/done, todo/in_progress/done)
export const planStatus = pgEnum("plan_status", ["open", "done"]);
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "done"]);

// plan = a goal / intent defined by a human. POC: flat, no parent/child.
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  intent: text("intent").notNull(), // why / what / acceptance, free text
  status: planStatus("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// task = something an agent does to complete a plan. Belongs to a single plan.
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    title: text("title").notNull(),
    intent: text("intent").notNull(),
    status: taskStatus("status").notNull().default("todo"),
    prRef: text("pr_ref"), // optional, e.g. 'owner/repo#42'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    planIdx: index("idx_tasks_plan").on(t.planId),
  }),
);

// comments split into two tables (not a polymorphic object_type+object_id),
// so each can use a real FK and the DB enforces integrity. No threading.
export const planComments = pgTable(
  "plan_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    author: text("author").notNull(), // free text: 'human:yilongli' / 'agent:dev-1'
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    planIdx: index("idx_plan_comments").on(t.planId, t.id),
  }),
);

export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    author: text("author").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index("idx_task_comments").on(t.taskId, t.id),
  }),
);

// Append-only audit of meaningful state changes that the current-state tables
// can NOT reconstruct on their own (a task row only keeps its latest status /
// prRef / intent, not the history of how it got there). Comments are NOT copied
// here — they already live in plan_comments / task_comments and the activity
// stream unions them in at read time. This table only records the deltas.
export const eventKind = pgEnum("event_kind", [
  "task_created",
  "status_changed",
  "pr_set",
  "plan_intent_edited",
  "task_intent_edited",
]);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    // null for plan-scoped events (e.g. plan_intent_edited); set for task-scoped.
    taskId: uuid("task_id").references(() => tasks.id),
    kind: eventKind("kind").notNull(),
    author: text("author").notNull(), // who triggered it: 'human:web' / 'agent:dev-1'
    // structured payload, kind-dependent: { from, to } | { ref } | { old, new }
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // (planId, createdAt) drives the plan-level `?since` incremental read.
    planIdx: index("idx_events_plan").on(t.planId, t.createdAt),
  }),
);

export type Event = typeof events.$inferSelect;

export type Plan = typeof plans.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type PlanComment = typeof planComments.$inferSelect;
export type TaskComment = typeof taskComments.$inferSelect;
