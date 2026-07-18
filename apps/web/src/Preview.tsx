import { forwardRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Reel } from "@factory/composition/Reel";
import { compile, type ReelProps, type Spec } from "@factory/composition/schema";

// Live preview. Uses the SAME composition + compile() the renderer uses, so
// what you see here is what the server outputs (blueprint §A: preview == output).
export const Preview = forwardRef<PlayerRef, { spec: Spec; width?: number }>(
  ({ spec, width = 320 }, ref) => {
    const props: ReelProps = compile(spec);
    const height = Math.round((width * props.height) / props.width);
    return (
      <div className="player-frame" style={{ width, height }}>
        <Player
          ref={ref}
          component={Reel as any}
          inputProps={props as any}
          durationInFrames={Math.max(1, props.totalFrames)}
          fps={props.fps}
          compositionWidth={props.width}
          compositionHeight={props.height}
          style={{ width, height }}
          controls
          clickToPlay
        />
      </div>
    );
  }
);
Preview.displayName = "Preview";

// Cumulative start frame of a scene, for per-scene seeking.
export function sceneStartFrame(spec: Spec, index: number): number {
  return compile(spec).scenes[index]?.from ?? 0;
}
