/**
 * Renders .bear-inject/wrangler.generated.json from environment variables so
 * the same package deploys any Bear Blog: set DOMAIN (and friends) instead
 * of editing config. Wrangler itself also reads CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID from the environment.
 *
 * Notes baked into the output:
 *  - workers_dev=false: an open *.workers.dev copy would serve a proxied
 *    duplicate of the blog under a different hostname.
 *  - routes only carry traffic while the DNS records are orange-clouded;
 *    grey-clouding (bear-inject rollback) is the emergency stop.
 *  - vars ship inside public page HTML, so they are plain vars, not secrets.
 */
import "./lib/env.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), ".bear-inject");
const env = (name, fallback) => process.env[name] || fallback;

const DOMAIN = env("DOMAIN");
if (!DOMAIN || !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(DOMAIN)) {
  console.error("DOMAIN must be your blog's apex domain, e.g. DOMAIN=example.com");
  process.exit(2);
}

let vars;
try {
  vars = JSON.parse(env("VARS_JSON", "{}"));
} catch (e) {
  console.error(`VARS_JSON is not valid JSON: ${e.message}`);
  process.exit(2);
}

const WORKER_NAME = env("WORKER_NAME", "bear-inject");
const routes = [{ pattern: `${DOMAIN}/*`, zone_name: DOMAIN }];
if (env("INCLUDE_WWW", "true") === "true") {
  routes.push({ pattern: `www.${DOMAIN}/*`, zone_name: DOMAIN });
}

const config = {
  name: WORKER_NAME,
  main: "entry.js", // relative to this config file, inside .bear-inject/
  compatibility_date: "2026-08-14",
  workers_dev: false,
  routes,
  vars,
};

// Wrangler also reads CLOUDFLARE_ACCOUNT_ID from its own environment, but
// baking it in here lets wrangler subcommands work no matter how they are
// launched. Absent (e.g. a credential-less dry run) it is simply omitted.
if (env("CLOUDFLARE_ACCOUNT_ID")) config.account_id = env("CLOUDFLARE_ACCOUNT_ID");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "wrangler.generated.json"), JSON.stringify(config, null, 2) + "\n");
console.log(
  `config: worker=${WORKER_NAME} routes=[${routes.map((r) => r.pattern).join(", ")}] vars=[${Object.keys(vars).join(", ")}]`,
);
