// Manual check against a local Ollama: pnpm --filter @pliant/studio exec tsx test/ollama.live.ts
import { createCustomizer } from "../src";
import { BUILTIN_COMPONENTS, defaultPolicy } from "@pliant/core";

const cap = (id: string, effect: any, params: any, policy = {}) => ({ id, description: id, route: { method: "POST" as const, path: "/x" }, params, entity: "group", effect, policy: { ...defaultPolicy(effect), ...policy } });
const manifest: any = {
  app: "Groupy",
  capabilities: [
    cap("group.mute", "write", { groupId: { type: "string" }, hours: { type: "number", optional: true } }),
    cap("group.archive", "write", { groupId: { type: "string" } }),
    cap("group.delete", "destructive", { groupId: { type: "string" } }),
    cap("message.send", "external", { groupId: { type: "string" }, text: { type: "string" } }),
  ],
  entities: [{ id: "group", fields: { name: "string", unread: "number", pinned: "boolean", muted: "boolean" }, relations: [] }],
  dials: { L0: "open", L1: "open", L2: "open", L3: "restricted", L4: "locked" } as any,
  locks: ["brand.logo", "legal.footer", "billing.price"], invariants: ["destructive-needs-confirm", "locked-visible", "external-shows-count"] as any,
};
const slots = ["chatList.header", "chatList.stories", "chatList.items", "chatList.footer"];
const run = createCustomizer({ provider: "ollama" });
for (const request of process.argv.slice(2).length ? process.argv.slice(2) : [
  "Dark mode, bigger text, compact list", "Hide the stories bar, put pinned groups on top", "Give me a tab with groups that have more than 50 unread",
  "Let me select multiple groups and mute or archive them", "Send 'Happy Diwali' to all my groups", "Delete all groups I haven't opened in a month", "Remove the logo", "Add video calling",
]) {
  const t = Date.now();
  const r = await run({ request, userId: "u1", manifest, profile: [], slots, catalog: [...BUILTIN_COMPONENTS, "GroupRow"] });
  console.log(`\n# ${request}  (${((Date.now() - t) / 1000).toFixed(1)}s)\n  ${r.verdict.verdict} ${r.verdict.layer} — ${r.verdict.reason}`);
  if (r.patch) console.log("  patch ops:", JSON.stringify(r.patch.ops), r.patch.workflows.length ? `workflows: ${r.patch.workflows.map((w) => w.id)}` : "");
  if (r.errors) console.log("  validator errors:", r.errors);
}
