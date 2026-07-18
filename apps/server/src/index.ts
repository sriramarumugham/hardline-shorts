import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import cors from "cors";
import express from "express";
import multer from "multer";
import {
  API_TOKEN,
  CORS_ORIGIN,
  IMAGES_DIR,
  PORT,
  SERVER_ROOT,
  STORAGE_DIR,
  ensureDirs,
  mediaPaths,
  storageUrl,
} from "./config.js";
import { synthScenes } from "./audio.js";
import { QUEUE_BACKEND } from "./config.js";
import { queue } from "./queue/index.js";
import { enqueueRender } from "./render.js";
import { watchCompleted } from "./watcher.js";
import { startRetention } from "./retention.js";

ensureDirs();

// A render failure inside the compositor can throw from a frame-pipe callback
// (outside the awaited promise) and would otherwise crash the whole server.
// Keep the API alive and just log it — the job stays in completed/ for retry.
process.on("uncaughtException", (e) => console.error("[server] uncaughtException:", e?.message ?? e));
process.on("unhandledRejection", (e: any) => console.error("[server] unhandledRejection:", e?.message ?? e));

const app = express();
// Restrict CORS to known origins when CORS_ORIGIN is set (else allow any for dev).
app.use(cors(CORS_ORIGIN ? { origin: CORS_ORIGIN.split(",").map((s) => s.trim()) } : {}));
app.use(express.json({ limit: "4mb" }));

// Opt-in shared-secret auth. When API_TOKEN is set, every /api/* route (except
// /api/health) requires it via `Authorization: Bearer <t>` or `x-api-token`.
// Unset => open (fine for localhost/LAN; set it before exposing publicly).
if (API_TOKEN) {
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/") || req.path === "/api/health") return next();
    const auth = req.header("authorization") ?? "";
    const token = (auth.startsWith("Bearer ") ? auth.slice(7) : "") || req.header("x-api-token") || "";
    if (token === API_TOKEN) return next();
    res.status(401).json({ error: "unauthorized" });
  });
}

// ---- static: media + built web app ----------------------------------------
app.use("/storage", express.static(STORAGE_DIR));

const WEB_DIST = resolve(SERVER_ROOT, "..", "web", "dist");

// ---- image uploads ----------------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, IMAGES_DIR),
    filename: (_req, file, cb) => {
      const ext = (extname(file.originalname) || ".jpg").toLowerCase();
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

app.post("/api/uploads", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file" });
  res.json({ url: storageUrl(join(IMAGES_DIR, req.file.filename)) });
});

// ---- draft audio (edge-tts) for preview/timing ------------------------------
app.post("/api/draft-audio", async (req, res) => {
  try {
    const { id, scenes } = req.body ?? {};
    if (!id || !Array.isArray(scenes)) {
      return res.status(400).json({ error: "expected { id, scenes:[{id,text}] }" });
    }
    const results = await synthScenes(scenes, mediaPaths.jobDraftDir(id));
    res.json({
      results: results.map((r) => ({
        sceneId: r.sceneId,
        url: r.audioPath ? storageUrl(r.audioPath) : "",
        durationMs: r.durationMs,
      })),
    });
  } catch (e: any) {
    console.error("draft-audio failed:", e);
    res.status(500).json({ error: e?.message ?? "draft audio failed" });
  }
});

// ---- queue ------------------------------------------------------------------
app.post("/api/jobs", async (req, res) => {
  try {
    const job = await queue.create(req.body?.spec ?? req.body);
    res.json(job);
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "could not create job" });
  }
});

app.get("/api/counts", async (_req, res) => {
  try {
    res.json(await queue.counts());
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

app.get("/api/jobs", async (_req, res) => {
  try {
    res.json({ jobs: await queue.listAll() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

app.get("/api/jobs/:id", async (req, res) => {
  try {
    const found = await queue.find(req.params.id);
    if (!found) return res.status(404).json({ error: "not found" });
    const outMp4 = join(mediaPaths.jobOutDir(found.job.meta.id), `${found.job.meta.id}.mp4`);
    res.json({
      stage: found.stage,
      meta: found.job.meta,
      spec: found.job.spec,
      video: existsSync(outMp4) ? storageUrl(outMp4) : null,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// ---- review gate (never auto-publish; blueprint guardrail) ------------------
app.post("/api/jobs/:id/approve", async (req, res) => {
  try {
    res.json(await queue.move(req.params.id, "generated", "approved"));
  } catch (e: any) {
    res.status(400).json({ error: e?.message });
  }
});

app.post("/api/jobs/:id/reject", async (req, res) => {
  try {
    const reason = String(req.body?.reason ?? "").slice(0, 500);
    res.json(await queue.move(req.params.id, "generated", "rejected", { rejectReason: reason }));
  } catch (e: any) {
    res.status(400).json({ error: e?.message });
  }
});

// Re-queue a rejected job to regenerate audio + render from scratch.
app.post("/api/jobs/:id/requeue", async (req, res) => {
  try {
    res.json(await queue.move(req.params.id, "rejected", "pending", { rejectReason: undefined }));
  } catch (e: any) {
    res.status(400).json({ error: e?.message });
  }
});

// Manual render trigger (the watcher does this automatically for completed/).
app.post("/api/render/:id", async (req, res) => {
  try {
    const url = await enqueueRender(req.params.id);
    res.json({ video: url });
  } catch (e: any) {
    res.status(400).json({ error: e?.message });
  }
});

// Voice worker liveness. Tri-state so we NEVER falsely report "offline" while
// the worker is actually busy: the Colab worker only writes its heartbeat
// between jobs, so during a multi-minute voice+render the heartbeat lapses. But
// if a job is in `in-progress`, the worker is alive by definition — that
// overrides a stale heartbeat. State: "busy" | "online" | "offline".
// Grace window is generous (Drive-sync latency). Local backend => unsupported.
const WORKER_ONLINE_MS = Number(process.env.WORKER_ONLINE_MS ?? 180_000);
app.get("/api/worker-status", async (_req, res) => {
  try {
    if (!queue.readWorkerHeartbeat) return res.json({ supported: false, state: "unsupported" });
    const hb = await queue.readWorkerHeartbeat();
    const lastSeenIso = hb?.lastSeenIso ?? null;
    const ageMs = lastSeenIso ? Date.now() - new Date(lastSeenIso).getTime() : null;
    const heartbeatFresh = ageMs != null && ageMs >= 0 && ageMs < WORKER_ONLINE_MS;

    // A job actively in progress means the worker is alive even if its heartbeat
    // lapsed while blocked voicing/rendering (the "false offline" case).
    let working = false;
    try {
      const counts = await queue.counts();
      working = (counts["in-progress"] ?? 0) > 0;
    } catch {
      /* counts unavailable -> fall back to heartbeat only */
    }

    const state = working ? "busy" : heartbeatFresh ? "online" : "offline";
    res.json({
      supported: true,
      state, // "busy" | "online" | "offline"
      online: state !== "offline", // back-compat for the current UI
      busy: working,
      status: hb?.status ?? null,
      lastSeenIso,
      ageMs,
      colabUrl: queue.workerColabUrl?.() ?? null,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---- SPA fallback (serve the built UI if present) ---------------------------
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api|\/storage).*/, (_req, res) => res.sendFile(join(WEB_DIST, "index.html")));
} else {
  app.get("/", (_req, res) =>
    res.type("text").send("Factory server running. Web UI not built — run `npm run dev:web`.")
  );
}

async function main() {
  try {
    await queue.init();
    console.log(`[server] queue backend: ${QUEUE_BACKEND}`);
  } catch (e: any) {
    console.error(`[server] queue init failed (${QUEUE_BACKEND}):`, e?.message ?? e);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`[server] http://localhost:${PORT}`);
    watchCompleted();
    startRetention();
  });
}

void main();
