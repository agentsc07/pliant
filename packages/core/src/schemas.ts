import { z } from "zod";

// ---------- Manifest ----------

export const Layer = z.enum(["L0", "L1", "L2", "L3", "L4"]);
export type Layer = z.infer<typeof Layer>;
export const LAYERS: Layer[] = ["L0", "L1", "L2", "L3", "L4"];

export const Dial = z.enum(["open", "restricted", "locked"]);
export type Dial = z.infer<typeof Dial>;

export const Effect = z.enum(["read", "write", "destructive", "external"]);
export type Effect = z.infer<typeof Effect>;

export const RateLimit = z.object({ count: z.number().int().positive(), perSeconds: z.number().positive() });
export type RateLimit = z.infer<typeof RateLimit>;

export const Policy = z.object({
  batchable: z.boolean(),
  maxFanOut: z.number().int().positive().nullable(),
  requiresConfirm: z.boolean(),
  rateLimit: RateLimit.nullable(),
  schedulable: z.boolean(),
});
export type Policy = z.infer<typeof Policy>;

export const ParamSpec = z.object({
  type: z.enum(["string", "number", "boolean", "any"]),
  optional: z.boolean().optional(),
});
export type ParamSpec = z.infer<typeof ParamSpec>;

export const CapabilityManifest = z.object({
  id: z.string(),
  description: z.string(),
  route: z.object({ method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), path: z.string() }),
  params: z.record(ParamSpec),
  entity: z.string(),
  effect: Effect,
  policy: Policy,
});
export type CapabilityManifest = z.infer<typeof CapabilityManifest>;

export const EntityManifest = z.object({
  id: z.string(),
  fields: z.record(z.enum(["string", "number", "boolean"])),
  relations: z.array(z.object({ kind: z.enum(["hasMany", "belongsTo"]), entity: z.string() })).default([]),
});
export type EntityManifest = z.infer<typeof EntityManifest>;

export const InvariantId = z.enum([
  "destructive-needs-confirm",
  "locked-visible",
  "external-shows-count",
]);
export type InvariantId = z.infer<typeof InvariantId>;

export const Manifest = z.object({
  app: z.string(),
  capabilities: z.array(CapabilityManifest),
  entities: z.array(EntityManifest),
  dials: z.record(Layer, Dial),
  locks: z.array(z.string()),
  invariants: z.array(InvariantId),
});
export type Manifest = z.infer<typeof Manifest>;

/** Policy defaults by effect (spec §3). Explicit values override. */
export function defaultPolicy(effect: Effect): Policy {
  switch (effect) {
    case "read":
      return { batchable: true, maxFanOut: null, requiresConfirm: false, rateLimit: null, schedulable: true };
    case "write":
      return { batchable: true, maxFanOut: null, requiresConfirm: false, rateLimit: null, schedulable: true };
    case "destructive":
      return { batchable: false, maxFanOut: 1, requiresConfirm: true, rateLimit: null, schedulable: false };
    case "external":
      return { batchable: true, maxFanOut: 5, requiresConfirm: true, rateLimit: null, schedulable: false };
  }
}

// ---------- Workflow DSL ----------

export type Step =
  | { type: "call"; capability: string; args: Record<string, unknown> }
  | { type: "forEach"; items: string | unknown[]; concurrency?: number; cap?: number; do: Step[] }
  | { type: "filter"; items: string; where: string; into: string }
  | { type: "confirm"; message: string; when?: string }
  | { type: "input"; name: string; prompt: string; kind?: "string" | "number" }
  | { type: "if"; cond: string; then: Step[]; else?: Step[] }
  | { type: "report" }
  | { type: "schedule"; every: string; do: Step[] };

export const Step: z.ZodType<Step> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("call"), capability: z.string(), args: z.record(z.unknown()).default({}) }),
    z.object({
      type: z.literal("forEach"),
      items: z.union([z.string(), z.array(z.unknown())]),
      concurrency: z.number().int().positive().max(16).optional(),
      cap: z.number().int().positive().optional(),
      do: z.array(Step),
    }),
    z.object({ type: z.literal("filter"), items: z.string(), where: z.string(), into: z.string() }),
    z.object({ type: z.literal("confirm"), message: z.string(), when: z.string().optional() }),
    z.object({ type: z.literal("input"), name: z.string(), prompt: z.string(), kind: z.enum(["string", "number"]).optional() }),
    z.object({ type: z.literal("if"), cond: z.string(), then: z.array(Step), else: z.array(Step).optional() }),
    z.object({ type: z.literal("report") }),
    z.object({ type: z.literal("schedule"), every: z.string(), do: z.array(Step) }),
  ]),
) as z.ZodType<Step>;

export const Workflow = z.object({
  id: z.string(),
  label: z.string(),
  input: z.object({ from: z.enum(["selection", "none"]), entity: z.string().optional() }),
  steps: z.array(Step),
});
export type Workflow = z.infer<typeof Workflow>;

// ---------- Patch ops ----------

export const Op = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setTheme"), theme: z.enum(["light", "dark"]) }),
  z.object({ op: z.literal("setToken"), token: z.string(), value: z.string() }),
  z.object({ op: z.literal("hide"), target: z.string() }),
  z.object({ op: z.literal("move"), target: z.string(), toSlot: z.string(), index: z.number().int().optional() }),
  z.object({ op: z.literal("resize"), target: z.string(), size: z.string() }),
  z.object({ op: z.literal("reorder"), slot: z.string(), by: z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }) }),
  z.object({
    op: z.literal("addComponent"),
    slot: z.string(),
    component: z.string(),
    props: z.record(z.unknown()).default({}),
    showWhen: z.string().optional(),
  }),
  z.object({ op: z.literal("enableSelection"), slot: z.string(), mode: z.enum(["single", "multi"]) }),
  z.object({
    op: z.literal("addView"),
    id: z.string(),
    title: z.string(),
    entity: z.string(),
    filter: z.string().optional(),
    columns: z.array(z.string()).optional(),
    component: z.string().optional(),
  }),
  z.object({ op: z.literal("addFilter"), slot: z.string(), label: z.string(), expr: z.string() }),
  z.object({ op: z.literal("addWorkflow"), workflow: z.string() }),
]);
export type Op = z.infer<typeof Op>;

export const OP_LAYER: Record<Op["op"], Layer> = {
  setTheme: "L0",
  setToken: "L0",
  hide: "L1",
  move: "L1",
  resize: "L1",
  reorder: "L1",
  addView: "L2",
  addFilter: "L2",
  addComponent: "L3",
  enableSelection: "L3",
  addWorkflow: "L3",
};

export const Patch = z.object({
  id: z.string(),
  layer: Layer,
  request: z.string(),
  createdAt: z.string(),
  enabled: z.boolean().default(true),
  ops: z.array(Op),
  workflows: z.array(Workflow).default([]),
});
export type Patch = z.infer<typeof Patch>;

export const Profile = z.object({ userId: z.string(), patches: z.array(Patch) });
export type Profile = z.infer<typeof Profile>;

// ---------- Classifier verdict ----------

export const Verdict = z.object({
  verdict: z.enum(["allow", "deny", "needs_clarification"]),
  layer: Layer,
  reason: z.string(),
  capabilitiesNeeded: z.array(z.string()).default([]),
  suggestion: z.string().optional(),
});
export type Verdict = z.infer<typeof Verdict>;
