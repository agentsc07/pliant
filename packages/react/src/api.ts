import type { Manifest, Patch, Verdict } from "@pliant/core";

export interface ApiConfig { baseUrl: string; userId: string }

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: any) { super(message); }
}

async function request<T>(cfg: ApiConfig, method: string, path: string, body?: unknown, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const r = await fetch(cfg.baseUrl + path, {
    method,
    headers: { "content-type": "application/json", "x-user-id": cfg.userId, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body), signal,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(data.message ?? data.error ?? (data.errors ? data.errors.join("; ") : `HTTP ${r.status}`), r.status, data);
  return data as T;
}

export const pliantApi = {
  manifest: (c: ApiConfig, manifestUrl: string) => request<Manifest>(c, "GET", manifestUrl),
  profile: (c: ApiConfig) => request<{ patches: Patch[] }>(c, "GET", `/__pliant/profile/${c.userId}`),
  savePatch: (c: ApiConfig, p: Patch) => request<{ patch: Patch; warnings: string[] }>(c, "PUT", `/__pliant/profile/${c.userId}/patches/${p.id}`, p),
  deletePatch: (c: ApiConfig, id: string) => request<unknown>(c, "DELETE", `/__pliant/profile/${c.userId}/patches/${id}`),
  reset: (c: ApiConfig) => request<unknown>(c, "DELETE", `/__pliant/profile/${c.userId}`),
  reorder: (c: ApiConfig, ids: string[]) => request<{ patches: Patch[] }>(c, "POST", `/__pliant/profile/${c.userId}/reorder`, { ids }),
  registerRun: (c: ApiConfig, workflowId: string, fanOut: number) => request<{ runId: string }>(c, "POST", "/__pliant/run", { workflowId, fanOut }),
  customize: (c: ApiConfig, request_: string, llm?: LlmKey, signal?: AbortSignal) =>
    request<CustomizeResponse>(c, "POST", "/__pliant/customize", { request: request_ }, llm?.apiKey ? {
      "x-pliant-llm-provider": llm.provider, "x-pliant-llm-key": llm.apiKey, ...(llm.model ? { "x-pliant-llm-model": llm.model } : {}),
    } : {}, signal),
};

/** A user's own model key. Lives in the browser only; sent per request, never stored server-side. */
export interface LlmKey { provider: string; apiKey: string; model?: string }

export interface CustomizeResponse {
  verdict: Verdict;
  patch?: Patch;
  errors?: string[];
  warnings?: string[];
  preview?: { description: string[] };
}

/** Invoke a capability through its declared route. */
export async function callCapability(
  cfg: ApiConfig, manifest: Manifest, capId: string, args: Record<string, unknown>, runId?: string,
): Promise<unknown> {
  const cap = manifest.capabilities.find((c) => c.id === capId);
  if (!cap) throw new Error(`Unknown capability ${capId}`);
  const used = new Set<string>();
  const path = cap.route.path.replace(/:(\w+)/g, (_, k) => {
    used.add(k);
    return encodeURIComponent(String(args[k]));
  });
  const rest = Object.fromEntries(Object.entries(args).filter(([k, v]) => !used.has(k) && v !== undefined));
  const extra: Record<string, string> = runId ? { "x-pliant-run": runId } : {};
  if (cap.route.method === "GET" || cap.route.method === "DELETE") {
    const qs = new URLSearchParams(Object.entries(rest).map(([k, v]) => [k, String(v)])).toString();
    return request(cfg, cap.route.method, path + (qs ? `?${qs}` : ""), undefined, extra);
  }
  return request(cfg, cap.route.method, path, rest, extra);
}
