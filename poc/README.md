# Hardline reel factory

Turn a Tamil news article into a vertical (1080×1920) news reel for Instagram / X / Meta.
Spec-driven: **one JSON in → one MP4 out.** No code edits per video, no LLM in the render loop.

---

## How it works

```
article  ──(you + any AI, one prompt)──►  specs/<id>.json          (render spec: brand, scenes, captions, stats, image)
                                          colab-input/<id>.voice.json (voice spec: id, title, scene texts)

specs/<id>.json ──► npm run make ──► out/<id>.mp4
                     ▲        ▲
     images ─────────┘        └───── audio  (from Colab OmniVoice, or free Edge TTS)
```

Only two things change per video: the **spec JSON** and the **images**. Everything else is frozen in the template.

---

## Prerequisites

- Node 18+ (`npm install` once). Remotion downloads its own headless Chrome and ships `ffmpeg`/`ffprobe`.
- A Google account for the free Colab GPU (voice cloning). No GPU needed locally.

---

## Quick start (one video)

```bash
# 1. Put images in public/images/ and write specs/<id>.json  (see "Spec format")

# 2. Generate audio — pick ONE:
node scripts/generate-edge.mjs specs/<id>.json   # a) FREE preview voice (local, instant) -> public/audio/<id>/*.mp3
#                                                # b) CLONED voice: run colab/omnivoice_batch.ipynb, unzip into public/audio/

# 3. Render:
npm run make -- specs/<id>.json                  # -> out/<id>.mp4
```

## Batch (many per day)

```bash
node scripts/make-voicejson.mjs specs/<id>.json     # -> colab-input/<id>.voice.json (for each video)
#   ... run ONE Colab batch for all voice.json files, unzip hardline_audio.zip into public/audio/ ...
npm run make:all                                    # renders every spec that has audio -> out/
```

---

## The two voice options

| | Edge TTS (free, local) | OmniVoice clone (Colab GPU) |
|---|---|---|
| Command | `node scripts/generate-edge.mjs specs/<id>.json` | `colab/omnivoice_batch.ipynb` |
| Speed | Instant | ~seconds/scene on free T4 |
| Voice | Generic Tamil neural voice | Your cloned brand voice |
| Use for | Fast drafts / previews | Final output |

`make-video` prefers `.wav` (Colab) over `.mp3` (Edge) automatically, so dropping cloned `.wav`s into
`public/audio/<id>/` and re-rendering upgrades a draft to the real voice with no other change.

### Cloning on Colab
1. Open `colab/omnivoice_batch.ipynb` → **Runtime → GPU (T4)**.
2. Cell 1 installs + loads OmniVoice. Cell 2 asks for two uploads: your **voice sample**, then the **voice.json** file(s).
3. Run to Cell 5 → downloads `hardline_audio.zip` containing `<id>/<sceneId>.wav`.
4. Unzip **into** `public/audio/` so each `<id>/` folder lands in place. Then `npm run make:all`.

---

## Spec format (`specs/<id>.json`)

```jsonc
{
  "id": "student-enrollment",              // = audio folder name = output filename; MUST match voice.json
  "title": "Short English label",          // used by Colab logs / voice.json
  "brand": {
    "kicker": "தமிழ்நாடு",                  // red top-left badge
    "date": "11.07.2026",
    "logo": "logo-h.jpeg",                  // file in public/images/
    "name": "THE HARDLINE"
  },
  "scenes": [
    {
      "id": "s1_hook",                      // stable id; audio saved as <id>.wav/.mp3
      "image": "hero.jpg",                  // file in public/images/
      "caption": "on-screen Tamil\n(\\n = line break)",
      "stat": { "value": "1,15,295", "label": "big-number caption" },  // or null
      "text": "Tamil narration for this scene (drives the voice only)"
    }
    // ...typically 6 scenes
  ]
}
```

`text` feeds the voice; `caption` / `stat` / `image` feed the render.

### Real examples in this repo

Working specs you can copy from (each rendered a finished MP4 in `out/`):

| Spec file | Voice file | Video |
|---|---|---|
| `specs/student-enrollment.json` | — | Govt school enrollment drop |
| `specs/up-revenue.json` | `colab-input/up-revenue.voice.json` | UP revenue surplus reality |
| `specs/food-security.json` | `colab-input/food-security.voice.json` | Food security bill cuts |
| `specs/amma-crisis.json` | `colab-input/amma-crisis.voice.json` | AMMA crisis |

A complete one — `specs/food-security.json`:

```json
{
  "id": "food-security",
  "title": "Food security bill cuts",
  "brand": {
    "kicker": "இந்தியா",
    "date": "08.07.2026",
    "logo": "logo-h.jpeg",
    "name": "THE HARDLINE"
  },
  "scenes": [
    {
      "id": "s1_hook",
      "image": "food3.png",
      "caption": "ஏழைகளின் உணவுத் தட்டில்\nகைவைக்கும் பாஜக?",
      "stat": null,
      "text": "இந்தியாவின் பரம ஏழைகளின் உணவுத் தட்டில் ஒன்றிய பாஜக அரசு கைவைக்கிறதா? உணவுப் பாதுகாப்புச் சட்டத் திருத்தத்தின் பின்னணி என்ன?"
    },
    {
      "id": "s2_now",
      "image": "food1.jpg",
      "caption": "இப்போது: குடும்பத்திற்கு 35 கிலோ",
      "stat": { "value": "35 கிலோ", "label": "இப்போது ஒரு குடும்பத்திற்கு இலவசம்" },
      "text": "அந்தியோதயா அன்ன யோஜனா திட்டத்தில், இப்போது ஒரு குடும்பத்தில் எத்தனை பேர் இருந்தாலும் மாதம் முப்பத்தைந்து கிலோ அரிசி அல்லது கோதுமை இலவசமாக வழங்கப்படுகிறது."
    }
    // ... 4 more scenes (s3_new, s4_impact, s5_risk, s6_outro)
  ]
}
```

Its matching `colab-input/food-security.voice.json` (auto-generated by `make-voicejson`) is just the id/title + scene texts:

```json
{
  "id": "food-security",
  "title": "Food security bill cuts",
  "scenes": [
    { "id": "s1_hook", "text": "இந்தியாவின் பரம ஏழைகளின் உணவுத் தட்டில் ..." },
    { "id": "s2_now",  "text": "அந்தியோதயா அன்ன யோஜனா திட்டத்தில், ..." }
    // ... same scene ids as the master spec
  ]
}
```

---

## npm scripts

| Script | What |
|---|---|
| `npm run make -- specs/<id>.json` | Build props + render one video (`RENDER=0` to build props only) |
| `npm run make:all` | Render every spec in `specs/` that has audio ready |
| `npm run studio` | Open Remotion Studio (live preview from `src/default-props.json`) |
| `node scripts/generate-edge.mjs specs/<id>.json` | Free Edge TTS audio → `public/audio/<id>/` |
| `node scripts/make-voicejson.mjs specs/<id>.json` | Export `colab-input/<id>.voice.json` for the notebook |

---

## Project layout

```
specs/            master specs (one per video)               <- you write these
colab-input/      voice.json files (generated)               <- upload to Colab
colab/            omnivoice_batch.ipynb (voice cloning)
public/images/    all images (referenced by filename in specs)
public/audio/<id>/  scene audio (.wav from Colab or .mp3 from Edge)
renders/<id>.props.json  compiled props (built by make-video)
src/              Reel.tsx (props-driven template), Root.tsx, default-props.json
scripts/          make-video, make-all, generate-edge, make-voicejson, lib
out/              rendered MP4s
docs/             blogpost-to-video.md (pipeline diagrams)
```

---

## Notes & guardrails

- **It's journalism — review every script before posting.** The AI-drafted `text`/`caption`/`stat`
  can get numbers or names wrong; that's your brand on the line.
- Voice cloning: only clone a voice you own or have permission for (or a licensed/synthetic voice).
- **Not built yet (scale-up):** Remotion Lambda (cloud-parallel render), a hosted OmniVoice API
  (removes the manual Colab step), a Ghost→spec auto-drafter, and a non-dev web UI. See `docs/blogpost-to-video.md`.
```
