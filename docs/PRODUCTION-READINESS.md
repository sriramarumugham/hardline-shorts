# Production-Readiness & Redesign Audit — News-Reel Factory

**Date:** 2026-07-18
**Status:** Findings only — no code changed. Captured while the live pipeline was running.
**Method:** 4 parallel read-only audit agents (backend, frontend/UX, deployment/headless, video-tool UI research) + a corrected architecture reassessment.

---

## 0. Where things stand (verified working today)

Full pipeline runs **end-to-end**: author a reel in the web UI → job to Google Drive queue → **Colab worker voices (OmniVoice) + renders (Remotion on Linux)** → server collects the mp4 → review/approve. Verified with 4 real reels (`amma-crisis-reel` 29.8 MB, `food-security-reel`, `up-revenue-reel`, + a smoke test), each a valid H.264 vertical reel with Tamil narration, images, and stat cards.

---

## 1. Architecture clarification — where Remotion actually runs

A correction to an earlier imprecise claim ("the server does multi-minute renders"). In the **current** (Colab-render) architecture:

| Piece | Runs where | Load |
|---|---|---|
| **Preview** (`@remotion/player`) | The **browser** (frontend). Pure client-side React. | None on server. Works the same in Vite or Next.js (`"use client"`). |
| **Render** (`@remotion/renderer`) | **Colab** (Linux + headless Chrome). | Off-box. Not the laptop, not the frontend. |
| **Server** (Express) | The laptop / a host | **Light I/O only**: Drive API calls, download the finished mp4, serve static media, one background polling loop (the watcher). No CPU-heavy video work. |

**Implication:** because rendering is in Colab, the server is lightweight. Any "server can't do long renders" reasoning does **not** apply to the current design.

---

## 2. The Next.js question — corrected verdict

**Next.js is NOT technically blocked. It is a preference, not a wall.**

- **Self-hosted Next.js (`next start` on a box/container): fine.** Load is trivial; API routes replace Express `/api/*`.
- **One real caveat:** the **watcher** (a `setInterval` polling Drive for finished jobs) needs an always-on process → does **not** fit Vercel-style serverless Next. Self-hosted Next or Express both handle it; Vercel would force a separate worker anyway.
- **Preview** works fine in Next — `@remotion/player` is browser-only, mark it `"use client"`.
- **Honest bottom line:** Next.js won't make the app faster or simpler to *operate*, and migration is ~1–2 days (port `/api/*` to route handlers, re-home the watcher as a separate always-on script, `"use client"` on Preview, `transpilePackages` for `@factory/composition`). Choose it only if a unified codebase + shadcn's first-class Next integration is worth that to you. **Otherwise Vite + Express is the lower-effort path and already serves UI + API + media as one process in production.**

> Decision still open: **Keep Vite+Express** (least effort) vs **Migrate to Next.js** (unified). This gates the shadcn UI setup (the steps differ slightly).

---

## 3. Backend production-readiness

Overall: well-structured prototype, **not yet production-ready for an unattended non-dev operator.** Dominant risks: jobs silently stuck with no operator-visible signal; a live full-Drive credential in plaintext; orphan-recovery gap that ephemeral Colab makes near-certain.

### 🔴 Critical
- **C1 — Orphaned `in-progress` jobs never auto-recover on the Colab worker.** `recover_startup()` runs once at startup; the loop has no time-based stale recovery. When Colab disconnects mid-job (its normal state), the reel is silently lost; UI still shows "in progress". Contradicts blueprint §D and the local worker (`worker-draft.ts` `recoverStale`, which runs every tick). **Fix:** port `recoverStale` into `drain_once()` — move any `in-progress/<id>` older than ~40 min back to `pending/` (~6 lines).
- **C2 — Failed renders get stuck forever.** `drive.ts watchCompleted` adds an id to `dispatched` and only clears it when the folder leaves `completed/`. If `renderJob` throws, the job is never re-dispatched. On a SAC laptop the local-render fallback always throws, so any job where `fetchRenderedVideo` returns null (e.g. mp4 not yet Drive-synced when the folder appears) wedges permanently. **Fix:** on dispatch failure remove the id from `dispatched` so the next poll retries; on gdrive, do not fall through to local render; add a settle/size-stability check before treating the mp4 as ready.

### 🟠 High
- **H1 — Worker heartbeat goes stale *while busy* → false "OFFLINE".** Notebook loop calls `beat('draining')` once, then voices+renders every pending job (minutes) before `beat('idle')`. Server marks offline after `WORKER_ONLINE_MS=120000` + Drive-sync latency. Operator sees "offline" mid-work → force-restarts Colab → interrupts render → orphan (C1). **Fix:** emit `beat()` inside the per-job loop (per scene + around `render_job`), and/or raise `WORKER_ONLINE_MS` above a worst-case single-job time.
- **H2 — No dead-letter / max-attempts.** On failure both workers move the job back to `pending/` with no attempt counter → poison jobs loop `pending→in-progress→pending` forever, burning GPU, and the Colab worker writes no reason anywhere. **Fix:** `meta.attempts++`; after N (≈3) move to `rejected/` with `rejectReason=<error>` (surfaces in the existing review UI).
- **H3 — Live full-Drive credential in plaintext, over-broad scope.** `apps/server/.env` holds a real `GOOGLE_CLIENT_SECRET` + `GOOGLE_REFRESH_TOKEN` (✅ confirmed gitignored and never committed). Token has full `auth/drive` scope (entire Drive, not just `reel-queue/`). No rotation/keychain. **7-day death trap:** if OAuth consent stays in *Testing*, the refresh token expires in 7 days → `DriveQueue.init` throws → `main()` `process.exit(1)` → whole factory down, non-dev sees only a console line. **Fix:** narrow scope to `drive.file` if server+Colab share the account; store via OS keychain/restricted perms; surface init failure in `/api/health`; make publish-to-Production a hard checklist gate.
- **H4 — No auth on any endpoint + wildcard CORS.** Every route (create job, 25 MB upload, approve/reject/requeue, render) is unauthenticated and `cors()` allows any origin. Fine on localhost; dangerous if `SERVER_ORIGIN` is ever exposed. **Fix:** shared-secret bearer middleware on `/api/*` + restrict CORS to the known web origin.

### 🟡 Medium
- **M1 — `multer@1.4.5-lts.1` deprecated** (known advisories, patched in 2.x). Pairs badly with H4. **Fix:** upgrade to `multer@^2` (API largely compatible for this diskStorage use).
- **M2 — Drive backend is chatty / O(N).** `create()`→`find()` scans all six stages and downloads every candidate's spec+meta; `listAll()` downloads every job's meta on every call (UI polls it). Risk of 429s as `approved/`+`rejected/` grow. **Fix:** duplicate-check via a single `files.list` by name; avoid full meta downloads where only id/stage is needed.
- **M3 — Whole-file buffering in memory** (`downloadBuffer` loads entire mp4/audio as arraybuffer). **Fix:** stream `alt=media` to disk.
- **M4 — No Drive 15 GB pruning.** `move()` only re-parents, never deletes; `approved/`+`rejected/` grow unbounded; at 15 GB `files.create` fails → pipeline stalls with `storageQuotaExceeded`. **Fix:** retention step deleting/trashing old `approved/`+`rejected/` job folders; show Drive usage in the UI.
- **M5 — Operator can't see failures.** Failures land in `console.*` only; `/api/health` always returns `{ok:true}`. A non-dev can't tell a stuck job from a slow one. **Fix:** persist failure reason+timestamp into `meta` (shows in dashboard); make `/api/health` reflect queue-init + worker freshness.

### ⚪ Low
- **L1** Composition/bundle drift — Colab renders from `render-bundle.zip`; if `packages/composition` changes and `npm run bundle` isn't re-run, reels render with a stale layout silently. Cell-5's hardcoded `FPS/W/H/GAP/PLACEHOLDER` must match the composition. *Fix:* stamp a version into the bundle and assert it.
- **L2** Notebook cell-ordering foot-gun — `process()` is redefined in the render cell; skip it and jobs are voiced but not rendered. *Fix:* fold render setup into one cell or assert it ran.
- **L3** `uncaughtException`/`unhandledRejection` are swallowed (intentional to survive compositor frame-pipe throws) — can mask real corruption. *Fix:* log to a file, not just stdout.
- **L4** Drive query escaping only handles single quotes; `spec.id` is user-supplied. Confirm id is constrained to a safe charset.
- **L5** Licensing constraints documented but unenforced (see §7).

### Backend — top 5, simplest-first
1. In-loop stale recovery on the Colab worker (C1).
2. Heartbeat inside the job loop + raise `WORKER_ONLINE_MS` (H1).
3. Stop marking failed renders permanently dispatched (C2).
4. Move the Drive token off plaintext `.env` + make init-failure visible (H3).
5. Attempt-count → `rejected/` with reason (H2).

---

## 4. Frontend / UX production-readiness

### The "false OFFLINE" bug — root cause (3 layers)
- **Layer A (real bug):** the Colab worker only heartbeats *between* jobs — no `beat()` while voicing/rendering (minutes). `lastSeenIso` goes stale for the whole job.
- **Layer B:** the server declares offline purely on heartbeat age (`WORKER_ONLINE_MS=120000`) + Drive sync latency, and never consults `queue.counts()` (which knows a job is in-progress).
- **Layer C:** the UI is binary (`online ? "online" : "OFFLINE"`), `worker` starts `null`, and a single failed poll blanks the banner.

**Simplest robust fix (all three):**
1. **Worker:** `beat('voicing')` per scene + `beat('rendering')` before render (~3 lines) — the primary fix.
2. **Server:** `/api/worker-status` returns a derived tri-state: `busy` if `counts["in-progress"]>0` (alive by definition), else `online` if heartbeat fresh, else `offline`. Return `state: "online"|"busy"|"offline"`.
3. **UI:** three states — neutral "Checking…" until first poll; amber "Working" for busy; red OFFLINE only after 2 consecutive stale polls; keep last-known status on a failed poll. Bump grace to ~180s. **Rule: an active in-progress job overrides a lapsed heartbeat → show Working, never Offline.**

### Missing / weak loaders (owner explicitly asked for "enough loaders")
| Action | Today | Needed |
|---|---|---|
| Approve / Reject / Re-queue | No busy state; buttons stay enabled | Per-action busy + disable + spinner (prevents double-approve) |
| Open job / load review video | Shows "No rendered video (yet)" *during loading* | Distinct "Loading video…" spinner |
| Counts / jobs first load | Shows `0` everywhere + "No jobs yet" before data | Skeleton / "Loading…" |
| `<video>` buffering | Raw `<video>`, no poster/spinner | Poster or spinner overlay |
| Image upload | `busy==="upload"` is a **single shared flag** → uploading one scene disables *all* image buttons | Per-field busy flag |
| Draft audio / send | Text-only busy | Spinner + "~30s" note |

No reusable spinner/skeleton exists in `styles.css` — add one.

### Error handling & usability
- Errors are inline text only (`.err` divs) — no toast/dismiss/retry; transient blips flash then clear; network failures surface raw `TypeError: Failed to fetch`. No global error boundary (a Player throw white-screens the app).
- **No validation before Send to queue** — empty id / empty narration / blank stat fields all pass; empty id → bad Drive folder name. Add pre-submit validation + confirm summary.
- After "Send to queue" the UI doesn't switch tabs or badge the Queue with the pending count.
- Jobs `<table>` has no horizontal-scroll wrapper (overflows on phones). CSS typo `.badge\.in-progress` (`styles.css:88`) → in-progress badge never gets its amber color.

### Vite vs Next (frontend agent's take): **stay on Vite.** Borrow **TanStack Query** for built-in loading/error/retry/polling instead of a framework change. (See §2 for the full nuanced verdict.)

### Frontend — top 5, simplest-first
1. `beat()` inside the worker job loop (kills false-offline at the source).
2. Disable Approve/Reject/Re-queue while in flight + "Loading video…" state.
3. Server derives tri-state from in-progress count.
4. UI three-state banner + grace period.
5. Validate before Send to queue + per-field upload busy flags. (Bonus: fix `.badge.in-progress` CSS typo.)

---

## 5. Deployment — simplest "truly headless" path

The only non-headless piece is the **attended, ephemeral Colab tab** (a human keeps it open; it disconnects). Key insight: Colab does **two** jobs — voice (needs GPU) + render (CPU-only Remotion). Only voice needs a GPU.

**Recommended default:**
- **Web + API + queue + render → one always-on Linux container** on a managed PaaS (Fly.io / Render / Railway). Node 20 + headless-Chrome apt libs (already listed in the notebook). Build `web/dist` into the image so one process serves UI + `/api` + `/storage`. **Render runs here on CPU — no GPU, no Smart App Control.** Persistent volume for `storage/`.
- **Queue → local filesystem** (`QUEUE_BACKEND=local`, already implemented). Deletes 4 blockers at once: Drive 15 GB cap, OAuth 7-day expiry, single-worker race, sync latency.
- **Voice → a Modal (or RunPod serverless) GPU function** wrapping the notebook's OmniVoice load + `synth()`. Scale-to-zero (~cents/clip vs a GPU VM idling at $150–400/mo).
- **Trigger (the one new piece):** a server step that POSTs each scene's text to the voice function, writes wavs into the job's `audio/`, moves it to `completed/`. Existing watcher→render→review path is unchanged.

**Non-dev operation:** nothing to start (PaaS keeps it up — no tab to babysit); status via the existing dashboard; add jobs via the web UI; secrets set once in the PaaS store; **no Google OAuth to manage** (Drive dropped).

**Migration checklist:** (1) Dockerfile for `apps/server` (Node 20 + Chrome libs + `web/dist`); (2) deploy to PaaS with a volume → always-on headless UI+API+render on Linux; (3) `QUEUE_BACKEND=local`; (4) port OmniVoice `synth` to a Modal function; (5) add the server voice-trigger step; (6) GPU token in PaaS secrets.

**Lower-effort alternative (worse economics):** keep Drive + run the existing notebook as a headless `systemd` service on a cheap always-on GPU host (swap Colab's `drive.mount()` for `rclone mount`). Near-zero new code, but GPU idles at $150–400/mo and keeps all Drive limits.

---

## 6. shadcn/ui redesign brief (UI research)

**Goal:** make it read like a real video-generation tool and be dead-simple for a non-dev — without changing the flow.

### Patterns worth stealing (sources: Runway, Pika, Descript, Kapwing, HeyGen, LogRocket, KoruUX)
- Explicit **queued → running → rendering → ready** state machine, never a bare spinner.
- **Step-based progress** ("Voicing → Rendering → Ready") over fake percentages for unpredictable GPU work; indeterminate bar with *specific* microcopy, never "Processing…".
- **Queue position / "why waiting"** microcopy ("2 jobs ahead — waiting for the voice worker").
- **Three-way status** (available / busy / offline) icon + label + microcopy.
- **Script vs Scene split** (Descript): caption = on-screen, narration = spoken-only — the app's #1 point of confusion.
- Treat the Queue as a **job library** (search / filter / re-run).

### Screen-by-screen (condensed)
- **Global shell:** top app bar with Tabs + a persistent **Worker status pill** (visible on both tabs) → Popover with detail + "Open Colab". Global **Sonner** toaster.
- **Worker pill (centerpiece):** 3 states — **Online-idle** (green), **Working** (amber, pulsing; *in-progress job overrides a lapsed heartbeat*), **Offline** (red, only when no in-progress job + stale/absent heartbeat, with "Open Colab").
- **Author:** two-column (editor + sticky Player preview, unchanged). Brand `Card` + `Form`. Scenes as `Card`s with a horizontal **filmstrip**; **caption (on-screen) vs narration (spoken)** made unmistakable with Badges/Tooltips; stat toggle → `Switch`; delete → `AlertDialog`; image upload dropzone with `Skeleton`. Sticky action bar: Draft audio + Send to queue → success toast with **"View in Queue"** action.
- **Queue:** relabel counts to human stages (Waiting / Working / Ready to review / Approved / Rejected), emphasize "Ready to review". Jobs `Table` with a **per-job step tracker** cell (Queued→Voicing→Rendering→Ready) + indeterminate `Progress` for in-progress; `Skeleton` rows on first load; empty-state `Card`; filter tabs + search.
- **Review:** open in a `Dialog`/`Sheet` — vertical `<video>` with `Skeleton` poster; Approve (primary); Reject (`AlertDialog` + reason `Textarea`); Re-queue for rejected.

### shadcn components
`Tabs, Card, Badge, Button, Sonner (toast), Skeleton, Progress, Table, Form (react-hook-form+zod), Input, Textarea, Label, Switch, Tooltip, Popover, Dialog, Sheet, AlertDialog, DropdownMenu, ScrollArea, AspectRatio, Alert, Separator` + `lucide-react` icons.

### Visual direction
Keep dark-first palette (reads "broadcast"). Map current CSS vars 1:1 to shadcn HSL tokens: `--primary #ba2025` (reserve red for primary actions + "Ready to review" only), `--background #0f1115`, `--card #191c22`, `--secondary/muted #22262e`, `--border #2c313b`, `--foreground #e7e9ee`, `--muted-foreground #9aa1ad`. Formalize status semantic colors (amber=working/queued, blue=completed, violet=generated, green=online/approved, red=offline/rejected). Serif/grotesque display face for wordmark + **keep a Tamil-capable font stack** (`Noto Sans/Serif Tamil`) for caption/narration.

### Add Tailwind + shadcn to this Vite app
1. `npm i tailwindcss @tailwindcss/vite -w @factory/web` + `-D @types/node`.
2. `@import "tailwindcss";` atop `styles.css` (keep hand-CSS below during migration).
3. tsconfig: `baseUrl: "."`, `paths: { "@/*": ["./src/*"] }` (no collision with `@factory/*`).
4. vite.config: add `tailwindcss()` + resolve alias `@`; **keep** `optimizeDeps.exclude:["@factory/composition"]`, the `/api`+`/storage` proxy, port 5173.
5. `npx shadcn@latest init` (dark base; wire tokens) + `add` the components above.
6. Mount `<Toaster/>` once; wrap in `TooltipProvider`.

**If Next.js instead:** shadcn init is first-class (auto `@/` alias, `components.json`); `@tailwindcss/vite` → Next's PostCSS; the Vite `/api`+`/storage` proxy → Next route handlers or `next.config` rewrites (the biggest change); Preview → `"use client"`; `transpilePackages:["@factory/composition"]`.

### Redesign — implementation order
1. shadcn foundation (setup, Toaster, TooltipProvider) — no visual change.
2. 3-state Worker pill.
3. Toasts everywhere (replace inline err/msg).
4. Queue: per-job step tracker + skeletons + empty state + relabeled counts.
5. Author: scene cards + caption/narration clarity + Switch + AlertDialog.
6. Review: Dialog/Sheet + skeleton poster.
7. Filmstrip + filters/search.
8. Theme/typography pass; delete superseded CSS.

---

## 7. Licensing / commercial gates (must resolve before monetizing)

- 🔴 **OmniVoice weights are CC-BY-NC (non-commercial).** Code is Apache-2.0; weights are not. Any monetized/branded reel is offside — Colab, Modal, or anywhere. Pipeline is voice-agnostic (render reads only `<sceneId>.wav`), so the swap is contained to the voice function. Candidates: AI4Bharat Indic Parler-TTS / Indic-TTS (**verify license**) or a paid API (Azure `ta-IN-PallaviNeural`, ElevenLabs). **#1 commercial blocker.**
- 🟠 **Remotion license by team size.** Free for individuals / for-profit ≤3 employees / non-profits; **4+ employees → paid "Automators" ≈ $100/mo** (renders programmatically + embeds Player). MIT fallback: **Revideo**. Confirm headcount.
- 🟡 **Edge TTS (`msedge-tts`) is draft-only** (MS ToS + periodic 403s) — correctly confined to `/api/draft-audio`. Never ship as final audio.
- 🟢 **Google OAuth "Production" consent** (7-day token death otherwise) — removed entirely by the recommended `local`-queue default.

---

## 8. Consolidated first-wave action plan (when code changes resume)

Ordered simplest-first; the top items fix the honesty bug + the biggest silent-loss modes:

1. **Worker: `beat()` inside the job loop** + **in-loop stale recovery** (fixes false-offline H1/§4 *and* orphan-loss C1 — both in the notebook loop).
2. **Server: tri-state `/api/worker-status`** from in-progress count + raise grace to ~180s.
3. **Server: retry stuck renders** — clear failed dispatch from `dispatched`; no local-render fallback on gdrive (C2).
4. **Worker: attempt-count → `rejected/` with reason** (H2) + persist failure into `meta` (M5).
5. **UI: three-state banner + loaders/skeletons/toasts** everywhere + Send-to-queue validation.
6. **Security before hosting:** bearer token on `/api/*`, narrow CORS, `multer@2`, move token to keychain.
7. **shadcn redesign** (§6) once the Vite-vs-Next decision is made.
8. **Headless deploy** (§5) — Linux container + local queue + Modal voice — when ready to leave the laptop.

---

*This document is a snapshot of the 2026-07-18 audit. No code was modified in producing it.*
