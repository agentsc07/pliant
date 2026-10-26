import { describe, expect, it } from "vitest";
import { validatePatch } from "../src";
import { bulkMute, manifest, patch, wf } from "./fixtures";

const ok = (p: unknown) => validatePatch(p, manifest);

describe("validator: demo requests (hand-written patches)", () => {
  it("#1 dark mode, bigger text, compact → allowed (L0)", () => {
    expect(ok(patch({ layer: "L0", ops: [
      { op: "setTheme", theme: "dark" },
      { op: "setToken", token: "fontScale", value: "1.2" },
      { op: "setToken", token: "density", value: "compact" },
    ] })).ok).toBe(true);
  });
  it("#2 hide stories, pinned on top → allowed (L1)", () => {
    expect(ok(patch({ layer: "L1", ops: [
      { op: "hide", target: "chatList.stories" },
      { op: "reorder", slot: "chatList.items", by: { field: "pinned", direction: "desc" } },
    ] })).ok).toBe(true);
  });
  it("#3 view of groups with >50 unread → allowed (L2)", () => {
    expect(ok(patch({ layer: "L2", ops: [{ op: "addView", id: "v1", title: "Busy", entity: "group", filter: "unread > 50" }] })).ok).toBe(true);
  });
  it("#3b view filter on unreadable field → rejected", () => {
    expect(ok(patch({ layer: "L2", ops: [{ op: "addView", id: "v1", title: "x", entity: "group", filter: "secret > 1" }] })).ok).toBe(false);
  });
  it("#4 multiselect + bulk actions → allowed (L3, restricted but explicit)", () => {
    const archive = { ...bulkMute, id: "wf_bulk_archive", label: "Archive selected",
      steps: [{ type: "forEach" as const, items: "input", do: [{ type: "call" as const, capability: "group.archive", args: { groupId: "{{item.id}}" } }] }, { type: "report" as const }] };
    const r = ok(patch({ layer: "L3", workflows: [bulkMute, archive], ops: [
      { op: "enableSelection", slot: "chatList.items", mode: "multi" },
      { op: "addComponent", slot: "chatList.header", component: "SelectionBar", props: { actions: ["wf_bulk_mute", "wf_bulk_archive"] }, showWhen: "selection.count > 0" },
    ] }));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("#4b selection bar referencing missing workflow → rejected", () => {
    expect(ok(patch({ layer: "L3", ops: [{ op: "addComponent", slot: "s", component: "SelectionBar", props: { actions: ["wf_x"] } }] })).ok).toBe(false);
  });
  it("#5 send to many groups → rejected (static fan-out)", () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `g${i}` }));
    const w = wf([{ type: "confirm", message: "Send to {{input.count}}?" }, { type: "forEach", items, do: [{ type: "call", capability: "message.send", args: { groupId: "{{item.id}}", text: "Happy Diwali" } }] }]);
    expect(ok(patch({ layer: "L3", workflows: [w], ops: [{ op: "addWorkflow", workflow: "wf_t" }] })).ok).toBe(false);
  });
  it("#6 bulk delete → rejected (not batchable)", () => {
    const w = wf([{ type: "confirm", message: "Delete?" }, { type: "forEach", items: "input", do: [{ type: "call", capability: "group.delete", args: { groupId: "{{item.id}}" } }] }]);
    const r = ok(patch({ layer: "L3", workflows: [w], ops: [] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/not batchable/);
  });
  it("#7 remove logo → rejected (locked)", () => {
    const r = ok(patch({ layer: "L1", ops: [{ op: "hide", target: "brand.logo" }] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/locked/);
  });
  it("#7b hiding a parent of a locked element, moving, resizing → rejected", () => {
    expect(ok(patch({ layer: "L1", ops: [{ op: "hide", target: "legal" }] })).ok).toBe(false);
    expect(ok(patch({ layer: "L1", ops: [{ op: "move", target: "legal.footer", toSlot: "x" }] })).ok).toBe(false);
    expect(ok(patch({ layer: "L1", ops: [{ op: "resize", target: "billing.price", size: "small" }] })).ok).toBe(false);
  });
  it("#8 L4 → rejected", () => {
    const r = ok(patch({ layer: "L4", ops: [] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/developer/);
  });
});

describe("validator: structure", () => {
  it("rejects schema violations", () => {
    expect(ok({ id: "x" }).ok).toBe(false);
    expect(ok(patch({ layer: "L0", ops: [{ op: "bogus" } as any] })).ok).toBe(false);
  });
  it("op layer cannot exceed declared patch layer", () => {
    expect(ok(patch({ layer: "L0", ops: [{ op: "hide", target: "a" }] })).ok).toBe(false);
  });
  it("unknown component rejected", () => {
    expect(ok(patch({ layer: "L3", ops: [{ op: "addComponent", slot: "s", component: "Evil", props: {} }] })).ok).toBe(false);
  });
  it("slot ids checked when provided", () => {
    const r = validatePatch(patch({ layer: "L3", ops: [{ op: "enableSelection", slot: "nope", mode: "multi" }] }), manifest, { slots: ["chatList.items"] });
    expect(r.ok).toBe(false);
  });
  it("returns normalized workflows", () => {
    const w = wf([{ type: "forEach", items: "input", do: [{ type: "call", capability: "group.archive", args: { groupId: "{{item.id}}" } }] }]);
    const r = ok(patch({ layer: "L3", workflows: [w], ops: [] }));
    expect(r.ok).toBe(true);
    expect(r.patch?.workflows).toHaveLength(1);
  });
});

describe("validator: tokens", () => {
  it("accepts allowed tokens and rejects unknown/invalid ones (no CSS injection)", () => {
    expect(ok(patch({ layer: "L0", ops: [{ op: "setToken", token: "accent", value: "#ff8800" }] })).ok).toBe(true);
    expect(ok(patch({ layer: "L0", ops: [{ op: "setToken", token: "accent", value: "red; background:url(x)" }] })).ok).toBe(false);
    expect(ok(patch({ layer: "L0", ops: [{ op: "setToken", token: "zIndex", value: "9" }] })).ok).toBe(false);
    expect(ok(patch({ layer: "L0", ops: [{ op: "setToken", token: "fontScale", value: "9" }] })).ok).toBe(false);
  });
});

describe("validator: toggles, layouts, rules", () => {
  it("accepts a filter toggle, a grid layout and a highlight rule", () => {
    expect(ok(patch({ layer: "L2", ops: [
      { op: "addToggle", slot: "chatList.items", label: "Unread only", effect: { kind: "filter", expr: "unread > 0" } },
      { op: "setLayout", slot: "chatList.items", layout: "grid", columns: 2 },
      { op: "addRule", slot: "chatList.items", when: "unread > 100", style: "highlight" },
    ] })).ok).toBe(true);
  });
  it("rejects a toggle that hides a locked element or sets a bad token", () => {
    const r1 = ok(patch({ layer: "L2", ops: [{ op: "addToggle", slot: "chatList.items", label: "x", effect: { kind: "hide", target: "brand.logo" } }] }));
    expect(r1.ok).toBe(false);
    expect(r1.errors.join()).toMatch(/locked/);
    expect(ok(patch({ layer: "L2", ops: [{ op: "addToggle", slot: "chatList.items", label: "x", effect: { kind: "token", token: "accent", value: "url(evil)" } }] })).ok).toBe(false);
  });
  it("rejects bad expressions and layout on a locked slot", () => {
    expect(ok(patch({ layer: "L2", ops: [{ op: "addRule", slot: "chatList.items", when: "eval(1)", style: "dim" }] })).ok).toBe(false);
    expect(ok(patch({ layer: "L1", ops: [{ op: "setLayout", slot: "brand.logo", layout: "grid" }] })).ok).toBe(false);
  });
  it("op layers are enforced (a toggle needs L2)", () => {
    expect(ok(patch({ layer: "L1", ops: [{ op: "addToggle", slot: "chatList.items", label: "x", effect: { kind: "filter", expr: "unread > 0" } }] })).ok).toBe(false);
  });
});
