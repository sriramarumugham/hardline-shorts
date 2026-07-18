import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { audioSeconds } from "./ffprobe.js";

// Tamil neural voice used for DRAFT audio only. Edge TTS is against Microsoft's
// ToS for shipped audio (blueprint §2) — this is for timing/preview and as a
// local stand-in for the Colab voice-clone worker. The final quality path is
// the OmniVoice clone on Colab (see poc/colab + README).
const VOICE = process.env.TA_VOICE ?? "ta-IN-PallaviNeural";

export type SceneAudio = { sceneId: string; audioPath: string; durationMs: number };

// Synthesize one mp3 per scene into `outDir`, returning path + measured duration.
export async function synthScenes(
  scenes: Array<{ id: string; text: string }>,
  outDir: string
): Promise<SceneAudio[]> {
  mkdirSync(outDir, { recursive: true });
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const results: SceneAudio[] = [];
  try {
    for (const s of scenes) {
      const text = (s.text ?? "").trim();
      const audioPath = join(outDir, `${s.id}.mp3`);
      if (!text) {
        // Skip empty narration — no file, zero duration (preview uses placeholder).
        results.push({ sceneId: s.id, audioPath: "", durationMs: 0 });
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        const { audioStream } = tts.toStream(text);
        const w = createWriteStream(audioPath);
        audioStream.pipe(w);
        audioStream.on("end", () => w.end());
        w.on("finish", () => resolve());
        w.on("error", reject);
        audioStream.on("error", reject);
      });
      const durationMs = Math.round(audioSeconds(audioPath) * 1000);
      results.push({ sceneId: s.id, audioPath, durationMs });
    }
  } finally {
    tts.close();
  }
  return results;
}
