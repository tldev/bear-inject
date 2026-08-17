/**
 * Locates the wrangler CLI that npm/bun installed alongside this package
 * (wrangler is a dependency of bear-inject) and runs it in the consumer's
 * cwd. Resolving through the module graph works under any package manager
 * and any hoisting layout; process.execPath keeps it on whichever runtime
 * (node or bun) launched the CLI.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

export function runWrangler(args) {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("wrangler/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.wrangler;
  const result = spawnSync(process.execPath, [join(dirname(pkgPath), bin), ...args], {
    stdio: "inherit",
  });
  return result.status ?? 1;
}
