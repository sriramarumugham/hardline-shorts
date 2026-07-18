import { Composition } from "remotion";
import { Reel } from "./Reel";
import { VIDEO, type ReelProps } from "./schema";

// A minimal non-empty default so the composition previews in Remotion Studio
// and has valid metadata before a real spec is passed via --props / inputProps.
const defaultProps: ReelProps = {
  id: "sample",
  fps: VIDEO.fps,
  width: VIDEO.width,
  height: VIDEO.height,
  totalFrames: VIDEO.fps * 4,
  brand: { kicker: "தமிழ்நாடு", date: "12.07.2026", name: "THE HARDLINE", logo: "" },
  scenes: [
    {
      id: "s1",
      image: "",
      caption: "மாதிரி காட்சி",
      stat: null,
      audio: "",
      from: 0,
      durationInFrames: VIDEO.fps * 4,
    },
  ],
};

// The video's duration/size come from the compiled props (built by compile()),
// so this one composition renders any spec passed through inputProps.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Reel"
      component={Reel}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.totalFrames,
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
  );
};
