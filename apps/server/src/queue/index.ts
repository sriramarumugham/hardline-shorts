import { QUEUE_BACKEND } from "../config.js";
import { LocalQueue } from "./local.js";
import { DriveQueue } from "./drive.js";
import type { QueueBackend } from "./types.js";

export type { Job, JobMeta, Stage, QueueBackend } from "./types.js";

// Single queue instance chosen by QUEUE_BACKEND (local | gdrive). Both the
// server routes and the render/worker code talk to this same object, so the
// backend swap is fully contained here.
export const queue: QueueBackend = QUEUE_BACKEND === "gdrive" ? new DriveQueue() : new LocalQueue();
