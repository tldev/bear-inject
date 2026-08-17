# bear-inject

Inject analytics, subscribe forms, or any HTML/JS snippet into a
[Bear Blog](https://bearblog.dev), which allows no script injection, by
proxying your custom domain through Cloudflare and rewriting the HTML at the
edge with a Worker.

This is a reusable library and CLI. Your blog lives in its own repo that
depends on this package; that repo holds your snippets, your configuration,
and your CI. This repo holds the engine, ready-made templates for all three,
and no site-specific anything.

```
visitor -> Cloudflare edge -> Worker (injects your snippets/) -> Bear Blog origin
                 ^
      orange-clouded DNS record; grey-clouding it is the instant kill switch
```

## Set up a blog repo

1. Create a repo for your blog and install the package:

   ```bash
   bun init -y
   bun add github:tldev/bear-inject
   ```

2. Add snippets (see below) and copy the templates you want:
   `templates/.env.example` to `.env`, `templates/github/*.yml` to
   `.github/workflows/`, and anything from `templates/snippets/` into your
   `snippets/` (drop the `.example` suffix to activate one).

3. Cloudflare one-time setup. Your domain must be a Cloudflare zone. Create
   an API token with:
   - Account: **Workers Scripts: Edit**
   - Zone (your zone only): **Zone: Read**, **DNS: Edit**,
     **Workers Routes: Edit**, **Zone Settings: Read** (Edit if you want
     `setup` to fix settings for you), optionally **Cache Purge: Purge**

   Then point DNS at Bear and orange-cloud it, captured as code:

   ```bash
   export CLOUDFLARE_API_TOKEN="..."
   bunx bear-inject setup          # dry run: prints the plan
   bunx bear-inject setup --yes    # applies it
   ```

   `setup` creates or patches the apex (and `www`) CNAME to
   `domain-proxy.bearblog.dev` as proxied, ensures SSL mode is **full**
   (flexible would redirect-loop), and ensures `always_use_https` is **off**
   (a forced HTTPS redirect breaks Bear's plain-HTTP cert renewal, and the
   site would drop offline at the next renewal).

4. For CI: set the `CLOUDFLARE_API_TOKEN` secret and these repo variables,
   then push to `main`.

   | Variable | Example | Notes |
   |---|---|---|
   | `CLOUDFLARE_ACCOUNT_ID` | `2bfa...` | dashboard, zone Overview |
   | `DOMAIN` | `example.com` | apex domain = zone name |
   | `VARS_JSON` | `{"GA_ID":"G-XXXX"}` | values for snippet `{{VARS}}` |
   | `INCLUDE_WWW` | `true` | also route `www.` (default true) |
   | `WORKER_NAME` | `bear-inject` | optional |
   | `FEED_PATH` | `/feed/` | optional, for verification |
   | `PURGE_CACHE` | `false` | optional; Cloudflare does not cache HTML by default, so deploys are already instant |

## CLI

All commands run in your blog repo and read `.env` there (explicit
environment variables always win). Build output goes to `.bear-inject/`
(gitignore it).

```bash
bunx bear-inject gen          # compile snippets/ + render wrangler config
bunx bear-inject dry-run      # validate a full build, no credentials needed
bunx bear-inject deploy       # gen + wrangler deploy
bunx bear-inject verify       # assert the LIVE site end to end
bunx bear-inject dev          # local dev server (see below)
bunx bear-inject setup        # Cloudflare DNS/settings onboarding
bunx bear-inject rollback     # emergency stop: grey-cloud the DNS records
bunx bear-inject purge-cache  # rarely needed, see PURGE_CACHE above
```

## How snippets work

Snippets are plain HTML files in your repo; the directory picks the
placement (Bear pages are always `header/nav/main/footer`):

```
snippets/
  head/     appended before </head>
  nav/      end of <header><nav>, the site nav row, on every page
  top/      start of <main>, right under the site nav, on every page
  bottom/   end of <main>, right above the footer, on every page
  body/     appended before </body>
```

- Files inject in filename order. Keep the `NN-` prefixes, and keep names
  and contents unique across directories (live verification counts each
  snippet's occurrences).
- `{{VAR_NAME}}` placeholders are filled at request time from the Worker's
  vars (set via `VARS_JSON`). A snippet whose vars are not all set is
  **skipped entirely**, so unsetting a var turns a snippet off without
  deleting the file. A snippet with no vars is always injected; reference a
  gating var in an HTML comment to tie it to a feature (the Buttondown
  templates do this).
- Only `text/html` responses are touched. The Atom feed, `robots.txt`, and
  assets pass through byte-identical, and `/.well-known/acme-challenge/*` is
  never rewritten (Bear renews your TLS cert through it).
- Every HTML response the Worker handles carries `x-injected-snippets:
  10-ga,...` (or `none`). If that header is missing on a page, the Worker
  did not run for that request; see Troubleshooting.
- Snippet vars are injected into public HTML, so they are plaintext Worker
  vars by design. Never put a real secret in `VARS_JSON`.

### Included snippet templates

| Template | Enabled by | What it does |
|---|---|---|
| `head/10-ga` | `GA_ID` | Google Analytics gtag |
| `head/20-buttondown-style`, `nav/30-buttondown-nav`, `body/50-buttondown-inline` | `BUTTONDOWN_USERNAME` | Compact Buttondown email subscribe form on the right of the nav row, styled from Bear's theme variables (dark mode included). Submits inline and swaps to a "check your inbox" note; without JS it falls back to Buttondown's full-page flow. |

The iteration loop for any snippet: drop a file in a placement directory,
add its `{{VARS}}` values to the `VARS_JSON` variable, push. Your CI deploys
and then verifies the snippet appears exactly once on the live site.

## The pipeline (what the templates give you)

1. **validate**: a credential-less `bear-inject dry-run` builds the full
   Worker to prove config and snippets compile.
2. **deploy**: `bear-inject deploy`, then `bear-inject verify` asserts
   through the Cloudflare edge that every enabled snippet appears exactly
   once with the right header, the feed is untouched XML, robots.txt is
   untouched, and the ACME path is not rewritten.
3. **scheduled verify** (weekly): catches drift with no push, like a failed
   Bear cert renewal or a hand-edited Cloudflare setting.

## Local dev server

`wrangler dev` cannot use the production code path: in production the
Worker calls `fetch(request)` and relies on Cloudflare routing that
subrequest to the origin instead of back into the Worker. Locally that
recurses into the dev server. Your blog repo's `.dev.vars` (gitignored)
therefore sets an origin override plus any snippet vars:

```
ORIGIN_URL = "https://example.com"
GA_ID = "G-XXXXXXXXXX"
```

```bash
bunx bear-inject dev
curl -A 'Mozilla/5.0' --compressed http://127.0.0.1:8799/
```

## Troubleshooting

Verification traps that have actually bitten:

- **Bear 403s non-browser user agents.** A bare `curl https://yourdomain`
  returning 403 is bot protection, not an outage. Send a browser
  `User-Agent` (the verify command does).
- **Stale DNS after flipping the orange cloud.** A resolver that cached the
  pre-proxy answer keeps connecting straight to Bear's origin and bypasses
  the Worker: pages show no snippet and no `x-injected-snippets` header.
  Compare `curl -sw '%{remote_ip}' -o /dev/null https://$DOMAIN/` with what
  the site should resolve to, or test with
  `curl --resolve $DOMAIN:443:<cloudflare-edge-ip> ...`. Browsers also
  cache sockets: clear chrome://net-internals/#dns and #sockets.
- **`x-injected-snippets` present but `none`**: the Worker ran but every
  snippet was skipped; a `{{VAR}}` referenced by a snippet is missing from
  `VARS_JSON`.
- **ACME probe answers 308.** Normal: with no active challenge Bear's Caddy
  redirects to HTTPS. The only requirement is that the Worker passes the
  path through, which `verify` asserts.

## Rollback

Grey-clouding the DNS records removes Cloudflare (and the Worker) from the
path in seconds, without touching the Worker, its routes, or its vars:

```bash
bunx bear-inject rollback --yes    # undo later with: bunx bear-inject setup --yes
```

## Library API

The CLI covers normal use, but the core is importable:

```js
import { createWorker, renderSnippets, applyInjection, PLACEMENTS } from "bear-inject";

export default createWorker([
  { name: "10-hello", placement: "head", html: "<meta name=hi content={{WHO}}>" },
]);
```

## Developing this package

```bash
bun install
bun run test       # vitest inside workerd (the real Workers runtime)
bun run test:e2e   # installs the package into test/fixture-blog and runs
                   # the CLI through a wrangler dry run
```
