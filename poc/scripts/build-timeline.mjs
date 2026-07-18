// Build src/timeline.json from cloned audio in public/audio/clone/<sceneId>.wav
// (unzip hardline_audio.zip from Colab into that folder first).
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { scenes } from "./narration.mjs";
import { findFfprobe, writeTimeline } from "./lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const ffprobe = findFfprobe(root);
if (!ffprobe) { console.error("ffprobe not found under node_modules/@remotion."); process.exit(1); }

const cloneDir = join(root, "public", "audio", "clone");
const entries = [];
const missing = [];
for (const s of scenes) {
  const abs = join(cloneDir, `${s.id}.wav`);
  if (!existsSync(abs)) { missing.push(`${s.id}.wav`); continue; }
  entries.push({
    id: s.id,
    image: s.image,
    caption: s.caption,
    stat: s.stat ?? null,
    audioAbsPath: abs,
    audioPublicPath: `audio/clone/${s.id}.wav`,
  });
}
if (missing.length) {
  console.error(`Missing clips in public/audio/clone/: ${missing.join(", ")}`);
  process.exit(1);
}

const tl = writeTimeline(root, ffprobe, entries);
console.log(`Total: ${(tl.totalFrames / tl.fps).toFixed(1)}s (${tl.totalFrames} frames). Wrote src/timeline.json`);
