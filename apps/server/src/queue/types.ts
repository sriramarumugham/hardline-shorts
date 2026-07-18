import type { Spec } from "@factory/composition/schema";
import type { Stage } from "../config.js";

export type { Stage };

export type JobMeta = {
  id: string;
  stage: Stage;
  createdAt: string;
  updatedAt: string;
  rejectReason?: string;
  note?: string;
  // draft = local edge-tts stand-in worker; final = Colab OmniVoice clone.
  audioSource?: "draft" | "final";
};

export type Job = { meta: JobMeta; spec: Spec };

// Written by the Colab voice worker each loop so the UI can show it online.
export type WorkerHeartbeat = { lastSeenIso: string; status?: string; numStep?: number };

// One async interface, two backends (local filesystem / Google Drive). The
// renderer always works off local storage, so backends only differ in how the
// queue folders + job media move around. See blueprint §C/§E.
export interface QueueBackend {
  readonly kind: "local" | "gdrive";

  // Called once on boot (create/verify folder structure, auth, etc.).
  init(): Promise<void>;

  counts(): Promise<Record<Stage, number>>;
  listStage(stage: Stage): Promise<string[]>;
  listAll(): Promise<Array<{ stage: Stage; meta: JobMeta }>>;
  readJob(stage: Stage, id: string): Promise<Job | null>;
  find(id: string): Promise<{ stage: Stage; job: Job } | null>;

  // Author -> pending. Throws if the id already exists anywhere.
  create(spec: Spec): Promise<Job>;
  // Re-parent a job between stages (Drive files.update / fs rename) + patch meta.
  move(id: string, from: Stage, to: Stage, patch?: Partial<JobMeta>): Promise<Job>;
  // Persist a spec back into a job (e.g. after the render step measures durations).
  writeSpec(stage: Stage, id: string, spec: Spec): Promise<void>;

  // Ensure the completed job's audio is present locally under
  // storage/jobs/<id>/audio so the renderer + ffprobe can read it.
  // local: no-op (already there); gdrive: download from the job folder.
  ensureAudioLocal(id: string): Promise<void>;
  // After a render, persist the mp4 into the queue (gdrive uploads it; local
  // keeps it in storage). The file is always kept in local storage for serving.
  saveVideo(id: string, localMp4Path: string): Promise<void>;

  // Poll/watch completed/ and invoke cb(id) for each job ready to render.
  watchCompleted(cb: (id: string) => void): { close(): void };

  // Optional (gdrive only): the voice worker's last heartbeat, and a one-click
  // Colab URL for the hosted worker notebook. Absent on the local backend.
  readWorkerHeartbeat?(): Promise<WorkerHeartbeat | null>;
  workerColabUrl?(): string | null;

  // Optional: if the worker already rendered <id>.mp4 (Colab, off the SAC-blocked
  // laptop), download it locally and return the path so the server skips its own
  // render. Returns null when no worker-rendered video exists.
  fetchRenderedVideo?(id: string): Promise<string | null>;

  // Optional: permanently remove a job + its local media (used by retention).
  deleteJob?(stage: Stage, id: string): Promise<void>;
}
