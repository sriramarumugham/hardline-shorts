import { z } from "zod";

// ---------------------------------------------------------------------------
// The canonical contract for a reel. This one file is imported by the web UI
// (to build/validate the form), the server (to store jobs + build render
// props), and the Remotion composition (to type its inputProps). If it
// compiles here, preview and output agree.
// ---------------------------------------------------------------------------

export const VIDEO = { fps: 30, width: 1080, height: 1920, gap: 0.35 } as const;
// Placeholder duration (seconds) used to preview a scene before its audio
// exists, so the Player timeline is never empty while authoring.
export const PLACEHOLDER_SCENE_SECONDS = 3.5;

export const StatSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});
export type Stat = z.infer<typeof StatSchema>;

export const BrandSchema = z.object({
  kicker: z.string().default(""),
  date: z.string().default(""),
  name: z.string().default(""),
  // URL to the logo image (served by the server, or a blob: url while authoring).
  logo: z.string().default(""),
});
export type Brand = z.infer<typeof BrandSchema>;

// ---- Authoring shape: what the UI edits and what a job carries ----
export const SceneSpecSchema = z.object({
  id: z.string().min(1),
  // URL to the backing image (server storage url or blob: url).
  image: z.string().default(""),
  caption: z.string().default(""),
  stat: StatSchema.nullable().default(null),
  // Narration text — only used to synthesize audio, never rendered on screen.
  text: z.string().default(""),
  // Filled in once audio (draft or final) exists.
  audio: z.string().optional(),
  durationMs: z.number().positive().optional(),
});
export type SceneSpec = z.infer<typeof SceneSpecSchema>;

export const SpecSchema = z.object({
  id: z.string().min(1),
  brand: BrandSchema,
  scenes: z.array(SceneSpecSchema).min(1),
});
export type Spec = z.infer<typeof SpecSchema>;

// ---- Compiled shape: what the composition actually renders ----
export const SceneRenderSchema = z.object({
  id: z.string(),
  image: z.string(),
  caption: z.string(),
  stat: StatSchema.nullable(),
  audio: z.string(), // may be "" if no audio yet (preview only)
  from: z.number(),
  durationInFrames: z.number(),
});
export type SceneRender = z.infer<typeof SceneRenderSchema>;

export const ReelPropsSchema = z.object({
  id: z.string(),
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  totalFrames: z.number(),
  brand: BrandSchema,
  scenes: z.array(SceneRenderSchema),
});
export type ReelProps = z.infer<typeof ReelPropsSchema>;

// ---------------------------------------------------------------------------
// compile(): spec -> ReelProps. Identical math on the client (Player preview)
// and the server (renderMedia), so timing never drifts between them.
// ---------------------------------------------------------------------------
export function compile(
  spec: Spec,
  opts: { fps?: number; width?: number; height?: number; gap?: number } = {}
): ReelProps {
  const fps = opts.fps ?? VIDEO.fps;
  const width = opts.width ?? VIDEO.width;
  const height = opts.height ?? VIDEO.height;
  const gap = opts.gap ?? VIDEO.gap;

  let cursor = 0;
  const scenes: SceneRender[] = spec.scenes.map((s) => {
    const seconds =
      s.durationMs && s.durationMs > 0
        ? s.durationMs / 1000
        : PLACEHOLDER_SCENE_SECONDS;
    const durationInFrames = Math.max(1, Math.round((seconds + gap) * fps));
    const scene: SceneRender = {
      id: s.id,
      image: s.image,
      caption: s.caption,
      stat: s.stat ?? null,
      audio: s.audio ?? "",
      from: cursor,
      durationInFrames,
    };
    cursor += durationInFrames;
    return scene;
  });

  return { id: spec.id, fps, width, height, totalFrames: cursor, brand: spec.brand, scenes };
}

// Small helper for the UI: a fresh blank scene.
export function blankScene(index: number): SceneSpec {
  return { id: `s${index + 1}`, image: "", caption: "", stat: null, text: "" };
}

export function blankSpec(id: string): Spec {
  return {
    id,
    brand: { kicker: "", date: "", name: "", logo: "" },
    scenes: [blankScene(0)],
  };
}
