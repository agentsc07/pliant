import { TOKENS, type Manifest, type Patch } from "@pliant/core";
import type { PipelineInput } from "./types";

export function manifestSummary(m: Manifest, slots?: string[], catalog?: string[]) {
  const caps = m.capabilities.map((c) => {
    const p = c.policy;
    const params = Object.entries(c.params).map(([k, v]) => `${k}${v.optional ? "?" : ""}:${v.type}`).join(", ");
    return `- ${c.id}(${params}) effect=${c.effect} batchable=${p.batchable} maxFanOut=${p.maxFanOut ?? "∞"} confirm=${p.requiresConfirm} schedulable=${p.schedulable}`;
  }).join("\n");
  const ents = m.entities.map((e) => `- ${e.id}: ${Object.entries(e.fields).map(([k, t]) => `${k}:${t}`).join(", ")}`).join("\n");
  return [
    `App: ${m.app}`,
    `Layer dials: ${Object.entries(m.dials).map(([l, d]) => `${l}=${d}`).join(" ")}`,
    `Locked elements (cannot be hidden/moved/resized/restyled): ${m.locks.join(", ") || "none"}`,
    `Capabilities:\n${caps}`,
    `Entities (readable fields):\n${ents}`,
    slots ? `Slots: ${slots.join(", ")}` : "",
    catalog ? `Component catalog: ${catalog.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

export const CLASSIFIER_SYSTEM = `You are the policy classifier for Pliant, a framework where end users customise an app by describing changes in natural language.
Decide quickly whether a request can be fulfilled, and which layer it belongs to:
L0 Look (theme, text size, colours, density) · L1 Layout (hide/move/resize panels, reorder lists, grid/row layout) · L2 Views (new tabs, saved filters, toggles/switches, highlight rules, read-only) · L3 Workflows (selection + batch actions, macros that call EXISTING capabilities) · L4 Capabilities (anything the backend cannot already do — never allowed).
Verdicts:
- "deny" for L4 requests (reason: this needs the developer to add a capability), requests touching locked elements, batching a non-batchable capability, or exceeding a capability's maxFanOut (name the limit in the reason).
- When denying only because of a fan-out limit, give a short "suggestion": a rephrased request the user could make instead (e.g. "Let me select up to 5 groups and send them a message").
- "allow" toggles/switches, grid layouts and highlight rules (supported).
- "allow" moving the sidebar/navigation to the top or horizontal (navPosition token), and adding sort controls — both are supported.
- Keep "reason" to ONE or TWO short plain sentences addressed to the user ("you"), never a restatement of these rules.
- "needs_clarification" if the request is ambiguous; ask one question in "reason".
- "allow" otherwise.
Deny requests that batch a capability with batchable=false (e.g. "delete all groups…" → group.delete is not batchable).
You are a friendly fast filter, not the security boundary — a deterministic validator checks everything later. Be accurate but do not agonise.`;

export const GENERATOR_SYSTEM = `You generate a Pliant "patch": pure JSON describing a user's customisation. You NEVER write code. Output only via the emit_patch tool.

Patch body: { "layer": "L0"|"L1"|"L2"|"L3", "ops": [...], "workflows": [...] }  (id/request/createdAt are added for you.)

Ops:
- {"op":"setTheme","theme":"light"|"dark"}
- {"op":"setToken","token":T,"value":V}  allowed tokens: ${Object.keys(TOKENS).join(", ")}  (fontScale 0.75–2 e.g. "1.25"; density compact|comfortable|spacious; accent "#rrggbb"; radius "12px"; fontFamily system|serif|mono; navPosition left|top — moves the whole sidebar to a horizontal bar across the top, or back)
- {"op":"hide","target":slotOrElementId} · {"op":"move","target":id,"toSlot":slot} · {"op":"resize","target":id,"size":"small"|"large"}
- {"op":"reorder","slot":slot,"by":{"field":F,"direction":"asc"|"desc"}}
- {"op":"addComponent","slot":slot,"component":C,"props":{...},"showWhen":"selection.count > 0"}   SelectionBar props: {"actions":[workflowIds]}. Stat props: {"label","entity","filter"}. SortControl props: {"slot":"chatList.items","fields":["name","unread"]} — adds an interactive "Sort by" dropdown the user can change any time (use this when the user wants a sort BUTTON/control; use reorder for a fixed order).
- {"op":"enableSelection","slot":slot,"mode":"single"|"multi"}   (slot should be an entity slot such as chatList.items)
- {"op":"addView","id":"snake_id","title":T,"entity":E,"filter":"unread > 50","columns":[fields]}  (filter fields must be readable entity fields)
- {"op":"addFilter","slot":slot,"label":L,"expr":"unread > 50"}
- {"op":"addToggle","slot":slot,"label":L,"defaultOn":false,"effect":{"kind":"filter","expr":"unread > 0"}}  a switch the user can flip any time; effect kind "filter" {expr} | "hide" {target} | "token" {token,value}. Use for "add a toggle/switch to …".
- {"op":"setLayout","slot":"chatList.items","layout":"list"|"grid"|"row","columns":2}   (grid/row = cards; columns 1-4)
- {"op":"addRule","slot":"chatList.items","when":"unread > 100","style":"highlight"|"dim"|"bold"}   style items matching a condition
- {"op":"addWorkflow","workflow":workflowId}  — every workflow in "workflows" must also be added with this op.
Each op has a minimum layer (setTheme/setToken L0; hide/move/resize/reorder/setLayout L1; addView/addFilter/addToggle/addRule L2; addComponent/enableSelection/addWorkflow L3); the patch "layer" must be at least the highest op layer.

Workflows: {"id":"wf_snake","label":"Mute selected","input":{"from":"selection","entity":"group"},"steps":[...]}
Steps: call{capability,args} · forEach{items:"input",concurrency?,cap?,do:[...]} · filter{items,where,into} · confirm{message,when?} · input{name,prompt,kind?} · if{cond,then,else?} · report · schedule{every:"1h",do:[...]}.
Args use templates like "{{item.id}}", "{{input.count}}", "{{someInputName}}". Expressions support field access, == != < <= > >=, and/or/not, parentheses, and ".count" on lists. No code.
Always end a bulk workflow with {"type":"report"}. Put a confirm before destructive/external capabilities; for external ones the confirm message must include {{input.count}}.
Respect each capability's batchable / maxFanOut / schedulable policy exactly.
Every item inside a "do"/"then"/"else" array is itself a step object and MUST have a "type" field. "concurrency" and "cap" are numbers.

Example — "let me select multiple groups and mute them" becomes:
{"layer":"L3","ops":[
 {"op":"enableSelection","slot":"chatList.items","mode":"multi"},
 {"op":"addComponent","slot":"chatList.header","component":"SelectionBar","props":{"actions":["wf_bulk_mute"]},"showWhen":"selection.count > 0"},
 {"op":"addWorkflow","workflow":"wf_bulk_mute"}],
 "workflows":[{"id":"wf_bulk_mute","label":"Mute selected","input":{"from":"selection","entity":"group"},"steps":[
  {"type":"confirm","message":"Mute {{input.count}} groups?","when":"input.count > 10"},
  {"type":"forEach","items":"input","concurrency":4,"do":[{"type":"call","capability":"group.mute","args":{"groupId":"{{item.id}}","hours":8}}]},
  {"type":"report"}]}]}
Example — "hide the stories bar and put pinned groups on top" needs TWO ops: {"op":"hide","target":"chatList.stories"} and {"op":"reorder","slot":"chatList.items","by":{"field":"pinned","direction":"desc"}}. Include every part of the request.

Example — "make the sidebar horizontal / move the sidebar to the top" is ONE op: {"layer":"L0","ops":[{"op":"setToken","token":"navPosition","value":"top"}],"workflows":[]}. Do NOT add unrelated ops (theme, resize) the user did not ask for.
Example — "add a sort button for name and unread count" is {"layer":"L3","ops":[{"op":"addComponent","slot":"chatList.header","component":"SortControl","props":{"slot":"chatList.items","fields":["name","unread"]}}],"workflows":[]}.

Example — "add a toggle to show only unread groups": {"layer":"L2","ops":[{"op":"addToggle","slot":"chatList.items","label":"Unread only","effect":{"kind":"filter","expr":"unread > 0"}}],"workflows":[]}.
Example — "show my groups as a grid": {"layer":"L1","ops":[{"op":"setLayout","slot":"chatList.items","layout":"grid","columns":2}],"workflows":[]}.

Only use slots, components, entities, fields and capabilities listed in the manifest summary. Prefer the smallest patch that satisfies the request.`;

export function profileSummary(profile: Patch[]) {
  if (!profile.length) return "(none)";
  return profile.map((p) => `- [${p.enabled ? "on" : "off"}] ${p.layer}: ${p.request}`).join("\n");
}

export function generatorUser(input: PipelineInput & { layer: string; previousErrors?: string[]; previousOutput?: unknown }) {
  return [
    `Manifest summary:\n${manifestSummary(input.manifest, input.slots, input.catalog)}`,
    `Current profile:\n${profileSummary(input.profile)}`,
    `Classifier layer: ${input.layer}`,
    `User request: ${input.request}`,
    input.previousErrors?.length
      ? `Your previous attempt was rejected by the validator.\nPrevious output: ${JSON.stringify(input.previousOutput)}\nErrors:\n${input.previousErrors.map((e) => `- ${e}`).join("\n")}\nFix these and emit a corrected patch.`
      : "",
  ].filter(Boolean).join("\n\n");
}
