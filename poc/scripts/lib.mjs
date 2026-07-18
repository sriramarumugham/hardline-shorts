import { execFileSync } from "child_process";
import { existsSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

// Locate the ffprobe binary that Remotion ships with (no separate install needed).
export function findFfprobe(root) {
  const base = join(root, "node_modules", "@remotion");
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    if (dir.startsWith("compositor-")) {
      const p = join(base, dir, "ffprobe.exe");
      if (existsSync(p)) return p;
      const p2 = join(base, dir, "ffprobe");
      if (existsSync(p2)) return p2;
    }
  }
  return null;
}

export function audioSeconds(ffprobe, file) {
  const out = execFileSync(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { encoding: "utf8" }
  );
  const s = parseFloat(out.trim());
  return isFinite(s) ? s : 0;
}

// Build src/timeline.json from a list of { id, image, caption, stat, audioAbsPath, audioPublicPath }.
export function writeTimeline(root, ffprobe, entries, { fps = 30, gap = 0.35 } = {}) {
  let cursor = 0;
  const scenes = entries.map((e) => {
    const seconds = audioSeconds(ffprobe, e.audioAbsPath);
    const durationInFrames = Math.round((seconds + gap) * fps);
    const scene = {
      id: e.id,
      image: e.image,
      caption: e.caption,
      stat: e.stat ?? null,
      audio: e.audioPublicPath,
      audioSeconds: Number(seconds.toFixed(2)),
      from: cursor,
      durationInFrames,
    };
    cursor += durationInFrames;
    return scene;
  });
  const out = { fps, width: 1080, height: 1920, totalFrames: cursor, scenes };
  writeFileSync(join(root, "src", "timeline.json"), JSON.stringify(out, null, 2));
  return out;
}
