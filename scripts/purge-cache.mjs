/**
 * Purges the zone's Cloudflare cache. Rarely needed: Cloudflare does not
 * cache HTML by default, so Worker deploys take effect immediately. Useful
 * only if you add Cache Rules later. Requires the token to also have the
 * "Zone → Cache Purge" permission (not part of the base scope set), and is
 * only run by CI when the PURGE_CACHE repo variable is "true".
 */
import "./lib/env.mjs";
import { cf, zoneId } from "./lib/cf.mjs";

const DOMAIN = process.env.DOMAIN;
if (!DOMAIN) {
  console.error("DOMAIN is not set");
  process.exit(2);
}

const zone = await zoneId(DOMAIN);
await cf(`/zones/${zone}/purge_cache`, { method: "POST", body: { purge_everything: true } });
console.log(`purged all Cloudflare cache for ${DOMAIN}`);
