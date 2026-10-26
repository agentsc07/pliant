import { describe, expect, it, vi } from "vitest";
import { resolveProfile, runWorkflow, type RunIO } from "../src";
import { bulkMute, manifest, patch, wf } from "./fixtures";

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `g${i}` }));
const io = (over: Partial<RunIO> = {}): RunIO => ({ call: async () => ({}), confirm: async () => true, ask: async () => "x", ...over });

describe("runWorkflow", () => {
  it("runs forEach with concurrency and reports", async () => {
    const calls: unknown[] = [];
    const r = await runWorkflow(bulkMute, manifest, items(20), io({ call: async (c, a) => void calls.push([c, a]) }));
    expect(r.status).toBe("done");
    expect(calls).toHaveLength(20);
    expect(calls[0]).toEqual(["group.mute", { groupId: "g0", hours: 8 }]);
    expect(r.summary?.text).toBe("Mute selected: 20/20 done");
  });
  it("partial failure summary + failed items for retry", async () => {
    const r = await runWorkflow(bulkMute, manifest, items(20), io({
      confirm: async () => true,
      call: async (_c, a) => { if (["g3", "g9"].includes(a.groupId as string)) throw new Error("admins only"); },
    }));
    expect(r.summary).toMatchObject({ ok: 18, failed: 2, total: 20 });
    expect(r.summary?.text).toBe("Mute selected: 18/20 done · 2 failed");
    expect(r.failedItems).toEqual([{ id: "g3" }, { id: "g9" }]);
  });
  it("confirm only when condition holds; decline cancels without calls", async () => {
    const confirm = vi.fn(async () => false);
    const call = vi.fn(async () => ({}));
    expect((await runWorkflow(bulkMute, manifest, items(5), io({ confirm, call }))).status).toBe("done");
    expect(confirm).not.toHaveBeenCalled();
    const r = await runWorkflow(bulkMute, manifest, items(11), io({ confirm, call }));
    expect(confirm).toHaveBeenCalledWith("Mute 11 groups?");
    expect(r.status).toBe("cancelled");
    expect(call).toHaveBeenCalledTimes(5);
  });
  it("enforces runtime cap before any call", async () => {
    const w = wf([{ type: "confirm", message: "{{input.count}}" }, { type: "forEach", items: "input", cap: 5, do: [{ type: "call", capability: "message.send", args: { groupId: "{{item.id}}", text: "x" } }] }]);
    const call = vi.fn(async () => ({}));
    const r = await runWorkflow(w, manifest, items(8), io({ call }));
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/at most 5/);
    expect(call).not.toHaveBeenCalled();
  });
  it("supports filter / if / input", async () => {
    const w = wf([
      { type: "input", name: "hours", prompt: "Hours?", kind: "number" },
      { type: "filter", items: "input", where: "item.unread > 50", into: "busy" },
      { type: "if", cond: "busy.count > 0", then: [{ type: "forEach", items: "busy", do: [{ type: "call", capability: "group.mute", args: { groupId: "{{item.id}}", hours: "{{hours}}" } }] }] },
    ]);
    const calls: any[] = [];
    await runWorkflow(w, manifest, [{ id: "a", unread: 80 }, { id: "b", unread: 1 }], io({ ask: async () => 3, call: async (_c, a) => void calls.push(a) }));
    expect(calls).toEqual([{ groupId: "a", hours: 3 }]);
  });
});

describe("resolveProfile", () => {
  it("folds enabled patches in order; later wins", () => {
    const r = resolveProfile([
      patch({ id: "a", layer: "L0", ops: [{ op: "setTheme", theme: "dark" }, { op: "setToken", token: "fontScale", value: "1.2" }] }),
      patch({ id: "b", layer: "L0", ops: [{ op: "setTheme", theme: "light" }] }),
      patch({ id: "c", layer: "L1", enabled: false, ops: [{ op: "hide", target: "chatList.stories" }] }),
    ]);
    expect(r.theme).toBe("light");
    expect(r.tokens.fontScale).toBe("1.2");
    expect(r.hidden.size).toBe(0);
  });
  it("never applies hide to a locked element even if stored", () => {
    const r = resolveProfile([patch({ layer: "L1", ops: [{ op: "hide", target: "brand.logo" }, { op: "hide", target: "x" }] })], { locks: ["brand.logo"] });
    expect([...r.hidden]).toEqual(["x"]);
  });
});
