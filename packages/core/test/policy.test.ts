import { describe, expect, it } from "vitest";
import { checkWorkflow } from "../src";
import { bulkMute, manifest, openL3, wf } from "./fixtures";

const call = (capability: string, args: Record<string, unknown> = { groupId: "{{item.id}}" }) => ({ type: "call" as const, capability, args });
const each = (items: any, ...doSteps: any[]) => ({ type: "forEach" as const, items, do: doSteps });

describe("workflow policy check (§6)", () => {
  it("accepts the spec's bulk mute example", () => {
    const r = checkWorkflow(bulkMute, manifest);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("rejects unknown capability", () => {
    expect(checkWorkflow(wf([call("nope")]), manifest).errors[0]).toMatch(/unknown capability/);
  });
  it("rejects bad args: unknown, missing, wrong type", () => {
    expect(checkWorkflow(wf([call("group.mute", { groupId: "g", bogus: 1 })]), manifest).errors.join()).toMatch(/no param "bogus"/);
    expect(checkWorkflow(wf([call("group.mute", {})]), manifest).errors.join()).toMatch(/missing required/);
    expect(checkWorkflow(wf([call("group.mute", { groupId: "g", hours: "eight" })]), manifest).errors.join()).toMatch(/expected number/);
  });
  it("rejects forEach over non-batchable capability", () => {
    const r = checkWorkflow(wf([{ type: "confirm", message: "sure?" }, each("input", call("group.delete"))]), manifest);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/not batchable/);
  });
  it("rejects static fan-out above maxFanOut", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: `g${i}` }));
    const r = checkWorkflow(wf([{ type: "confirm", message: "Send to {{input.count}}?" }, each(items, call("message.send", { groupId: "{{item.id}}", text: "hi" }))]), manifest);
    expect(r.errors.join()).toMatch(/fan-out 40 exceeds maxFanOut 5/);
  });
  it("inserts a runtime cap when fan-out is dynamic", () => {
    const r = checkWorkflow(wf([{ type: "confirm", message: "Send to {{input.count}}?" }, each("input", call("message.send", { groupId: "{{item.id}}", text: "hi" }))]), manifest);
    expect(r.ok).toBe(true);
    expect((r.workflow.steps[1] as any).cap).toBe(5);
  });
  it("rejects nested loops over capped capabilities", () => {
    const r = checkWorkflow(wf([{ type: "confirm", message: "{{input.count}}" }, each("input", each("item.sub", call("message.send", { groupId: "g", text: "x" })))]), manifest);
    expect(r.errors.join()).toMatch(/nested/);
  });
  it("auto-inserts confirm for destructive when L3 is open", () => {
    const r = checkWorkflow(wf([each("input", call("group.leave"))]), openL3);
    expect(r.ok).toBe(true);
    expect(r.workflow.steps[0].type).toBe("confirm");
  });
  it("rejects missing confirm when L3 is restricted", () => {
    const r = checkWorkflow(wf([each("input", call("group.leave"))]), manifest);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/explicit confirm/);
  });
  it("conditional confirm does not satisfy a destructive gate", () => {
    const r = checkWorkflow(wf([{ type: "confirm", message: "x", when: "input.count > 3" }, each("input", call("group.leave"))]), manifest);
    expect(r.ok).toBe(false);
  });
  it("external loop needs confirm showing the count", () => {
    const r = checkWorkflow(wf([{ type: "confirm", message: "Send?" }, each("input", call("message.send", { groupId: "g", text: "x" }))]), manifest);
    expect(r.errors.join()).toMatch(/recipient count/);
  });
  it("rejects schedule around non-schedulable capability", () => {
    const r = checkWorkflow(wf([{ type: "confirm", message: "x" }, { type: "schedule", every: "1d", do: [call("message.send", { groupId: "g", text: "x" })] }]), manifest);
    expect(r.errors.join()).toMatch(/not schedulable/);
  });
  it("allows schedule around schedulable capability", () => {
    const r = checkWorkflow(wf([{ type: "schedule", every: "1d", do: [call("group.archive", { groupId: "g" })] }], { from: "none" }), manifest);
    expect(r.ok).toBe(true);
  });
  it("rejects invalid expressions", () => {
    expect(checkWorkflow(wf([{ type: "if", cond: "a >", then: [] }]), manifest).ok).toBe(false);
  });
});
