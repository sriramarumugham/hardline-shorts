# News-Reel Factory

Web-based factory that turns Tamil news articles into vertical (1080×1920) reels
at scale, operated by non-developers. This is the real build of
[`blueprint.md`](./blueprint.md). The original proof-of-concept (the level-0
CLI pipeline) is preserved under [`poc/`](./poc/).

> Only two things change per video: the **spec JSON** and the **images**.

## What works today

The full loop runs on a laptop with no GPU:

```
Author (web UI)  ──▶  Queue: pending ──▶ in-progress ──▶ completed ──▶ generated ──▶ approved / rejected
   │  build spec        │ voice worker         │ render watcher            │ review gate
   │  + draft audio      (draft: edge-tts       (@remotion/renderer)         (manual, never
   │  + live preview      local, or the Colab    completed → generated        auto-publishes)
   └────────────────────  OmniVoice clone)
```

Verified end-to-end: author a spec → send to queue → the draft worker voices it
→ the watcher renders an MP4 → review and approve.

## Repository layout (npm workspaces)

| Path | What |
|---|---|
| `packages/composition` | The shared Remotion `Reel` component + the Zod **spec schema** + `compile()`. Imported by **both** the Player (preview) and the renderer (output) so they never diverge — this is blueprint §A's "one shared composition." |
| `apps/server` | Express: image uploads, draft audio (edge-tts + ffprobe), the filesystem job queue, the draft voice worker, the render watcher, and the review API (blueprint §B, §C, §E). |
| `apps/web` | Vite + React authoring UI: schema-building form, live Player preview, draft audio, send-to-queue, and the queue dashboard + review gate (blueprint §A). |
| `poc/` | The original CLI proof-of-concept (Remotion project, Colab notebooks, sample specs). Reference only. |

## Run it

```bash
npm install            # once, at the repo root (installs all workspaces)

# Terminal 1 — server + web together (server :4000, web :5173)
npm run dev

# Terminal 2 — the local draft voice worker (drains pending → completed)
npm run worker:draft
```

Open **http://localhost:5173**.

1. **Author** tab — fill in brand + scenes, upload images, click **Draft audio**
   to hear real per-scene timing in the preview, then **Send to queue**.
2. Leave the draft worker running; it voices the job and the server renders it.
3. **Queue & Review** tab — watch the counts advance, then **Review** the
   generated MP4 and **Approve** or **Reject** (with a reason).

## Audio: draft vs. final quality

- **Draft** (`npm run worker:draft`, and the "Draft audio" button) uses Microsoft
  Edge TTS. It is for **timing and preview only** — against Microsoft's ToS for
  shipped audio (blueprint §2). It lets the whole pipeline run with no GPU.
- **Final / shippable** audio comes from the **OmniVoice voice clone on Google
  Colab** (free T4 GPU). The Colab worker drops `<sceneId>.wav` files into a
  job's audio folder; the render step measures them and renders. See
  [`docs/colab-worker.md`](./docs/colab-worker.md) and the notebooks in
  `poc/colab/`. OmniVoice weights are **CC-BY-NC** — non-commercial only until a
  commercially-licensed Tamil voice is swapped in (blueprint §1).

## The queue — two swappable backends

The queue is one async interface (`apps/server/src/queue/types.ts`) with two
implementations, chosen by `QUEUE_BACKEND`:

- **`local`** (default) — filesystem under `apps/server/queue/<stage>/<id>/`.
  Each stage is a folder; moving a job = renaming its dir. Zero setup.
- **`gdrive`** — the blueprint's production path (§C/§4): the Node server talks
  to **Google Drive** via the API (OAuth2 user refresh token), and the **Colab
  worker** voices jobs over the same Drive via `drive.mount()`. Headless-server
  friendly. Full setup in **[`docs/google-drive-setup.md`](./docs/google-drive-setup.md)**.

The renderer always reads media from local `storage/`, so the gdrive backend
downloads a completed job's audio locally before rendering and uploads the mp4
back — the backend swap is fully contained in `apps/server/src/queue/`.

Switch backends by env only:
```bash
# local (default) — laptop dev loop
npm run dev  &&  npm run worker:draft

# gdrive — production; server renders, Colab voices
QUEUE_BACKEND=gdrive npm run dev            # + Colab: colab/omnivoice_drive_worker.ipynb
```

## Configuration

Server env (see `apps/server/.env.example`): `PORT`, `HOST`, `SERVER_ORIGIN`
(origin the renderer's Chromium fetches media from), `TA_VOICE` (draft voice),
`WORKER_POLL_MS`, `WORKER_STALE_MS`.

## Guardrails

Manual review gate — nothing auto-publishes. Respect the voice-model license.
Handle image credit. (Blueprint "Guardrails".)

## Known follow-ups

- Google Drive backend + Colab drainer are **built** (`QUEUE_BACKEND=gdrive`,
  `docs/google-drive-setup.md`). Still to do: end-to-end run against a real
  Google account, and pruning old jobs under the 15 GB free tier.
- Bump `multer` to 2.x (1.x LTS has known advisories).
- Hosted voice endpoint (RunPod/Modal) and Remotion Lambda for render scale
  (blueprint "Later").
