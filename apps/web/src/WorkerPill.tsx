import { useEffect, useState } from "react";
import { api, type WorkerStatus } from "./api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";

type State = "online" | "busy" | "offline";

// Persistent app-bar indicator. Polls worker-status (+ pending count for copy),
// keeps last-known on a dropped poll, and derives a 3-state pill so it never
// falsely shows "offline" while the worker is busy on a job.
export function WorkerPill() {
  const [w, setW] = useState<WorkerStatus | null>(null);
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const [s, c] = await Promise.all([
        api.workerStatus().catch(() => null),
        api.counts().catch(() => null),
      ]);
      if (!alive) return;
      if (s) setW(s); // keep last-known on a failed poll
      if (c) setWaiting(c["pending"] ?? 0);
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!w?.supported) return null; // local backend has no worker to show

  const state: State = (w.state as State) ?? (w.busy ? "busy" : w.online ? "online" : "offline");
  const dot =
    state === "online" ? "bg-emerald-400 shadow-[0_0_8px_theme(colors.emerald.400)]"
    : state === "busy" ? "bg-amber-400 shadow-[0_0_8px_theme(colors.amber.400)] animate-pulse"
    : "bg-red-400 shadow-[0_0_8px_theme(colors.red.400)]";
  const word = state === "online" ? "Ready" : state === "busy" ? "Working" : "Offline";
  const tone = state === "online" ? "text-emerald-300" : state === "busy" ? "text-amber-300" : "text-red-300";

  return (
    <Popover>
      <PopoverTrigger className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-sm transition-colors hover:bg-card">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <span className={tone}>{word}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2">
        <div className="font-semibold">
          Voice worker: <span className={tone}>{word.toLowerCase()}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {state === "busy"
            ? `${w.status ?? "processing a job"}${waiting > 0 ? ` · ${waiting} queued` : ""}`
            : state === "online"
              ? "Idle — send a job and it starts automatically."
              : waiting > 0
                ? `${waiting} job${waiting === 1 ? "" : "s"} waiting. Start the worker to process them.`
                : "Start the worker before jobs can be voiced."}
        </p>
        {w.colabUrl && (
          <a
            href={w.colabUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({
              size: "sm",
              variant: state === "offline" ? "default" : "secondary",
              className: "w-full",
            })}
          >
            ▶ Open Colab worker
          </a>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          The worker (Colab, free GPU) voices &amp; renders each job, then the server collects it.
          "Working" means it's busy on a job; it returns to "Ready" when done.
        </p>
      </PopoverContent>
    </Popover>
  );
}
