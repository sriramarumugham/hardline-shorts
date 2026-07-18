import { useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import { blankScene, type SceneSpec, type Spec } from "@factory/composition/schema";
import { toast } from "sonner";
import { api } from "./api";
import { sceneStartFrame } from "./Preview";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Play, Send, Trash2, Upload, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

// On-screen caption = a short headline (≈2 lines). Narration = spoken per scene,
// a few sentences. Keeps scenes tight and captions from overflowing the reel.
const CAPTION_MAX = 100;
const NARRATION_MAX = 400;

function CharCount({ n, max }: { n: number; max: number }) {
  return (
    <span
      className={cn(
        "ml-auto text-[11px] tabular-nums",
        n >= max ? "text-red-400" : n > max * 0.85 ? "text-amber-400" : "text-muted-foreground"
      )}
    >
      {n}/{max}
    </span>
  );
}

type Props = {
  spec: Spec;
  setSpec: (s: Spec) => void;
  playerRef: React.RefObject<PlayerRef>;
};

// Block a broken reel from reaching the queue with a clear, specific message.
function validate(spec: Spec): string | null {
  if (!spec.id.trim()) return "Give the reel a video id first.";
  for (let i = 0; i < spec.scenes.length; i++) {
    const s = spec.scenes[i];
    if (!s.text.trim()) return `Scene ${i + 1} (${s.id}) has no narration text.`;
    if (!s.caption.trim()) return `Scene ${i + 1} (${s.id}) has no caption.`;
    if (s.stat && (!s.stat.value.trim() || !s.stat.label.trim()))
      return `Scene ${i + 1} stat card needs both a value and a label.`;
  }
  return null;
}

export function Author({ spec, setSpec, playerRef }: Props) {
  const [busy, setBusy] = useState<"audio" | "queue" | null>(null);
  const [uploading, setUploading] = useState<string | null>(null); // per-field key

  const patchBrand = (p: Partial<Spec["brand"]>) => setSpec({ ...spec, brand: { ...spec.brand, ...p } });
  const patchScene = (i: number, p: Partial<SceneSpec>) =>
    setSpec({ ...spec, scenes: spec.scenes.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const addScene = () => setSpec({ ...spec, scenes: [...spec.scenes, blankScene(spec.scenes.length)] });
  const removeScene = (i: number) => setSpec({ ...spec, scenes: spec.scenes.filter((_, j) => j !== i) });

  async function uploadImage(key: string, file: File, apply: (url: string) => void) {
    setUploading(key);
    try {
      apply(await api.uploadImage(file));
      toast.success("Image uploaded");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function genDraftAudio() {
    setBusy("audio");
    try {
      const results = await api.draftAudio(spec.id, spec.scenes.map((s) => ({ id: s.id, text: s.text })));
      const byId = new Map(results.map((r) => [r.sceneId, r]));
      setSpec({
        ...spec,
        scenes: spec.scenes.map((s) => {
          const r = byId.get(s.id);
          return r && r.url ? { ...s, audio: r.url, durationMs: r.durationMs } : s;
        }),
      });
      toast.success("Draft audio generated — preview now uses real per-scene timing.");
    } catch (e: any) {
      toast.error(e.message ?? "Draft audio failed");
    } finally {
      setBusy(null);
    }
  }

  async function sendToQueue() {
    const problem = validate(spec);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy("queue");
    try {
      // Strip draft audio/durations — the worker produces the real audio and the
      // render step measures durations from it.
      const clean: Spec = { ...spec, scenes: spec.scenes.map(({ audio, durationMs, ...rest }) => rest) };
      await api.sendToQueue(clean);
      toast.success(`Job "${spec.id}" sent to the queue.`, {
        description: "It's now Waiting — the worker will voice and render it.",
      });
    } catch (e: any) {
      toast.error(e.message ?? "Could not send to queue");
    } finally {
      setBusy(null);
    }
  }

  // Seek the live preview to this scene AND start playback. (It used to only
  // seek, so the button looked dead.) Audio is only audible after you generate
  // Draft audio / the final voice — otherwise it plays the visuals silently.
  function previewScene(i: number) {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.seekTo(sceneStartFrame(spec, i));
      p.play();
    } catch {
      /* player not mounted yet */
    }
  }

  return (
    <div className="space-y-4">
      <Card className="gap-4 p-5">
        <h2 className="text-base font-semibold">Author a reel</h2>

        <div className="grid gap-1.5">
          <Label>Video id (filename-safe)</Label>
          <Input
            value={spec.id}
            onChange={(e) => setSpec({ ...spec, id: e.target.value.replace(/[^\w-]/g, "-") })}
          />
        </div>

        <div className="grid gap-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Brand</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Kicker (topic/location)</Label>
              <Input value={spec.brand.kicker} onChange={(e) => patchBrand({ kicker: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Date</Label>
              <Input value={spec.brand.date} onChange={(e) => patchBrand({ date: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Wordmark</Label>
            <Input value={spec.brand.name} onChange={(e) => patchBrand({ name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Logo image</Label>
            <div className="w-24">
              <ImageField
                url={spec.brand.logo}
                busy={uploading === "logo"}
                onPick={(f) => uploadImage("logo", f, (url) => patchBrand({ logo: url }))}
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scenes</div>
      {spec.scenes.map((s, i) => (
        <Card key={i} className="gap-2.5 p-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Scene {i + 1}</Badge>
            <Input
              value={s.id}
              onChange={(e) => patchScene(i, { id: e.target.value.replace(/[^\w-]/g, "_") })}
              className="h-7 max-w-36 text-xs"
            />
            <span className="ml-auto text-xs text-muted-foreground">
              {s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : "—"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              title="Play the preview from this scene"
              onClick={() => previewScene(i)}
            >
              <Play className="size-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger
                disabled={spec.scenes.length <= 1}
                className={buttonVariants({ variant: "ghost", size: "icon" })}
              >
                <Trash2 className="size-4 text-red-400" />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove scene {i + 1}?</AlertDialogTitle>
                  <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => removeScene(i)}>Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <div className="grid grid-cols-[92px_1fr] gap-3">
            <ImageField
              url={s.image}
              busy={uploading === `scene-${i}`}
              onPick={(f) => uploadImage(`scene-${i}`, f, (url) => patchScene(i, { image: url }))}
            />
            <div className="space-y-2.5">
              <div className="grid gap-1">
                <Label className="flex items-center gap-2">
                  Caption
                  <Badge variant="outline" className="text-emerald-300">on-screen</Badge>
                  <CharCount n={s.caption.length} max={CAPTION_MAX} />
                </Label>
                <Textarea
                  value={s.caption}
                  maxLength={CAPTION_MAX}
                  rows={2}
                  placeholder="Short on-screen headline (≈2 lines)"
                  className="min-h-0 resize-none"
                  onChange={(e) => patchScene(i, { caption: e.target.value })}
                />
              </div>

              <div className="grid gap-1">
                <Label className="flex items-center gap-2">
                  Narration
                  <Badge
                    variant="outline"
                    title="Read aloud by the voice — never appears on screen."
                    className="gap-1 text-amber-300"
                  >
                    <Volume2 className="size-3" /> spoken only
                  </Badge>
                  <CharCount n={s.text.length} max={NARRATION_MAX} />
                </Label>
                <Textarea
                  value={s.text}
                  maxLength={NARRATION_MAX}
                  rows={3}
                  placeholder="What the voice says (a few sentences)"
                  className="min-h-0 resize-none"
                  onChange={(e) => patchScene(i, { text: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={!!s.stat}
              onCheckedChange={(on) => patchScene(i, { stat: on ? { value: "", label: "" } : null })}
            />
            <Label>Stat card</Label>
          </div>
          {s.stat && (
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label>Value</Label>
                <Input value={s.stat.value} onChange={(e) => patchScene(i, { stat: { ...s.stat!, value: e.target.value } })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Label</Label>
                <Input value={s.stat.label} onChange={(e) => patchScene(i, { stat: { ...s.stat!, label: e.target.value } })} />
              </div>
            </div>
          )}
        </Card>
      ))}

      <Button variant="outline" className="w-full border-dashed" onClick={addScene}>
        + Add scene
      </Button>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-4">
        <Button variant="secondary" onClick={genDraftAudio} disabled={busy !== null}>
          {busy === "audio" ? <Loader2 className="size-4 animate-spin" /> : <Volume2 className="size-4" />}
          Draft audio (timing)
        </Button>
        <Button onClick={sendToQueue} disabled={busy !== null}>
          {busy === "queue" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send to queue
        </Button>
      </div>

      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        🔇 The preview is <b>silent</b> until you click <b>Draft audio</b> (a quick robotic voice
        just for timing). The real Tamil cloned voice is added later, when the worker processes the
        reel you send to the queue.
      </p>
    </div>
  );
}

function ImageField({ url, onPick, busy }: { url: string; onPick: (f: File) => void; busy: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = () => ref.current?.click();
  return (
    <div className="space-y-1.5">
      {url ? (
        <img
          src={url}
          alt=""
          onClick={pick}
          className="aspect-square w-full cursor-pointer rounded-md border border-border object-cover"
        />
      ) : (
        <button
          type="button"
          onClick={pick}
          className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-border bg-muted/20 text-muted-foreground transition-colors hover:bg-muted/40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
      <Button variant="outline" size="sm" className="h-6 w-full px-1 text-[11px]" onClick={pick} disabled={busy}>
        {busy ? "Uploading…" : url ? "Replace" : "Upload"}
      </Button>
    </div>
  );
}
