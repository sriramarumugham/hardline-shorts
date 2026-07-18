import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { scenes, VOICE } from "./narration.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const audioDir = join(root, "public", "audio");
mkdirSync(audioDir, { recursive: true });

const FPS = 30;
const GAP_SECONDS = 0.35; // small breath between scenes

// Duration comes from the last word-boundary entry: offset + duration (100ns ticks).
function durationFromMetadata(metadataPath) {
  const raw = readFileSync(metadataPath, "utf8").trim();
  let lastEnd = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const data = obj?.Metadata?.[0]?.Data ?? obj?.data ?? obj;
    const offset = data?.Offset ?? data?.offset;
    const dur = data?.Duration ?? data?.duration;
    if (typeof offset === "number" && typeof dur === "number") {
      lastEnd = Math.max(lastEnd, offset + dur);
    }
  }
  return lastEnd / 10_000_000; // ticks -> seconds
}

const tts = new MsEdgeTTS();
await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
  wordBoundaryEnabled: true,
  sentenceBoundaryEnabled: true,
});

const manifest = [];
let cursorFrames = 0;

for (const scene of scenes) {
  const sceneDir = join(audioDir, scene.id);
  mkdirSync(sceneDir, { recursive: true });
  const { audioFilePath, metadataFilePath } = await tts.toFile(sceneDir, scene.text);
  let seconds = metadataFilePath ? durationFromMetadata(metadataFilePath) : 0;
  if (!seconds || !isFinite(seconds)) seconds = Math.max(2.5, scene.text.length / 14);
  const durationInFrames = Math.round((seconds + GAP_SECONDS) * FPS);
  manifest.push({
    id: scene.id,
    image: scene.image,
    caption: scene.caption,
    stat: scene.stat ?? null,
    audio: `audio/${scene.id}/` + audioFilePath.split(/[\\/]/).pop(),
    audioSeconds: Number(seconds.toFixed(2)),
    from: cursorFrames,
    durationInFrames,
  });
  console.log(`${scene.id}: ${seconds.toFixed(2)}s  (${durationInFrames}f)  -> ${audioFilePath}`);
  cursorFrames += durationInFrames;
}
tts.close();

const totalFrames = cursorFrames;
const out = { fps: FPS, width: 1080, height: 1920, totalFrames, scenes: manifest };
writeFileSync(join(root, "src", "timeline.json"), JSON.stringify(out, null, 2));
console.log(`\nTotal: ${(totalFrames / FPS).toFixed(1)}s (${totalFrames} frames). Wrote src/timeline.json`);
