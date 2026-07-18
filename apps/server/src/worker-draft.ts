// Draft voice worker — the local stand-in for the Colab OmniVoice clone
// (blueprint §D). Drains pending -> in-progress -> completed by synthesizing
// edge-tts audio into each job's audio dir. Lets the whole loop run on the
// laptop with no GPU. For the gdrive backend the worker is Colab instead (see
// colab/omnivoice_drive_worker.ipynb) — this local worker refuses to run there.
import { QUEUE_BACKEND, ensureDirs, mediaPaths } from "./config.js";
import { synthScenes } from "./audio.js";
import { queue } from "./queue/index.js";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 4000);
const STALE_MS = Number(process.env.WORKER_STALE_MS ?? 40 * 60 * 1000);

if (QUEUE_BACKEND !== "local") {
  console.error(
    `[worker] draft worker only supports the local backend (QUEUE_BACKEND=${QUEUE_BACKEND}).\n` +
      `For gdrive, run the Colab worker: colab/omnivoice_drive_worker.ipynb`
  );
  process.exit(1);
}

ensureDirs();

async function processOne(id: string) {
  console.log(`[worker] claiming ${id}`);
  const claimed = await queue.move(id, "pending", "in-progress", { audioSource: "draft" });
  try {
    const scenes = claimed.spec.scenes.map((s) => ({ id: s.id, text: s.text }));
    await synthScenes(scenes, mediaPaths.jobAudioDir(id));
    await queue.move(id, "in-progress", "completed", { note: "draft audio generated" });
    console.log(`[worker] completed ${id}`);
  } catch (e: any) {
    console.error(`[worker] failed ${id}:`, e?.message ?? e);
    try {
      await queue.move(id, "in-progress", "pending", { note: `worker error: ${e?.message ?? e}` });
    } catch {
      /* already moved */
    }
  }
}

// in-progress older than STALE_MS -> back to pending (crash/abandon recovery).
async function recoverStale() {
  for (const id of await queue.listStage("in-progress")) {
    const job = await queue.readJob("in-progress", id);
    if (!job) continue;
    const age = Date.now() - new Date(job.meta.updatedAt).getTime();
    if (age > STALE_MS) {
      console.log(`[worker] recovering stale ${id} (${Math.round(age / 60000)}m)`);
      try {
        await queue.move(id, "in-progress", "pending", { note: "stale recovery" });
      } catch {
        /* raced */
      }
    }
  }
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    await recoverStale();
    for (const id of await queue.listStage("pending")) await processOne(id);
  } finally {
    running = false;
  }
}

await queue.init();
console.log(`[worker] draft voice worker up (poll ${POLL_MS}ms). Ctrl+C to stop.`);
void tick();
setInterval(() => void tick(), POLL_MS);
