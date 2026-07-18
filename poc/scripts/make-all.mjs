// Batch: render every spec in specs/ that has its audio ready in public/audio/<id>/.
//   node scripts/make-all.mjs
import { readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const specsDir = join(root, "specs");

const specs = readdirSync(specsDir).filter((f) => f.endsWith(".json"));
if (!specs.length) { console.log("No specs in specs/."); process.exit(0); }

const results = [];
for (const file of specs) {
  const id = file.replace(/\.json$/, "");
  const audioDir = join(root, "public", "audio", id);
  if (!existsSync(audioDir)) {
    results.push(`SKIP ${id} (no audio at public/audio/${id}/ yet)`);
    continue;
  }
  console.log(`\n=== ${id} ===`);
  try {
    execFileSync("node", ["scripts/make-video.mjs", `specs/${file}`], {
      cwd: root,
      stdio: "inherit",
    });
    results.push(`OK   ${id} -> out/${id}.mp4`);
  } catch {
    results.push(`FAIL ${id}`);
  }
}
console.log("\n--- summary ---\n" + results.join("\n"));
