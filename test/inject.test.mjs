import { describe, it, expect } from "vitest";
import { renderSnippets, applyInjection } from "../src/inject.js";

const SNIPPETS = [
  { name: "10-ga", placement: "head", html: '<script src="https://x/gtag.js?id={{GA_ID}}"></script>' },
  { name: "15-nav", placement: "nav", html: "<span>nav-box {{BTN_USER}}</span>" },
  { name: "20-top", placement: "top", html: "<p>top-box {{BTN_USER}}</p>" },
  { name: "30-bottom", placement: "bottom", html: "<p>bottom-box {{BTN_USER}}</p>" },
  { name: "40-plain", placement: "body", html: '<meta name="x" content="y">' },
];
const ALL_VARS = { GA_ID: "G-1", BTN_USER: "tom" };

const PAGE =
  "<!DOCTYPE html><html><head><title>t</title></head><body><header><a href='/'>T</a><nav><p>links</p></nav></header><main><h2>Hi</h2><p>content</p></main><footer>bear</footer></body></html>";
const htmlRes = () =>
  new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });

describe("renderSnippets", () => {
  it("substitutes vars, buckets by placement, and keeps file order in names", () => {
    const r = renderSnippets(SNIPPETS, ALL_VARS);
    expect(r.names).toEqual(["10-ga", "15-nav", "20-top", "30-bottom", "40-plain"]);
    expect(r.head[0]).toContain("id=G-1");
    expect(r.nav[0]).toContain("nav-box tom");
    expect(r.top[0]).toContain("top-box tom");
    expect(r.bottom[0]).toContain("bottom-box tom");
    expect(r.body[0]).toContain('<meta name="x"');
  });

  it("skips a snippet when any of its vars is unset or empty", () => {
    const r = renderSnippets(SNIPPETS, { GA_ID: "G-1", BTN_USER: "" });
    expect(r.names).toEqual(["10-ga", "40-plain"]);
    expect(r.nav).toEqual([]);
    expect(r.top).toEqual([]);
    expect(r.bottom).toEqual([]);
  });

  it("keeps var-free snippets when nothing else can render", () => {
    const r = renderSnippets(SNIPPETS, {});
    expect(r.names).toEqual(["40-plain"]);
  });
});

describe("applyInjection", () => {
  it("places every bucket correctly relative to the page structure", async () => {
    const res = applyInjection(htmlRes(), renderSnippets(SNIPPETS, ALL_VARS));
    const text = await res.text();
    expect(res.headers.get("x-injected-snippets")).toBe("10-ga,15-nav,20-top,30-bottom,40-plain");

    const at = (s) => {
      const i = text.indexOf(s);
      expect(i, `expected page to contain: ${s}`).toBeGreaterThan(-1);
      return i;
    };
    // head snippet inside <head>
    expect(at("id=G-1")).toBeLessThan(at("</head>"));
    // nav snippet inside the header's nav, after the links
    expect(at("nav-box tom")).toBeGreaterThan(at("<p>links</p>"));
    expect(at("nav-box tom")).toBeLessThan(at("</nav>"));
    // top snippet after <main> opens but before the content
    expect(at("top-box tom")).toBeGreaterThan(at("<main>"));
    expect(at("top-box tom")).toBeLessThan(at("<h2>Hi</h2>"));
    // bottom snippet after the content but before </main> (above the footer)
    expect(at("bottom-box tom")).toBeGreaterThan(at("<p>content</p>"));
    expect(at("bottom-box tom")).toBeLessThan(at("</main>"));
    // body snippet after the footer
    expect(at('<meta name="x"')).toBeGreaterThan(at("<footer>"));
  });

  it('tags "none" and leaves the page byte-identical when every snippet is skipped', async () => {
    const res = applyInjection(htmlRes(), renderSnippets([SNIPPETS[0]], {}));
    expect(res.headers.get("x-injected-snippets")).toBe("none");
    expect(await res.text()).toBe(PAGE);
  });

  it("injects nothing into a page missing the target element", async () => {
    const bare = new Response("<!DOCTYPE html><html><head></head><body>no main</body></html>", {
      headers: { "content-type": "text/html" },
    });
    const res = applyInjection(bare, renderSnippets(SNIPPETS, ALL_VARS));
    const text = await res.text();
    expect(text).not.toContain("nav-box");
    expect(text).not.toContain("top-box");
    expect(text).not.toContain("bottom-box");
    // head/body targets still exist, so those snippets landed
    expect(text).toContain("id=G-1");
  });
});
