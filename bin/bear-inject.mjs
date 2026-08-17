#!/usr/bin/env node
/**
 * bear-inject CLI. Runs in the CONSUMER's repo (process.cwd()): reads its
 * snippets/ and .env, writes build output to .bear-inject/, and drives
 * wrangler against the generated config.
 */
import { runWrangler } from "../scripts/lib/wrangler.mjs";

const CONFIG = ".bear-inject/wrangler.generated.json";
const [cmd, ...rest] = process.argv.slice(2);

async function gen() {
  await import("../scripts/gen-snippets.mjs");
  await import("../scripts/gen-config.mjs");
}

switch (cmd) {
  case "gen":
    await gen();
    break;
  case "deploy":
    await gen();
    process.exit(runWrangler(["deploy", "-c", CONFIG, ...rest]));
  case "dry-run":
    await gen();
    process.exit(runWrangler(["deploy", "--dry-run", "--outdir", ".bear-inject/dist", "-c", CONFIG, ...rest]));
  case "dev":
    await gen();
    process.exit(runWrangler(["dev", "-c", CONFIG, "--port", "8799", ...rest]));
  case "verify":
    await import("../scripts/verify.mjs");
    break;
  case "setup":
    await import("../scripts/setup.mjs");
    break;
  case "rollback":
    await import("../scripts/rollback.mjs");
    break;
  case "purge-cache":
    await import("../scripts/purge-cache.mjs");
    break;
  default:
    console.log(`bear-inject: inject snippets into a Bear Blog at the Cloudflare edge

usage: bear-inject <command> [flags]

  gen          compile snippets/ and render wrangler config into .bear-inject/
  dry-run      gen + validate a full wrangler build without deploying
  deploy       gen + wrangler deploy
  dev          gen + wrangler dev on port 8799 (set ORIGIN_URL in .dev.vars)
  verify       assert the LIVE site: snippets present exactly once, feed and
               ACME paths untouched
  setup        one-time Cloudflare DNS/settings onboarding (dry run; --yes applies)
  rollback     emergency stop: grey-cloud the DNS records (dry run; --yes applies)
  purge-cache  purge the zone's Cloudflare cache (rarely needed)

Configuration comes from env vars or .env in the current directory:
DOMAIN (required), CLOUDFLARE_ACCOUNT_ID, VARS_JSON, INCLUDE_WWW,
WORKER_NAME, FEED_PATH, and CLOUDFLARE_API_TOKEN (export it; never in .env).`);
    process.exit(cmd ? 1 : 0);
}
