/**
 * Builds the Cloudflare Worker fetch handler for a compiled snippet list.
 * Consumers never write this by hand: `bear-inject gen` compiles their
 * snippets/ directory and emits an entry module that calls createWorker.
 */
import { renderSnippets, applyInjection } from "./inject.js";

// Bear renews its cert via HTTP-01. These requests must reach the origin
// byte-for-byte, over plain HTTP, or renewal fails and the site drops offline.
const ACME_PREFIX = "/.well-known/acme-challenge/";

export function createWorker(snippets) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);

      // In production ORIGIN_URL is unset and we pass `request` through as-is:
      // Cloudflare's loop prevention routes a Worker's subrequest to its own
      // route straight to the origin instead of re-invoking this Worker, and
      // it is the only way to reach Bear with the Host header intact (Workers
      // cannot override Host, and Bear's Caddy picks the blog by Host).
      //
      // Locally that same call would recurse into the dev server, so
      // `wrangler dev` sets ORIGIN_URL (via .dev.vars) to fetch the real
      // site instead.
      const upstream = env.ORIGIN_URL
        ? new Request(new URL(url.pathname + url.search, env.ORIGIN_URL), request)
        : request;

      if (url.pathname.startsWith(ACME_PREFIX)) {
        return fetch(upstream);
      }

      const res = await fetch(upstream);

      // Only touch HTML. The Atom feed is application/atom+xml and RSS
      // readers will choke on an injected <script>, so it must fall through.
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/html")) return res;

      return applyInjection(res, renderSnippets(snippets, env));
    },
  };
}
