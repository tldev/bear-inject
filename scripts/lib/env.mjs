/**
 * Loads .env from the consumer's repo (the current directory) into
 * process.env, without overriding variables that are already set, so CI and
 * explicit `DOMAIN=... bear-inject ...` always win. Kept dependency-free and
 * imported by every script so they behave identically under node, bun, and
 * GitHub Actions, where no .env exists and this is a no-op.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let text = "";
try {
  text = readFileSync(join(process.cwd(), ".env"), "utf8");
} catch {
  // no .env, nothing to load
}

for (const line of text.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    value = value.slice(1, -1);
  }
  if (process.env[key] === undefined) process.env[key] = value;
}
