import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { compile, type Spec } from "@factory/composition/schema";
import { absoluteUrl, mediaPaths, storageUrl } from "./config.js";
import { audioSeconds } from "./ffprobe.js";
import { queue } from "./queue/index.js";

const require = createRequire(import.meta.url);

let bundlePromise: Promise<string> | null = null;

// Bundle the shared composition once (webpack via @remotion/bundler). Cached
// for the process lifetime; both preview and this render use the same module.
function getServeUrl(): Promise<string> {
  if (!bundlePromise) {
    const entry = require.resolve("@factory/composition/remotion-entry");
    bundlePromise = bundle({ entryPoint: entry });
  }
  return bundlePromise;
}

// Serialize renders — one headless Chrome at a time on a cheap box.
let renderChain: Promise<unknown> = Promise.resolve();
export function enqueueRender(id: string): Promise<string> {
  const run = renderChain.then(() => renderJob(id));
  renderChain = run.catch(() => undefined); // keep the chain alive on failure
  return run;
}

// Resolve each scene's audio file in storage/jobs/<id>/audio (wav from Colab or
// mp3 from the draft worker) and stamp measured duration onto the spec.
function attachAudio(id: string, spec: Spec): Spec {
  const audioDir = mediaPaths.jobAudioDir(id);
  const scenes = spec.scenes.map((s) => {
    const wav = join(audioDir, `${s.id}.wav`);
    const mp3 = join(audioDir, `${s.id}.mp3`);
    const abs = existsSync(wav) ? wav : existsSync(mp3) ? mp3 : null;
    if (!abs) return { ...s }; // no audio -> placeholder duration in compile()
    return { ...s, audio: storageUrl(abs), durationMs: Math.round(audioSeconds(abs) * 1000) };
  });
  return { ...spec, scenes };
}

// Rewrite every media url to absolute so the renderer's Chromium can fetch it.
function toAbsolute(spec: Spec): Spec {
  return {
    ...spec,
    brand: { ...spec.brand, logo: absoluteUrl(spec.brand.logo) },
    scenes: spec.scenes.map((s) => ({
      ...s,
      image: absoluteUrl(s.image),
      audio: s.audio ? absoluteUrl(s.audio) : s.audio,
    })),
  };
}

export async function renderJob(id: string): Promise<string> {
  // Preferred path: the worker (Colab, off the SAC-blocked laptop) already
  // rendered the mp4. Collect it and skip the local render entirely.
  if (queue.fetchRenderedVideo) {
    const local = await queue.fetchRenderedVideo(id);
    if (local) {
      await queue.move(id, "completed", "generated", { note: `rendered by worker ${new Date().toISOString()}` });
      console.log(`[render] collected worker mp4: ${id}`);
      return storageUrl(local);
    }
    // gdrive: the worker produces the mp4; if it isn't here yet, the folder just
    // synced ahead of the mp4 upload. Do NOT local-render (blocked under Smart
    // App Control). Throw so the watcher clears this id and retries next poll,
    // once the mp4 has synced.
    if (queue.kind === "gdrive") {
      throw new Error(`worker mp4 for "${id}" not synced yet — will retry`);
    }
  }

  // Fallback: render locally (needs a working ffmpeg — blocked under Smart App
  // Control, so this only runs on machines without SAC or the local backend).
  // Make sure the completed job's audio is on local disk (gdrive downloads it).
  await queue.ensureAudioLocal(id);

  const found = await queue.readJob("completed", id);
  if (!found) throw new Error(`renderJob: "${id}" not found in completed/`);

  const withAudio = attachAudio(id, found.spec);
  await queue.writeSpec("completed", id, withAudio); // persist measured durations

  const props = compile(toAbsolute(withAudio));

  const serveUrl = await getServeUrl();
  const composition = await selectComposition({ serveUrl, id: "Reel", inputProps: props });

  const outDir = mediaPaths.jobOutDir(id);
  mkdirSync(outDir, { recursive: true });
  const outputLocation = join(outDir, `${id}.mp4`);

  console.log(`[render] ${id} -> ${outputLocation} (${props.totalFrames}f)`);
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation, inputProps: props });

  await queue.saveVideo(id, outputLocation); // gdrive: upload mp4 to the job folder
  await queue.move(id, "completed", "generated", { note: `rendered ${new Date().toISOString()}` });
  console.log(`[render] done: ${id}`);
  return storageUrl(outputLocation);
}
