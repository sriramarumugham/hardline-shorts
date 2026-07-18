import { queue } from "./queue/index.js";
import { enqueueRender } from "./render.js";

// Render any job that lands in completed/ (blueprint §E). The backend decides
// how it watches: local = chokidar fs events, gdrive = polling.
export function watchCompleted() {
  return queue.watchCompleted((id) => {
    console.log(`[watch] completed job ready: ${id}`);
    // Return the promise so the backend can see a failure and re-dispatch (e.g.
    // the mp4 hadn't Drive-synced yet). Still log, then rethrow.
    return enqueueRender(id).catch((e) => {
      console.error(`[watch] render failed ${id}:`, e?.message ?? e);
      throw e;
    });
  });
}
