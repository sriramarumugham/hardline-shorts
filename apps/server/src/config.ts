import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// apps/server
export const SERVER_ROOT = resolve(__dirname, "..");
// repo root (monorepo)
export const REPO_ROOT = resolve(SERVER_ROOT, "..", "..");

export const PORT = Number(process.env.PORT ?? 4000);
export const HOST = process.env.HOST ?? "localhost";
// Absolute origin used to build URLs the renderer's Chromium can fetch.
export const SERVER_ORIGIN = process.env.SERVER_ORIGIN ?? `http://${HOST}:${PORT}`;

// Where uploaded/generated media lives (stable URLs under /storage). The
// renderer always reads media locally from here, whichever queue backend is
// used, so the Drive backend downloads audio into this same layout.
export const STORAGE_DIR = process.env.STORAGE_DIR
  ? resolve(process.env.STORAGE_DIR)
  : resolve(SERVER_ROOT, "storage");
export const IMAGES_DIR = join(STORAGE_DIR, "images");
export const JOBS_MEDIA_DIR = join(STORAGE_DIR, "jobs"); // storage/jobs/<id>/{draft,audio,out}

// Queue backend: "local" (filesystem, default) or "gdrive" (Google Drive API).
// Both implement the same async interface (see src/queue/). Mirrors blueprint
// §C: pending -> in-progress -> completed -> generated -> approved/rejected.
export const QUEUE_BACKEND = (process.env.QUEUE_BACKEND ?? "local") as "local" | "gdrive";

// Local backend: the queue root on disk (overridable, e.g. a Drive-for-Desktop
// synced folder for the throwaway local Drive test).
export const QUEUE_DIR = process.env.QUEUE_DIR
  ? resolve(process.env.QUEUE_DIR)
  : resolve(SERVER_ROOT, "queue");

// gdrive backend: OAuth2 (user refresh token — NOT a service account, per
// blueprint §4) + the id of the queue root folder in that user's My Drive.
export const DRIVE = {
  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN ?? "",
  rootFolderId: process.env.DRIVE_ROOT_FOLDER_ID ?? "",
  pollMs: Number(process.env.DRIVE_POLL_MS ?? 8000),
};

// Security / ops (all opt-in; unset = current permissive behavior for local dev).
// API_TOKEN: when set, /api/* (except /health) requires it (Bearer or x-api-token).
export const API_TOKEN = process.env.API_TOKEN ?? "";
// CORS_ORIGIN: comma-separated allowed origins; unset = allow any (dev).
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "";
// RETENTION_DAYS: prune approved/rejected jobs older than this many days; 0 = off.
export const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 0);

export const STAGES = [
  "pending",
  "in-progress",
  "completed",
  "generated",
  "approved",
  "rejected",
] as const;
export type Stage = (typeof STAGES)[number];

export function ensureDirs() {
  mkdirSync(IMAGES_DIR, { recursive: true });
  mkdirSync(JOBS_MEDIA_DIR, { recursive: true });
  if (QUEUE_BACKEND === "local") {
    for (const s of STAGES) mkdirSync(join(QUEUE_DIR, s), { recursive: true });
  }
}

// Media helpers (filesystem path + public URL for the same asset).
export const mediaPaths = {
  jobDraftDir: (id: string) => join(JOBS_MEDIA_DIR, id, "draft"),
  jobAudioDir: (id: string) => join(JOBS_MEDIA_DIR, id, "audio"),
  jobOutDir: (id: string) => join(JOBS_MEDIA_DIR, id, "out"),
};

// Turn an absolute path under STORAGE_DIR into a /storage/... URL path.
export function storageUrl(absPath: string): string {
  const rel = absPath.slice(STORAGE_DIR.length).split(/[\\/]/).filter(Boolean).join("/");
  return `/storage/${rel}`;
}

// Make a possibly-relative /storage url absolute (for the renderer).
export function absoluteUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `${SERVER_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}
