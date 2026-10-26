import type { Verdict } from "@pliant/core";
import type { LLM, PipelineInput } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9>' ]+/g, " ").replace(/\s+/g, " ").trim();

interface Fixture {
  match: (q: string) => boolean;
  verdict: Omit<Verdict, "capabilitiesNeeded"> & { capabilitiesNeeded?: string[] };
  patch?: () => unknown;
}

const confirmCountMsg = (verb: string) => `${verb} {{input.count}} group(s)?`;

const FIXTURES: Fixture[] = [
  { // 1
    match: (q) => /dark/.test(q) && /(bigger|larger) text/.test(q),
    verdict: { verdict: "allow", layer: "L0", reason: "Theme and text size are yours to change." },
    patch: () => ({
      layer: "L0",
      ops: [
        { op: "setTheme", theme: "dark" },
        { op: "setToken", token: "fontScale", value: "1.25" },
        { op: "setToken", token: "density", value: "compact" },
      ],
    }),
  },
  { // 2
    match: (q) => /hide/.test(q) && /stories/.test(q),
    verdict: { verdict: "allow", layer: "L1", reason: "Hiding a panel and reordering a list are layout changes." },
    patch: () => ({
      layer: "L1",
      ops: [
        { op: "hide", target: "chatList.stories" },
        { op: "reorder", slot: "chatList.items", by: { field: "pinned", direction: "desc" } },
      ],
    }),
  },
  { // 3
    match: (q) => /tab/.test(q) && /50 unread/.test(q),
    verdict: { verdict: "allow", layer: "L2", reason: "A read-only saved view over your groups." },
    patch: () => ({
      layer: "L2",
      ops: [{ op: "addView", id: "busy_groups", title: "50+ unread", entity: "group", filter: "unread > 50", columns: ["name", "unread", "memberCount"] }],
    }),
  },
  { // 4
    match: (q) => /select/.test(q) && /(mute|archive)/.test(q) && !/diwali|message/.test(q),
    verdict: { verdict: "allow", layer: "L3", reason: "Selection plus batch actions built from existing group capabilities.", capabilitiesNeeded: ["group.mute", "group.archive"] },
    patch: () => ({
      layer: "L3",
      ops: [
        { op: "enableSelection", slot: "chatList.items", mode: "multi" },
        { op: "addComponent", slot: "chatList.header", component: "SelectionBar", props: { actions: ["wf_bulk_mute", "wf_bulk_archive"] }, showWhen: "selection.count > 0" },
        { op: "addWorkflow", workflow: "wf_bulk_mute" },
        { op: "addWorkflow", workflow: "wf_bulk_archive" },
      ],
      workflows: [
        {
          id: "wf_bulk_mute", label: "Mute selected", input: { from: "selection", entity: "group" },
          steps: [
            { type: "confirm", message: confirmCountMsg("Mute"), when: "input.count > 10" },
            { type: "forEach", items: "input", concurrency: 4, do: [{ type: "call", capability: "group.mute", args: { groupId: "{{item.id}}", hours: 8 } }] },
            { type: "report" },
          ],
        },
        {
          id: "wf_bulk_archive", label: "Archive selected", input: { from: "selection", entity: "group" },
          steps: [
            { type: "confirm", message: confirmCountMsg("Archive"), when: "input.count > 10" },
            { type: "forEach", items: "input", concurrency: 4, do: [{ type: "call", capability: "group.archive", args: { groupId: "{{item.id}}" } }] },
            { type: "report" },
          ],
        },
      ],
    }),
  },
  { // 5 — denied
    match: (q) => /send/.test(q) && /all (my )?groups/.test(q),
    verdict: {
      verdict: "deny", layer: "L3",
      reason: "Sending a message notifies other people, so message.send is limited to 5 groups per run. Messaging all your groups isn't allowed.",
      capabilitiesNeeded: ["message.send"],
      suggestion: "Let me select up to 5 groups and send them a message",
    },
  },
  { // 5b — the suggested alternative
    match: (q) => /select/.test(q) && /up to 5/.test(q) && /message/.test(q),
    verdict: { verdict: "allow", layer: "L3", reason: "A send action for up to 5 selected groups, with a confirmation showing the recipient count.", capabilitiesNeeded: ["message.send"] },
    patch: () => ({
      layer: "L3",
      ops: [
        { op: "enableSelection", slot: "chatList.items", mode: "multi" },
        { op: "addComponent", slot: "chatList.header", component: "SelectionBar", props: { actions: ["wf_send_selected"] }, showWhen: "selection.count > 0" },
        { op: "addWorkflow", workflow: "wf_send_selected" },
      ],
      workflows: [{
        id: "wf_send_selected", label: "Send message", input: { from: "selection", entity: "group" },
        steps: [
          { type: "input", name: "text", prompt: "What do you want to send?", kind: "string" },
          { type: "confirm", message: "Send this message to {{input.count}} group(s)?" },
          { type: "forEach", items: "input", cap: 5, concurrency: 1, do: [{ type: "call", capability: "message.send", args: { groupId: "{{item.id}}", text: "{{text}}" } }] },
          { type: "report" },
        ],
      }],
    }),
  },
  { // 6 — denied
    match: (q) => /delete/.test(q) && /groups/.test(q),
    verdict: {
      verdict: "deny", layer: "L3",
      reason: "group.delete can't be batched — it's destructive, so it has to be done one group at a time with a confirmation.",
      capabilitiesNeeded: ["group.delete"],
    },
  },
  { // 7 — denied
    match: (q) => /(remove|hide|delete|get rid of)/.test(q) && /logo/.test(q),
    verdict: { verdict: "deny", layer: "L1", reason: "The logo (brand.logo) is locked by the app's developer, so it can't be hidden, moved or restyled." },
  },
  { // 8 — denied
    match: (q) => /(video|voice) call/.test(q),
    verdict: {
      verdict: "deny", layer: "L4",
      reason: "This needs the developer to add a capability — Pliant can only combine what the backend can already do.",
    },
  },
];

/** Deterministic stand-in for both models, keyed on the demo requests. For tests and offline demos. */
export class MockLLM implements LLM {
  private find(request: string) { const q = norm(request); return FIXTURES.find((f) => f.match(q)); }

  async classify({ request }: PipelineInput): Promise<Verdict> {
    const f = this.find(request);
    if (!f) {
      return {
        verdict: "needs_clarification", layer: "L1", capabilitiesNeeded: [],
        reason: "Mock mode only understands the demo requests (dark mode, hide stories, 50+ unread tab, select & mute/archive, …). Set PLIANT_MOCK=0 and ANTHROPIC_API_KEY for free-form requests.",
      };
    }
    return { capabilitiesNeeded: [], ...f.verdict };
  }

  async generate({ request }: PipelineInput) {
    const f = this.find(request);
    if (!f?.patch) throw new Error("mock: no patch fixture for request");
    return f.patch();
  }
}
