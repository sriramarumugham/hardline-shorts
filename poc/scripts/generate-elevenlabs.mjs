// Clone the provided sample into an ElevenLabs instant voice, then narrate every
// scene in Tamil with it. Usage:
//   ELEVENLABS_API_KEY=... node scripts/generate-elevenlabs.mjs "<path-to-sample.mp3>"
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";
import { scenes } from "./narration.mjs";
import { findFfprobe, writeTimeline } from "./lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const API_KEY = process.env.ELEVENLABS_API_KEY;
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
const SAMPLE = process.argv[2];

if (!API_KEY) { console.error("Missing ELEVENLABS_API_KEY env var."); process.exit(1); }
if (!SAMPLE || !existsSync(SAMPLE)) { console.error(`Sample not found: ${SAMPLE}`); process.exit(1); }

const ffprobe = findFfprobe(root);
if (!ffprobe) { console.error("Could not locate ffprobe under node_modules/@remotion."); process.exit(1); }

const audioDir = join(root, "public", "audio");
mkdirSync(audioDir, { recursive: true });
const voiceCacheFile = join(root, "scripts", ".voice-id");

async function api(path, opts) {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    ...opts,
    headers: { "xi-api-key": API_KEY, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs ${path} -> ${res.status}: ${body.slice(0, 400)}`);
  }
  return res;
}

async function getOrCreateVoice() {
  if (existsSync(voiceCacheFile)) {
    const id = readFileSync(voiceCacheFile, "utf8").trim();
    if (id) { console.log(`Reusing cloned voice: ${id}`); return id; }
  }
  console.log("Creating instant voice clone from sample...");
  const form = new FormData();
  form.append("name", "Hardline Tamil Narrator");
  form.append("remove_background_noise", "true");
  const bytes = readFileSync(SAMPLE);
  form.append("files", new Blob([bytes], { type: "audio/mpeg" }), basename(SAMPLE));
  const res = await api("/v1/voices/add", { method: "POST", body: form });
  const { voice_id } = await res.json();
  writeFileSync(voiceCacheFile, voice_id);
  console.log(`Cloned voice id: ${voice_id}`);
  return voice_id;
}

async function tts(voiceId, text, outPath) {
  const res = await api(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0.3, use_speaker_boost: true },
    }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
}

const voiceId = await getOrCreateVoice();
const entries = [];
for (const scene of scenes) {
  const sceneDir = join(audioDir, scene.id);
  mkdirSync(sceneDir, { recursive: true });
  const outPath = join(sceneDir, "el.mp3");
  await tts(voiceId, scene.text, outPath);
  entries.push({
    id: scene.id,
    image: scene.image,
    caption: scene.caption,
    stat: scene.stat ?? null,
    audioAbsPath: outPath,
    audioPublicPath: `audio/${scene.id}/el.mp3`,
  });
  console.log(`${scene.id}: synthesized`);
}

const tl = writeTimeline(root, ffprobe, entries);
console.log(`\nTotal: ${(tl.totalFrames / tl.fps).toFixed(1)}s (${tl.totalFrames} frames). Wrote src/timeline.json`);
