import type { FC } from "hono/jsx";
import type { Task, TaskComment } from "../../db/schema.js";
import { Layout } from "./Layout.js";
import { Badge, PrLink, Comment, CommentForm, IntentText } from "./components.js";

export const TaskDetailPage: FC<{
  task: Task;
  comments: TaskComment[];
}> = ({ task, comments }) => (
  <Layout title={task.title}>
    <nav>
      <a href={`/plans/${task.planId}`}>&larr; back to plan</a>
    </nav>
    <h1>
      {task.title} <Badge status={task.status} />
    </h1>
    <IntentText text={task.intent} />
    {task.prRef ? (
      <p>
        PR: <PrLink refStr={task.prRef} />
      </p>
    ) : null}
    <div class="muted">{task.id}</div>

    <h2>Comments ({comments.length})</h2>
    <div data-live="task-comments">
      {comments.length ? (
        comments.map((c) => <Comment comment={c} />)
      ) : (
        <p class="muted">(none)</p>
      )}
    </div>
    <CommentForm action={`/tasks/${task.id}/comments`} />
  </Layout>
);
