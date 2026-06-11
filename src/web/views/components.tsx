import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { marked } from "marked";
import type { PlanComment, TaskComment } from "../../db/schema.js";
import type { Activity } from "../../data/index.js";

// Render a comment body as markdown. POC threat model: authors are the local
// human + trusted agents, so we don't sanitize marked's HTML output.
marked.setOptions({ breaks: true, gfm: true });
function md(src: string): string {
  return marked.parse(src, { async: false }) as string;
}

// Autolink bare oversteer ids in rendered text. A uuid alone can't tell us
// whether it's a plan or a task, so we point at /go/:id which resolves the type
// server-side and redirects. Works for both comment bodies and intent text.
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
export function linkifyIds(html: string): string {
  return html.replace(UUID_RE, (id) => `<a href="/go/${id}">${id}</a>`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Plain text (e.g. a plan/task intent): escape, then autolink ids. CSS keeps
// newlines via white-space: pre-wrap.
export const IntentText: FC<{ text: string }> = ({ text }) => (
  <div class="intent">{raw(linkifyIds(escapeHtml(text)))}</div>
);

export const Badge: FC<{ status: string }> = ({ status }) => (
  <span class="badge">{status}</span>
);

// Render a PR ref like `owner/repo#42` as a clickable GitHub PR link.
// Falls back to plain text for anything that doesn't match.
export const PrLink: FC<{ refStr: string }> = ({ refStr }) => {
  const m = refStr.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  if (!m) return <span class="muted">{refStr}</span>;
  const [, owner, repo, num] = m;
  const url = `https://github.com/${owner}/${repo}/pull/${num}`;
  return (
    <a class="muted" href={url} target="_blank" rel="noopener">
      {refStr}
    </a>
  );
};

export const Comment: FC<{ comment: PlanComment | TaskComment }> = ({ comment }) => (
  <div class="comment">
    <div class="muted">
      {comment.author} · {comment.createdAt.toISOString()}
    </div>
    <div class="body">{raw(linkifyIds(md(comment.body)))}</div>
  </div>
);

export const CommentForm: FC<{ action: string }> = ({ action }) => (
  <form method="post" action={action}>
    <input name="author" value="human:yilongli" />
    <textarea name="body" placeholder="comment" rows={2} required></textarea>
    <button type="submit">Comment</button>
  </form>
);

// One row of the unified activity stream. Comments render their markdown body;
// state-change events (task created / status / pr / intent edit) render a compact
// one-liner. A task-scoped row carries a [task] tag that links back to the task,
// so the reader never has to cross-reference which task an event belongs to.
export const ActivityRow: FC<{ item: Activity }> = ({ item }) => {
  const when = new Date(item.at).toISOString();
  const taskTag = item.taskId ? (
    <a class="badge" href={`/tasks/${item.taskId}`}>
      {item.taskTitle ?? "task"}
    </a>
  ) : null;
  const d = (item.data ?? {}) as Record<string, string>;

  if (item.kind === "plan_comment" || item.kind === "task_comment") {
    return (
      <div class="comment" id={`c-${item.id}`}>
        <div class="muted">
          💬 {item.author} · {when} {taskTag}
          {item.inReplyTo ? (
            <>
              {" "}
              <a href={`#c-${item.inReplyTo}`}>↳ re: {item.inReplyTo.slice(0, 8)}</a>
            </>
          ) : null}
        </div>
        <div class="body">{raw(linkifyIds(md(item.body ?? "")))}</div>
      </div>
    );
  }

  let text: string;
  switch (item.kind) {
    case "task_created":
      text = `➕ task created`;
      break;
    case "status_changed":
      text = `🔄 status ${d.from} → ${d.to}`;
      break;
    case "pr_set":
      text = `🔗 pr ${d.ref}`;
      break;
    case "plan_intent_edited":
    case "task_intent_edited": {
      // Show what changed: an expandable old→new diff so the reader can see the
      // edit inline without leaving the stream (acceptance: "可看到改了什么").
      const label = item.kind === "plan_intent_edited" ? "plan" : "task";
      return (
        <div class="event muted">
          ✏️ {label} intent edited · {item.author} · {when} {taskTag}
          <details>
            <summary>diff</summary>
            <div class="intent">
              <s>{d.old}</s>
              {"\n→\n"}
              {d.new}
            </div>
          </details>
        </div>
      );
    }
    default:
      text = item.kind;
  }
  return (
    <div class="event muted">
      {text} · {item.author} · {when} {taskTag}
    </div>
  );
};
