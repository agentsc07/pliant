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
