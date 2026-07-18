import type { Spec } from "@factory/composition/schema";

export type Stage =
  | "pending"
  | "in-progress"
  | "completed"
  | "generated"
  | "approved"
  | "rejected";

export type JobMeta = {
  id: string;
  stage: Stage;
  createdAt: string;
  updatedAt: string;
  rejectReason?: string;
  note?: string;
  audioSource?: "draft" | "final";
};

export type DraftAudioResult = { sceneId: string; url: string; durationMs: number };

export type WorkerState = "online" | "busy" | "offline" | "unsupported";
export type WorkerStatus = {
  supported: boolean;
  state?: WorkerState;
  online?: boolean;
  busy?: boolean;
  status?: string | null;
  lastSeenIso?: string | null;
  ageMs?: number | null;
  colabUrl?: string | null;
};

// Opt-in shared-secret auth: if the server sets API_TOKEN, it requires a token.
// We attach it from localStorage and prompt once on a 401. No token set => the
// header is simply absent (server runs open on localhost/LAN).
const TOKEN_KEY = "apiToken";
function apiFetch(input: string, init: RequestInit = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(init.headers);
  if (token) headers.set("x-api-token", token);
  return fetch(input, { ...init, headers });
}

async function j<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    const t = window.prompt("This server requires an API token:");
    if (t) localStorage.setItem(TOKEN_KEY, t);
    throw new Error("Unauthorized — enter the API token, then retry.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async uploadImage(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    const { url } = await j<{ url: string }>(
      await apiFetch("/api/uploads", { method: "POST", body: fd })
    );
    return url;
  },

  async draftAudio(id: string, scenes: { id: string; text: string }[]): Promise<DraftAudioResult[]> {
    const { results } = await j<{ results: DraftAudioResult[] }>(
      await apiFetch("/api/draft-audio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, scenes }),
      })
    );
    return results;
  },

  async sendToQueue(spec: Spec): Promise<{ meta: JobMeta }> {
    return j(
      await apiFetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec }),
      })
    );
  },

  async counts(): Promise<Record<Stage, number>> {
    return j(await apiFetch("/api/counts"));
  },

  async workerStatus(): Promise<WorkerStatus> {
    return j(await apiFetch("/api/worker-status"));
  },

  async jobs(): Promise<{ jobs: { stage: Stage; meta: JobMeta }[] }> {
    return j(await apiFetch("/api/jobs"));
  },

  async job(id: string): Promise<{ stage: Stage; meta: JobMeta; spec: Spec; video: string | null }> {
    return j(await apiFetch(`/api/jobs/${encodeURIComponent(id)}`));
  },

  async approve(id: string) {
    return j(await apiFetch(`/api/jobs/${encodeURIComponent(id)}/approve`, { method: "POST" }));
  },

  async reject(id: string, reason: string) {
    return j(
      await apiFetch(`/api/jobs/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      })
    );
  },

  async requeue(id: string) {
    return j(await apiFetch(`/api/jobs/${encodeURIComponent(id)}/requeue`, { method: "POST" }));
  },
};
