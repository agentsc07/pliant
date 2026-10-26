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

export interface PliantOptions {
  app: string;
  dbPath?: string;
  entities?: EntityManifest[];
  dials?: Partial<Record<Layer, Dial>>;
  locks?: string[];
  invariants?: InvariantId[];
  customize?: CustomizeHandler;
  /** Slot ids / component catalog the frontend registers; forwarded to validation. */
  slots?: string[];
  catalog?: string[];
}

export function userIdOf(req: Request): string {
  return (req.header("x-user-id") ?? (req.query.userId as string | undefined) ?? "anonymous").toString();
}

export function createPliant(opts: PliantOptions) {
  const router: Router = express.Router();
  const caps: CapabilityManifest[] = [];
  const store = new ProfileStore(opts.dbPath);
  const enforcer = new Enforcer();

  const manifest = (): Manifest => ({
    app: opts.app,
    capabilities: caps,
    entities: opts.entities ?? [],
    dials: { L0: "open", L1: "open", L2: "open", L3: "restricted", L4: "locked", ...opts.dials },
    locks: opts.locks ?? [],
    invariants: opts.invariants ?? ["destructive-needs-confirm", "locked-visible", "external-shows-count"],
  });

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
        const denial = enforcer.check({
          userId: userIdOf(req), capId: def.id, maxFanOut: policy.maxFanOut, rateLimit: policy.rateLimit,
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
  p.get("/manifest", (_req, res) => res.json(manifest()));

  p.post("/run", (req, res) => {
    const body = z.object({ workflowId: z.string(), fanOut: z.number().int().nonnegative() }).safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "bad_run", issues: body.error.issues });
    const run = enforcer.registerRun(userIdOf(req), body.data.workflowId, body.data.fanOut);
    res.json({ runId: run.id });
  });

  p.get("/profile/:userId", (req, res) => res.json({ userId: req.params.userId, patches: store.list(req.params.userId) }));
  p.put("/profile/:userId/patches/:id", (req, res) => {
    const v = validatePatch({ ...req.body, id: req.params.id }, manifest(), {
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
      res.json(await opts.customize({ request: body.data.request, userId, manifest: manifest(), profile: store.list(userId), slots: opts.slots, catalog: opts.catalog, byok }));
    } catch (e) { next(e); }
  });

  router.use("/__pliant", p);

  return { router, capability, manifest, store, enforcer };
}
export type Pliant = ReturnType<typeof createPliant>;
