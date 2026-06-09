import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  index,
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

export type Plan = typeof plans.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type PlanComment = typeof planComments.$inferSelect;
export type TaskComment = typeof taskComments.$inferSelect;
