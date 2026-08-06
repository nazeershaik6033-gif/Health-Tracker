# FatSecret proxy

If you saw this in Settings:

> Your browser cannot call FatSecret directly — FatSecret sends no CORS headers
> and pins keys to whitelisted IPs. Set a Proxy URL in Settings.

that message is correct, and this directory is the fix.

## Why a proxy is required

Every other API Healthify uses is called straight from your browser. FatSecret
can't be, for two reasons that no amount of app code can work around:

1. **No CORS headers.** `oauth.fatsecret.com/connect/token` doesn't send
   `Access-Control-Allow-Origin`, so the browser refuses to let JavaScript read
   the response. Sending an `Authorization` header to the REST host also
   triggers a preflight that goes unanswered.
2. **IP whitelisting.** FatSecret pins credentials to specific IP addresses. A
   phone moving between wifi and mobile data has no stable IP to whitelist —
   so even if CORS were solved, the calls would still be rejected.

FatSecret's own guidance is to request tokens through a proxy. A Cloudflare
Worker has a fixed egress IP and sets its own CORS headers, so it solves both.
It also keeps your Client Secret off your device entirely — the app never sees it.

## Setup

**1. Get FatSecret credentials.** Register free at
[platform.fatsecret.com/platform-api](https://platform.fatsecret.com/platform-api)
and note your Client ID and Client Secret.

**2. Deploy the worker.** You need a Cloudflare account (the free tier is
plenty — this worker does a handful of requests per meal).

```bash
cd proxy
npx wrangler login
npx wrangler secret put FATSECRET_CLIENT_ID       # paste when prompted
npx wrangler secret put FATSECRET_CLIENT_SECRET   # paste when prompted
npx wrangler deploy
```

`wrangler deploy` prints the worker's URL — something like
`https://healthify-fatsecret-proxy.<your-subdomain>.workers.dev`. Keep it.

**3. Whitelist the worker's IP with FatSecret.** Open `<worker-url>/whoami` in
a browser; it returns the address FatSecret will see:

```json
{ "ip": "172.71.x.x" }
```

Add that under **IP Restrictions** in the FatSecret dashboard. If your plan
allows CIDR ranges, whitelisting
[Cloudflare's published ranges](https://www.cloudflare.com/ips/) is steadier
than a single address — Cloudflare does not guarantee one fixed egress IP per
worker, so a single address can change and lookups will start failing with
"Invalid IP address detected". Re-check `/whoami` if that happens.

**4. Point the app at it.** In Healthify: **Settings → Food database —
FatSecret**, switch it on, paste the worker URL into **Proxy URL**, and press
**Save**. Leave Client ID and Secret blank — the worker holds them now. Then
press **Test connection**.

## Reading the test result

| What it says | What to do |
|---|---|
| `Connected via your proxy — 3 results for "apple"` | Done. |
| `Could not reach your FatSecret proxy…` | Check the URL is `https://` and exactly what `wrangler deploy` printed. |
| `Origin not allowed` | `ALLOWED_ORIGIN` in `wrangler.toml` doesn't match where you're loading the app. Fix and redeploy. |
| `Invalid IP address detected…` | Step 3 — whitelist the IP `/whoami` reports. |
| `…scope…` | Your FatSecret plan doesn't include that call. Barcode lookup needs Premier. |
| `FatSecret rejected those credentials` | Re-run the two `wrangler secret put` commands. |

## What the worker will and won't do

It relays exactly three methods — `foods.search.v3`, `food.get.v4` and
`food.find_id_for_barcode` — and rejects any other origin. So a leaked worker
URL can't be turned into an open relay against your FatSecret quota.

It holds your Client Secret as a Cloudflare secret, never in the browser and
never in this repo.

## Not using Cloudflare?

Any host that gives you a stable egress IP and lets you set CORS headers works.
The contract the app expects is one endpoint accepting:

```
POST /   { "method": "foods.search.v3", "params": { ... } }
→ FatSecret's raw JSON response
```

`fatsecret-worker.js` is ~150 lines and ports to Deno Deploy, a Vercel function
or a small Node server with little more than a change of handler signature.
