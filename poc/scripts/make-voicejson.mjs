// Derive the Colab voice.json (id, title, scenes[{id,text}]) from a master spec.
//   node scripts/make-voicejson.mjs <spec.json>
// Writes colab-input/<id>.voice.json
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const specPath = process.argv[2];
if (!specPath) { console.error("usage: node scripts/make-voicejson.mjs <spec.json>"); process.exit(1); }
const spec = JSON.parse(readFileSync(specPath, "utf8"));

const voice = {
  id: spec.id,
  title: spec.title || spec.id,
  scenes: spec.scenes.map((s) => ({ id: s.id, text: s.text })),
};
mkdirSync(join(root, "colab-input"), { recursive: true });
const out = join(root, "colab-input", `${spec.id}.voice.json`);
writeFileSync(out, JSON.stringify(voice, null, 2));
console.log(`voice.json -> colab-input/${spec.id}.voice.json`);
