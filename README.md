# Healthify

An AI-powered health, nutrition and fitness tracking PWA. Track calories from a
photo, a barcode, a nutrition label or your voice; log water, sleep, weight,
steps and workouts; and ask an AI coach about your day.

Everything runs in the browser. There is no backend, no account and no server —
your data lives in IndexedDB on your device and nothing leaves it except the AI
requests you configure.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm run build        # typecheck + production build into dist/ (throwaway)
npm run build:pages  # the published build, into docs/ — commit the result
npm run check:pages  # fail if docs/ is older than the source
npm run preview      # serve the built app
npm run typecheck
npm run lint
```

The app is installable from the browser's "Add to Home Screen" / install
prompt. Installing it is what enables share-to-track (below).

### Deploying

The live site is the committed **`docs/`** directory, served straight off
`main` by GitHub Pages — repository **Settings → Pages → Build and deployment
→ Source: Deploy from a branch → `main` / `/docs`**.

So a change is only live once `docs/` is rebuilt and committed with it:

```bash
npm run build:pages
git add docs && git commit
```

Two things make that hard to get wrong. `npm run build:pages` records a hash
of every input it built from, and CI recomputes it — commit a source change
without rebuilding and the build fails, naming the command that fixes it. CI
also refuses a `docs/index.html` whose entry point is still `/src/main.tsx`,
which is what a raw, unbuilt deploy looks like.

There is deliberately **no Actions-based Pages deploy**. Running one alongside
a branch-served site publishes two different things to the same URL; whichever
finishes last wins, and the app loads or blanks depending on the race. That
happened, and it cost several rounds of misdiagnosis — the symptom looks like
a browser bug, not a deployment one.

`docs/` is generated. Never hand-edit it; edit the source and rebuild.

---

## What it does

**Food logging**

| How | What happens |
|---|---|
| **Snap** | Photograph a plate; a vision model identifies each item, estimates portions and macros, scores the meal 0–10 and writes a short take |
| **Barcode** | Scan a packaged product; looked up in [Open Food Facts](https://world.openfoodfacts.org) (free, ~3M products, no key), trying each valid form of the code. Known by name but with no panel → the AI estimate works from the product name, not the digits |
| **Label** | Point at a nutrition panel; read by AI vision, or on-device OCR when no key is set |
| **Voice** | "Two rotis, a katori of dal and a glass of milk" → structured entries |
| **Search** | ~165 bundled foods, Indian-first with native units (roti, katori, glass, idli, dosa), plus anything you've saved. Fuzzy matched, works offline |

**Micronutrients** — twelve vitamins and minerals per day, alongside the
macros: iron, calcium, magnesium, zinc, potassium, sodium, vitamins A, C, D, E,
B12 and folate. Targets follow ICMR-NIN 2020 RDAs for Indians, adjusted for
your age and sex (iron drops after menopause, calcium rises in adolescence and
again past 50); potassium and the sodium ceiling come from WHO. Sodium is
tracked as a limit rather than a goal.

Every bundled food carries per-100 g figures from IFCT 2017 and USDA
FoodData Central; barcode lookups take whatever the product declares, and
AI-generated foods are asked for the panel too. Tap any nutrient for what it
does, which of today's foods supplied it, and what would close the gap —
ranked by foods you already log, since the richest source of B12 is no use to
someone who doesn't eat it.

Micronutrient data is patchy everywhere in the world, so the screen reports
**coverage**: what share of the day's calories the figures actually saw, and
which items had no data. A photo-logged restaurant meal contributes none, and
the app says so rather than reporting a deficiency that is really a gap in the
data.

**Trackers** — water, sleep, weight, workouts and steps, each with a goal, an
entry flow and a trend chart.

**Workouts** — a session per day built from a bundled catalog of ~285
exercises, searchable by name, muscle group and equipment. Strength work logs
sets × reps × weight; cardio, mobility and sport log duration. Personal records
(heaviest set, estimated 1RM, best volume) and a per-exercise trend are derived
from your log, so they never drift out of step with it.

Calories for resistance work are estimated from sets, reps and time under
tension, which is a genuinely rough figure — resistance-training expenditure
varies far more between people than steady-state cardio. The app says so where
it shows the number, and every estimate can be overridden. Volume moved is
tracked exactly and is the more honest strength signal.

**Ria, the AI coach** — reads your profile, targets, today's log and recent
trends, and answers with your actual numbers. Also produces the daily insight
card on the home screen, per-meal scores, and diet/workout plans.

Calorie and macro targets are computed with Mifflin-St Jeor × an activity
factor, adjusted for your goal, and follow your weight as it changes. You can
override the calorie number at any time.

**Macros by part of the day** — protein, fats, carbs and fibre are tracked
against parts of the day as well as the day as a whole. Diet puts an expand
button beside Breakfast, Lunch and Dinner for Morning (breakfast + morning
snack), Afternoon (lunch + evening snack) and Night (dinner); it opens the same
four bars as the day card, scaled to that period. A shortfall is then visible
while there are still meals left to fix it, rather than only at midnight. The
split defaults to 37.5 / 37.5 / 25 — the member slots' calorie shares — and is
editable under Settings → Meal period split.

---

## Bring your own AI key

There is no server, so there is no shared key — you supply your own in
**Settings**, and requests go straight from your browser to the provider.

| Provider | Default model | Where to get a key |
|---|---|---|
| **Anthropic (Claude)** | `claude-opus-5` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **Google Gemini** | `gemini-2.5-flash` | [aistudio.google.com](https://aistudio.google.com/apikey) |
| **OpenRouter** | `anthropic/claude-sonnet-4.5` | [openrouter.ai/keys](https://openrouter.ai/keys) |

Each provider has a suggested model list **plus a free-text model field**, so a
newly released model works without waiting for an app update.

**Where your key lives.** It is stored in IndexedDB in this browser and sent
only to the provider you selected. It is never included in data exports.
Because there is no backend to hold it, anyone with access to the device or its
developer tools can read it — that is inherent to a keyless, serverless
design. Use a scoped key, and remove it in Settings if you share the device.

Calling Anthropic from a browser requires the
`anthropic-dangerous-direct-browser-access` header; the adapter sends it, and
that is the supported bring-your-own-key path.

### Everything works without a key

Barcode scanning, the bundled food database, manual logging, every tracker,
charts, streaks and export/import all run with no key and no network. The
AI-only surfaces explain what a key would add instead of silently disappearing:

- The home insight card computes a real local summary from your day
- Label scanning falls back to on-device OCR (Tesseract) with editable values
- Snap, Voice, Coach and Plans link to Settings

---

## FatSecret (optional food database)

Healthify can add [FatSecret](https://platform.fatsecret.com/platform-api)'s
branded and restaurant foods to barcode scans and name search. It is off by
default and entirely optional — the bundled database, Open Food Facts and AI
estimates are unaffected either way.

**FatSecret cannot be called from a browser.** Unlike the AI providers, this
is not a matter of setting a header:

1. `oauth.fatsecret.com/connect/token` returns no `Access-Control-Allow-Origin`
   header, so the browser refuses to let JavaScript read the response.
2. FatSecret pins credentials to **whitelisted IP addresses**. A phone moving
   between wifi and mobile data has no stable IP to whitelist.

FatSecret's own guidance is to request tokens through a proxy, so that is the
supported path here.

### Setting it up

[`proxy/`](proxy/) holds a ready-to-deploy Cloudflare Worker that keeps your
Client Secret off your device, mints and caches tokens, and exposes one
CORS-enabled endpoint. Four commands:

```bash
cd proxy
npx wrangler login
npx wrangler secret put FATSECRET_CLIENT_ID
npx wrangler secret put FATSECRET_CLIENT_SECRET
npx wrangler deploy
```

Then whitelist the worker's egress IP in the FatSecret dashboard (open
`<worker-url>/whoami` — it reports the address), paste the worker URL into
**Settings → Food database → Proxy URL**, and switch FatSecret on. Leave Client
ID and Secret blank; the worker holds them.

**Test connection** says exactly which step failed if one did — wrong origin,
unwhitelisted IP, missing scope and bad credentials each get their own message.
[`proxy/README.md`](proxy/README.md) has the full walkthrough and a table
mapping each message to its fix.

The worker only relays three methods (`foods.search.v3`, `food.get.v4`,
`food.find_id_for_barcode`) and rejects other origins, so a leaked URL can't be
turned into an open relay against your quota.

### Without a proxy

You can paste a Client ID and Secret directly into Settings. The app will try
the direct call and, when the browser blocks it, say so and point at the proxy
rather than failing silently. Note that a Client Secret in browser storage is a
long-lived credential for your whole FatSecret account — a stronger reason to
use the proxy than for an AI key. Backups never include either.

### How lookups are ordered

| Tier | Source | Needs a key? |
|---|---|---|
| 1 | Foods you've already saved (instant, offline) | no |
| 2 | FatSecret, when configured | yes |
| 3 | Open Food Facts | no |
| 4 | AI estimate ("Generate this food") | AI key |

A tier that fails never blocks the next one — a FatSecret outage shows as a
note on an Open Food Facts result, not an error screen.

---

## Share-to-track (instead of gallery auto-detect)

The app this is modelled on watches your camera roll in the background and logs
meals automatically. **A browser cannot do that** — there is no background
photo-library access on the web, and any claim otherwise would be false.

The web-native equivalent is implemented instead: Healthify registers as a
**share target**, so once installed it appears in your phone's share sheet.
Share a food photo from your gallery and it is analysed and logged. The
**Auto-Track** toggle in the Snap Gallery decides whether shared photos are
logged immediately or wait for you to confirm.

The service worker handles the `POST /share-target` request, stashes each file
in the Cache API and redirects into the Snap screen, which reads the blob back
and clears it.

Similarly, **steps are entered by hand**: a browser can't read your phone's
pedometer in the background, so the tracker is built for copying the number
across from your health app once a day.

---

## Getting the latest version

The service worker precaches the app shell so it works offline, which is also
why a freshly deployed version doesn't always appear on the next visit — the
page loads from cache before the worker notices there's anything newer.

**Settings → App version** shows the running build (short commit SHA and build
time in CI) and offers two escape hatches:

- **Check for updates** — asks the worker to re-fetch its script and reloads if
  a new build exists. The right button almost always.
- **Force reload** — replaces the app's offline copy. For when a cache is
  genuinely wedged.

Force reload is deliberately narrow. It clears only workbox's precache — the
app's own files — and leaves the `healthify-*` caches alone, so saved barcode
lookups, the lazily-downloaded scanner and OCR binaries, and any photo shared
but not yet logged all survive. It downloads the shell back *before* reloading,
so the app returns from a warm cache instead of a cold network; the earlier
version cleared everything first and left you looking at a blank screen for the
length of the download.

Refilling the precache is the subtle part, and **the page cannot do it**. Two
things that look like they should work do not:

- `registration.update()` is a no-op when the worker script hasn't changed,
  which is exactly the case this button exists for.
- Unregister-then-register is no better. With the script byte-identical and the
  old worker still controlling the page, the browser hands the *running* worker
  straight back — no install event fires, so nothing is fetched. Measured
  directly: `registered. installing=false waiting=false active=true`, precache
  still empty.

So the worker refills it itself, on a `REPRECACHE` message (`src/sw.ts`). That
needs an explicit `PrecacheController` rather than `precacheAndRoute`, because
the singleton helper gives no handle to re-run installation with. The worker
acknowledges the message before starting, which is how the page distinguishes
"still downloading" from "this worker is too old to understand" without waiting
out a long timeout — and workers installed before this shipped are exactly that
case. They fall back to being unregistered so the next load installs a fresh
one.

Keeping the worker registered throughout also means the app is never left with
neither a worker nor an offline copy. A browser tab survives that window; an
installed iOS PWA may not.

Neither button touches IndexedDB: the Cache API holds the app's own files,
IndexedDB holds your meals, photos and tracker entries. They are separate
stores, so no logged data is at risk either way — but a force reload does need
a connection, and refuses to run without one.

---

## Architecture

```
src/
  ai/           ProviderAdapter interface + Anthropic / Gemini / OpenRouter
                adapters, prompts, JSON schemas, streaming SSE reader
  db/           Dexie schema, repository layer, JSON export/import
  data/         bundled seed catalogs (foods, micronutrients, exercises)
                as compact tuples
  lib/          camera, barcode decoding, OCR, image pipeline,
                Open Food Facts, nutrition maths, fuzzy search, motion
  components/   design-system pieces (rings, macro bars, sheets, icons)
  screens/      one file per route
  stores/       Zustand app state + live Dexie queries
  sw.ts         service worker: precache, runtime caching, share target
```

**Theming.** Every tinted surface reads a hue triple — fill, foreground and a
leading rule — from CSS variables selected by `[data-theme]` in
`styles/index.css`. Tailwind's `@theme` ramp can't do that job: it emits one
fixed value per class, which is why tinted cards used to stay pale on a black
canvas. Use `.accent-card` (with an `.accent-*` hue modifier) for tinted cards
and `.tint-*` for icon chips rather than reaching for `bg-brand-50` again.

**Motion** is CSS and platform APIs only — no animation library, so nothing is
added to the offline bundle. `lib/motion.ts` holds the shared helpers
(`haptic`, `animateNumber`, reduced-motion checks); a global
`prefers-reduced-motion` rule neutralises everything for users who ask for it.

**Search** is one scorer in `lib/search.ts`, specialised by `foodSearch.ts` and
`exerciseSearch.ts`. Every typed word must land somewhere or the row scores
zero, which is what makes multi-word queries behave.

**Micronutrients are optional everywhere and "missing" never means zero.**
`Food.micros` and `MealItem.micros` are partial maps, so a barcode that
declares only calcium counts its calcium and stays silent on the rest instead
of reporting eleven zeroes. Day totals therefore travel with a calorie-weighted
coverage figure, and every screen that shows a micronutrient number is required
to be able to say what that number is built on. `lib/micros.ts` owns the
reference data, the units and the maths; the seed table is joined onto the food
catalog by name at seed time, and drift between the two files is shouted about
in dev.

**Workout sessions extend `WorkoutEntry` rather than replacing it.** The
per-exercise detail lives in an optional `exercises` array while `type`,
`durationMin` and `kcal` stay populated as roll-ups, so day totals, streaks,
calendar dots, AI context and export all keep reading a workout as one figure.
Rows logged before sessions existed have no `exercises` array and still render
and count.

**Stack** — Vite 6, React 19, TypeScript (strict), Tailwind v4, Dexie 4
(IndexedDB), Zustand, React Router 7, Recharts, `vite-plugin-pwa` (Workbox,
`injectManifest`).

**Food lookup is three-tiered**: bundled seed database → Open Food Facts →
AI generation, with generated foods cached locally so the next lookup is
instant and offline.

**Barcode decoding** uses the native `BarcodeDetector` where available
(Chrome, Edge, Safari 17+) and lazy-loads `zxing-wasm` everywhere else,
including Firefox. Reliability comes less from the decoder than from cropping
to the guide box, validating the EAN check digit, and requiring the same value
on two consecutive frames before accepting it. Cropping costs something too —
a barcode just outside the box is never seen at all — so every fourth pass
sweeps the whole frame instead.

**Barcode lookups ask for several forms of the same code.** The scanner reads
whatever symbology is printed; a database stores whichever form its contributor
entered. A UPC-A scanned verbatim misses the padded GTIN-13 the same product
sits under, and a UPC-E resolves to neither, because it is zero-*suppressed*
rather than truncated and has to be expanded. `lib/gtin.ts` derives the
candidates and caps them at three, so a miss costs a bounded number of requests
rather than one wrong one.

**App icons are generated**, not committed as art:

```bash
node scripts/gen-icons.mjs
```

---

## Privacy

- All health data is stored locally in IndexedDB; there is no server
- API keys are stored locally and sent only to your chosen provider
- Exports never include your API key or FatSecret credentials
- Clearing site data erases everything — **export first** (Settings → Backup)

Photos in an export are base64-encoded and make the file much larger, so
export-with-photos is a separate button.

Because a downloaded JSON file is easy to lose on a phone, export hands the
file to the OS share sheet where one exists (Drive, Files, a chat) and falls
back to a download otherwise. The app records when you last backed up and
nudges once a backup is more than two weeks old; importing shows you what a
file contains and asks whether to merge it or replace everything first.

---

## Apple Health and Apple Watch

Apple gives websites **no access to HealthKit** — not to the Health app, not to
the Watch. It is a native-only capability, available to App Store apps and
nothing else. There is no browser API to work around, so no web app can sync
with your Watch, including this one.

What Apple does provide is a full export, and that is what this reads:

1. Health app → your **profile picture** (top right)
2. **Export All Health Data** — takes a few minutes
3. **Save to Files**
4. In Healthify: **Settings → Import from Apple Health**, choose `export.zip`

It brings across **steps, weight, sleep, water and workouts**. This is a
snapshot you re-run when you want to catch up, not a live connection.

The file is read entirely on your device — nothing is uploaded, and no key is
needed. The zip is opened with a small central-directory reader and the
platform's own `DecompressionStream`, and the XML is streamed rather than
loaded, because these exports routinely run to hundreds of megabytes.

Three details worth knowing, because they change the numbers:

- **Steps and water take the highest single source for a day, not the sum.**
  An iPhone and a Watch both record the same walk, and both are in the file;
  adding them up roughly doubles your day. Health de-duplicates by source
  priority internally, and this is the closest honest approximation.
- **Overlapping sleep is merged, not added.** The same night is often reported
  by several sources with overlapping windows.
- **Times use the offset in the file**, so a night slept at 23:00 in Delhi
  reads as 23:00 wherever you later open the app.

By default an import **only fills days you have nothing recorded for**, so it
can never overwrite something you typed. You can choose to let the export win
instead. Re-running the same import is safe — it writes nothing the second
time.

---

## Limitations, stated plainly

- No background gallery scanning — share-to-track instead (see above). Picking
  a photo from the library by hand works everywhere, on Snap and Label alike
- No automatic step counting — manual entry, or a bulk import from an Apple
  Health export (see above)
- No live Apple Watch or Health sync, and there cannot be one from a web app —
  HealthKit has no browser API
- Calories burned in resistance training are estimated from sets, reps and
  tempo; treat them as a guide, not a measurement
- FatSecret needs a proxy you deploy yourself; there is no browser-direct path
  (CORS and IP whitelisting, see above)
- AI portion estimates from a photo are estimates; check them before saving
- Photo and voice logs carry no micronutrients — the per-item cost in tokens
  and latency buys numbers a model is guessing at from an image. They lower the
  day's micro coverage instead, which the screen states outright
- Micronutrient figures for composite dishes are computed from typical recipes,
  not laboratory values; the whole foods around them are direct table lookups
- Reference intakes are for a healthy adult. Pregnancy, supplements and
  diagnosed deficiencies all change them, and the app does not model any of it
- On-device OCR is a fallback and is noticeably worse than AI vision on
  curved or glare-affected packaging
- **No barcode database is complete, and this app has no product database of
  its own.** Open Food Facts is crowd-sourced and thin on Indian retail, so
  local and unbranded products are often genuinely absent — trying every form
  of a code raises the hit rate but cannot invent an entry. When a scan comes
  back empty the honest routes are the label reader, an AI estimate, or adding
  the food by hand, and the app offers all three rather than pretending
- Ria is not a clinician

---

## License

MIT
