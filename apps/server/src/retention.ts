import { RETENTION_DAYS } from "./config.js";
import { queue } from "./queue/index.js";

// Prune old terminal jobs (approved/rejected) + their media so a self-hosted box
// — or the Google Drive 15 GB free tier — doesn't fill up over time. Off unless
// RETENTION_DAYS > 0 and the backend supports deleteJob. Runs on boot + every 6h.
export function startRetention() {
  if (!RETENTION_DAYS || !queue.deleteJob) return;
  const maxAgeMs = RETENTION_DAYS * 86_400_000;

  const run = async () => {
    try {
      const cutoff = Date.now() - maxAgeMs;
      const rows = await queue.listAll();
      let n = 0;
      for (const r of rows) {
        const terminal = r.stage === "approved" || r.stage === "rejected";
        if (terminal && new Date(r.meta.updatedAt).getTime() < cutoff) {
          await queue.deleteJob!(r.stage, r.meta.id);
          n++;
          console.log(`[retention] pruned ${r.stage}/${r.meta.id}`);
        }
      }
      if (n) console.log(`[retention] pruned ${n} job(s) older than ${RETENTION_DAYS}d`);
    } catch (e: any) {
      console.error("[retention]", e?.message ?? e);
    }
  };

  void run();
  setInterval(() => void run(), 6 * 3_600_000);
  console.log(`[retention] on: prune approved/rejected older than ${RETENTION_DAYS}d`);
}
