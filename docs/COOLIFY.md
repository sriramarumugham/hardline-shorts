# Deploy on Coolify (single-tenant)

Deploys the **Hardline Shorts** server (UI + API + queue + render) to your own
Coolify. Voice still comes from your **Colab worker** over Google Drive
(`gdrive` mode) — that's the "works today" setup. See `DEPLOY.md` for the other
voice options.

> Runs on **your** Google account — this is the single-tenant version. Letting
> other people use their own accounts is a separate rebuild (see the SaaS notes).

---

## 0. Prerequisites
1. **Push this repo to a git host Coolify can reach** (GitHub / GitLab / Gitea).
   Coolify deploys from a git remote — the repo has none yet. Secrets are
   gitignored, so the repo is safe to push (no `.env`, no `client_secret`).
2. **Rotate the Google credentials first** (they were exposed while building
   this). New client secret + fresh refresh token — see `google-drive-setup.md`.
   You'll paste the new values into Coolify (never into the repo).
3. **Keep the Colab worker running** — it does voice + render and writes the mp4
   back to Drive; the Coolify server collects it. `reference.wav` +
   `render-bundle.zip` must be in the `reel-queue` Drive folder (they already are).

## 1. Create the app in Coolify
- **New Resource → Application → your git repository** (pick the repo/branch).
- **Build Pack: Dockerfile** (the repo's root `Dockerfile`). Coolify builds it —
  first build ~5 min (installs deps, builds the UI, downloads headless Chrome).
- **Port:** `4000` (Coolify maps your domain → the container's 4000, with SSL).

## 2. Persistent storage (so media/queue survive redeploys)
- **Storages → Add → mount path `/data`** (a Coolify volume). The app writes
  `storage/` + `queue/` under `/data`.

## 3. Environment variables (Coolify → Environment Variables)
```
QUEUE_BACKEND=gdrive
GOOGLE_CLIENT_ID=<your new client id>
GOOGLE_CLIENT_SECRET=<your new client secret>
GOOGLE_REFRESH_TOKEN=<your new refresh token>
DRIVE_ROOT_FOLDER_ID=<your reel-queue folder id from the Drive URL>
SERVER_ORIGIN=http://127.0.0.1:4000      # internal — do NOT set to the public URL
# --- recommended once it's public ---
API_TOKEN=<a long random string>          # then enter it once in the browser on first load
# CORS_ORIGIN=https://your-domain          # only if the UI is on a different origin
RETENTION_DAYS=14                          # prune old approved/rejected jobs + media
```
> Keep `SERVER_ORIGIN=http://127.0.0.1:4000`. It's only used if the container
> renders locally (a fallback) — the browser reaches `/storage` through your
> Coolify domain automatically via relative URLs.

## 4. Deploy
- Click **Deploy**. When the health check goes green (`/api/health`, wired into
  the Dockerfile), open your domain — the UI loads.
- If you set `API_TOKEN`, the first API call prompts for it in the browser
  (stored in localStorage). Leave it unset for a private/LAN deploy.

## 5. Run it end to end
1. Author a reel → **Send to queue** (lands in Drive `pending/`).
2. Your **Colab worker** voices + renders it → moves it to `completed/`.
3. The Coolify server collects the mp4 → **`generated`** → **Review → Approve**.

---

## Notes & limits
- **Resources:** in `gdrive` + Colab mode the server is light (render is off-box)
  — ~0.5–1 GB RAM is plenty. If you later switch to on-box CPU render
  (`QUEUE_BACKEND=local` + a voice source), budget **2 vCPU / 4 GB** and expect
  ~1–3 min per reel (see `EFFICIENT-SELF-HOSTING.md`).
- **Colab is the weak link** — it's attended and disconnects; fine as a bridge,
  not truly unattended. The always-on fix is a GPU voice worker or a Modal
  function (the trigger step is still to build).
- **Rebuild the composition bundle** (`npm run bundle`) and re-run if you change
  `packages/composition`, so Colab renders the current layout.
- **Not for commercial output** until OmniVoice's non-commercial voice is swapped
  (see MASTER-AUDIT §7).
