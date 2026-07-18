# Deploy (self-host)

Ready-to-use artifacts for hosting the factory on your own Linux box. Full
reasoning + sizing is in [`EFFICIENT-SELF-HOSTING.md`](./EFFICIENT-SELF-HOSTING.md);
this is the quickstart.

## What's in the box
`Dockerfile` + `docker-compose.yml` build **one Node process** that serves the
UI + `/api` + `/storage` **and renders video on CPU** (no GPU, no Windows Smart
App Control). Media + queue persist on the `factory-data` volume.

```bash
docker compose up -d --build      # build + start
docker compose logs -f            # watch it
# open http://<server>:4000
docker compose restart            # restart   /   down to stop
```

Day-2 ops (status, updates, disk, backups) are in EFFICIENT-SELF-HOSTING.md §7.

## The one decision: where does VOICE run?
Rendering is handled by this container. **Voice cloning (OmniVoice) needs a
GPU**, which this image does not provide. Pick one:

| Your box | Queue mode | Voice |
|---|---|---|
| **Has a GPU** | `QUEUE_BACKEND=local` | Run the OmniVoice worker (notebook cells 3–5, minus `drive.mount()`, pointed at `QUEUE_DIR`) as a second process on the box. Fully self-contained. |
| **CPU-only** | `QUEUE_BACKEND=local` | Voice on a scale-to-zero serverless GPU (Modal/RunPod); a small server step POSTs each scene's text and writes the wavs. *(trigger step is the one piece still to build)* |
| **CPU-only, least change** | `QUEUE_BACKEND=gdrive` | Keep the current Colab worker (voice **and** render over Google Drive). Works today; set the `GOOGLE_*` vars in compose. Attended/ephemeral — bridge, not steady state. |

Until that's decided, the **gdrive mode works out of the box** (uncomment the
`GOOGLE_*` block in `docker-compose.yml` and keep the Colab worker running) — the
container just needs to reach Drive; render still happens in Colab.

## Before exposing publicly
Set in compose (see `.env.example`): **`API_TOKEN`** (bearer/x-api-token on
`/api/*`), **`CORS_ORIGIN`**, and **`RETENTION_DAYS`** to prune old media. On a
private LAN these can stay unset.

## Commercial gate (unchanged by hosting)
OmniVoice weights are **CC-BY-NC (non-commercial)** — swap to a commercially
licensed Tamil voice before monetizing. Remotion is free ≤3 employees / non-profit.
See MASTER-AUDIT.md §7.
