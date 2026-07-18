// Free Tamil narration (MS Edge TTS) straight from a master spec.
//   node scripts/generate-edge.mjs <spec.json>
// Writes public/audio/<id>/<sceneId>.mp3 — the layout make-video expects.
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { createWriteStream, mkdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const VOICE = process.env.TA_VOICE || "ta-IN-PallaviNeural";

const specPath = process.argv[2];
if (!specPath) { console.error("usage: node scripts/generate-edge.mjs <spec.json>"); process.exit(1); }
const spec = JSON.parse(readFileSync(specPath, "utf8"));

const outDir = join(root, "public", "audio", spec.id);
mkdirSync(outDir, { recursive: true });

const tts = new MsEdgeTTS();
await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

console.log(`${spec.id}  (${VOICE})`);
for (const s of spec.scenes) {
  const { audioStream } = tts.toStream(s.text);
  await new Promise((resolve, reject) => {
    const w = createWriteStream(join(outDir, `${s.id}.mp3`));
    audioStream.pipe(w);
    audioStream.on("end", () => w.end());
    w.on("finish", resolve);
    w.on("error", reject);
    audioStream.on("error", reject);
  });
  console.log("  ", s.id);
}
tts.close();
console.log(`-> public/audio/${spec.id}/`);
