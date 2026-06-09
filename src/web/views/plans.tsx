import type { FC } from "hono/jsx";
import type { Plan, Task, PlanComment } from "../../db/schema.js";
import { Layout } from "./Layout.js";
import { Badge, PrLink, Comment, CommentForm, IntentText } from "./components.js";

export const PlanListPage: FC<{ plans: Plan[] }> = ({ plans }) => (
  <Layout title="Plans">
    <h1>Plans</h1>
    {plans.length ? (
      plans.map((p) => (
        <div class="card">
          <a href={`/plans/${p.id}`}>{p.title}</a> <Badge status={p.status} />
          <div class="muted">{p.id}</div>
        </div>
      ))
    ) : (
      <p class="muted">(no plans yet)</p>
    )}
    <h2>New plan</h2>
    <form method="post" action="/plans">
      <input name="title" placeholder="title" required />
      <textarea
        name="intent"
        placeholder="intent: why / what / acceptance"
        rows={4}
        required
      ></textarea>
      <button type="submit">Create plan</button>
    </form>
  </Layout>
);

export const PlanDetailPage: FC<{
  plan: Plan;
  tasks: Task[];
  comments: PlanComment[];
}> = ({ plan, tasks, comments }) => (
  <Layout title={plan.title}>
    <h1>
      {plan.title} <Badge status={plan.status} />
    </h1>
    <IntentText text={plan.intent} />
    <div class="muted">{plan.id}</div>

    <h2>Tasks ({tasks.length})</h2>
    <div data-live="tasks">
      {tasks.length ? (
        tasks.map((t) => (
          <div class="card">
            <a href={`/tasks/${t.id}`}>{t.title}</a> <Badge status={t.status} />
            {t.prRef ? <> <PrLink refStr={t.prRef} /></> : null}
          </div>
        ))
      ) : (
        <p class="muted">(no tasks yet — agents create these via CLI)</p>
      )}
    </div>

    <h2>Comments ({comments.length})</h2>
    <div data-live="plan-comments">
      {comments.length ? (
        comments.map((c) => <Comment comment={c} />)
      ) : (
        <p class="muted">(none)</p>
      )}
    </div>
    <CommentForm action={`/plans/${plan.id}/comments`} />
  </Layout>
);
