# Colab voice-clone worker (final-quality audio)

The shippable-quality path for audio. The local draft worker
(`npm run worker:draft`, edge-tts) exists so the pipeline runs with no GPU, but
Edge TTS is draft-only (blueprint §2). For real output, an attended Google Colab
notebook clones the brand voice with **OmniVoice** on a free T4 GPU.

Ready-to-run notebooks live in [`../poc/colab/`](../poc/colab/):
`omnivoice_hardline.ipynb` (primary) and `omnivoice_batch.ipynb`.

## The contract the render step expects

For a job with id `<id>` and scenes `s1, s2, …`, drop one audio file per scene:

```
<audioDir>/<sceneId>.wav      # or .mp3
```

The server's render step (`apps/server/src/render.ts → attachAudio`) looks for
`<sceneId>.wav` first, then `<sceneId>.mp3`, measures each with ffprobe, stamps
the duration onto the spec, then renders. It does **not** care how the audio was
made — only that the files exist.

- **Local queue:** audio dir is `apps/server/storage/jobs/<id>/audio/`.
- **Drive queue (future):** the job folder in `completed/`.

## OmniVoice recipe (confirmed working on Colab)

```python
# install: omnivoice, then torchaudio cu128 — no kernel restart, no HF gate
model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=device, dtype=torch.float16)
audio = model.generate(text=scene_text, ref_audio=REF_WAV, num_step=48, speed=1.0)  # 48–64 = final
torchaudio.save(f"{scene_id}.wav", audio[0].unsqueeze(0).cpu(), 24000)
```

## Audio quality checklist (blueprint §"100% good")

1. Clean 15–30 s single-speaker reference, noise removed (#1 cause of artifacts).
2. `num_step` 48–64 for final (32 = draft).
3. One sentence per generation, concatenate with 250–350 ms silence — fixes
   pauses and hallucinated sounds on long inputs.
4. Normalize text for TTS: Tamil words for numbers/acronyms, strip stray
   punctuation, avoid mixed-script tokens.
5. Per-scene regenerate via the reject → re-queue loop; only bad scenes redo.

## Licensing

OmniVoice **weights are CC-BY-NC** → non-commercial only. Before monetizing,
swap to a commercially-licensed Tamil voice (candidate: AI4Bharat Indic-TTS —
verify license). The pipeline is voice-agnostic, so the swap is contained to the
worker.
