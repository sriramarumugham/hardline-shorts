# Ghost blog post to Video — Hardline reel pipeline

These are plain-text diagrams, so they render in any Markdown preview (no Mermaid
extension needed). Ask if you'd prefer a colored, rendered HTML version.

## 1. End-to-end flow

```text
┌───────────────┐   ┌───────────┐   ┌───────────────────┐   ┌───────────┐   ┌──────────────┐
│   Ghost CMS   │──►│ spec.json │──►│   voice + images  │──►│  Remotion │──►│     MP4      │
│ post + photos │   │ (script)  │   │  (audio + jpgs)   │   │  render   │   │  1080 x 1920 │
└───────────────┘   └───────────┘   └───────────────────┘   └───────────┘   └──────┬───────┘
                                                                                    │
                                                                                    ▼
                                                                      Instagram · X · Meta
```

## 2. The 6 stages  (who does what)

```text
 [1] FETCH        Ghost post text + images .......... YOU (manual)
        |
        v
 [2] SCRIPT CUT   article  ->  6 scenes .............. AI, one prompt (NOT Claude Code)
        |
        v
 [3] IMAGES       pick the relevant photos ........... YOU (manual)
        |
        v
 [4] VOICE        Tamil cloned narration ............. GPU  (Colab today)
        |
        v
 [5] TIMELINE     measure audio, lay out scenes ...... AUTOMATED
        |
        v
 [6] RENDER       Remotion  ->  MP4 .................. AUTOMATED (one command)

 Only ONE step needs AI, and ONE needs a GPU. Everything else is a plain command.
```

## 3. What a "video" actually is  (the only thing that changes)

```text
 spec.json
 ├── brand ....... kicker · date · logo · name  ------------->  top bar
 └── scenes[]
      └── scene
           ├── text ..................  drives  VOICE   (Colab)
           ├── caption .............. ┐
           ├── stat ................. ├------------------>  RENDER
           └── image ................ ┘
```

## 4. "Many per day" batch flow

```text
   YOU write                COLAB (free T4 GPU, one run)          YOUR MACHINE
 ┌─────────────┐           ┌──────────────────────────┐        ┌──────────────────┐
 │ spec1.json  │──┐        │  omnivoice_batch.ipynb   │        │ npm run make:all │
 │ spec2.json  │──┼──────► │  + voice_sample.mp3      │        └────────┬─────────┘
 │ specN.json  │──┘        └────────────┬─────────────┘                 │
 └──────┬──────┘                        │  hardline_audio.zip           │
        │                               ▼  (ID/scene.wav)               │
        │                        public/audio/  ──────────────────────► │
        │                                                               │
        └──────────────── specs/ ────────────────────────────────────► │
                                                                        ▼
                                                              out/*.mp4  (all videos)
```

## 5. Where "Ghost -> spec" fits  (piece not built yet)

```text
 Ghost post URL
      │
      ├─ (today) ──────────► copy text + save photos ──► write spec.json by hand ─┐
      │                                                                           │
      └─ (future, NOT built) ─► auto-draft from Ghost API ───────────────────────┤
                                                                                  ▼
                                                                          specs/ID.json
                                                                                  │
                                                                                  ▼
                                                                    rest of pipeline
                                                                    (fully automated)
```

## 6. Scale-up options  (optional, later)

```text
 NOW:  local render  (few  ->  many per day)
   │
   ├─►  Remotion Lambda .......... cloud-parallel render        [future]
   ├─►  Hosted OmniVoice API ..... removes the manual Colab     [future]
   ├─►  Web UI ................... non-dev, no terminal         [future]
   └─►  Ghost webhook ............ auto-draft on publish        [future]
```
