/**
 * Post-deploy verification against the LIVE site, through the Cloudflare
 * edge. Asserts everything that has bitten before:
 *
 *   - every snippet whose {{VARS}} are all set is injected exactly once,
 *     and the x-injected-snippets header agrees
 *   - the feed is untouched, still XML, and contains no snippet
 *   - robots.txt is untouched
 *   - /.well-known/acme-challenge/* is NOT rewritten (Bear cert renewals)
 *
 * Two traps this script sidesteps deliberately:
 *   - Bear 403s non-browser user agents → it sends a real browser UA
 *   - a stale local DNS answer can bypass the Worker entirely → CI runners
 *     are fresh; locally, if results look impossible, compare
 *     `curl -sw '%{remote_ip}' -o /dev/null https://$DOMAIN/` with
 *     `dig +short $DOMAIN A` before blaming the deploy.
 */
import "./lib/env.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Runs in the consumer's repo: snippets/ is read from the current directory.
const root = process.cwd();
const DOMAIN = process.env.DOMAIN;
if (!DOMAIN) {
  console.error("DOMAIN is not set");
  process.exit(2);
}
const INCLUDE_WWW = (process.env.INCLUDE_WWW || "true") === "true";
const FEED_PATH = process.env.FEED_PATH || "/feed/";
const VARS = JSON.parse(process.env.VARS_JSON || "{}");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

// Recompute what the Worker should inject from the same snippet sources,
// with the same skip-on-missing-var rule as src/inject.js.
const VAR_RE = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;
const expected = [];
// Same placement order as scripts/gen-snippets.mjs, so the expected
// x-injected-snippets value matches what the Worker emits.
for (const placement of ["head", "nav", "top", "bottom", "body"]) {
  let files = [];
  try {
    files = readdirSync(join(root, "snippets", placement))
      .filter((f) => f.endsWith(".html"))
      .sort();
  } catch {
    continue;
  }
  for (const f of files) {
    const raw = readFileSync(join(root, "snippets", placement, f), "utf8").trim();
    let ok = true;
    const html = raw.replace(VAR_RE, (_, k) => {
      const v = VARS[k];
      if (v === undefined || v === null || v === "") {
        ok = false;
        return "";
      }
      return String(v);
    });
    if (ok) expected.push({ name: f.replace(/\.html$/, ""), html });
  }
}

let failures = 0;
const pass = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};

const get = (url, opts = {}) =>
  fetch(url, { headers: { "user-agent": UA }, redirect: "follow", ...opts });

// Worker deploys and DNS propagate in seconds, retry transient mismatches
// instead of failing the pipeline on a race.
async function check(label, fn, attempts = 4) {
  console.log(`\n${label}`);
  for (let i = 1; ; i++) {
    const before = failures;
    try {
      await fn();
      if (failures === before) return;
    } catch (e) {
      fail(`threw: ${e.message}`);
    }
    if (i >= attempts) return;
    failures = before;
    console.log(`  …retrying (${i}/${attempts - 1})`);
    await new Promise((r) => setTimeout(r, 6000));
  }
}

async function checkPage(host) {
  const res = await get(`https://${host}/`);
  if (res.status !== 200) return fail(`${host}/ → status ${res.status}`);
  pass(`${host}/ → 200`);
  const body = await res.text();
  const header = res.headers.get("x-injected-snippets");
  const want = expected.map((e) => e.name).join(",") || "none";
  if (header === want) pass(`x-injected-snippets: ${header}`);
  else
    fail(
      `x-injected-snippets is ${JSON.stringify(header)}, expected "${want}"` +
        (header === null ? ", header missing means the Worker did not run; is the DNS record orange-clouded?" : ""),
    );
  for (const e of expected) {
    const count = body.split(e.html).length - 1;
    if (count === 1) pass(`snippet ${e.name} present exactly once`);
    else fail(`snippet ${e.name} found ${count} times, expected exactly 1`);
  }
}

await check(`page https://${DOMAIN}/`, () => checkPage(DOMAIN));
if (INCLUDE_WWW) await check(`page https://www.${DOMAIN}/`, () => checkPage(`www.${DOMAIN}`));

await check(`feed https://${DOMAIN}${FEED_PATH}`, async () => {
  const res = await get(`https://${DOMAIN}${FEED_PATH}`);
  const ct = res.headers.get("content-type") || "";
  const body = await res.text();
  if (res.status === 200) pass(`status 200 (${ct})`);
  else return fail(`status ${res.status}`);
  if (ct.includes("xml")) pass("content-type is XML");
  else fail(`content-type "${ct}" is not XML`);
  if (body.trimStart().startsWith("<?xml")) pass("body starts with <?xml");
  else fail("body does not start with <?xml");
  if (res.headers.get("x-injected-snippets") === null) pass("not tagged by the Worker");
  else fail("feed was processed as HTML");
  const leaked = expected.find((e) => body.includes(e.html));
  if (leaked) fail(`snippet ${leaked.name} leaked into the feed`);
  else pass("no snippets in the feed");
});

await check(`robots https://${DOMAIN}/robots.txt`, async () => {
  const res = await get(`https://${DOMAIN}/robots.txt`);
  if (res.status === 200) pass("status 200");
  else fail(`status ${res.status}`);
  if (res.headers.get("x-injected-snippets") === null) pass("untouched");
  else fail("robots.txt was processed as HTML");
});

await check(`acme http://${DOMAIN}/.well-known/acme-challenge/ci-probe`, async () => {
  // With no active challenge Bear's Caddy answers 308→https or 404, both
  // fine. What must never happen is the Worker rewriting this path.
  const res = await get(`http://${DOMAIN}/.well-known/acme-challenge/ci-probe`, {
    redirect: "manual",
  });
  pass(`origin answered ${res.status} (any status is fine with no active challenge)`);
  if (res.headers.get("x-injected-snippets") === null) pass("passthrough, not rewritten by the Worker");
  else fail("ACME path was rewritten, cert renewal would break");
});

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
