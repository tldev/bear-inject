/**
 * Integration tests for the full Worker built via createWorker, using
 * fixture snippets shaped like the real templates (a head analytics tag and
 * a nav subscribe form).
 *
 * Tests and Worker share one workerd isolate, so outbound fetch is stubbed
 * by swapping globalThis.fetch: no network, no mock framework.
 */
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { createWorker } from "../src/index.js";

const SNIPPETS = [
  {
    name: "10-analytics",
    placement: "head",
    html: '<script async src="https://tracker.test/t.js?id={{TRACKER_ID}}"></script>',
  },
  {
    name: "30-subscribe",
    placement: "nav",
    html: '<form class="sub" action="https://letters.test/{{NEWSLETTER_USER}}" method="post"><input type="email" name="email"><button>Subscribe</button></form>',
  },
];
const worker = createWorker(SNIPPETS);

const ORIGIN = "https://blog.test";
const PAGE =
  "<!DOCTYPE html><html><head><title>t</title></head><body><header><nav><p>links</p></nav></header><main>post</main><footer>f</footer></body></html>";
const FEED =
  '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title></feed>';

const FULL_ENV = { TRACKER_ID: "T-1", NEWSLETTER_USER: "tester" };

const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  globalThis.fetch = async (input) => {
    throw new Error(`unexpected fetch: ${input instanceof Request ? input.url : input}`);
  };
});

/** The origin serves exactly one URL; anything else throws loudly. */
function originServes(url, body, contentType) {
  globalThis.fetch = async (input) => {
    const got = input instanceof Request ? input.url : String(input);
    if (got !== url) throw new Error(`unexpected origin fetch: ${got} (expected ${url})`);
    return new Response(body, { headers: { "content-type": contentType } });
  };
}

async function run(path, env) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("createWorker", () => {
  it("injects the head snippet exactly once, inside <head>", async () => {
    originServes(`${ORIGIN}/`, PAGE, "text/html; charset=utf-8");
    const res = await run("/", FULL_ENV);
    const text = await res.text();
    expect(res.headers.get("x-injected-snippets")).toBe("10-analytics,30-subscribe");
    expect(text.split("tracker.test/t.js?id=T-1").length - 1).toBe(1);
    expect(text.indexOf("t.js?id=T-1")).toBeLessThan(text.indexOf("</head>"));
  });

  it("injects the nav snippet into the nav row, exactly once", async () => {
    originServes(`${ORIGIN}/`, PAGE, "text/html; charset=utf-8");
    const res = await run("/", FULL_ENV);
    const text = await res.text();
    expect(text.split("letters.test/tester").length - 1).toBe(1);
    expect(text.indexOf("letters.test/tester")).toBeGreaterThan(text.indexOf("<nav>"));
    expect(text.indexOf("letters.test/tester")).toBeLessThan(text.indexOf("</nav>"));
  });

  it("serves HTML byte-identical when no snippet vars are set", async () => {
    originServes(`${ORIGIN}/`, PAGE, "text/html; charset=utf-8");
    const res = await run("/", {});
    expect(res.headers.get("x-injected-snippets")).toBe("none");
    expect(await res.text()).toBe(PAGE);
  });

  it("leaves the Atom feed byte-identical", async () => {
    originServes(`${ORIGIN}/feed/`, FEED, "application/atom+xml");
    const res = await run("/feed/", FULL_ENV);
    expect(res.headers.get("x-injected-snippets")).toBeNull();
    expect(await res.text()).toBe(FEED);
  });

  it("passes ACME challenges through unrewritten, even if they claim to be HTML", async () => {
    originServes(`${ORIGIN}/.well-known/acme-challenge/tok123`, "<head>challenge</head>", "text/html");
    const res = await run("/.well-known/acme-challenge/tok123", FULL_ENV);
    expect(res.headers.get("x-injected-snippets")).toBeNull();
    expect(await res.text()).toBe("<head>challenge</head>");
  });

  it("preserves path and query when the ORIGIN_URL dev override is set", async () => {
    originServes("https://origin.test/p?q=1", PAGE, "text/html");
    const res = await run("/p?q=1", { ...FULL_ENV, ORIGIN_URL: "https://origin.test" });
    expect(res.headers.get("x-injected-snippets")).toContain("10-analytics");
  });
});
