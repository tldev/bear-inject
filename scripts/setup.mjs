/**
 * One-time Cloudflare onboarding for a Bear Blog domain, the manual steps
 * this Worker depends on, captured as code:
 *
 *   1. apex (and optionally www) CNAME → domain-proxy.bearblog.dev, PROXIED
 *      (orange cloud) so the Worker route sees the traffic
 *   2. SSL mode "full", "flexible" would redirect-loop against Bear's
 *      HTTPS origin
 *   3. always_use_https OFF, Bear renews certs over plain-HTTP ACME, and a
 *      forced HTTPS redirect breaks renewal (site drops offline in ~60 days)
 *
 * Dry-runs by default and prints a plan; --yes applies it. Prints the prior
 * state of anything it changes so you can put it back by hand.
 */
import "./lib/env.mjs";
import { cf, zoneId } from "./lib/cf.mjs";

const DOMAIN = process.env.DOMAIN;
if (!DOMAIN) {
  console.error("DOMAIN is not set");
  process.exit(2);
}
const INCLUDE_WWW = (process.env.INCLUDE_WWW || "true") === "true";
const BEAR_TARGET = "domain-proxy.bearblog.dev";
const apply = process.argv.includes("--yes");

const zone = await zoneId(DOMAIN);
console.log(`zone ${DOMAIN} = ${zone}\n`);

const hosts = [DOMAIN, ...(INCLUDE_WWW ? [`www.${DOMAIN}`] : [])];
const records = await cf(`/zones/${zone}/dns_records?per_page=500`);
const plan = [];

for (const host of hosts) {
  const existing = records.find(
    (r) => r.name === host && ["CNAME", "A", "AAAA"].includes(r.type),
  );
  if (!existing) {
    plan.push({
      desc: `CREATE ${host} CNAME → ${BEAR_TARGET}, proxied`,
      run: () =>
        cf(`/zones/${zone}/dns_records`, {
          method: "POST",
          body: { type: "CNAME", name: host, content: BEAR_TARGET, proxied: true, ttl: 1 },
        }),
    });
  } else if (existing.type !== "CNAME" || existing.content !== BEAR_TARGET) {
    console.log(`!! ${host} is ${existing.type} → ${existing.content}, not a CNAME to ${BEAR_TARGET}.`);
    console.log("   Leaving it alone, point this host at Bear first if the blog should serve here.");
  } else if (!existing.proxied) {
    plan.push({
      desc: `PROXY ${host} (record ${existing.id}; was DNS-only, ttl ${existing.ttl})`,
      run: () =>
        cf(`/zones/${zone}/dns_records/${existing.id}`, {
          method: "PATCH",
          body: { proxied: true, ttl: 1 },
        }),
    });
  } else {
    console.log(`ok ${host} already proxied → ${BEAR_TARGET}`);
  }
}

const ssl = await cf(`/zones/${zone}/settings/ssl`);
if (["full", "strict", "full_strict"].includes(ssl.value)) {
  console.log(`ok ssl mode is "${ssl.value}"`);
} else {
  plan.push({
    desc: `SET ssl mode "full" (was "${ssl.value}", flexible redirect-loops against Bear's HTTPS origin)`,
    run: () => cf(`/zones/${zone}/settings/ssl`, { method: "PATCH", body: { value: "full" } }),
  });
}

const auh = await cf(`/zones/${zone}/settings/always_use_https`);
if (auh.value === "off") {
  console.log("ok always_use_https is off (required for Bear's ACME cert renewals)");
} else {
  plan.push({
    desc: `SET always_use_https off (was "${auh.value}", it breaks Bear's plain-HTTP cert renewal)`,
    run: () =>
      cf(`/zones/${zone}/settings/always_use_https`, { method: "PATCH", body: { value: "off" } }),
  });
}

if (!plan.length) {
  console.log("\nNothing to do, the zone is already set up.");
  process.exit(0);
}

console.log("\nPlan:");
for (const p of plan) console.log(`  - ${p.desc}`);

if (!apply) {
  console.log("\nDry run, nothing changed. Re-run with --yes to apply.");
  process.exit(0);
}

console.log();
for (const p of plan) {
  await p.run();
  console.log(`applied: ${p.desc}`);
}
console.log("\nDone. Emergency stop: `bun run rollback --yes` grey-clouds the records.");
