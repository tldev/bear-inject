/**
 * Pure snippet-injection logic, kept separate from routing so tests can
 * exercise it with synthetic snippet lists.
 */

// Where a snippet can land, keyed by its directory under snippets/.
// Bear pages are always <header>/<main>/<footer>, so "top" and "bottom"
// bracket the content on every page. A page missing the target element
// simply gets nothing (HTMLRewriter handlers only fire on a match).
export const PLACEMENTS = {
  head: { selector: "head", action: "append" }, //       …before </head>
  nav: { selector: "header nav", action: "append" }, //  end of the site nav row
  top: { selector: "main", action: "prepend" }, //       just under the header/nav
  bottom: { selector: "main", action: "append" }, //     just above the footer
  body: { selector: "body", action: "append" }, //       …before </body>
};

// {{VAR_NAME}} placeholders are filled from the Worker's vars at request time.
const VAR_RE = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;

/**
 * Substitute {{VARS}} in each snippet from env. A snippet referencing a var
 * that is unset (or empty) is skipped entirely rather than injected broken;
 * unsetting a var is how a snippet is turned off without deleting its file.
 */
export function renderSnippets(snippets, env) {
  const rendered = Object.fromEntries(Object.keys(PLACEMENTS).map((p) => [p, []]));
  rendered.names = [];
  for (const s of snippets) {
    let ok = true;
    const html = s.html.replace(VAR_RE, (_, name) => {
      const v = env[name];
      if (v === undefined || v === null || v === "") {
        ok = false;
        return "";
      }
      return String(v);
    });
    if (!ok) continue;
    (rendered[s.placement] ?? rendered.body).push(`<!-- inject:${s.name} -->\n${html}`);
    rendered.names.push(s.name);
  }
  return rendered;
}

/**
 * Insert rendered snippets at their placements and tag the response so
 * production behavior is observable from outside: x-injected-snippets
 * lists what actually went in ("none" = Worker ran on HTML but every snippet
 * was skipped; header absent on HTML = Worker never ran for that request).
 */
export function applyInjection(res, rendered) {
  let out = res;
  if (rendered.names.length) {
    const rw = new HTMLRewriter();
    for (const [placement, { selector, action }] of Object.entries(PLACEMENTS)) {
      const chunks = rendered[placement];
      if (!chunks.length) continue;
      rw.on(selector, {
        element(e) {
          e[action](chunks.join("\n"), { html: true });
        },
      });
    }
    out = rw.transform(res);
  }
  const tagged = new Response(out.body, out);
  tagged.headers.set("x-injected-snippets", rendered.names.join(",") || "none");
  return tagged;
}
