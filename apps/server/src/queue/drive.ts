import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { SpecSchema, type Spec } from "@factory/composition/schema";
import { DRIVE, JOBS_MEDIA_DIR, REPO_ROOT, STORAGE_DIR, STAGES, mediaPaths, type Stage } from "../config.js";
import type { Job, JobMeta, QueueBackend, WorkerHeartbeat } from "./types.js";

const FOLDER = "application/vnd.google-apps.folder";
const COLAB = "application/vnd.google.colaboratory";

const IMG_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// Map a /storage/... url (as stored in a spec) back to the local file, or null
// if it isn't a local storage asset (blob:/http:/empty).
function storageLocalPath(url: string): string | null {
  if (!url || !url.startsWith("/storage/")) return null;
  const rel = url.slice("/storage/".length).split("/").filter(Boolean);
  return join(STORAGE_DIR, ...rel);
}
// Written by the Colab worker each loop; read by /api/worker-status.
const HEARTBEAT_FILE = "worker-heartbeat.json";
// Uploaded into the queue root so the UI can offer a one-click Colab link
// (this repo has no GitHub remote, so we host the notebook in Drive instead).
const WORKER_NOTEBOOK = "omnivoice_drive_worker.ipynb";
const esc = (s: string) => s.replace(/'/g, "\\'");

// Google Drive job queue (blueprint §C/§4). Auth is a user OAuth2 refresh
// token (NOT a service account — those have no My Drive storage). Each stage
// is a folder under one root folder; each job is a folder under a stage; a
// move re-parents the job folder (files.update add/removeParents). The Colab
// worker writes audio into the job's audio/ subfolder via drive.mount().
export class DriveQueue implements QueueBackend {
  readonly kind = "gdrive" as const;
  private drive!: drive_v3.Drive;
  private stageIds = new Map<Stage, string>();
  private workerNotebookId: string | null = null;

  async init() {
    const missing = (["clientId", "clientSecret", "refreshToken", "rootFolderId"] as const).filter(
      (k) => !DRIVE[k]
    );
    if (missing.length) {
      throw new Error(
        `gdrive backend needs: ${missing
          .map((k) => ({ clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET", refreshToken: "GOOGLE_REFRESH_TOKEN", rootFolderId: "DRIVE_ROOT_FOLDER_ID" }[k]))
          .join(", ")}. See docs/google-drive-setup.md.`
      );
    }
    const auth = new google.auth.OAuth2(DRIVE.clientId, DRIVE.clientSecret);
    auth.setCredentials({ refresh_token: DRIVE.refreshToken });
    this.drive = google.drive({ version: "v3", auth });

    // Verify auth + resolve/create the six stage folders under the root.
    await this.drive.files.get({ fileId: DRIVE.rootFolderId, fields: "id,name" });
    for (const stage of STAGES) {
      const existing = await this.findChildFolder(DRIVE.rootFolderId, stage);
      this.stageIds.set(stage, existing ?? (await this.createFolder(DRIVE.rootFolderId, stage)));
    }
    await this.ensureWorkerNotebook();
  }

  // Upsert the Colab worker notebook into the queue root and remember its id so
  // the UI can link straight to it in Colab. Best-effort — a failure here never
  // blocks the queue from working.
  private async ensureWorkerNotebook() {
    try {
      const src = join(REPO_ROOT, "colab", WORKER_NOTEBOOK);
      if (!existsSync(src)) {
        console.warn(`[drive] worker notebook missing at ${src}; Colab link disabled`);
        return;
      }
      const existing = await this.findChildFile(DRIVE.rootFolderId, WORKER_NOTEBOOK);
      if (existing) {
        await this.drive.files.update({
          fileId: existing,
          media: { mimeType: COLAB, body: createReadStream(src) },
        });
        this.workerNotebookId = existing;
      } else {
        const res = await this.drive.files.create({
          requestBody: { name: WORKER_NOTEBOOK, parents: [DRIVE.rootFolderId], mimeType: COLAB },
          media: { mimeType: COLAB, body: createReadStream(src) },
          fields: "id",
        });
        this.workerNotebookId = res.data.id ?? null;
      }
    } catch (e: any) {
      console.warn("[drive] could not host worker notebook:", e?.message ?? e);
    }
  }

  workerColabUrl(): string | null {
    return this.workerNotebookId
      ? `https://colab.research.google.com/drive/${this.workerNotebookId}`
      : null;
  }

  // Read the worker's heartbeat file from the queue root, if present.
  async readWorkerHeartbeat(): Promise<WorkerHeartbeat | null> {
    try {
      const id = await this.findChildFile(DRIVE.rootFolderId, HEARTBEAT_FILE);
      if (!id) return null;
      const obj = JSON.parse((await this.downloadBuffer(id)).toString("utf8"));
      return obj && typeof obj.lastSeenIso === "string" ? (obj as WorkerHeartbeat) : null;
    } catch {
      return null;
    }
  }

  // ---- low-level Drive helpers ----------------------------------------------
  private stageId(stage: Stage): string {
    const id = this.stageIds.get(stage);
    if (!id) throw new Error(`stage folder "${stage}" not initialised`);
    return id;
  }

  private async list(q: string): Promise<drive_v3.Schema$File[]> {
    const files: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.drive.files.list({
        q,
        fields: "nextPageToken, files(id,name,mimeType,modifiedTime)",
        pageSize: 1000,
        spaces: "drive",
        pageToken,
      });
      files.push(...(res.data.files ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return files;
  }

  private async findChildFolder(parentId: string, name: string): Promise<string | null> {
    const f = await this.list(
      `'${parentId}' in parents and name = '${esc(name)}' and mimeType = '${FOLDER}' and trashed = false`
    );
    return f[0]?.id ?? null;
  }

  private async findChildFile(parentId: string, name: string): Promise<string | null> {
    const f = await this.list(
      `'${parentId}' in parents and name = '${esc(name)}' and trashed = false`
    );
    return f[0]?.id ?? null;
  }

  private async createFolder(parentId: string, name: string): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: { name, mimeType: FOLDER, parents: [parentId] },
      fields: "id",
    });
    return res.data.id!;
  }

  private async upsertJson(parentId: string, name: string, obj: unknown) {
    const body = Readable.from([JSON.stringify(obj, null, 2)]);
    const existing = await this.findChildFile(parentId, name);
    if (existing) {
      await this.drive.files.update({ fileId: existing, media: { mimeType: "application/json", body } });
    } else {
      await this.drive.files.create({
        requestBody: { name, parents: [parentId] },
        media: { mimeType: "application/json", body },
        fields: "id",
      });
    }
  }

  private async downloadBuffer(fileId: string): Promise<Buffer> {
    const res = await this.drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    return Buffer.from(res.data as ArrayBuffer);
  }

  private async jobFolderId(stage: Stage, id: string): Promise<string | null> {
    return this.findChildFolder(this.stageId(stage), id);
  }

  private nowIso() {
    return new Date().toISOString();
  }

  // ---- QueueBackend ----------------------------------------------------------
  async listStage(stage: Stage): Promise<string[]> {
    const f = await this.list(
      `'${this.stageId(stage)}' in parents and mimeType = '${FOLDER}' and trashed = false`
    );
    return f.map((x) => x.name!).filter(Boolean);
  }

  async readJob(stage: Stage, id: string): Promise<Job | null> {
    const folderId = await this.jobFolderId(stage, id);
    if (!folderId) return null;
    const specId = await this.findChildFile(folderId, "spec.json");
    const metaId = await this.findChildFile(folderId, "meta.json");
    if (!specId || !metaId) return null;
    const spec = JSON.parse((await this.downloadBuffer(specId)).toString("utf8")) as Spec;
    const meta = JSON.parse((await this.downloadBuffer(metaId)).toString("utf8")) as JobMeta;
    return { spec, meta };
  }

  async writeSpec(stage: Stage, id: string, spec: Spec) {
    const folderId = await this.jobFolderId(stage, id);
    if (!folderId) throw new Error(`job "${id}" not found in ${stage}/`);
    await this.upsertJson(folderId, "spec.json", spec);
  }

  async find(id: string) {
    for (const stage of STAGES) {
      const job = await this.readJob(stage, id);
      if (job) return { stage, job };
    }
    return null;
  }

  async create(rawSpec: unknown): Promise<Job> {
    const spec = SpecSchema.parse(rawSpec);
    if (await this.find(spec.id)) throw new Error(`job "${spec.id}" already exists in the queue`);
    const folderId = await this.createFolder(this.stageId("pending"), spec.id);
    const meta: JobMeta = { id: spec.id, stage: "pending", createdAt: this.nowIso(), updatedAt: this.nowIso() };
    await this.upsertJson(folderId, "spec.json", spec);
    await this.upsertJson(folderId, "meta.json", meta);
    await this.uploadJobMedia(folderId, spec);
    return { spec, meta };
  }

  // Copy the job's local images (+ logo) into the Drive job folder under media/
  // so the Colab worker can render with all assets locally: media/<sceneId>.<ext>
  // and media/logo.<ext>. Best-effort per file.
  private async uploadJobMedia(jobFolderId: string, spec: Spec) {
    const entries: Array<{ name: string; abs: string }> = [];
    const logo = storageLocalPath(spec.brand.logo);
    if (logo) entries.push({ name: `logo${extname(logo)}`, abs: logo });
    for (const s of spec.scenes) {
      const abs = storageLocalPath(s.image);
      if (abs) entries.push({ name: `${s.id}${extname(abs)}`, abs });
    }
    if (!entries.length) return;
    const mediaFolder =
      (await this.findChildFolder(jobFolderId, "media")) ?? (await this.createFolder(jobFolderId, "media"));
    for (const { name, abs } of entries) {
      if (!existsSync(abs)) continue;
      const mime = IMG_MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
      const existing = await this.findChildFile(mediaFolder, name);
      const media = { mimeType: mime, body: createReadStream(abs) };
      if (existing) await this.drive.files.update({ fileId: existing, media });
      else await this.drive.files.create({ requestBody: { name, parents: [mediaFolder] }, media, fields: "id" });
    }
  }

  // If the Colab worker already rendered <id>.mp4 into the completed job folder,
  // download it to local storage and return the path — the server then skips its
  // own (SAC-blocked) render and just serves this file.
  async fetchRenderedVideo(id: string): Promise<string | null> {
    const jobId = await this.jobFolderId("completed", id);
    if (!jobId) return null;
    const fileId = await this.findChildFile(jobId, `${id}.mp4`);
    if (!fileId) return null;
    mkdirSync(mediaPaths.jobOutDir(id), { recursive: true });
    const dest = join(mediaPaths.jobOutDir(id), `${id}.mp4`);
    writeFileSync(dest, await this.downloadBuffer(fileId));
    return dest;
  }

  async move(id: string, from: Stage, to: Stage, patch: Partial<JobMeta> = {}): Promise<Job> {
    const job = await this.readJob(from, id);
    if (!job) throw new Error(`job "${id}" not found in ${from}/`);
    const folderId = (await this.jobFolderId(from, id))!;
    await this.drive.files.update({
      fileId: folderId,
      addParents: this.stageId(to),
      removeParents: this.stageId(from),
      fields: "id,parents",
    });
    const meta: JobMeta = { ...job.meta, ...patch, stage: to, updatedAt: this.nowIso() };
    await this.upsertJson(folderId, "meta.json", meta);
    return { spec: job.spec, meta };
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

  async ensureAudioLocal(id: string) {
    const jobId = await this.jobFolderId("completed", id);
    if (!jobId) return;
    const audioFolder = await this.findChildFolder(jobId, "audio");
    if (!audioFolder) return;
    const files = await this.list(`'${audioFolder}' in parents and trashed = false`);
    const dest = mediaPaths.jobAudioDir(id);
    mkdirSync(dest, { recursive: true });
    for (const f of files) {
      if (!f.id || !f.name) continue;
      writeFileSync(join(dest, f.name), await this.downloadBuffer(f.id));
    }
  }

  async saveVideo(id: string, localMp4Path: string) {
    const jobId = await this.jobFolderId("completed", id);
    if (!jobId) return;
    const name = `${id}.mp4`;
    const existing = await this.findChildFile(jobId, name);
    const media = { mimeType: "video/mp4", body: createReadStream(localMp4Path) };
    if (existing) await this.drive.files.update({ fileId: existing, media });
    else await this.drive.files.create({ requestBody: { name, parents: [jobId] }, media, fields: "id" });
  }

  // Download <id>.mp4 from the job's Drive folder (whatever stage it's in) into
  // local storage so the Review UI can serve it — even if this server never
  // rendered it (e.g. another machine did, or the container restarted).
  async ensureVideoLocal(id: string): Promise<string | null> {
    for (const stage of STAGES) {
      const jobId = await this.jobFolderId(stage, id);
      if (!jobId) continue;
      const fileId = await this.findChildFile(jobId, `${id}.mp4`);
      if (!fileId) return null;
      mkdirSync(mediaPaths.jobOutDir(id), { recursive: true });
      const dest = join(mediaPaths.jobOutDir(id), `${id}.mp4`);
      writeFileSync(dest, await this.downloadBuffer(fileId));
      return dest;
    }
    return null;
  }

  async deleteJob(stage: Stage, id: string) {
    const folderId = await this.jobFolderId(stage, id);
    if (folderId) await this.drive.files.update({ fileId: folderId, requestBody: { trashed: true } });
    const media = join(JOBS_MEDIA_DIR, id);
    if (existsSync(media)) rmSync(media, { recursive: true, force: true });
  }

  watchCompleted(cb: (id: string) => void) {
    const dispatched = new Set<string>();
    const tick = async () => {
      try {
        const ids = await this.listStage("completed");
        const now = new Set(ids);
        for (const id of ids) {
          if (!dispatched.has(id)) {
            dispatched.add(id);
            // If the dispatch fails (e.g. render threw / mp4 not synced yet),
            // drop it from the set so the next poll retries instead of wedging.
            Promise.resolve(cb(id)).catch(() => dispatched.delete(id));
          }
        }
        for (const id of [...dispatched]) if (!now.has(id)) dispatched.delete(id);
      } catch (e: any) {
        console.error("[drive-watch] poll failed:", e?.message ?? e);
      }
    };
    const timer = setInterval(() => void tick(), DRIVE.pollMs);
    void tick();
    return { close: () => clearInterval(timer) };
  }
}
