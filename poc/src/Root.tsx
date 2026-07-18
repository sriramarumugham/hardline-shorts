import { Composition } from "remotion";
import { Reel, ReelProps } from "./Reel";
import defaultProps from "./default-props.json";

// The video's duration/size come from the compiled props (built by scripts/make-video.mjs),
// so one composition renders any spec passed via --props.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Reel"
      component={Reel}
      defaultProps={defaultProps as unknown as ReelProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.totalFrames,
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
  );
};
