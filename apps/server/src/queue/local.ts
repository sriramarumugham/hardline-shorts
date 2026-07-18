import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import chokidar from "chokidar";
import { SpecSchema, type Spec } from "@factory/composition/schema";
import { JOBS_MEDIA_DIR, QUEUE_DIR, STAGES, mediaPaths, type Stage } from "../config.js";
import type { Job, JobMeta, QueueBackend } from "./types.js";

// Filesystem queue: queue/<stage>/<id>/{spec.json,meta.json}. A move is a dir
// rename (the local equivalent of Drive files.update). Single worker assumed.
export class LocalQueue implements QueueBackend {
  readonly kind = "local" as const;

  private stageDir(stage: Stage) {
    return join(QUEUE_DIR, stage);
  }
  private jobDir(stage: Stage, id: string) {
    return join(this.stageDir(stage), id);
  }
  private nowIso() {
    return new Date().toISOString();
  }
  private readJson<T>(path: string): T | null {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      return null;
    }
  }

  async init() {
    for (const s of STAGES) mkdirSync(this.stageDir(s), { recursive: true });
  }

  async listStage(stage: Stage): Promise<string[]> {
    const dir = this.stageDir(stage);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  }

  async readJob(stage: Stage, id: string): Promise<Job | null> {
    const dir = this.jobDir(stage, id);
    const spec = this.readJson<Spec>(join(dir, "spec.json"));
    const meta = this.readJson<JobMeta>(join(dir, "meta.json"));
    if (!spec || !meta) return null;
    return { spec, meta };
  }

  private writeMeta(stage: Stage, meta: JobMeta) {
    writeFileSync(join(this.jobDir(stage, meta.id), "meta.json"), JSON.stringify(meta, null, 2));
  }

  async writeSpec(stage: Stage, id: string, spec: Spec) {
    writeFileSync(join(this.jobDir(stage, id), "spec.json"), JSON.stringify(spec, null, 2));
  }

  async find(id: string) {
    for (const stage of STAGES) {
      if (existsSync(this.jobDir(stage, id))) {
        const job = await this.readJob(stage, id);
        if (job) return { stage, job };
      }
    }
    return null;
  }

  async create(rawSpec: unknown): Promise<Job> {
    const spec = SpecSchema.parse(rawSpec);
    if (await this.find(spec.id)) throw new Error(`job "${spec.id}" already exists in the queue`);
    const dir = this.jobDir("pending", spec.id);
    mkdirSync(dir, { recursive: true });
    const meta: JobMeta = {
      id: spec.id,
      stage: "pending",
      createdAt: this.nowIso(),
      updatedAt: this.nowIso(),
    };
    await this.writeSpec("pending", spec.id, spec);
    this.writeMeta("pending", meta);
    return { spec, meta };
  }

  async move(id: string, from: Stage, to: Stage, patch: Partial<JobMeta> = {}): Promise<Job> {
    const src = this.jobDir(from, id);
    const dst = this.jobDir(to, id);
    if (!existsSync(src)) throw new Error(`job "${id}" not found in ${from}/`);
    if (existsSync(dst)) throw new Error(`job "${id}" already in ${to}/`);
    mkdirSync(this.stageDir(to), { recursive: true });
    renameSync(src, dst);
    const job = await this.readJob(to, id);
    if (!job) throw new Error(`job "${id}" unreadable after move`);
    job.meta = { ...job.meta, ...patch, stage: to, updatedAt: this.nowIso() };
    this.writeMeta(to, job.meta);
    return job;
  }

  async counts(): Promise<Record<Stage, number>> {
    const out = {} as Record<Stage, number>;
    for (const stage of STAGES) out[stage] = (await this.listStage(stage)).length;
    return out;
  }

  async listAll() {
    const rows: Array<{ stage: Stage; meta: JobMeta }> = [];
    for (const stage of STAGES) {
      for (const id of await this.listStage(stage)) {
        const job = await this.readJob(stage, id);
        if (job) rows.push({ stage, meta: job.meta });
      }
    }
    return rows.sort((a, b) => (a.meta.updatedAt < b.meta.updatedAt ? 1 : -1));
  }

  // The edge-tts worker writes straight into storage/jobs/<id>/audio. A Colab
  // worker (e.g. over Drive-for-Desktop) instead writes into the job folder's
  // audio/ subdir, which it can see; copy those into storage so the renderer
  // (which always reads storage) picks them up.
  async ensureAudioLocal(id: string) {
    const jobAudio = join(this.jobDir("completed", id), "audio");
    if (!existsSync(jobAudio)) return;
    const dest = mediaPaths.jobAudioDir(id);
    mkdirSync(dest, { recursive: true });
    for (const f of readdirSync(jobAudio)) {
      try {
        copyFileSync(join(jobAudio, f), join(dest, f));
      } catch {
        /* skip non-file */
      }
    }
  }
  // Rendered mp4 already lives in local storage; nothing extra to persist.
  async saveVideo(_id: string, _localMp4Path: string) {
    /* no-op */
  }

  async deleteJob(stage: Stage, id: string) {
    const dir = this.jobDir(stage, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    const media = join(JOBS_MEDIA_DIR, id);
    if (existsSync(media)) rmSync(media, { recursive: true, force: true });
  }

  watchCompleted(cb: (id: string) => void) {
    const completedDir = this.stageDir("completed");
    // Drain existing backlog on boot.
    this.listStage("completed").then((ids) => ids.forEach(cb));
    const watcher = chokidar.watch(completedDir, {
      depth: 1,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
    });
    watcher.on("addDir", (path) => {
      const rel = path.slice(completedDir.length).split(/[\\/]/).filter(Boolean);
      if (rel.length === 1) cb(rel[0]);
    });
    return { close: () => void watcher.close() };
  }
}
