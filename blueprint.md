# Blueprint: web-based news-reel factory

Build-ready plan to turn Tamil news articles into vertical (1080×1920) reels at scale, operated by
non-developers. Every moving part was validated against current (2024–2026) docs and prior art (sources at
bottom). **Read "Decisions to make first" before writing code — two licensing issues and the audio-quality
problem can change direction.**

## Your 4 goals (captured from PLAN.md)
1. **Reliable audio** — §Audio quality.
2. **Faster/easier audio generation** — §D worker + §"Later: hosted voice".
3. **Google Drive loop** — `pending → in-progress → completed`, plus **approve → generated / reject → rejected** (your two-folder QA idea). §C.
4. **Audio 100% good** — no unnatural sounds, correct pauses (student-enrollment was clean; others weren't). §Audio quality.

End goal (your words): **a reliable audio output + a semi-automated process through Google Drive.**

---

## The vision

```
                        ┌──────────────────────────────────────────────┐
                        │  WEB UI  (non-dev authoring + monitoring)      │
                        │  • upload photos                                │
                        │  • edit script / captions / stat cards          │
                        │  • LIVE per-scene preview (Remotion Player)     │
                        │  • draft audio (Edge TTS) to check timing       │
                        │  • "Send to queue"  +  queue dashboard          │
                        │  • REVIEW rendered video → Approve / Reject     │
                        └───────────────┬───────────────────┬────────────┘
                                        │ writes JSON        │ reads counts / reviews
                                        ▼                    ▲
   ┌───────────────── GOOGLE DRIVE (job queue) ──────────────────────────────────┐
   │  pending/ ─► in-progress/ ─► completed/ ─► generated/ ─► approved/           │
   │  (json+imgs)  (claimed)      (json+wavs)   (mp4)          rejected/ (+reason) │
   └──────┬────────────────────────────┬─────────────────────────────────────────┘
          │ drain (attended)           │ watch + render
          ▼                            ▼
   ┌──────────────────┐        ┌──────────────────────────┐
   │ COLAB GPU worker │        │  RENDER SERVER (Node)     │
   │ voice cloning    │        │  @remotion/renderer       │
   │ pending→completed│        │  completed → generated    │
   └──────────────────┘        │  + serves UI + /counts    │
                               └──────────────────────────┘
```

Only two things change per video: the **spec JSON** and the **images**.

---

## Decisions to make first (can change direction)

> **Decided 2026-07-12:** Output is **non-commercial for now** → **keep OmniVoice** (revisit the voice model
> the moment anything gets monetized — see #1). Team is **1–3 / non-profit** → **Remotion is free**, no license
> cost (#3). Both blockers cleared; build proceeds on the current free stack.

### 🔴 1. OmniVoice weights are NON-COMMERCIAL (CC-BY-NC)
Code is Apache-2.0, **weights are CC-BY-NC**. Monetized/branded news reels = commercial → offside, on Colab
or hosted. Options: (a) strictly non-commercial output (risky for a brand); (b) switch to a commercially-licensed
Tamil model — candidate **AI4Bharat Indic Parler-TTS/Indic-TTS** (verify its license; it's describe-the-voice, so
cloning a specific brand voice may need fine-tuning); (c) pay (Azure `ta-IN-PallaviNeural`, ElevenLabs). Pipeline
is voice-agnostic, so swapping is contained — but decide before building the worker.

### 🔴 2. Edge TTS (`msedge-tts`) is DRAFT-ONLY
Against Microsoft ToS + periodic 403s. Use for preview/timing in the UI only, never shipped audio.

### 🟠 3. Remotion license by team size
Free for individuals / for-profit ≤3 employees / non-profits. **4+ employees → paid "Automators" ≈ $100/mo**
(we embed Player + render programmatically; previews free). Confirm headcount. MIT fallback: **Revideo**.

### 🟢 4. Google Drive free-tier auth (settled)
Service accounts have no storage → can't create files on personal Drive (`storageQuotaExceeded`); Shared Drives
need paid Workspace. Free path: queue folders in **one human account's My Drive**; **Colab** writes as that user
via `drive.mount()`; **Node server** uses a stored **OAuth2 refresh token** (not a service account); **browser
holds no key** (calls server `/counts`); **publish OAuth consent to "Production"** (else token dies in 7 days).

---

## Audio quality — making it "100% good" (your #4)

Zero-shot cloning varies (student-enrollment clean, others had artifacts/bad pauses). Controllable, cheapest first:
1. **Better reference:** ~15–30 s clean, single-speaker, no music/noise; enable noise removal. #1 cause of artifacts.
2. **Raise `num_step`** to 48–64 for final (32 = draft).
3. **One sentence per generation, concatenate** with a fixed 250–350 ms silence — fixes pauses and cuts
   hallucinated sounds that appear on long multi-sentence inputs.
4. **Normalize text for TTS:** Tamil words for numbers/acronyms, strip stray punctuation, avoid mixed-script tokens.
5. **Per-scene regenerate + QA gate (your two folders):** review in UI → **Approve → `approved/`** or
   **Reject → `rejected/` + reason**; re-queue regenerates only the bad scene(s), not the whole video.
6. **If artifacts persist**, the model is the ceiling — A/B OmniVoice vs AI4Bharat on the same reference.

---

## Moving parts (validated)

- **A. Authoring UI — Vite + React + `@remotion/player`.** Same composition in-browser via `inputProps`, no server
  render; per-scene preview via `seekTo`. One shared composition module for preview==output. Preview uploads with
  `URL.createObjectURL`; swap to persisted URLs on save. Audio needs a user gesture. Load only the Tamil font subset.
- **B. Draft audio — server `msedge-tts` + `ffprobe`.** Text → MP3 per scene → durations → `{sceneId,url,durationMs}`.
  Same shape as final wavs. Draft only.
- **C. Queue — Drive folders** `pending→in-progress→completed→generated`, then `approved/` / `rejected/`. Job =
  `job_<id>/`. Move = re-parent (`files.update`; Colab `os.rename`). **Single worker** (no atomic claim on Drive).
  Counts via server `/counts`. Prune to stay under 15 GB.
- **D. Voice worker — attended Colab drainer.** `drive.mount()`; load model once; **claim by rename first**;
  write `.tmp`→rename→`done.json`; **stale recovery** (in-progress > ~40 min → pending). Good for 10–50 clips/day.
- **E. Render server — Node + `@remotion/renderer`** on a cheap Linux box (Docker image for Chrome/deps). Same box
  serves UI + `/counts` + watches `completed/`. Lambda only if it can't keep up.

---

## Prior art to fork (don't reinvent)

| Project | License | Reuse |
|---|---|---|
| **itsPremkumar/Automated-Video-Generator** | MIT | Closest skeleton: JSON→MP4, non-dev portal, Remotion, Edge-TTS, batch+resume queue. Start here. |
| **gyoridavid/short-video-maker** | MIT | text→TTS→Whisper caption timing; REST+MCP API. |
| **remotion-dev/template-prompt-to-video** | Remotion | `timeline.json` schema = canonical spec + Ken Burns anims. |
| **openvideodev/react-video-editor**, **sambowenhughes/a-react-video-editor** | varies | Player-based authoring UI references. |
| **Revideo** | MIT | Fallback if Remotion licensing blocks. |

**Gaps we build:** Ghost→reel JSON drafter; commercial-licensed Tamil voice clone in-pipeline (biggest gap);
Drive-queue + Colab-worker glue; stat cards + news chrome; non-dev UI wired to our schema.

---

## Build phases (each useful alone)
- **Phase 0** — decide blockers #1–#3. ~0 code.
- **Phase 1** — Authoring UI (form + upload + Player preview + Edge draft + export JSON). Biggest value, no infra.
- **Phase 2** — Drive queue + Colab worker (OAuth Node, rename-claim, stale-recovery, audio-quality pipeline).
- **Phase 3** — Render server + review dashboard (watcher → renderMedia → generated; Approve/Reject → approved/rejected).
- **Later** — hosted voice endpoint (RunPod/Modal scale-to-zero ~$0.01/video) to drop manual Colab past ~5–10/day;
  Ghost Content API auto-draft; Remotion Lambda for render scale.

## Guardrails
Journalism review gate (Approve/Reject) — never auto-publish. Respect the voice-model license. Handle image credit.

## Sources
**Drive:** developers.google.com/workspace/drive/api/guides/limits · /handle-errors · /folder · reference/rest/v3/files
**Remotion:** remotion.dev/docs/player · /docs/license · /license/faq · remotion.pro/license · /docs/renderer/render-media · /docs/docker
**Colab:** research.google.com/colaboratory/faq.html · github.com/googlecolab/colabtools/issues/960,2607 · kaggle.com/general/108481
**Voice:** github.com/k2-fsa/OmniVoice (weights CC-BY-NC) · github.com/AI4Bharat/Indic-TTS · huggingface.co/ai4bharat/indic-parler-tts · learn.microsoft.com (Edge ToS)
**Prior art:** github.com/itsPremkumar/Automated-Video-Generator · github.com/gyoridavid/short-video-maker · github.com/remotion-dev/template-prompt-to-video · midrender.com/revideo · docs.ghost.org/content-api
