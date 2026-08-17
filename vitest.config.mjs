import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Tests run inside workerd (the real Workers runtime), so HTMLRewriter
// behaves exactly as in production. Outbound fetches are mocked per-test
// with fetchMock from "cloudflare:test", no network, no wrangler config.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-14",
      },
    }),
  ],
});
