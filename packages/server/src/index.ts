import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import {
  defaultPolicy, validatePatch, Patch,
  type CapabilityManifest, type Dial, type EntityManifest, type Effect, type InvariantId, type Layer, type Manifest, type Policy, type Verdict,
} from "@pliant/core";
import { Enforcer } from "./enforce";
import { paramSpecs } from "./params";
import { ProfileStore } from "./store";

export { Enforcer } from "./enforce";
export { ProfileStore } from "./store";

export interface CapabilityDef<P extends z.ZodObject<any> = z.ZodObject<any>> {
  id: string;
  description: string;
  route: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string };
  params: P;
  returns?: z.ZodTypeAny;
  entity: string;
  effect: Effect;
  policy?: Partial<Policy>;
  handler: (params: z.infer<P>, req: Request) => unknown | Promise<unknown>;
}

export interface CustomizeResult {
  verdict: Verdict;
  patch?: Patch;
  errors?: string[];
  warnings?: string[];
  preview?: unknown;
}

/** Injected by the host app (usually @pliant/studio) so this package stays LLM-free. */
export interface CustomizeHandler {
  (input: {
    request: string; userId: string; manifest: Manifest; profile: Patch[]; slots?: string[]; catalog?: string[];
    /** Bring-your-own-key: sent per request in headers, used for this call only, never stored or logged. */
    byok?: { provider: string; apiKey: string; model?: string };
  }): Promise<CustomizeResult>;
}

/** Per-visitor developer sandbox: changes apply to that session only, never to other users. */
export interface DevOverrides {
  dials?: Partial<Record<Layer, Dial>>;
  locks?: string[];
  policies?: Record<string, Partial<Policy>>;
}
export interface AuditEntry {
  at: number; request: string; verdict: string; layer: string; reason: string; ops: string[]; errors: string[]; ms: number; ownKey: boolean;
}
const DevOverridesSchema = z.object({
  dials: z.record(z.enum(["L0", "L1", "L2", "L3", "L4"]), z.enum(["open", "restricted", "locked"])).optional(),
  locks: z.array(z.string().max(80)).max(60).optional(),
  policies: z.record(z.object({
    batchable: z.boolean().optional(), maxFanOut: z.number().int().positive().max(1000).nullable().optional(),
    requiresConfirm: z.boolean().optional(),
    rateLimit: z.object({ count: z.number().int().positive().max(10000), perSeconds: z.number().int().positive().max(86400) }).nullable().optional(),
    schedulable: z.boolean().optional(),
  })).optional(),
});
const MAX_SANDBOXES = 5000, MAX_AUDIT = 100;

export interface PliantOptions {
  app: string;
  dbPath?: string;
  entities?: EntityManifest[];
  dials?: Partial<Record<Layer, Dial>>;
  locks?: string[];
  invariants?: InvariantId[];
  customize?: CustomizeHandler;
  examples?: string[];
  labels?: Record<string, string>;
  /** Slot ids / component catalog the frontend registers; forwarded to validation. */
  slots?: string[];
  catalog?: string[];
  /** Mount /__pliant/dev/* (config sandbox + audit log). Default true; every change is scoped to the calling session. */
  devConsole?: boolean;
}

export function userIdOf(req: Request): string {
  return (req.header("x-user-id") ?? (req.query.userId as string | undefined) ?? "anonymous").toString();
}

export function createPliant(opts: PliantOptions) {
  const router: Router = express.Router();
  const caps: CapabilityManifest[] = [];
  const store = new ProfileStore(opts.dbPath);
  const enforcer = new Enforcer();

  const overrides = new Map<string, DevOverrides>();
  const audit = new Map<string, AuditEntry[]>();
  const remember = <T,>(m: Map<string, T>, k: string, v: T) => { m.delete(k); m.set(k, v); if (m.size > MAX_SANDBOXES) m.delete(m.keys().next().value as string); };

  const policyFor = (userId: string | undefined, c: CapabilityManifest): Policy => ({ ...c.policy, ...((userId && overrides.get(userId)?.policies?.[c.id]) || {}) } as Policy);

  const manifest = (userId?: string): Manifest => {
    const o = userId ? overrides.get(userId) : undefined;
    return ({
    app: opts.app,
    capabilities: o?.policies ? caps.map((c) => ({ ...c, policy: policyFor(userId, c) })) : caps,
    entities: opts.entities ?? [],
    dials: { L0: "open", L1: "open", L2: "open", L3: "restricted", L4: "locked", ...opts.dials, ...o?.dials },
    locks: o?.locks ?? opts.locks ?? [],
    invariants: opts.invariants ?? ["destructive-needs-confirm", "locked-visible", "external-shows-count"],
    examples: opts.examples,
    labels: opts.labels,
    });
  };

  function capability<P extends z.ZodObject<any>>(def: CapabilityDef<P>) {
    const policy: Policy = { ...defaultPolicy(def.effect), ...def.policy };
    caps.push({
      id: def.id, description: def.description, route: def.route, params: paramSpecs(def.params),
      entity: def.entity, effect: def.effect, policy,
    });
    const method = def.route.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
    router[method](def.route.path, async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Enforcement happens on the server regardless of what the client claims.
        const runId = req.header("x-pliant-run")?.split(";")[0].trim() || undefined;
        const uid = userIdOf(req);
        const eff = policyFor(uid, { id: def.id, policy } as CapabilityManifest);
        const denial = enforcer.check({
          userId: uid, capId: def.id, maxFanOut: eff.maxFanOut, rateLimit: eff.rateLimit,
          runId,
        });
        if (denial) return void res.status(denial.status).json({ error: denial.error, message: denial.message });

        const raw = { ...req.query, ...(req.body ?? {}), ...req.params };
        const parsed = def.params.safeParse(raw);
        if (!parsed.success) return void res.status(400).json({ error: "bad_params", issues: parsed.error.issues });
        res.json(await def.handler(parsed.data, req));
      } catch (e) { next(e); }
    });
  }

  // ----- /__pliant routes -----
  const p = express.Router();
  p.use(express.json());
  p.get("/manifest", (req, res) => res.json(manifest(userIdOf(req))));

  p.post("/run", (req, res) => {
    const body = z.object({ workflowId: z.string(), fanOut: z.number().int().nonnegative() }).safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "bad_run", issues: body.error.issues });
    const run = enforcer.registerRun(userIdOf(req), body.data.workflowId, body.data.fanOut);
    res.json({ runId: run.id });
  });

  p.get("/profile/:userId", (req, res) => res.json({ userId: req.params.userId, patches: store.list(req.params.userId) }));
  p.put("/profile/:userId/patches/:id", (req, res) => {
    const v = validatePatch({ ...req.body, id: req.params.id }, manifest(req.params.userId), {
      slots: opts.slots, catalog: opts.catalog,
      knownWorkflowIds: store.list(req.params.userId).flatMap((x) => x.workflows.map((w) => w.id)),
    });
    if (!v.ok || !v.patch) return void res.status(422).json({ errors: v.errors });
    store.upsert(req.params.userId, v.patch);
    res.json({ patch: v.patch, warnings: v.warnings });
  });
  p.delete("/profile/:userId/patches/:id", (req, res) => {
    res.status(store.remove(req.params.userId, req.params.id) ? 200 : 404).json({ ok: true });
  });
  p.delete("/profile/:userId", (req, res) => { store.reset(req.params.userId); res.json({ ok: true }); });
  p.post("/profile/:userId/reorder", (req, res) => {
    const ids = z.array(z.string()).safeParse(req.body?.ids);
    if (!ids.success) return void res.status(400).json({ error: "bad_ids" });
    store.reorder(req.params.userId, ids.data);
    res.json({ patches: store.list(req.params.userId) });
  });

  p.post("/customize", async (req, res, next) => {
    try {
      if (!opts.customize) return void res.status(501).json({ error: "no_studio" });
      const body = z.object({ request: z.string().min(1) }).safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "bad_request" });
      const userId = userIdOf(req);
      const key = req.header("x-pliant-llm-key");
      const byok = key ? { provider: req.header("x-pliant-llm-provider") ?? "", apiKey: key, model: req.header("x-pliant-llm-model") || undefined } : undefined;
      const t0 = Date.now();
      const result = await opts.customize({ request: body.data.request, userId, manifest: manifest(userId), profile: store.list(userId), slots: opts.slots, catalog: opts.catalog, byok });
      const log = [...(audit.get(userId) ?? []), {
        at: t0, request: body.data.request.slice(0, 300), verdict: result.verdict.verdict, layer: result.verdict.layer, reason: result.verdict.reason.slice(0, 300),
        ops: result.patch?.ops.map((o) => o.op) ?? [], errors: (result.errors ?? []).slice(0, 5), ms: Date.now() - t0, ownKey: !!byok,
      } satisfies AuditEntry].slice(-MAX_AUDIT);
      remember(audit, userId, log);
      res.json(result);
    } catch (e) { next(e); }
  });

  if (opts.devConsole !== false) {
    p.get("/dev/config", (req, res) => {
      const uid = userIdOf(req);
      res.json({
        app: opts.app, slots: opts.slots ?? [], catalog: opts.catalog ?? [], labels: opts.labels ?? {},
        manifest: manifest(uid), defaults: { dials: manifest().dials, locks: opts.locks ?? [], policies: Object.fromEntries(caps.map((c) => [c.id, c.policy])) },
        overrides: overrides.get(uid) ?? {},
      });
    });
    p.put("/dev/config", (req, res) => {
      const body = DevOverridesSchema.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "bad_config", issues: body.error.issues });
      const known = new Set(caps.map((c) => c.id));
      const unknown = Object.keys(body.data.policies ?? {}).filter((k) => !known.has(k));
      if (unknown.length) return void res.status(400).json({ error: "unknown_capability", message: `Unknown capability: ${unknown.join(", ")}` });
      remember(overrides, userIdOf(req), body.data);
      res.json({ ok: true, manifest: manifest(userIdOf(req)) });
    });
    p.delete("/dev/config", (req, res) => { overrides.delete(userIdOf(req)); res.json({ ok: true }); });
    p.get("/dev/audit", (req, res) => res.json({ entries: audit.get(userIdOf(req)) ?? [] }));
    p.delete("/dev/audit", (req, res) => { audit.delete(userIdOf(req)); res.json({ ok: true }); });
  }

  router.use("/__pliant", p);

  return { router, capability, manifest: (userId?: string) => manifest(userId), store, enforcer };
}
export type Pliant = ReturnType<typeof createPliant>;
