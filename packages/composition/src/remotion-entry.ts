import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

// Entry point the renderer bundles (see apps/server render pipeline) and the
// entry Remotion Studio loads. Kept separate from index.ts so importing the
// schema/component in the browser or Node never triggers registerRoot.
registerRoot(RemotionRoot);
