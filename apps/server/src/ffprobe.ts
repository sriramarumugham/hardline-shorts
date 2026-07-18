import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, SERVER_ROOT } from "./config.js";

// Reuse the ffprobe binary that Remotion's compositor ships with — no separate
// ffmpeg install needed. In a workspace it may hoist to the repo-root
// node_modules, so scan a few candidate roots.
let cached: string | null | undefined;

export function findFfprobe(): string | null {
  if (cached !== undefined) return cached;
  const roots = [SERVER_ROOT, REPO_ROOT];
  for (const root of roots) {
    const base = join(root, "node_modules", "@remotion");
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base)) {
      if (!dir.startsWith("compositor-")) continue;
      for (const name of ["ffprobe.exe", "ffprobe"]) {
        const p = join(base, dir, name);
        if (existsSync(p)) {
          cached = p;
          return p;
        }
      }
    }
  }
  cached = null;
  return null;
}

// Read a PCM WAV's duration straight from its RIFF header: duration =
// data-chunk-bytes / byteRate. No external binary — and it sidesteps the
// bundled compositor ffprobe, which can fail to launch on some Windows setups
// (missing runtime DLLs). Scans chunks so a LIST/INFO block before data (as
// torchaudio writes) doesn't break it. Returns null if not a parseable WAV.
function wavDurationSeconds(file: string): number | null {
  let buf: Buffer;
  try {
    buf = readFileSync(file);
  } catch {
    return null;
  }
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let byteRate = 0;
  let dataSize = 0;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      byteRate = buf.readUInt32LE(off + 16); // sampleRate*channels*bytesPerSample
    } else if (id === "data") {
      dataSize = Math.min(size, buf.length - (off + 8));
      break;
    }
    off += 8 + size + (size & 1); // chunks are word-aligned
  }
  if (byteRate > 0 && dataSize > 0) return dataSize / byteRate;
  return null;
}

export function audioSeconds(file: string): number {
  if (file.toLowerCase().endsWith(".wav")) {
    const s = wavDurationSeconds(file);
    if (s && isFinite(s)) return s;
  }
  const ffprobe = findFfprobe();
  if (!ffprobe) throw new Error("ffprobe not found under node_modules/@remotion/compositor-*");
  const out = execFileSync(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { encoding: "utf8" }
  );
  const s = parseFloat(out.trim());
  return isFinite(s) ? s : 0;
}
