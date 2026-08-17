var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/snippets.generated.js
var snippets_generated_default = [
  {
    "name": "10-ga",
    "placement": "head",
    "html": `<script async src="https://www.googletagmanager.com/gtag/js?id={{GA_ID}}"><\/script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('js',new Date());gtag('config','{{GA_ID}}');<\/script>`
  }
];

// src/inject.js
var VAR_RE = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;
function renderSnippets(snippets, env) {
  const head = [];
  const body = [];
  const names = [];
  for (const s of snippets) {
    let ok = true;
    const html = s.html.replace(VAR_RE, (_, name) => {
      const v = env[name];
      if (v === void 0 || v === null || v === "") {
        ok = false;
        return "";
      }
      return String(v);
    });
    if (!ok) continue;
    (s.placement === "body" ? body : head).push(`<!-- inject:${s.name} -->
${html}`);
    names.push(s.name);
  }
  return { head, body, names };
}
__name(renderSnippets, "renderSnippets");
function applyInjection(res, rendered) {
  let out = res;
  if (rendered.head.length || rendered.body.length) {
    const rw = new HTMLRewriter();
    if (rendered.head.length) {
      rw.on("head", {
        element(e) {
          e.append(rendered.head.join("\n"), { html: true });
        }
      });
    }
    if (rendered.body.length) {
      rw.on("body", {
        element(e) {
          e.append(rendered.body.join("\n"), { html: true });
        }
      });
    }
    out = rw.transform(res);
  }
  const tagged = new Response(out.body, out);
  tagged.headers.set("x-injected-snippets", rendered.names.join(",") || "none");
  return tagged;
}
__name(applyInjection, "applyInjection");

// src/index.js
var ACME_PREFIX = "/.well-known/acme-challenge/";
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upstream = env.ORIGIN_URL ? new Request(new URL(url.pathname + url.search, env.ORIGIN_URL), request) : request;
    if (url.pathname.startsWith(ACME_PREFIX)) {
      return fetch(upstream);
    }
    const res = await fetch(upstream);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return res;
    return applyInjection(res, renderSnippets(snippets_generated_default, env));
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
