// One spec in -> one MP4 out. No code edits per video.
//   node scripts/make-video.mjs <spec.json> [audioDir]
// audioDir defaults to public/audio/<spec.id> (where the Colab wavs go).
// Set RENDER=0 to only build props (skip the render).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve, relative } from "path";
import { execFileSync } from "child_process";
import { findFfprobe, audioSeconds } from "./lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const FPS = 30, WIDTH = 1080, HEIGHT = 1920, GAP = 0.35;

const specPath = process.argv[2];
if (!specPath) {
  console.error("usage: node scripts/make-video.mjs <spec.json> [audioDir]");
  process.exit(1);
}
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const audioDir = resolve(root, process.argv[3] || join("public", "audio", spec.id));
const ffprobe = findFfprobe(root);
if (!ffprobe) { console.error("ffprobe not found under node_modules/@remotion."); process.exit(1); }

const publicRel = relative(join(root, "public"), audioDir).split(/[\\/]/).join("/");

let cursor = 0;
const scenes = spec.scenes.map((s) => {
  // Accept either Colab (.wav) or Edge TTS (.mp3) audio.
  const wav = join(audioDir, `${s.id}.wav`);
  const mp3 = join(audioDir, `${s.id}.mp3`);
  const abs = existsSync(wav) ? wav : existsSync(mp3) ? mp3 : null;
  if (!abs) { console.error(`Missing audio: ${wav} (or .mp3)`); process.exit(1); }
  const ext = abs.endsWith(".wav") ? "wav" : "mp3";
  const durationInFrames = Math.round((audioSeconds(ffprobe, abs) + GAP) * FPS);
  const scene = {
    id: s.id,
    image: s.image,
    caption: s.caption,
    stat: s.stat ?? null,
    audio: `${publicRel}/${s.id}.${ext}`,
    from: cursor,
    durationInFrames,
  };
  cursor += durationInFrames;
  return scene;
});

const props = {
  id: spec.id,
  fps: FPS,
  width: WIDTH,
  height: HEIGHT,
  totalFrames: cursor,
  brand: spec.brand,
  scenes,
};

mkdirSync(join(root, "renders"), { recursive: true });
const propsPath = join(root, "renders", `${spec.id}.props.json`);
writeFileSync(propsPath, JSON.stringify(props, null, 2));
// Keep the Studio preview pointed at the latest build.
writeFileSync(join(root, "src", "default-props.json"), JSON.stringify(props, null, 2));
console.log(`props -> renders/${spec.id}.props.json  (${(cursor / FPS).toFixed(1)}s, ${cursor}f)`);

if (process.env.RENDER !== "0") {
  const out = join(root, "out", `${spec.id}.mp4`);
  mkdirSync(join(root, "out"), { recursive: true });
  execFileSync(
    "npx",
    ["remotion", "render", "src/index.ts", "Reel", out, `--props=${propsPath}`],
    { cwd: root, stdio: "inherit", shell: true }
  );
  console.log(`rendered -> out/${spec.id}.mp4`);
}
