import { defaultPolicy, type CapabilityManifest, type Effect, type Manifest, type Patch, type Workflow } from "../src";

function cap(id: string, effect: Effect, params: CapabilityManifest["params"], policy: Partial<CapabilityManifest["policy"]> = {}): CapabilityManifest {
  return {
    id, description: id, route: { method: "POST", path: "/x" }, params, entity: "group", effect,
    policy: { ...defaultPolicy(effect), ...policy },
  };
}

export const manifest: Manifest = {
  app: "groupy",
  capabilities: [
    cap("group.list", "read", {}),
    cap("group.mute", "write", { groupId: { type: "string" }, hours: { type: "number", optional: true } }),
    cap("group.archive", "write", { groupId: { type: "string" } }),
    cap("group.leave", "destructive", { groupId: { type: "string" } }, { batchable: true, maxFanOut: null }),
    cap("group.delete", "destructive", { groupId: { type: "string" } }),
    cap("message.send", "external", { groupId: { type: "string" }, text: { type: "string" } }, { rateLimit: { count: 30, perSeconds: 60 } }),
  ],
  entities: [{ id: "group", fields: { name: "string", unread: "number", pinned: "boolean", muted: "boolean" }, relations: [] }],
  dials: { L0: "open", L1: "open", L2: "open", L3: "restricted", L4: "locked" },
  locks: ["brand.logo", "legal.footer", "billing.price"],
  invariants: ["destructive-needs-confirm", "locked-visible", "external-shows-count"],
};

export const openL3: Manifest = { ...manifest, dials: { ...manifest.dials, L3: "open" } };

export function patch(partial: Partial<Patch> & Pick<Patch, "layer" | "ops">): Patch {
  return { id: "p1", request: "test", createdAt: "2026-01-01", enabled: true, workflows: [], ...partial };
}

export const bulkMute: Workflow = {
  id: "wf_bulk_mute", label: "Mute selected", input: { from: "selection", entity: "group" },
  steps: [
    { type: "confirm", message: "Mute {{input.count}} groups?", when: "input.count > 10" },
    { type: "forEach", items: "input", concurrency: 4, do: [{ type: "call", capability: "group.mute", args: { groupId: "{{item.id}}", hours: 8 } }] },
    { type: "report" },
  ],
};

export function wf(steps: Workflow["steps"], input: Workflow["input"] = { from: "selection", entity: "group" }): Workflow {
  return { id: "wf_t", label: "t", input, steps };
}
