import type { AddressInfo } from "node:net";
import { createCustomizer } from "@pliant/studio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

let base = "";
let server: ReturnType<ReturnType<typeof createApp>["app"]["listen"]>;
beforeAll(async () => {
  server = createApp({ customize: createCustomizer({ mock: true }) }).app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const ask = async (request: string) =>
  (await fetch(base + "/__pliant/customize", { method: "POST", headers: { "content-type": "application/json", "x-user-id": "u1" }, body: JSON.stringify({ request }) })).json() as Promise<any>;

describe("customize pipeline in mock mode (demo script)", () => {
  it("#1 dark mode, bigger text, compact list → L0 patch", async () => {
    const r = await ask("Dark mode, bigger text, compact list");
    expect(r.verdict).toMatchObject({ verdict: "allow", layer: "L0" });
    expect(r.patch.ops.map((o: any) => o.op)).toEqual(["setTheme", "setToken", "setToken"]);
  });
  it("#2 hide stories, pinned on top → L1 patch", async () => {
    const r = await ask("Hide the stories bar, put pinned groups on top");
    expect(r.verdict).toMatchObject({ verdict: "allow", layer: "L1" });
  });
  it("#3 tab with >50 unread → L2 view", async () => {
    const r = await ask("Give me a tab with groups that have more than 50 unread");
    expect(r.verdict).toMatchObject({ verdict: "allow", layer: "L2" });
    expect(r.patch.ops[0]).toMatchObject({ op: "addView", filter: "unread > 50" });
  });
  it("#4 select multiple and mute/archive → L3 with two validated workflows", async () => {
    const r = await ask("Let me select multiple groups and mute or archive them");
    expect(r.verdict).toMatchObject({ verdict: "allow", layer: "L3" });
    expect(r.patch.workflows.map((w: any) => w.id)).toEqual(["wf_bulk_mute", "wf_bulk_archive"]);
  });
  it("#5 send to all groups → denied with a fan-out reason and a suggestion that is itself allowed", async () => {
    const r = await ask("Send 'Happy Diwali' to all my groups");
    expect(r.verdict.verdict).toBe("deny");
    expect(r.verdict.reason).toMatch(/5/);
    const alt = await ask(r.verdict.suggestion);
    expect(alt.verdict.verdict).toBe("allow");
    const wf = alt.patch.workflows[0];
    expect(wf.steps.find((s: any) => s.type === "forEach").cap).toBe(5);
  });
  it("#6 delete stale groups → denied (not batchable)", async () => {
    const r = await ask("Delete all groups I haven't opened in a month");
    expect(r.verdict.verdict).toBe("deny");
    expect(r.verdict.reason).toMatch(/batch/i);
    expect(r.patch).toBeUndefined();
  });
  it("#7 remove the logo → denied (locked)", async () => {
    const r = await ask("Remove the logo");
    expect(r.verdict.verdict).toBe("deny");
    expect(r.verdict.reason).toMatch(/locked/);
  });
  it("#8 add video calling → denied as L4", async () => {
    const r = await ask("Add video calling");
    expect(r.verdict).toMatchObject({ verdict: "deny", layer: "L4" });
    expect(r.verdict.reason).toMatch(/developer/);
  });
});
