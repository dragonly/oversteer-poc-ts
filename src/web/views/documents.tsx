import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import type { Document, Event } from "../../db/schema.js";
import { Layout } from "./Layout.js";
import { Badge, Prose } from "./components.js";

// Split a markdown body into heading-delimited sections. Each section is a
// heading line plus everything up to (but not including) the next heading; text
// before the first heading is its own leading section. Splitting on lines only
// means `sections.join("\n") === body` exactly, so reassembly on save is lossless.
function splitSections(body: string): string[] {
  const lines = body.split("\n");
  const sections: string[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && cur.length) {
      sections.push(cur.join("\n"));
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length || sections.length === 0) sections.push(cur.join("\n"));
  return sections;
}

// In-place section editing: hover a rendered section → an "edit" affordance
// appears; clicking swaps that section's rendered view for a textarea holding
// just that section's raw markdown, at the exact spot the reader was looking at.
// Save reads *all* section textareas (edited or not), joins them back into the
// full body, and posts to the normal /documents/:id endpoint, then reloads.
// This solves the "can't find in the plain textarea what I saw in the preview"
// problem without pulling in a WYSIWYG editor.
const SECTION_EDIT_SCRIPT = `
(function () {
  var root = document.getElementById('doc-body');
  if (!root) return;
  function sections() { return root.querySelectorAll('.doc-section'); }

  function fullBody() {
    return Array.prototype.map
      .call(sections(), function (s) { return s.querySelector('textarea').value; })
      .join('\\n');
  }

  async function save() {
    var fd = new FormData();
    fd.set('author', root.dataset.author || 'human:web');
    fd.set('title', root.dataset.title || '');
    fd.set('kind', root.dataset.kind || '');
    fd.set('body', fullBody());
    var res = await fetch(location.pathname, { method: 'POST', body: fd });
    if (res.ok || res.redirected) location.reload();
  }

  function enter(sec) {
    sec.classList.add('editing');
    var ta = sec.querySelector('textarea');
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 40) + 'px';
    ta.focus();
  }
  function leave(sec, revert, original) {
    if (revert) sec.querySelector('textarea').value = original;
    sec.classList.remove('editing');
  }

  root.addEventListener('click', function (ev) {
    var t = ev.target;
    var sec = t.closest('.doc-section');
    if (!sec) return;
    if (t.classList.contains('sec-edit')) { enter(sec); }
    else if (t.classList.contains('sec-cancel')) {
      leave(sec, true, sec.querySelector('textarea').defaultValue);
    }
    else if (t.classList.contains('sec-save')) { save(); }
  });
})();
`;

const SECTION_STYLE = `
  .doc-section { position: relative; }
  .doc-section .sec-edit {
    position: absolute; top: 2px; right: 2px; padding: 1px 8px;
    background: #8882; color: inherit; font-size: 0.75em; opacity: 0;
    transition: opacity 0.1s;
  }
  .doc-section:hover .sec-edit { opacity: 0.7; }
  .doc-section .sec-edit:hover { opacity: 1; }
  .doc-section .sec-editor { display: none; }
  .doc-section.editing .prose,
  .doc-section.editing .sec-edit { display: none; }
  .doc-section.editing .sec-editor { display: grid; gap: 0.4rem; margin: 0; }
  .doc-section .sec-editor textarea { min-height: 40px; }
  .doc-section .sec-actions { display: flex; gap: 0.5rem; }
  .doc-section .sec-cancel { background: #8883; color: inherit; }
`;

// Document detail: the living body (rendered markdown/yaml) + an edit form, plus
// the doc's own edit history so a reader sees how it evolved without leaving the
// page. History rows come from the document_* events scoped to this doc.
export const DocumentDetailPage: FC<{
  document: Document;
  history: Event[];
}> = ({ document: doc, history }) => {
  const sections = splitSections(doc.body || "");
  return (
    <Layout title={doc.title}>
      <style dangerouslySetInnerHTML={{ __html: SECTION_STYLE }} />
      <nav>
        <a href={`/plans/${doc.planId}`}>&larr; back to plan</a>
      </nav>
      <h1>
        {doc.title} <Badge status={doc.kind} />
      </h1>
      <div class="muted">
        {doc.id} · updated {doc.updatedAt.toISOString()} · hover a section to edit in place
      </div>

      <div
        class="card"
        id="doc-body"
        data-title={doc.title}
        data-kind={doc.kind}
        data-author="human:yilongli"
      >
        {sections.map((sec, i) => (
          <div class="doc-section" data-idx={i}>
            <Prose src={sec.trim() ? sec : "*(empty)*"} />
            <button type="button" class="sec-edit">
              edit
            </button>
            <div class="sec-editor">
              <textarea rows={4}>{sec}</textarea>
              <div class="sec-actions">
                <button type="button" class="sec-save">
                  Save
                </button>
                <button type="button" class="sec-cancel">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <details class="edit-intent">
        <summary class="muted">edit full document (raw)</summary>
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
      <script dangerouslySetInnerHTML={{ __html: SECTION_EDIT_SCRIPT }} />
    </Layout>
  );
};
