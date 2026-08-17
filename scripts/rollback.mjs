/**
 * Emergency stop: grey-cloud the blog's DNS records so traffic goes straight
 * to Bear and the Worker becomes unreachable. Takes effect in seconds and
 * changes nothing else, the Worker, its routes, and its vars all stay put.
 * Re-enable later with `bun run setup --yes`.
 */
import "./lib/env.mjs";
import { cf, zoneId } from "./lib/cf.mjs";

const DOMAIN = process.env.DOMAIN;
if (!DOMAIN) {
  console.error("DOMAIN is not set");
  process.exit(2);
}
const INCLUDE_WWW = (process.env.INCLUDE_WWW || "true") === "true";
const apply = process.argv.includes("--yes");

const zone = await zoneId(DOMAIN);
const hosts = [DOMAIN, ...(INCLUDE_WWW ? [`www.${DOMAIN}`] : [])];
const records = await cf(`/zones/${zone}/dns_records?per_page=500`);
const targets = records.filter((r) => hosts.includes(r.name) && r.type === "CNAME" && r.proxied);

if (!targets.length) {
  console.log(`Nothing to do, no proxied CNAMEs found for ${hosts.join(", ")}.`);
  process.exit(0);
}

for (const r of targets) console.log(`would grey-cloud ${r.name} (record ${r.id})`);

if (!apply) {
  console.log("\nDry run, nothing changed. Re-run with --yes to disconnect the Worker.");
  process.exit(0);
}

console.log();
for (const r of targets) {
  await cf(`/zones/${zone}/dns_records/${r.id}`, { method: "PATCH", body: { proxied: false } });
  console.log(`grey-clouded ${r.name}, traffic now bypasses Cloudflare and the Worker`);
}
console.log("\nDone. Undo with `bun run setup --yes`.");
