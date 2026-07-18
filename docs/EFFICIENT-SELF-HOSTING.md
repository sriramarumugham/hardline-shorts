# Efficient Self-Hosting Guide — News-Reel Factory

**Date:** 2026-07-18
**Audience:** the owner, self-hosting this app on their **own server**, as lean as possible.
**Scope:** how to run the factory at lowest CPU/RAM/disk/cost with the fewest moving parts.
**Prereq read:** [`PRODUCTION-READINESS.md`](./PRODUCTION-READINESS.md) — architecture, the Next.js verdict, the backend/frontend/deployment/licensing findings. This doc **builds on it** and does not repeat the reliability-bug list (C1/C2/H1…); it focuses purely on *efficient self-hosting*. No code was changed to write this.

> **The one architectural fact that drives everything below:**
> The pipeline does two heavy jobs — **voice cloning** (OmniVoice, **needs a GPU**) and **video render** (Remotion/Chrome, **CPU-only, no GPU**). The web/API/queue layer is near-idle. On the current laptop, Windows Smart App Control blocked ffmpeg, which is the *only* reason render was pushed to Colab. **On any Linux server, render runs locally with no GPU.** So the entire self-hosting decision reduces to one question: **does your server have a GPU?**

---

## 1. Executive recommendation

### Case A — your server HAS an NVIDIA GPU (Linux)
**Run everything on it. One box, one Node process, one local filesystem queue, plus a GPU voice step. No Colab, no Google Drive, no Modal, no cloud.**

- `QUEUE_BACKEND=local` (already the default — `apps/server/src/config.ts:29`).
- Node/Express serves **UI + `/api` + `/storage`** as a single process (already the prod model — `apps/server/src/index.ts:183-190`).
- **Render runs on the box's CPU** (Remotion, serialized — `render.ts:26-31`).
- **Voice runs on the box's GPU** via a small always-on Python worker (the Colab notebook's OmniVoice logic, minus `drive.mount()`, pointed at the local queue dir instead of Drive).
- This is the most efficient and most self-contained option: zero external dependencies, zero per-clip cost, no attended browser tab, no OAuth, no 15 GB Drive cap.

### Case B — your server is CPU-only (no GPU)
**Run web + API + queue + RENDER on it (all fine on CPU). Voice must come from a GPU elsewhere. Recommended: a scale-to-zero serverless GPU (Modal or RunPod) called per clip (~cents/clip), scaling to $0 when idle.**

- Same single Node process + `QUEUE_BACKEND=local` + local CPU render as Case A.
- **Voice:** wrap the notebook's `OmniVoice.from_pretrained(...) + synth()` in a Modal/RunPod serverless function. A server step POSTs each scene's text, writes the returned wavs into the job's `audio/`, then moves the job to `completed/` so the existing watcher renders it.
- **Do not** run OmniVoice on the CPU-only server: it's a diffusion/flow-matching TTS model at `num_step=48`; on CPU each scene would take *minutes*, serializing behind renders and starving the box. At 10–50 reels/day the serverless-GPU bill is a few dollars/month vs. an idle GPU VM at ~$150–400/mo.
- **Interim / free fallback:** keep the current Colab worker. It works today and costs nothing, but it is **attended and ephemeral** (a human keeps a tab open; it disconnects) — acceptable as a bridge, not as the steady state for an unattended non-dev operator.

**Bottom line:** if you have a GPU, Case A is strictly better (self-contained, $0 marginal cost). If you don't, Case B keeps the whole box lean and pushes only the GPU-bound voice step off-box on a pay-per-use basis.

> **Licensing gate that applies to BOTH cases (from PRODUCTION-READINESS §7):** OmniVoice **weights are CC-BY-NC (non-commercial)**. Self-hosting does not change that — a monetized reel needs a commercially-licensed Tamil voice. Remotion is free for ≤3 employees / non-profits; **4+ employees → paid ≈ $100/mo minimum** (confirmed current: remotion.dev/docs/license/faq, /license/pricing). Neither is a *technical* self-hosting blocker; both are commercial gates.

---

## 2. Resource footprint analysis

Concrete, component-by-component. Sources cited inline; Remotion render numbers are grounded in the official docs plus the maintainer benchmark that matches this exact 1080×1920@30fps case.

### 2a. Idle Node/Express server (web + API + queue)
- **Near-zero.** It does light I/O only: serves static files, answers `/api/*` JSON, and runs one watcher. With the **local** backend the watcher is a **chokidar filesystem watch** (`local.ts:150-164`) — event-driven, ~0% CPU at rest. With the **gdrive** backend it's a `setInterval` poll every 8 s (`drive.ts:345`, `config.ts:44`) that downloads job metadata each tick — measurably chattier (see §5).
- **RAM:** a Node 20/22 + Express process idles around **~60–120 MB RSS**. The `@remotion/bundler` webpack bundle is built lazily on first render and cached for the process lifetime (`render.ts:13-23`); expect **+150–300 MB** resident once a render has happened.
- **CPU:** effectively 0 between jobs.

### 2b. One Remotion CPU render (the real cost on the server)
A render spins up **headless Chrome (Chrome Headless Shell)** and encodes frames. This app already **serializes renders one-at-a-time** (`render.ts:26-31`), so you only ever pay for **one** render's footprint at a time — a deliberate, efficient choice for a cheap box.

- **Concurrency:** Remotion's `concurrency` defaults to **half the available CPU threads**; each unit is a parallel render process (remotion.dev/docs/renderer/render-media). Setting it to all cores maximizes speed "but other parts of your system might slow down" (remotion.dev/docs/config). The Colab notebook currently hard-codes `--concurrency=2` (notebook cell-5) — a safe low value tuned for the free T4's 2 vCPUs; **on a bigger server you'll want to raise it** (see §3, §5).
- **Render speed** (grounded in remotion-dev/remotion issue #4949, a **1080×1920 @30fps, 94 s** clip, CPU-only, `<OffthreadVideo>`-heavy — the pessimistic case):
  | vCPU / RAM | concurrency | time | render fps |
  |---|---|---|---|
  | 16 / 16 GB | 4 | 298 s | 9.5 |
  | 32 / 32 GB | 8 | 200 s | 14.0 |
  | 64 / 64 GB | 8 | 174 s | 16.2 |
  | 224 / 224 GB | 8 | 175 s | 16.1 |

  Scaling is **strongly sublinear** — past ~8 concurrency another bottleneck dominates and extra cores barely help. **Sweet spot: concurrency 4–8.** This app's reels are **image + text + stat-card motion graphics** (no full-frame video layers), which render **faster** than the `<OffthreadVideo>` benchmark above. Practical estimate for a ~60 s / ~1800-frame vertical reel: **~1–3 minutes on a 4–8 vCPU box.** Use `npx remotion benchmark` on your actual box + a real reel to get the true number (remotion.dev/docs/performance).
- **Peak RAM during render:** Remotion publishes no per-tab figure, but the official anchors are: Lambda default **2048 MB** per render (remotion.dev/docs/lambda/concurrency); self-host Studio server recommendation **2 CPU + 4 GB** (Fly) or **2 GB** (Render Standard) (remotion.dev/docs/studio/deploy-server). The frame cache for `<Video>`/`<OffthreadVideo>` defaults to **half of system RAM** (remotion.dev/docs/renderer/render-media) — relevant only if you add video layers. **Budget ~1.5–3 GB peak for one render at concurrency 4–8** for this app's graphics-only reels.
- **OOM lever:** if you ever see "renderer ran out of memory," **lower `--concurrency`** and/or pass `--disallow-parallel-encoding` (more memory-efficient, slightly slower) (remotion.dev/docs/performance, /docs/cli/render).

### 2c. OmniVoice voice cloning (GPU)
- **Model:** `OmniVoice.from_pretrained("k2-fsa/OmniVoice", dtype=torch.float16)` at `num_step=48`, output 24 kHz mono (notebook cell-3; `docs/colab-worker.md`). Runs today on a **free Colab T4 (16 GB VRAM)**.
- **VRAM:** a flow-matching TTS model in fp16 of this class typically occupies **a few GB of VRAM** (well under the T4's 16 GB — it coexists with a Remotion render on the same Colab today). **Verify on your GPU with `nvidia-smi` during a run** before sizing — treat "~4–8 GB VRAM" as an unverified planning estimate, not a measured fact.
- **Per-clip time:** GPU synthesis is **seconds per scene** at `num_step=48` (one generation per sentence, concatenated — notebook `synth()`). A 4–6-scene reel voices in well under a minute on a T4-class GPU. On **CPU it is minutes per scene** — the reason Case B pushes voice to a GPU.
- **System RAM (host):** loading torch + the model needs **a few GB of system RAM** regardless of GPU.

### 2d. Media / disk growth and retention
Each reel accumulates under `apps/server/storage/jobs/<id>/` (`config.ts:20-24, 66-70`): uploaded **images** (up to 25 MB each, `index.ts:48`), per-scene **wav** audio (24 kHz mono, small), and the final **mp4** (~**30 MB** — the audit's `amma-crisis-reel` was 29.8 MB). Plus the job's `spec.json`/`meta.json` in the queue dir (KB).
- **Rough per-reel disk:** **~30–60 MB** (mp4 + a few source images + audio).
- **At 10–50 reels/day:** **~0.3–3 GB/day**, i.e. **~10–90 GB/month** if nothing is pruned. This grows unbounded — the local equivalent of the audit's Drive M4 (`approved/`+`rejected/` never deleted, `local.ts move()` only renames). **You must add a retention/prune step** (see §5).
- **One-time:** `node_modules` + the cached Remotion browser ≈ **0.5–1.5 GB**; the composition bundle is tens of MB.

---

## 3. Recommended minimal server spec (10–50 reels/day)

Low concurrency is already guaranteed by the code (renders serialized, single voice worker), so you size for **one render + one voice at a time**, not a fleet.

### Case A — GPU server (everything on one box)
- **GPU:** any modern NVIDIA with **≥8 GB VRAM** (T4 / L4 / RTX 3060+ class). The free-Colab T4 already runs both voice **and** render, so this is comfortable.
- **CPU:** **4–8 vCPU** (render is the CPU consumer; 4 is fine at this volume, 8 halves render wall-time).
- **RAM:** **8 GB** (Node ≤0.3 GB + one render ≤3 GB + torch/model host RAM a few GB). 16 GB if you also keep the model resident 24/7.
- **Disk:** **40–80 GB SSD** (OS + node_modules/browser ~1.5 GB + torch/CUDA a few GB + a rolling week or two of media with pruning).

### Case B — CPU-only server (voice off-box)
- **CPU:** **4 vCPU** minimum, **8 vCPU** recommended (render is the only heavy user; 8 → concurrency 8 → ~2× faster renders).
- **RAM:** **4 GB** works for graphics-only reels; **8 GB** gives headroom for the Chrome frame cache and comfortably clears the audit-noted Remotion self-host guidance (2–4 GB).
- **Disk:** **30–60 GB SSD** (no torch/CUDA here).
- **Off-box voice:** Modal/RunPod serverless GPU, billed per second of use only.

### What changes at higher volume
- **>50–100 reels/day:** renders may queue behind each other (serialized). First lever: **raise render `--concurrency` toward 8** and add cores. Next: allow **2 concurrent renders** (relax the single `renderChain` in `render.ts:26-31`) only if RAM allows (~+2–3 GB per parallel render).
- **Sustained heavy volume:** move render to **Remotion Lambda** (the blueprint's documented scale path) or a second render worker. Voice scales for free on serverless GPU (more concurrent function invocations).
- **Case A at high volume:** the GPU voice step is cheap; the CPU render becomes the bottleneck first — add vCPUs before worrying about the GPU.

---

## 4. The efficient deployment

### Process model — already optimal
The prod model is **one Node process** that serves the built React app, the JSON API, and the media, all on one port (`index.ts:34-35, 183-190`; SPA fallback regex excludes `/api` and `/storage`). Nothing to change: build `apps/web` to `dist/`, point `WEB_DIST` at it (it's resolved automatically as `../web/dist`), and the single process does everything. **Keep it a single process** — it's the lowest-overhead topology for a solo operator.

### Docker vs systemd vs PM2 (solo operator)
- **Recommended: Docker (Case A and B).** Remotion explicitly recommends Docker and documents the exact image and Chrome-install step; it also pins the system libs Chrome needs so you don't fight them on the host. One image = reproducible, and the host stays clean.
- **systemd** is a fine, even-lighter alternative if you'd rather not run a container runtime — it's the leanest (no daemon overhead) but you must install the Chrome apt libs on the host yourself (list below). Good for a dedicated box you fully control.
- **PM2** adds a Node process manager on top; **not needed here** — you already run a single long-lived process, and Docker's restart policy or systemd's `Restart=always` covers crash-restart without the extra dependency. **Skip PM2** for efficiency.

### Node & Chrome
- **Node:** the notebook installs **Node 20**; Remotion's current Docker guidance recommends **`node:22-bookworm-slim`** (Debian, **not Alpine** — Chrome needs glibc). Node 20 works today; use 22 for the image.
- **Chrome:** don't apt-install Chrome. Run **`npx remotion browser ensure`** to fetch Chrome Headless Shell into the project (remotion.dev/docs/docker).
- **Headless-Chrome apt libs** (already listed in the Colab notebook cell-5, matching Remotion's Linux-deps doc):
  `libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxfixes3 libxi6 libgtk-3-0`
  (Remotion's doc also lists `libgbm-dev`/`libxkbcommon-dev`; the runtime `libgbm1`/`libxkbcommon0` are sufficient.)

### Persistent data + secrets
- **Persist `apps/server/storage/`** (media) and the **local queue dir** (`apps/server/queue/`, or set `QUEUE_DIR`) on a volume that survives restarts/redeploys. Everything else is rebuildable.
- **Env:** `PORT`, `HOST`, `SERVER_ORIGIN` (must be a URL the renderer's Chromium can reach — e.g. `http://127.0.0.1:4000`; see `config.ts:14-15, 79-83`), `QUEUE_BACKEND=local`, `STORAGE_DIR`, `QUEUE_DIR`. If (and only if) you keep the Drive backend you also need the Google OAuth vars — see §6.
- Set the voice function's API token (Case B) as an env var, never in code.

### Dockerfile sketch (recommendation — do not create a file from this)
```dockerfile
# Case A and B server image (render happens here on CPU).
FROM node:22-bookworm-slim

# Chrome Headless Shell runtime libs (from the notebook / remotion.dev/docs/docker).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libgbm1 libasound2 libpango-1.0-0 libcairo2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxrandr2 libxfixes3 libxi6 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci

# Build the web UI so the single Node process serves it from ../web/dist.
RUN npm run build:web

# Fetch Chrome Headless Shell into the project (do NOT apt-install Chrome).
RUN cd apps/server && npx remotion browser ensure

ENV NODE_ENV=production \
    PORT=4000 \
    QUEUE_BACKEND=local \
    STORAGE_DIR=/data/storage \
    QUEUE_DIR=/data/queue \
    SERVER_ORIGIN=http://127.0.0.1:4000

VOLUME ["/data"]
EXPOSE 4000
WORKDIR /app/apps/server
CMD ["npm", "run", "start"]   # tsx src/index.ts (see apps/server/package.json)
```
> Note: `npm run start` uses `tsx` (runs TS directly). That's fine and avoids a build step. For a leaner runtime you could pre-compile to JS, but at this scale `tsx` is not the bottleneck.

### systemd unit sketch (recommendation — do not create a file)
```ini
# /etc/systemd/system/reel-factory.service
[Unit]
Description=News-Reel Factory (web + api + queue + render)
After=network.target

[Service]
Type=simple
User=factory
WorkingDirectory=/opt/reel-factory/apps/server
Environment=NODE_ENV=production
Environment=PORT=4000
Environment=QUEUE_BACKEND=local
Environment=STORAGE_DIR=/var/lib/reel-factory/storage
Environment=QUEUE_DIR=/var/lib/reel-factory/queue
Environment=SERVER_ORIGIN=http://127.0.0.1:4000
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Install the Chrome apt libs on the host once, run `npm ci && npm run build:web && (cd apps/server && npx remotion browser ensure)`, then `systemctl enable --now reel-factory`.

**Case A voice worker:** run the OmniVoice Python worker as a **second** unit/container (or a sidecar) pointed at the same `QUEUE_DIR` — it drains `pending/`, writes `audio/`, moves to `completed/`. It's the notebook's loop with `drive.mount()` removed and paths set to the local queue.

---

## 5. Efficiency tuning specific to THIS code

Concrete, file-referenced levers — mostly config, no redesign.

1. **Use the local queue backend — biggest single win.** `QUEUE_BACKEND=local` is already the default (`config.ts:29`) but confirm it's set in prod. Switching off `gdrive` removes:
   - the **O(N) chattiness**: `listAll()` downloads **every** job's `meta.json` on every UI poll (`drive.ts:293-302`), and `find()`/`create()` scan all six stages downloading candidates (`drive.ts:215-221`) — audit **M2**.
   - the **whole-file in-memory buffering**: `downloadBuffer()` loads entire mp4/audio as an `arraybuffer` (`drive.ts:177-180`) — audit **M3**. The local backend just reads/renames files.
   - **Drive sync latency**, the **15 GB cap** (M4), and the **7-day OAuth token death** (H3).
   The local backend instead uses cheap `readdirSync`/`statSync` (`local.ts:43-53`) and a `renameSync` move (`local.ts:103`).

2. **Prefer the event-driven watcher over polling — already automatic with local.** The local backend watches `completed/` with **chokidar** (event-driven, `awaitWriteFinish` debounce — `local.ts:150-164`); the Drive backend `setInterval`-polls every `DRIVE_POLL_MS=8000` and re-lists on every tick (`drive.ts:328-347`, `config.ts:44`). Local = lower idle CPU and lower latency. (Selecting `QUEUE_BACKEND=local` gives you this for free — no code change.)

3. **The Remotion bundle is already cached per-process** — `getServeUrl()` memoizes the webpack bundle in `bundlePromise` (`render.ts:13-23`), so you pay the bundle cost **once** per server lifetime, not per render. Don't restart the process needlessly (each restart re-bundles on the next render). Keep the process long-lived (Docker restart policy / systemd `Restart=always`).

4. **Renders are already serialized** — `renderChain` runs one render at a time and survives failures (`render.ts:26-31`). Keep this at your volume; it caps peak RAM at one render. Only relax it (2 parallel) if you add cores + RAM at higher volume.

5. **Tune `--concurrency` to your cores.** The Colab notebook hard-codes `--concurrency=2` (cell-5) for the T4's 2 vCPUs. When you self-host render, set concurrency to **~4–8** (sweet spot per issue #4949; `os.cpus().length` for max speed at the cost of box responsiveness). Note: the server's `renderMedia` call (`render.ts:93`) does **not** currently pass `concurrency`, so it uses Remotion's default (**half your threads**) — reasonable, but run `npx remotion benchmark` to confirm and set it explicitly if you want more speed.

6. **ffprobe is already dependency-free for wav.** `audioSeconds()` parses wav duration straight from the RIFF header (`ffprobe.ts:37-62`) and only falls back to the Remotion-bundled ffprobe binary (`ffprobe.ts:11-30`) for non-wav. Since the final pipeline produces **wav**, you need **no system ffmpeg** on the server for duration measurement — one less dependency.

7. **Add disk retention/pruning (not yet present).** `move()` only renames (`local.ts:97-109`); `approved/`+`rejected/` and `storage/jobs/<id>/` grow unbounded (audit M4, and §2d above: ~10–90 GB/month). Add a scheduled prune (cron/systemd-timer) that deletes `approved/`+`rejected/` job dirs and their `storage/jobs/<id>/` media older than N days. Keep the mp4 for approved jobs only as long as you need it downstream.

8. **Log rotation.** Failures currently go to `console.*` only (`watcher.ts:9`, `render.ts`, audit M5/L3) and `uncaughtException`/`unhandledRejection` are logged, not fatal (`index.ts:27-28`). Under Docker use the json-file driver with `max-size`/`max-file`; under systemd, journald caps size via `SystemMaxUse`. Don't let stdout logs fill the disk.

9. **Keep the composition bundle in sync (Case B interim / Colab only).** If you keep Colab, the worker renders from `render-bundle.zip` built by `npm run bundle` (audit L1); a stale bundle silently renders an old layout. **In Case A/B self-hosted render this problem disappears** — the server bundles live from `@factory/composition` source at runtime (`render.ts:18-22`), always current.

---

## 6. What to strip for efficiency when self-hosted

Going `local`-only lets you drop a meaningful amount of surface. Tradeoffs noted.

- **The entire Google Drive backend + `googleapis` dependency.** `apps/server/src/queue/drive.ts` (350 lines) and `"googleapis": "144.0.0"` (`apps/server/package.json:22`) are unused when `QUEUE_BACKEND=local`. `googleapis` is a **large** dependency (pulls the whole Google API client). Removing it shrinks `node_modules`/image and install time.
  - **Tradeoff:** you lose the Drive queue and the hosted-Colab-notebook link (`workerColabUrl`). Fine for Case A and the recommended Case B. **Keep it only if** you intend to keep Colab-over-Drive as your voice path. *(Note: `queue/index.ts:3,11` imports `DriveQueue` unconditionally, so fully dropping the file is a small code edit — out of scope here; at minimum you can leave it unused and simply never set `QUEUE_BACKEND=gdrive`.)*
- **Google OAuth / secrets management.** With `local`, the `GOOGLE_*` env vars and the refresh-token machinery (`config.ts:39-45`, `scripts/get-refresh-token.mjs`) are dead — no 7-day token death (audit H3/§7), no consent-screen upkeep, one fewer credential to store.
- **The edge-tts draft path (`msedge-tts`)** — `apps/server/src/audio.ts` + the `/api/draft-audio` route (`index.ts:57-75`). This is **draft/preview only** (against MS ToS for shipped audio — blueprint §2). It's genuinely useful for **timing preview in the authoring UI**, so **keep it if the operator uses "Draft audio"**; strip it only if they don't. `msedge-tts` is small, so this is a nice-to-have, not a footprint concern.
- **The heartbeat / worker-status UI plumbing** (`/api/worker-status`, `readWorkerHeartbeat` — `index.ts:159-178`) is a **no-op on local** (`queue.readWorkerHeartbeat` is undefined → returns `{supported:false}`). Harmless; leave it. In Case A, consider having the local Python voice worker write the same heartbeat file so the UI's online/offline pill still works.
- **`multer@1.4.5-lts.1`** (`package.json:23`) is deprecated (audit M1) — not a footprint issue but upgrade to `multer@2` when you touch deps, since uploads are unauthenticated (audit H4). If self-hosting **LAN-only**, H4's exposure risk drops; if **public**, add the bearer-token + CORS restriction before exposing (audit H4) — a security, not efficiency, note.

---

## 7. Day-2 operations for a non-dev

### Docker
- **Start / stop / restart:** `docker compose up -d` / `docker compose stop` / `docker compose restart`.
- **Status:** `docker compose ps` (is it Up?), `docker compose logs -f --tail=100` (live logs).
- **Update to a new version:** `git pull` → `docker compose build` → `docker compose up -d` (rebuilds web + re-ensures Chrome). Media/queue survive on the `/data` volume.
- **Health:** open `http://<server>:4000/api/health` (returns `{ok:true}`) and the dashboard. *(Note: per audit M5, `/api/health` is currently always-ok and doesn't reflect queue/worker state — treat the **dashboard counts** as the real health signal: jobs sitting in `in-progress`/`completed` too long = something's stuck.)*

### systemd
- **Start/stop/restart:** `systemctl start|stop|restart reel-factory`.
- **Status + logs:** `systemctl status reel-factory` and `journalctl -u reel-factory -f`.
- **Update:** `git pull && npm ci && npm run build:web && (cd apps/server && npx remotion browser ensure) && systemctl restart reel-factory`.

### Disk / health checks (both)
- **Disk:** `df -h` on the data volume; watch `storage/` and the queue dir. If usage climbs, the retention prune (§5.7) isn't running or its window is too long.
- **"Is a job stuck?"** Watch the dashboard stage counts. A job that stays in `in-progress` (voice) or `completed` (awaiting render) far longer than usual is stuck — see PRODUCTION-READINESS C1/C2/H1 for the underlying reliability fixes (out of scope here, but the operator should know the symptom).
- **Backups:** the only irreplaceable state is the **queue dir + `storage/`** — back those up; everything else redeploys from git.

---

## 8. Open questions the owner must answer (to finalize the recommendation)

1. **Does the server have an NVIDIA GPU?** (Decides Case A vs Case B — the whole recommendation hinges on this.) If yes: **which GPU / how much VRAM?** (Confirm ≥8 GB and run `nvidia-smi` during a voice job to get real OmniVoice VRAM/RAM.)
2. **OS and versions?** (This guide assumes **Linux**; Docker vs systemd depends on whether you'll run a container runtime. Not Windows — SAC/ffmpeg is exactly what we're leaving behind.)
3. **How many vCPU and how much RAM does the box have?** (Sets render `--concurrency` and whether you can ever run 2 renders in parallel — §3.)
4. **How much free disk, and is it a persistent volume?** (Media grows ~10–90 GB/month unpruned — §2d — so retention window depends on disk size.)
5. **Public internet or LAN-only?** (LAN-only → you can skip the auth/CORS hardening for now, audit H4. Public → add bearer-token + restricted CORS + `multer@2` before exposing.)
6. **Expected steady daily volume, and any spikes?** (10–50/day fits the minimal spec; >50–100/day triggers the concurrency/parallel-render/Lambda levers in §3.)
7. **Will output ever be monetized / is the team >3 employees?** (Not a hosting blocker, but gates the OmniVoice CC-BY-NC voice swap and the Remotion Company License — PRODUCTION-READINESS §7.)
8. **Case B only:** Modal, RunPod, or keep Colab for voice? (Serverless GPU = unattended + ~cents/clip; Colab = free but attended/ephemeral.)

---

*Companion to PRODUCTION-READINESS.md. Findings and recommendations only — no code or config was modified in producing this document.*
