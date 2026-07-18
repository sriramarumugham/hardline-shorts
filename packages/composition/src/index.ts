// Public surface of the shared composition package (safe in browser + Node —
// no registerRoot side effects here; use ./remotion-entry for that).
export * from "./schema";
export { Reel } from "./Reel";
export { RemotionRoot } from "./Root";
