import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type JobMeta, type Stage } from "./api";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Row = { stage: Stage; meta: JobMeta };

// Per-stage status shown in the jobs table — an honest step, not a fake %.
const STATUS: Record<Stage, { label: string; cls: string; active?: boolean }> = {
  pending: { label: "Queued", cls: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  "in-progress": { label: "Voicing…", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300", active: true },
  completed: { label: "Rendering…", cls: "border-sky-500/30 bg-sky-500/10 text-sky-300", active: true },
  generated: { label: "Ready to review", cls: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
  approved: { label: "Approved", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  rejected: { label: "Rejected", cls: "border-red-500/30 bg-red-500/10 text-red-300" },
};

function StatusCell({ stage }: { stage: Stage }) {
  const s = STATUS[stage];
  return (
    <div className="space-y-1.5">
      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
      {s.active && (
        <div className="h-1 w-28 overflow-hidden rounded bg-muted">
          <div className="h-full w-1/2 animate-pulse rounded bg-amber-400/70" />
        </div>
      )}
    </div>
  );
}

function rel(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function Queue() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [jobs, setJobs] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [acting, setActing] = useState(false);

  async function refresh() {
    try {
      const [c, j] = await Promise.all([api.counts(), api.jobs()]);
      setCounts(c);
      setJobs(j.jobs);
    } catch (e: any) {
      toast.error(e.message ?? "Could not refresh the queue");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  async function openReview(row: Row) {
    setSelected(row);
    setVideo(null);
    setReason("");
    setVideoLoading(true);
    try {
      const info = await api.job(row.meta.id);
      setVideo(info.video);
    } catch (e: any) {
      toast.error(e.message ?? "Could not load the job");
    } finally {
      setVideoLoading(false);
    }
  }

  async function act(label: string, fn: () => Promise<unknown>) {
    setActing(true);
    try {
      await fn();
      toast.success(label);
      setSelected(null);
      await refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Action failed");
    } finally {
      setActing(false);
    }
  }

  const cards = [
    { label: "Waiting", n: counts["pending"] ?? 0, primary: false },
    { label: "Working", n: (counts["in-progress"] ?? 0) + (counts["completed"] ?? 0), primary: false },
    { label: "Ready to review", n: counts["generated"] ?? 0, primary: true },
    { label: "Approved", n: counts["approved"] ?? 0, primary: false },
    { label: "Rejected", n: counts["rejected"] ?? 0, primary: false },
  ];

  return (
    <div className="space-y-5 p-5">
      {/* stage summary */}
      <div className="flex flex-wrap gap-3">
        {cards.map((c) => (
          <Card
            key={c.label}
            className={`min-w-32 gap-1 p-4 ${c.primary && c.n > 0 ? "border-primary/60 bg-primary/5" : ""}`}
          >
            <div className="text-2xl font-extrabold tabular-nums">{loaded ? c.n : "–"}</div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{c.label}</div>
          </Card>
        ))}
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Audio</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loaded &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {loaded && jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No jobs yet — author a reel and send it to the queue.
                  </TableCell>
                </TableRow>
              )}
              {jobs.map((j) => (
                <TableRow key={j.meta.id}>
                  <TableCell className="font-medium">{j.meta.id}</TableCell>
                  <TableCell>
                    <StatusCell stage={j.stage} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{j.meta.audioSource ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{rel(j.meta.updatedAt)}</TableCell>
                  <TableCell className="text-right">
                    {(j.stage === "generated" || j.stage === "approved" || j.stage === "rejected") && (
                      <Button variant="outline" size="sm" onClick={() => openReview(j)}>
                        Review
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Review gate is manual by design — nothing auto-publishes (blueprint guardrail).
      </p>

      {/* Review dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selected?.meta.id}</DialogTitle>
          </DialogHeader>

          {videoLoading ? (
            <Skeleton className="mx-auto aspect-[9/16] w-56 rounded-lg" />
          ) : video ? (
            <video
              src={video}
              controls
              className="mx-auto max-h-[60vh] rounded-lg border border-border bg-black"
            />
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">No rendered video.</div>
          )}

          {selected?.meta.rejectReason && (
            <Alert variant="destructive">
              <AlertDescription>Rejected: {selected.meta.rejectReason}</AlertDescription>
            </Alert>
          )}

          {selected?.stage === "generated" && (
            <>
              <Textarea
                placeholder="Reject reason (optional) — e.g. bad pause in scene 3"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <DialogFooter className="gap-2 sm:justify-start">
                <Button
                  disabled={acting}
                  onClick={() => act("Approved", () => api.approve(selected.meta.id))}
                >
                  ✓ Approve
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger disabled={acting} className={buttonVariants({ variant: "secondary" })}>
                    ✕ Reject
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reject this reel?</AlertDialogTitle>
                      <AlertDialogDescription>
                        It moves to Rejected. You can re-queue it later to regenerate.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => act("Rejected", () => api.reject(selected.meta.id, reason))}
                      >
                        Reject
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </DialogFooter>
            </>
          )}

          {selected?.stage === "rejected" && (
            <DialogFooter className="sm:justify-start">
              <Button
                variant="secondary"
                disabled={acting}
                onClick={() => act("Re-queued", () => api.requeue(selected.meta.id))}
              >
                ↻ Re-queue (regenerate)
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
