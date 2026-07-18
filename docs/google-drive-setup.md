# Google Drive queue — production setup

The `gdrive` backend runs the factory over a real Google Drive queue: the Node
server talks to Drive via the API (OAuth2 **user refresh token** — not a service
account, which has no My Drive storage, blueprint §4), and the **Colab worker**
voices jobs by writing into the same Drive via `drive.mount()`. This is the
headless-server production path.

```
Web UI ─▶ server (Drive API) ─▶  MyDrive/reel-queue/
                                    pending ─▶ in-progress ─▶ completed ─▶ generated ─▶ approved/rejected
Colab (drive.mount) drains pending ─────────────────────────┘  ▲
server watches completed, renders, moves to generated ─────────┘
```

## 1. Create the queue folder in Drive
In the Google account that will own the queue, create a folder in **My Drive**,
e.g. `reel-queue`. Open it; the URL ends with the folder id:
`https://drive.google.com/drive/folders/<THIS_IS_DRIVE_ROOT_FOLDER_ID>`.
Also drop a clean 15–30s **`reference.wav`** (single speaker, no music) in it for
the voice clone.

## 2. Google Cloud project + Drive API
1. https://console.cloud.google.com → create a project.
2. **APIs & Services → Library → Google Drive API → Enable.**

## 3. OAuth consent screen
- **APIs & Services → OAuth consent screen.** User type **External**.
- Add scope `https://www.googleapis.com/auth/drive`.
- Add your Google account under **Test users**.
- ⚠️ **Publish to Production** (blueprint §4) — while the app is in *Testing*, the
  refresh token expires after 7 days. Publishing keeps it alive. (Google may warn
  the app is unverified; for your own account, proceed.)

## 4. OAuth client (Desktop app)
- **APIs & Services → Credentials → Create credentials → OAuth client ID.**
- Application type **Desktop app**. This yields a **Client ID** and **Client
  secret** and allows the loopback redirect the token helper uses.

## 5. Get a refresh token
From `apps/server/`:
```bash
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run token
```
Open the printed URL, approve, and copy the `GOOGLE_REFRESH_TOKEN=...` it prints.

## 6. Configure + run the server
Put these in `apps/server/.env` (or the shell environment):
```
QUEUE_BACKEND=gdrive
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=yyy
GOOGLE_REFRESH_TOKEN=zzz
DRIVE_ROOT_FOLDER_ID=<from step 1>
# SERVER_ORIGIN must be reachable by the render machine's Chromium (default localhost is fine
# when the server renders locally).
```
Then:
```bash
npm run dev        # server (gdrive) + web
```
On boot it verifies auth and creates the six stage folders under `reel-queue/`.

## 7. Run the Colab worker
Open [`../colab/omnivoice_drive_worker.ipynb`](../colab/omnivoice_drive_worker.ipynb)
in Colab (GPU runtime). Set `QUEUE_ROOT = '/content/drive/MyDrive/reel-queue'`
(match the folder from step 1) and run all cells. It drains `pending → completed`.

## Flow to test it
1. Author a reel in the web UI → **Send to queue** (job appears in Drive `pending/`).
2. Colab picks it up (after Drive sync), voices it, moves it to `completed/`.
3. The server's poll-watcher renders it → `generated/`.
4. **Review** in the UI → Approve / Reject.

## Notes / limits
- **Single worker** — no atomic claim on Drive; run one Colab worker.
- **Images** stay in the server's local `storage/` and are served at `/storage`;
  only `spec.json`, the audio, and the mp4 live in Drive. Keep the render server
  and the UI/upload server the same box (blueprint §E).
- Prune old jobs to stay under the 15 GB free tier.
- Not for commercial output until the OmniVoice (CC-BY-NC) voice is swapped for a
  commercially-licensed Tamil model (blueprint §1).
