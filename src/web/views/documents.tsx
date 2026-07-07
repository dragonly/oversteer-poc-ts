import type { FC } from "hono/jsx";
import type { Document, Event } from "../../db/schema.js";
import { Layout } from "./Layout.js";
import { Badge, Prose } from "./components.js";

// Document detail: the living body (rendered markdown/yaml) + an edit form, plus
// the doc's own edit history so a reader sees how it evolved without leaving the
// page. History rows come from the document_* events scoped to this doc.
export const DocumentDetailPage: FC<{
  document: Document;
  history: Event[];
}> = ({ document: doc, history }) => (
  <Layout title={doc.title}>
    <nav>
      <a href={`/plans/${doc.planId}`}>&larr; back to plan</a>
    </nav>
    <h1>
      {doc.title} <Badge status={doc.kind} />
    </h1>
    <div class="muted">
      {doc.id} · updated {doc.updatedAt.toISOString()}
    </div>

    <div class="card">
      <Prose src={doc.body || "*(empty)*"} />
    </div>

    <details class="edit-intent">
      <summary class="muted">edit document</summary>
      <form method="post" action={`/documents/${doc.id}`}>
        <input name="author" value="human:yilongli" />
        <input name="title" value={doc.title} required />
        <input name="kind" value={doc.kind} placeholder="kind (discovery/design/catalog/result/note)" />
        <textarea name="body" rows={20} required>{doc.body}</textarea>
        <button type="submit">Save document</button>
      </form>
    </details>

    <h2>Edit history ({history.length})</h2>
    {history.length ? (
      history.map((e) => {
        const d = (e.data ?? {}) as Record<string, string>;
        const label = e.kind === "document_created" ? "➕ created" : "✏️ edited";
        const hasDiff = d.old !== undefined || d.new !== undefined;
        return (
          <div class="event muted" id={`e-${e.id}`}>
            {label} · {e.author} · {e.createdAt.toISOString()}
            {hasDiff ? (
              <details>
                <summary>body diff</summary>
                <div class="intent">
                  <s>{d.old}</s>
                  {"\n→\n"}
                  {d.new}
                </div>
              </details>
            ) : null}
          </div>
        );
      })
    ) : (
      <p class="muted">(none)</p>
    )}
  </Layout>
);
