import { describe, expect, it } from "vitest";
import { Enforcer } from "../src";

describe("Enforcer", () => {
  it("caps per-run fan-out per capability regardless of the declared fan-out", () => {
    const e = new Enforcer();
    const run = e.registerRun("u1", "wf", 1000);
    const res = Array.from({ length: 8 }, () => e.check({ userId: "u1", capId: "message.send", maxFanOut: 5, rateLimit: null, runId: run.id }));
    expect(res.filter((r) => r === null)).toHaveLength(5);
    expect(res[5]).toMatchObject({ status: 403, error: "pliant_fanout_exceeded" });
  });
  it("counts capabilities separately and leaves null maxFanOut unlimited", () => {
    const e = new Enforcer();
    const run = e.registerRun("u1", "wf", 50);
    for (let i = 0; i < 50; i++) expect(e.check({ userId: "u1", capId: "group.mute", maxFanOut: null, rateLimit: null, runId: run.id })).toBeNull();
  });
  it("sliding-window rate limit", () => {
    let t = 0;
    const e = new Enforcer(() => t);
    const rl = { count: 2, perSeconds: 10 };
    const c = () => e.check({ userId: "u", capId: "x", maxFanOut: null, rateLimit: rl });
    expect(c()).toBeNull(); expect(c()).toBeNull();
    expect(c()).toMatchObject({ status: 429 });
    t = 10_001;
    expect(c()).toBeNull();
  });
  it("expires runs", () => {
    let t = 0;
    const e = new Enforcer(() => t);
    const run = e.registerRun("u", "wf", 1);
    t = 11 * 60_000;
    e.registerRun("u", "other", 1); // triggers gc
    expect(e.check({ userId: "u", capId: "x", maxFanOut: 5, rateLimit: null, runId: run.id })).toMatchObject({ error: "pliant_unknown_run" });
  });
});
