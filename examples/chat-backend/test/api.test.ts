import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

let base = "";
let server: ReturnType<ReturnType<typeof createApp>["app"]["listen"]>;
beforeAll(async () => {
  const { app } = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const call = (path: string, init: RequestInit & { user?: string; run?: string } = {}) =>
  fetch(base + path, {
    ...init,
    headers: {
      "content-type": "application/json", "x-user-id": init.user ?? "u1",
      ...(init.run ? { "x-pliant-run": init.run } : {}),
    },
  });
const json = async (r: Response) => r.json() as Promise<any>;
const newRun = async (workflowId: string, fanOut: number, user = "u1") =>
  (await json(await call("/__pliant/run", { method: "POST", user, body: JSON.stringify({ workflowId, fanOut }) }))).runId as string;

describe("backend (classic API)", () => {
  it("seeds 40 groups for a user", async () => {
    const groups = await json(await call("/groups"));
    expect(groups).toHaveLength(40);
    expect(groups.filter((g: any) => g.unread > 50).length).toBeGreaterThan(0);
  });
  it("mute / archive / pin / markRead work without Pliant headers", async () => {
    expect((await call("/groups/g3/mute", { method: "POST", body: JSON.stringify({ hours: 2 }) })).status).toBe(200);
    expect((await call("/groups/g3/archive", { method: "POST", body: "{}" })).status).toBe(200);
    const g = await json(await call("/groups/g3"));
    expect(g.muted).toBe(true);
    expect(g.archived).toBe(true);
  });
  it("admin-only groups fail to mute (partial-failure demo)", async () => {
    const groups = await json(await call("/groups"));
    const ann = groups.find((g: any) => g.name === "Office Announcements");
    const r = await call(`/groups/${ann.id}/mute`, { method: "POST", body: "{}" });
    expect(r.status).toBe(403);
  });
});

describe("manifest", () => {
  it("publishes capabilities with default/explicit policy", async () => {
    const m = await json(await call("/__pliant/manifest"));
    const byId = Object.fromEntries(m.capabilities.map((c: any) => [c.id, c]));
    expect(byId["message.send"].policy).toMatchObject({ maxFanOut: 5, requiresConfirm: true });
    expect(byId["group.delete"].policy.batchable).toBe(false);
    expect(byId["group.mute"].params.hours).toEqual({ type: "number", optional: true });
    expect(m.locks).toContain("brand.logo");
  });
});

describe("demo #9: tampered client", () => {
  it("rejects message.send calls beyond 5 in one run, whatever the client declares", async () => {
    const runId = await newRun("wf_evil", 20);
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await call(`/groups/g${i + 1}/messages`, { method: "POST", run: runId, body: JSON.stringify({ text: "Happy Diwali" }) });
      statuses.push(r.status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.slice(5).every((s) => s === 403)).toBe(true);
  });
  it("rejects an unknown run id", async () => {
    const r = await call("/groups/g1/messages", { method: "POST", run: "run_fake", body: JSON.stringify({ text: "x" }) });
    expect(r.status).toBe(403);
  });
  it("rejects using another user's run", async () => {
    const runId = await newRun("wf", 1, "u2");
    const r = await call("/groups/g1/messages", { method: "POST", run: runId, body: JSON.stringify({ text: "x" }) });
    expect(r.status).toBe(403);
  });
  it("uncapped capabilities are unlimited inside a run", async () => {
    const runId = await newRun("wf_bulk_mute", 40);
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => call(`/groups/g${i + 4}/archive`, { method: "POST", run: runId, body: "{}" })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
  });
  it("applies the rate limit regardless of run header", async () => {
    // u3 has its own window; 30 allowed per 60s, the 31st is rejected.
    const out: number[] = [];
    for (let i = 0; i < 31; i++) {
      out.push((await call(`/groups/g${(i % 5) + 1}/messages`, { method: "POST", user: "u3", body: JSON.stringify({ text: "hi" }) })).status);
    }
    expect(out.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(out[30]).toBe(429);
  });
});

describe("profile store", () => {
  const patch = { layer: "L0", request: "dark", createdAt: "2026-01-01", ops: [{ op: "setTheme", theme: "dark" }] };
  it("stores, lists, toggles, deletes, resets", async () => {
    expect((await call("/__pliant/profile/u1/patches/p1", { method: "PUT", body: JSON.stringify(patch) })).status).toBe(200);
    expect((await json(await call("/__pliant/profile/u1"))).patches).toHaveLength(1);
    await call("/__pliant/profile/u1/patches/p1", { method: "PUT", body: JSON.stringify({ ...patch, enabled: false }) });
    expect((await json(await call("/__pliant/profile/u1"))).patches[0].enabled).toBe(false);
    expect((await call("/__pliant/profile/u1/patches/p1", { method: "DELETE" })).status).toBe(200);
    await call("/__pliant/profile/u1/patches/p2", { method: "PUT", body: JSON.stringify(patch) });
    await call("/__pliant/profile/u1", { method: "DELETE" });
    expect((await json(await call("/__pliant/profile/u1"))).patches).toHaveLength(0);
  });
  it("refuses patches that fail validation (server is the boundary)", async () => {
    const bad = { ...patch, layer: "L1", ops: [{ op: "hide", target: "brand.logo" }] };
    const r = await call("/__pliant/profile/u1/patches/p9", { method: "PUT", body: JSON.stringify(bad) });
    expect(r.status).toBe(422);
  });
});

describe("visitor sessions", () => {
  it("each visitor gets their own fresh copy; their messages and state stay private", async () => {
    const a = "v_aaaa1111", b = "v_bbbb2222";
    const ga = await json(await call("/groups", { user: a }));
    expect(ga).toHaveLength(40);
    await call("/groups/g1/pin", { method: "POST", user: a, body: JSON.stringify({ pinned: true }) });
    await call("/groups/g1/messages", { method: "POST", user: a, body: JSON.stringify({ text: "only visitor a sees this" }) });
    const seen = async (u: string) => (await json(await call("/groups/g1/messages", { user: u }))).map((m: any) => m.text);
    expect(await seen(a)).toContain("only visitor a sees this");
    expect(await seen(b)).not.toContain("only visitor a sees this");
    expect(await seen("u1")).not.toContain("only visitor a sees this");
    expect((await json(await call("/groups/g1", { user: b }))).pinned).toBe(false);
    // seeded messages show up as the visitor's own (they are a clone of u1)
    expect((await json(await call("/groups/g1/messages", { user: a }))).some((m: any) => m.userId === a)).toBe(true);
  });

  it("rejects malformed visitor ids (no accidental row creation)", async () => {
    const r = await call("/groups", { user: "v_;drop table" });
    expect((await json(r))).toEqual([]);
  });
});

describe("developer sandbox", () => {
  it("per-session policy overrides apply only to that session and are enforced server-side", async () => {
    const dev = "v_dev00001", other = "v_dev00002";
    const put = await call("/__pliant/dev/config", { method: "PUT", user: dev, body: JSON.stringify({ policies: { "message.send": { maxFanOut: 1 } } }) });
    expect(put.status).toBe(200);
    const run = await newRun("wf", 5, dev);
    const send = (u: string, g: string, r?: string) => call(`/groups/${g}/messages`, { method: "POST", user: u, run: r, body: JSON.stringify({ text: "hi" }) });
    expect((await send(dev, "g1", run)).status).toBe(200);
    expect((await send(dev, "g2", run)).status).toBe(403); // tightened to 1 per run for this session
    const run2 = await newRun("wf", 5, other);
    for (const g of ["g1", "g2", "g3"]) expect((await send(other, g, run2)).status).toBe(200); // untouched
    const m = await json(await call("/__pliant/manifest", { user: dev }));
    expect(m.capabilities.find((c: any) => c.id === "message.send").policy.maxFanOut).toBe(1);
    const m2 = await json(await call("/__pliant/manifest", { user: other }));
    expect(m2.capabilities.find((c: any) => c.id === "message.send").policy.maxFanOut).toBe(5);
  });
  it("rejects unknown capabilities and malformed config", async () => {
    expect((await call("/__pliant/dev/config", { method: "PUT", user: "v_dev00003", body: JSON.stringify({ policies: { "nope.x": { maxFanOut: 2 } } }) })).status).toBe(400);
    expect((await call("/__pliant/dev/config", { method: "PUT", user: "v_dev00003", body: JSON.stringify({ dials: { L0: "wide-open" } }) })).status).toBe(400);
  });
  it("locks can be changed per session and are enforced by the validator", async () => {
    const dev = "v_dev00004";
    await call("/__pliant/dev/config", { method: "PUT", user: dev, body: JSON.stringify({ locks: ["brand.logo", "chatList.stories"] }) });
    const patch = { id: "p1", layer: "L1", request: "r", createdAt: "x", enabled: true, workflows: [], ops: [{ op: "hide", target: "chatList.stories" }] };
    expect((await call(`/__pliant/profile/${dev}/patches/p1`, { method: "PUT", user: dev, body: JSON.stringify(patch) })).status).toBe(422);
    expect((await call(`/__pliant/profile/u2/patches/p1`, { method: "PUT", user: "u2", body: JSON.stringify(patch) })).status).toBe(200);
  });
});
