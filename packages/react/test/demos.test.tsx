import { defaultPolicy, type Manifest, type Patch } from "@pliant/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Item, PliantProvider, Screen, Slot } from "../src";

const cap = (id: string, effect: any, params: any = { groupId: { type: "string" } }, path = "/groups/:groupId/mute") => ({
  id, description: id, route: { method: "POST" as const, path }, params, entity: "group", effect, policy: defaultPolicy(effect),
});
const manifest: Manifest = {
  app: "t",
  capabilities: [cap("group.mute", "write", { groupId: { type: "string" }, hours: { type: "number", optional: true } }), cap("group.archive", "write", { groupId: { type: "string" } }, "/groups/:groupId/archive")],
  entities: [{ id: "group", fields: { name: "string", unread: "number", pinned: "boolean" }, relations: [] }],
  dials: { L0: "open", L1: "open", L2: "open", L3: "restricted", L4: "locked" },
  locks: ["brand.logo"], invariants: ["destructive-needs-confirm", "locked-visible", "external-shows-count"],
};

const GROUPS = Array.from({ length: 6 }, (_, i) => ({ id: `g${i + 1}`, name: `Group ${i + 1}`, unread: i * 20, pinned: i === 4 }));

function TestApp() {
  return (
    <PliantProvider manifestUrl="/__pliant/manifest" userId="u1">
      <Screen id="chatList">
        <Slot id="brand.logo" locked><div data-testid="logo">Logo</div></Slot>
        <Slot id="chatList.header"><div>Header</div></Slot>
        <Slot id="chatList.stories"><div data-testid="stories">Stories</div></Slot>
        <Slot id="chatList.items" entity="group" data={GROUPS}>
          <List groups={GROUPS} />
        </Slot>
      </Screen>
    </PliantProvider>
  );
}
function List({ groups }: { groups: typeof GROUPS }) {
  return <div data-testid="list">{groups.map((g) => <Item key={g.id} id={g.id}><div data-testid={`row-${g.id}`}>{g.name}</div></Item>)}</div>;
}

let patches: Patch[] = [];
let calls: { url: string; init?: RequestInit }[] = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
    if (url.endsWith("/__pliant/manifest")) return ok(manifest);
    if (url.includes("/__pliant/profile/")) return ok({ patches });
    if (url.endsWith("/__pliant/run")) return ok({ runId: "run_1" });
    if (url.includes("/g3/")) return { ok: false, status: 403, json: async () => ({ message: "Only admins can mute" }) };
    return ok({ ok: true });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const P = (p: Partial<Patch> & Pick<Patch, "layer" | "ops">): Patch => ({ id: "p1", request: "r", createdAt: "x", enabled: true, workflows: [], ...p });
const ready = () => screen.findByTestId("logo");

describe("demo 1 — L0 look", () => {
  it("applies theme and tokens instantly", async () => {
    patches = [P({ layer: "L0", ops: [
      { op: "setTheme", theme: "dark" }, { op: "setToken", token: "fontScale", value: "1.2" }, { op: "setToken", token: "density", value: "compact" },
    ] })];
    const { container } = render(<TestApp />);
    await ready();
    const root = container.querySelector(".pliant-root") as HTMLElement;
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.fontSize).toBe("19.2px");
    expect(root.style.getPropertyValue("--row-pad")).toBe("4px");
  });
});

describe("demo 2 — L1 layout", () => {
  it("hides stories, reorders pinned first, but never hides a locked slot", async () => {
    patches = [P({ layer: "L1", ops: [
      { op: "hide", target: "chatList.stories" }, { op: "hide", target: "brand.logo" },
      { op: "reorder", slot: "chatList.items", by: { field: "pinned", direction: "desc" } },
    ] })];
    render(<TestApp />);
    await ready(); // logo still there despite a (bad) stored hide
    await waitFor(() => expect(screen.queryByTestId("stories")).toBeNull()); // profile loads after the manifest
    expect(screen.getByTestId("logo")).toBeTruthy();
    const rows = screen.getAllByTestId(/^row-/);
    expect(rows[0]).toHaveTextContent("Group 5");
  });
});

describe("demo 3 — L2 view", () => {
  it("adds a My views tab listing groups with >50 unread", async () => {
    patches = [P({ layer: "L2", ops: [{ op: "addView", id: "busy", title: "Busy", entity: "group", filter: "unread > 50", columns: ["name", "unread"] }] })];
    render(<TestApp />);
    await ready();
    await userEvent.click(await screen.findByTestId("tab-my-views"));
    const table = await screen.findByTestId("view-items");
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 3); // header + g4(60) g5(80) g6(100)
    expect(screen.getByTestId("view-title")).toHaveTextContent("Busy");
  });
});

describe("demo 4 — L3 selection + bulk mute", () => {
  const wfMute = {
    id: "wf_bulk_mute", label: "Mute selected", input: { from: "selection" as const, entity: "group" },
    steps: [
      { type: "confirm" as const, message: "Mute {{input.count}} groups?", when: "input.count > 10" },
      { type: "forEach" as const, items: "input", concurrency: 2, do: [{ type: "call" as const, capability: "group.mute", args: { groupId: "{{item.id}}", hours: 8 } }] },
      { type: "report" as const },
    ],
  };
  beforeEach(() => {
    patches = [P({ layer: "L3", workflows: [wfMute], ops: [
      { op: "enableSelection", slot: "chatList.items", mode: "multi" },
      { op: "addComponent", slot: "chatList.header", component: "SelectionBar", props: { actions: ["wf_bulk_mute"] }, showWhen: "selection.count > 0" },
      { op: "addWorkflow", workflow: "wf_bulk_mute" },
    ] })];
  });

  it("shows the bar only with a selection, runs with run header, reports partial failure and retries", async () => {
    render(<TestApp />);
    await ready();
    expect(screen.queryByTestId("selection-bar")).toBeNull();
    await userEvent.click(screen.getByTestId("select-g1"));
    await userEvent.click(screen.getByTestId("select-g2"));
    await userEvent.click(screen.getByTestId("select-g3"));
    expect(await screen.findByTestId("selection-count")).toHaveTextContent("3 selected");

    await userEvent.click(screen.getByTestId("action-wf_bulk_mute"));
    await waitFor(() => expect(screen.getByTestId("report-text")).toHaveTextContent("Mute selected: 2/3 done · 1 failed"));
    expect(screen.getByTestId("report-failures")).toHaveTextContent("Only admins can mute");

    const muteCalls = calls.filter((c) => c.url.endsWith("/mute"));
    expect(muteCalls).toHaveLength(3);
    expect(muteCalls.every((c) => (c.init?.headers as any)["x-pliant-run"] === "run_1")).toBe(true);
    expect(JSON.parse(muteCalls[0].init!.body as string)).toEqual({ hours: 8 });

    // selection cleared after the run; retry re-runs only the failed item
    expect(screen.queryByTestId("selection-bar")).toBeNull();
    await userEvent.click(screen.getByTestId("report-retry"));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith("/mute"))).toHaveLength(4));
  });

  it("asks for confirmation above the threshold and does nothing if declined", async () => {
    // 12 groups so input.count > 10
    patches[0].workflows[0] = { ...wfMute };
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `h${i}`, name: `H${i}`, unread: 0, pinned: false }));
    render(
      <PliantProvider manifestUrl="/__pliant/manifest" userId="u1">
        <Slot id="chatList.header"><div>h</div></Slot>
        <Slot id="chatList.items" entity="group" data={many}><List groups={many as any} /></Slot>
      </PliantProvider>,
    );
    await screen.findByTestId("row-h0");
    for (const g of many) await userEvent.click(screen.getByTestId(`select-${g.id}`));
    await userEvent.click(screen.getByTestId("action-wf_bulk_mute"));
    expect(await screen.findByTestId("dialog-message")).toHaveTextContent("Mute 12 groups?");
    await userEvent.click(screen.getByTestId("dialog-cancel"));
    await waitFor(() => expect(screen.getByTestId("report-text")).toHaveTextContent("Cancelled"));
    expect(calls.filter((c) => c.url.endsWith("/mute"))).toHaveLength(0);
  });
});

describe("layout + sort controls", () => {
  it("navPosition token sets data-nav on the root", async () => {
    patches = [P({ layer: "L0", ops: [{ op: "setToken", token: "navPosition", value: "top" }] })];
    const { container } = render(<TestApp />);
    await ready();
    await waitFor(() => expect(container.querySelector(".pliant-root")?.getAttribute("data-nav")).toBe("top"));
  });

  it("SortControl re-sorts the list in place", async () => {
    patches = [P({ layer: "L3", ops: [{ op: "addComponent", slot: "chatList.header", component: "SortControl", props: { slot: "chatList.items", fields: ["unread"] } }] })];
    render(<TestApp />);
    await ready();
    await userEvent.selectOptions(await screen.findByTestId("sort-field"), "unread");
    const order = () => within(screen.getByTestId("list")).getAllByTestId(/row-/).map((e) => e.textContent);
    expect(order()[0]).toBe("Group 6");
    await userEvent.click(screen.getByTestId("sort-direction"));
    expect(order()[0]).toBe("Group 1");
  });
});

describe("toggles, layouts and rules", () => {
  it("a filter toggle hides non-matching rows until switched on", async () => {
    patches = [P({ layer: "L2", ops: [{ op: "addToggle", slot: "chatList.items", label: "Busy only", effect: { kind: "filter", expr: "unread > 50" } }] })];
    render(<TestApp />);
    await ready();
    expect(screen.getAllByTestId(/^row-/)).toHaveLength(6);
    await userEvent.click(await screen.findByTestId("toggle-Busy only"));
    expect(screen.getAllByTestId(/^row-/).length).toBeLessThan(6);
    await userEvent.click(screen.getByTestId("toggle-Busy only"));
    expect(screen.getAllByTestId(/^row-/)).toHaveLength(6);
  });
  it("setLayout wraps the slot content in a grid; addRule marks matching rows", async () => {
    patches = [P({ layer: "L2", ops: [
      { op: "setLayout", slot: "chatList.items", layout: "grid", columns: 3 },
      { op: "addRule", slot: "chatList.items", when: "unread > 80", style: "highlight" },
    ] })];
    const { container } = render(<TestApp />);
    await ready();
    await waitFor(() => expect(container.querySelector(".pliant-layout[data-layout=grid]")).toBeTruthy());
    expect(container.querySelectorAll(".pliant-rule-highlight").length).toBeGreaterThan(0);
  });
  it("a hide toggle can't touch locked elements", async () => {
    patches = [P({ layer: "L2", ops: [{ op: "addToggle", slot: "chatList.items", label: "Hide logo", effect: { kind: "hide", target: "brand.logo" } }] })];
    render(<TestApp />);
    await ready();
    expect(screen.queryByTestId("toggle-Hide logo")).toBeNull();
    expect(screen.getByTestId("logo")).toBeTruthy();
  });
});
