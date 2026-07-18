# Master Audit — News-Reel Factory

**Date:** 2026-07-18 · **Status:** findings + roadmap, no code changed while producing it.
**Source:** 5 parallel read-only audits — backend reliability, frontend/UX, deployment/headless, video-tool UI research (shadcn), efficient self-hosting.
**Detail docs:** [`PRODUCTION-READINESS.md`](./PRODUCTION-READINESS.md) (backend/frontend/deploy/UI) · [`EFFICIENT-SELF-HOSTING.md`](./EFFICIENT-SELF-HOSTING.md) (server sizing/tuning). This file is the **single optimized summary** across all of them.

---

## TL;DR — decisions settled

- **Pipeline works end-to-end today** (verified with 4 real reels): UI → Drive queue → Colab (voice + render) → server collects mp4 → review/approve.
- **Next.js? Optional, not required.** Since render runs in **Colab**, the server is light — Next.js is technically fine self-hosted but buys nothing over the current Vite+Express (which already serves UI+API+media as one process). Migration ≈ 1–2 days for zero functional gain. **Recommend: stay Vite+Express** unless you specifically want a unified codebase.
- **"Truly headless" hinges on one fact: does your server have a GPU?** Render is CPU-only (runs on any Linux box); **voice cloning needs a GPU**.
  - **GPU server →** run *everything* on it (voice+render+web+queue), drop Colab/Drive/Modal. Best.
  - **CPU-only server →** run web+API+queue+**render** on it; push only **voice** to a scale-to-zero serverless GPU (Modal, ~cents/clip). Colab stays as a free-but-attended interim.
- **Biggest efficiency win:** flip `QUEUE_BACKEND=local` — kills Drive chattiness, in-memory buffering, sync latency, the 15GB cap, and the 7-day OAuth expiry in one move.

## Where Remotion runs (the fact that reframes everything)
| Piece | Runs where | Load |
|---|---|---|
| **Preview** `@remotion/player` | Browser (frontend) | none on server; same in Vite/Next |
| **Render** `@remotion/renderer` | **Colab** (Linux, CPU) | off-box |
| **Server** (Express) | laptop/host | light I/O only (Drive calls, collect mp4, serve media, 1 watcher) |

---

## A. Backend reliability & security

**🔴 Critical**
- **C1 — Orphaned `in-progress` jobs never recover on Colab.** Stale-recovery runs once at startup; when Colab disconnects mid-job the reel is silently lost. **Fix:** port the local worker's `recoverStale` (~6 lines) into the Colab `drain_once()` loop (move `in-progress/<id>` older than ~40 min → `pending/`).
- **C2 — Failed renders wedge forever.** `watchCompleted` marks a job `dispatched` and never re-tries if `renderJob` throws (e.g. mp4 not Drive-synced yet → `fetchRenderedVideo` null → local fallback throws under SAC). **Fix:** clear the id from `dispatched` on failure; on gdrive don't fall back to local render; add an mp4 size-stability check.

**🟠 High**
- **H1 — False "OFFLINE" while busy** *(owner's #1 complaint)* — worker only heartbeats between jobs. **Fix:** heartbeat per-scene + before render; server treats `in-progress>0` as alive; UI tri-state + grace. (Full spec in §B.)
- **H2 — No dead-letter / attempts** — poison jobs loop `pending→in-progress→pending` forever, burning GPU, no reason recorded. **Fix:** `meta.attempts++`; after 3 → `rejected/` with `rejectReason`.
- **H3 — Live full-Drive token in plaintext `.env`** (✅ gitignored, never committed), full `auth/drive` scope, no rotation; **7-day expiry** if OAuth stays in *Testing* → `init` throws → `process.exit(1)` → factory down. **Fix:** narrow scope / keychain; surface init failure in `/api/health`; publish-to-Production gate. *(Going `local` deletes this entirely.)*
- **H4 — No API auth + wildcard CORS** — every route open (create, 25MB upload, approve, render). Fine on LAN/localhost; **before public hosting** add a bearer token + restricted CORS.

**🟡 Medium:** M1 `multer@1`→`@2` (advisories); M2 Drive `find`/`listAll` are O(N) + download everything each poll; M3 whole-file in-memory buffering; M4 no 15GB/disk pruning (stall risk); M5 no operator-visible failures (`/api/health` always ok).
**⚪ Low:** L1 bundle/layout drift if `npm run bundle` skipped; L2 notebook cell-order foot-gun; L3 swallowed uncaught exceptions; L4 `spec.id` charset in Drive queries; L5 unenforced licensing.

## B. Frontend & UX

- **False-OFFLINE fix (3 layers):** (A) worker `beat()` per scene + before render; (B) server `/api/worker-status` returns tri-state `online|busy|offline` — **`busy` if a job is in-progress overrides a lapsed heartbeat**; (C) UI: "Checking…" until first poll, amber "Working", red OFFLINE only after 2 consecutive stale polls, keep last-known status on a failed poll, grace ~180s.
- **Loaders missing** (owner wants "enough loaders"): Approve/Reject/Re-queue have **no busy state** (double-click risk); review video shows "No rendered video" *during load* (needs "Loading…"); first counts/jobs load needs skeletons; `<video>` needs a poster/spinner; **image upload uses one shared busy flag → uploading one scene disables all image buttons** (per-field fix).
- **Errors:** inline-text only, no toasts/retry; transient blips flash; raw `Failed to fetch`; no error boundary (a Player throw white-screens).
- **Usability:** no validation before Send (empty id → bad folder name); no tab-switch/badge after Send; jobs table overflows on mobile; CSS typo `.badge\.in-progress` (in-progress badge never colored).
- **Framework:** stay on Vite; optionally add **TanStack Query** for free loading/error/retry/polling.

## C. shadcn UI redesign (make it feel like a real video tool)

- **Patterns to steal** (Runway/Pika/Descript/Kapwing/HeyGen): explicit `queued→voicing→rendering→ready` state machine (never a bare spinner); **step-based progress**, not fake %; queue-position microcopy ("2 ahead — waiting for worker"); 3-way status pill; **caption (on-screen) vs narration (spoken)** split (the app's #1 confusion); treat Queue as a searchable job **library**.
- **Screens:** app bar with Tabs + persistent **3-state Worker pill** (Popover w/ "Open Colab"); **Author** = editor + sticky Player preview, scene **Cards** + filmstrip, caption/narration Badges+tooltips, stat `Switch`, delete `AlertDialog`, upload dropzone w/ Skeleton, Send → success toast w/ "View in Queue"; **Queue** = relabeled stage cards (Waiting/Working/Ready/Approved/Rejected), jobs `Table` w/ per-job **step tracker** + indeterminate `Progress`, skeleton rows, empty state, filter tabs + search; **Review** = `Dialog`/`Sheet`, vertical `<video>` + skeleton poster, Approve (primary), Reject (`AlertDialog`+reason), Re-queue.
- **Components:** `Tabs, Card, Badge, Button, Sonner, Skeleton, Progress, Table, Form(+zod), Input, Textarea, Switch, Tooltip, Popover, Dialog, Sheet, AlertDialog, DropdownMenu, ScrollArea, AspectRatio, Alert` + lucide icons.
- **Theme:** keep dark-first; map current CSS vars 1:1 to shadcn tokens; reserve red `#ba2025` for primary + "Ready to review"; **keep Noto Sans/Serif Tamil** for captions/narration.
- **Setup (Vite):** `tailwindcss @tailwindcss/vite`, `@import "tailwindcss"`, tsconfig `@/*` alias, add `tailwindcss()` + alias to vite.config (**keep** the `@factory/composition` exclude + `/api`+`/storage` proxy), `shadcn init` (dark), mount `<Toaster/>`.

## D. Deployment & headless path

- **Simplest headless:** one **always-on Linux container** (Fly/Render/Railway or your own box) running Node → serves UI+API+`/storage` **and renders on CPU** (no SAC, no GPU); `QUEUE_BACKEND=local`; **voice** on a scale-to-zero **Modal** GPU function; a small server "voice-trigger" step replaces the Colab drain loop. No browser tab to babysit; no Google OAuth.
- **Migration order:** Dockerfile (Node + Chrome libs + `web/dist`) → deploy w/ volume → `local` queue → port OmniVoice `synth` to Modal → add voice-trigger → GPU token in secrets.

## E. Efficient self-hosting (your own server)

- **The pivot = GPU or not** (see TL;DR). Case A (GPU): all on one box, $0 marginal. Case B (CPU-only): render on-box, voice on serverless GPU; **never run OmniVoice on CPU** (minutes/scene).
- **Footprint:** idle Node ~60–120 MB (+150–300 MB after first bundle); one CPU render peak ~1.5–3 GB RAM, **~1–3 min** for these graphics-only reels on 4–8 vCPU (benchmark #4949: sublinear past concurrency 8 — sweet spot 4–8); OmniVoice ~a few GB VRAM (verify w/ `nvidia-smi`); disk **~30–60 MB/reel → ~10–90 GB/month unpruned**.
- **Min spec (10–50/day):** GPU box = ≥8GB VRAM GPU + 4–8 vCPU + 8GB RAM + 40–80GB SSD. CPU box = 4–8 vCPU + 4–8GB RAM + 30–60GB SSD + off-box voice.
- **Deploy:** single Node process (already prod); **Docker recommended** (or systemd; **skip PM2**); `node:22-bookworm-slim`; `npx remotion browser ensure` (don't apt-install Chrome); Chrome apt libs already in notebook cell-5; persist `storage/` + queue dir; `SERVER_ORIGIN=http://127.0.0.1:4000`. Dockerfile + systemd sketches in the detail doc.
- **Tuning:** `local` backend (kills M2/M3 + chokidar watch instead of poll); bundle cached per-process (keep it long-lived); renders serialized (keep); set `--concurrency` 4–8; wav ffprobe is dependency-free (no system ffmpeg needed); add retention prune + log rotation.
- **Strip when local:** the whole Drive backend + heavy `googleapis` dep + OAuth (needs a 1-line `queue/index.ts` edit to fully drop); keep edge-tts draft only if the operator uses "Draft audio".

---

## Unified roadmap — simplest-first (the one plan)

**Wave 1 — reliability + the honesty bug (decision-independent, highest value):**
1. Worker: `beat()` per scene + before render **and** in-loop stale recovery → fixes **H1 false-offline** *and* **C1 orphan-loss** (both in the notebook loop).
2. Server: tri-state `/api/worker-status` from `in-progress` count + grace ~180s.
3. Server: retry stuck renders (clear failed `dispatched`; no local fallback on gdrive) → **C2**.
4. Worker: attempts → `rejected/` with reason (**H2**) + persist failures into `meta` (**M5**).

**Wave 2 — UX the owner asked for:**
5. Loaders/skeletons + disable in-flight buttons + "Loading video…" + per-field upload flag.
6. Toasts (replace inline err/msg) + Send-to-queue validation + "View in Queue".
7. UI 3-state worker banner.

**Wave 3 — shadcn redesign** (needs Vite-vs-Next decision): §C, in its own simplest-first order (foundation → worker pill → toasts → queue step-tracker → author scene clarity → review dialog → filmstrip/filters → theme).

**Wave 4 — hardening before hosting:** bearer auth + CORS (**H4**), `multer@2` (**M1**), retention prune (**M4**), stream downloads (**M3**), `/api/health` reflects state (**M5**).

**Wave 5 — go headless/self-host** (needs GPU/server answers): §D/§E — Dockerize, `QUEUE_BACKEND=local`, render on-box, voice on GPU (local or Modal), retire Colab/Drive.

---

## Licensing / commercial gates (before monetizing)
- 🔴 **OmniVoice weights CC-BY-NC (non-commercial)** — swap to a commercially-licensed Tamil voice (contained to the voice step). #1 blocker.
- 🟠 **Remotion** free ≤3 employees / non-profit; **4+ → ~$100/mo**.
- 🟡 **edge-tts** draft-only (never ship). 🟢 Drive OAuth "Production" — removed by going `local`.

## Open questions (to finalize deployment)
GPU? (+ VRAM) · OS (Linux assumed) · vCPU/RAM · disk & persistence · **public or LAN-only** · daily volume · monetized/team>3? · Case B voice provider (Modal/RunPod/Colab)?

---
*Consolidates the 5 audits of 2026-07-18. No code modified.*
