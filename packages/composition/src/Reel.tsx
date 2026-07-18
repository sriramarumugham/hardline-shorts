import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/NotoSansTamil";
import type { Brand, ReelProps, SceneRender, Stat } from "./schema";

const { fontFamily } = loadFont();
const RED = "#ba2025";

// Slow Ken Burns zoom on the backing image. Renders a flat panel if no image
// is set yet (authoring preview before an upload).
const KenBurns: React.FC<{ src: string; durationInFrames: number }> = ({
  src,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], [1.08, 1.22], {
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame, [0, durationInFrames], [-10, 10], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#111" }}>
      {src ? (
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale}) translateY(${y}px)`,
          }}
        />
      ) : null}
      {/* darken top & bottom for text legibility */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0.85) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

// Top-left: red location/topic badge with a date line under it.
const Kicker: React.FC<{ brand: Brand }> = ({ brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16 } });
  if (!brand.kicker && !brand.date) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 54,
        left: 44,
        opacity: enter,
        transform: `translateX(${interpolate(enter, [0, 1], [-26, 0])}px)`,
      }}
    >
      {brand.kicker ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            background: RED,
            padding: "10px 20px",
            borderRadius: 8,
            boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
          }}
        >
          <span style={{ fontFamily: `${fontFamily}, sans-serif`, fontSize: 30, color: "#fff", lineHeight: 1 }}>
            ↘
          </span>
          <span style={{ fontFamily, fontWeight: 800, fontSize: 36, color: "#fff", lineHeight: 1 }}>
            {brand.kicker}
          </span>
        </div>
      ) : null}
      {brand.date ? (
        <div
          style={{
            fontFamily,
            fontWeight: 700,
            fontSize: 27,
            color: "#fff",
            marginTop: 12,
            marginLeft: 4,
            textShadow: "0 2px 10px rgba(0,0,0,0.9)",
          }}
        >
          {brand.date}
        </div>
      ) : null}
    </div>
  );
};

// Top-right: logo mark + wordmark.
const LogoBadge: React.FC<{ brand: Brand }> = ({ brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16 } });
  if (!brand.logo && !brand.name) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 54,
        right: 44,
        opacity: enter,
        transform: `translateX(${interpolate(enter, [0, 1], [26, 0])}px)`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        {brand.logo ? (
          <div
            style={{
              width: 104,
              height: 104,
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
            }}
          >
            <Img src={brand.logo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        ) : null}
        {brand.name ? (
          <div
            style={{
              fontFamily: `${fontFamily}, sans-serif`,
              fontWeight: 900,
              fontSize: 22,
              letterSpacing: 3,
              color: "#fff",
              lineHeight: 1,
              marginTop: 10,
              textShadow: "0 2px 10px rgba(0,0,0,0.9)",
            }}
          >
            {brand.name}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const TopBar: React.FC<{ brand: Brand }> = ({ brand }) => (
  <>
    <Kicker brand={brand} />
    <LogoBadge brand={brand} />
  </>
);

const StatCard: React.FC<{ stat: Stat }> = ({ stat }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 6, fps, config: { damping: 12, stiffness: 120 } });
  const pop = spring({ frame: frame - 14, fps, config: { damping: 9, stiffness: 160 } });
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        top: "34%",
        transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px)`,
        opacity: enter,
        background: "rgba(0,0,0,0.42)",
        border: `3px solid ${RED}`,
        borderRadius: 28,
        padding: "44px 40px",
        textAlign: "center",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 130,
          lineHeight: 1,
          color: "#fff",
          transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`,
          textShadow: `0 6px 24px rgba(186,32,37,0.6)`,
        }}
      >
        {stat.value}
      </div>
      <div style={{ fontFamily, fontWeight: 600, fontSize: 44, marginTop: 22, color: "#ffdede" }}>
        {stat.label}
      </div>
    </div>
  );
};

const Caption: React.FC<{ text: string; durationInFrames: number }> = ({ text, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14 } });
  const out = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
  });
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 55,
        right: 55,
        bottom: 210,
        opacity: Math.min(enter, out),
        transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)`,
      }}
    >
      <div style={{ display: "inline-block", background: RED, height: 8, width: 90, borderRadius: 4, marginBottom: 20 }} />
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 62,
          lineHeight: 1.25,
          color: "#fff",
          whiteSpace: "pre-line",
          textShadow: "0 4px 20px rgba(0,0,0,0.8)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = (frame / durationInFrames) * 100;
  return (
    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 10, background: "rgba(255,255,255,0.15)" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: RED }} />
    </div>
  );
};

const SceneView: React.FC<{ scene: SceneRender; brand: Brand }> = ({ scene, brand }) => (
  <>
    <KenBurns src={scene.image} durationInFrames={scene.durationInFrames} />
    <TopBar brand={brand} />
    {scene.stat && <StatCard stat={scene.stat} />}
    <Caption text={scene.caption} durationInFrames={scene.durationInFrames} />
    {scene.audio ? <Audio src={scene.audio} /> : null}
  </>
);

export const Reel: React.FC<ReelProps> = ({ brand, scenes }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {scenes.map((scene) => (
        <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames} name={scene.id}>
          <SceneView scene={scene} brand={brand} />
        </Sequence>
      ))}
      <ProgressBar />
    </AbsoluteFill>
  );
};

export type { ReelProps, Brand, SceneRender, Stat };
