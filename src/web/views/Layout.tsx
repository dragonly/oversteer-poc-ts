import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1 { font-size: 1.4rem; }
  .muted { color: #888; font-size: 0.85em; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; background: #eee; color: #333; font-size: 0.8em; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem 1rem; margin: 0.5rem 0; }
  .intent { white-space: pre-wrap; color: #444; }
  form { margin: 1rem 0; display: grid; gap: 0.5rem; }
  input, textarea { font: inherit; padding: 0.5rem; border: 1px solid #ccc; border-radius: 6px; width: 100%; box-sizing: border-box; }
  button { font: inherit; padding: 0.5rem 1rem; border: 0; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; width: fit-content; }
  .comment { border-left: 3px solid #ddd; padding: 0.25rem 0 0.25rem 0.75rem; margin: 0.5rem 0; }
  .prose > :first-child { margin-top: 0.25rem; }
  .prose > :last-child { margin-bottom: 0; }
  .prose code { background: #8881; padding: 0.1em 0.3em; border-radius: 4px; font-size: 0.9em; }
  .prose pre { background: #8881; padding: 0.6rem 0.8rem; border-radius: 6px; overflow-x: auto; }
  .prose pre code { background: none; padding: 0; }
  .prose ol, .prose ul { padding-left: 1.4rem; }
  nav { margin-bottom: 1rem; }
`;

// POC auto-refresh: poll the current page and swap only the regions tagged
// [data-live] when their HTML changes. No SPA framework — keeps forms, scroll,
// and focus intact so the human sees agent comments appear without a manual reload.
const LIVE_SCRIPT = `
(function () {
  var INTERVAL = 4000;
  function live() { return document.querySelectorAll('[data-live]'); }
  if (!live().length) return;
  async function tick() {
    try {
      var res = await fetch(location.href, { headers: { 'x-live': '1' } });
      if (!res.ok) return;
      var doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      live().forEach(function (el) {
        var key = el.getAttribute('data-live');
        var next = doc.querySelector('[data-live="' + key + '"]');
        if (next && next.innerHTML !== el.innerHTML && !el.contains(document.activeElement)) {
          el.innerHTML = next.innerHTML;
        }
      });
    } catch (e) { /* transient; try again next tick */ }
  }
  setInterval(tick, INTERVAL);
})();
`;

export const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <>
    {raw("<!doctype html>")}
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · oversteer</title>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
    </head>
    <body>
      <nav>
        <a href="/">&larr; all plans</a>
      </nav>
      {children}
      <script dangerouslySetInnerHTML={{ __html: LIVE_SCRIPT }} />
      </body>
    </html>
  </>
);
