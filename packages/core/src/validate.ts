import { checkExpr, parseExpr, type Node } from "./expr";
import { checkWorkflow } from "./policy";
import { LAYERS, OP_LAYER, Patch, type Layer, type Manifest } from "./schemas";

export const BUILTIN_COMPONENTS = [
  "List", "Table", "Card", "Tabs", "SelectionBar", "ActionButton", "FilterBar", "Stat", "Chart", "SortControl", "ConfirmDialog", "ProgressToast",
];

/** Design tokens users may set (L0). Values are validated so they can never inject arbitrary CSS. */
export const TOKENS: Record<string, (v: string) => boolean> = {
  fontScale: (v) => /^\d+(\.\d+)?$/.test(v) && Number(v) >= 0.75 && Number(v) <= 2,
  density: (v) => ["compact", "comfortable", "spacious"].includes(v),
  accent: (v) => /^#[0-9a-fA-F]{6}$/.test(v),
  radius: (v) => /^\d{1,2}px$/.test(v),
  fontFamily: (v) => ["system", "serif", "mono"].includes(v),
  navPosition: (v) => ["left", "top"].includes(v),
};

export function tokenError(token: string, value: string): string | null {
  const check = TOKENS[token];
  if (!check) return `unknown token "${token}" (allowed: ${Object.keys(TOKENS).join(", ")})`;
  return check(value) ? null : `invalid value "${value}" for token ${token}`;
}

export interface ValidateContext {
  /** Component catalog; defaults to built-ins. */
  catalog?: string[];
  /** If given, slot ids referenced by ops must be among these. */
  slots?: string[];
  /** Workflow ids already available from other patches. */
  knownWorkflowIds?: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  patch?: Patch;
}

const layerIdx = (l: Layer) => LAYERS.indexOf(l);

function coversLock(target: string, lock: string) {
  return lock === target || lock.startsWith(target + ".");
}

function rootIdents(n: Node, out: Set<string> = new Set()): Set<string> {
  if (n.k === "path") out.add(n.p[0]);
  else if (n.k === "not") rootIdents(n.e, out);
  else if (n.k === "bin") { rootIdents(n.l, out); rootIdents(n.r, out); }
  return out;
}

export function validatePatch(input: unknown, manifest: Manifest, ctx: ValidateContext = {}): ValidationResult {
  const parsed = Patch.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `schema: ${i.path.join(".")}: ${i.message}`), warnings: [] };
  }
  const patch = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const catalog = ctx.catalog ?? BUILTIN_COMPONENTS;
  const slotOk = (s: string) => !ctx.slots || ctx.slots.includes(s);

  // Layer dial for the patch as a whole
  if (patch.layer === "L4" || manifest.dials[patch.layer] === "locked")
    errors.push(`layer ${patch.layer} is locked for this app — it needs the developer to add a capability`);

  const workflowIds = new Set([...(ctx.knownWorkflowIds ?? []), ...patch.workflows.map((w) => w.id)]);

  patch.ops.forEach((op, i) => {
    const at = `ops[${i}] ${op.op}`;
    const opLayer = OP_LAYER[op.op];
    if (layerIdx(opLayer) > layerIdx(patch.layer))
      errors.push(`${at}: belongs to ${opLayer} but patch is declared ${patch.layer}`);
    if (manifest.dials[opLayer] === "locked") errors.push(`${at}: layer ${opLayer} is locked`);

    const lockHit = (t: string) => manifest.locks.find((l) => coversLock(t, l));
    switch (op.op) {
      case "setToken": {
        const l = manifest.locks.find((l) => l === op.token);
        if (l) errors.push(`${at}: token "${op.token}" is locked`);
        const err = tokenError(op.token, op.value);
        if (err) errors.push(`${at}: ${err}`);
        break;
      }
      case "hide":
      case "move":
      case "resize": {
        const l = lockHit(op.target);
        if (l) errors.push(`${at}: "${op.target}" is locked (${l}) and cannot be changed`);
        if (op.op === "move" && !slotOk(op.toSlot)) errors.push(`${at}: unknown slot "${op.toSlot}"`);
        break;
      }
      case "reorder":
        if (!slotOk(op.slot)) errors.push(`${at}: unknown slot "${op.slot}"`);
        break;
      case "enableSelection":
      case "addFilter":
        if (!slotOk(op.slot)) errors.push(`${at}: unknown slot "${op.slot}"`);
        if (op.op === "addFilter") {
          const e = checkExpr(op.expr);
          if (e) errors.push(`${at}: ${e}`);
        }
        break;
      case "addComponent": {
        if (!slotOk(op.slot)) errors.push(`${at}: unknown slot "${op.slot}"`);
        if (!catalog.includes(op.component)) errors.push(`${at}: component "${op.component}" is not in the catalog`);
        if (op.showWhen) {
          const e = checkExpr(op.showWhen);
          if (e) errors.push(`${at}: showWhen ${e}`);
        }
        const actions = (op.props as { actions?: unknown }).actions;
        if (Array.isArray(actions))
          for (const a of actions)
            if (typeof a === "string" && !workflowIds.has(a)) errors.push(`${at}: action "${a}" references unknown workflow`);
        break;
      }
      case "addView": {
        const ent = manifest.entities.find((e) => e.id === op.entity);
        if (!ent) { errors.push(`${at}: unknown entity "${op.entity}"`); break; }
        for (const c of op.columns ?? [])
          if (!(c in ent.fields)) errors.push(`${at}: entity ${ent.id} has no readable field "${c}"`);
        if (op.filter) {
          try {
            for (const r of rootIdents(parseExpr(op.filter)))
              if (!(r in ent.fields) && !["true", "false", "null"].includes(r))
                errors.push(`${at}: filter references field "${r}" not readable on ${ent.id}`);
          } catch (e) { errors.push(`${at}: filter ${(e as Error).message}`); }
        }
        if (op.component && !catalog.includes(op.component)) errors.push(`${at}: component "${op.component}" is not in the catalog`);
        break;
      }
      case "addToggle": {
        if (!slotOk(op.slot)) errors.push(`${at}: unknown slot "${op.slot}"`);
        const eff = op.effect;
        if (eff.kind === "filter") { const e = checkExpr(eff.expr); if (e) errors.push(`${at}: ${e}`); }
        else if (eff.kind === "hide") { const l = lockHit(eff.target); if (l) errors.push(`${at}: "${eff.target}" is locked (${l}) and cannot be hidden`); }
        else {
          if (manifest.locks.includes(eff.token)) errors.push(`${at}: token "${eff.token}" is locked`);
          const err = tokenError(eff.token, eff.value);
          if (err) errors.push(`${at}: ${err}`);
        }
        break;
      }
      case "setLayout": {
        if (!slotOk(op.slot)) errors.push(`${at}: unknown slot "${op.slot}"`);
        const l = lockHit(op.slot);
        if (l) errors.push(`${at}: "${op.slot}" is locked (${l}) and cannot be changed`);
        break;
      }
      case "addRule": {
        if (!slotOk(op.slot)) errors.push(`${at}: unknown slot "${op.slot}"`);
        const e = checkExpr(op.when);
        if (e) errors.push(`${at}: when ${e}`);
        break;
      }
      case "addWorkflow":
        if (!workflowIds.has(op.workflow)) errors.push(`${at}: workflow "${op.workflow}" is not defined in this patch`);
        break;
      case "setTheme":
        break;
    }
  });

  // Workflows: static policy check + auto-fix
  const checked = patch.workflows.map((wf) => {
    const r = checkWorkflow(wf, manifest);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    return r.workflow;
  });

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, errors: [], warnings, patch: { ...patch, workflows: checked } };
}

/** Human-readable summary of what a patch changes (used by diff view). */
export function describePatch(patch: Patch): string[] {
  return patch.ops.map((op) => {
    switch (op.op) {
      case "setTheme": return `Theme → ${op.theme}`;
      case "setToken": return `Token ${op.token} = ${op.value}`;
      case "hide": return `Hide ${op.target}`;
      case "move": return `Move ${op.target} → ${op.toSlot}`;
      case "resize": return `Resize ${op.target} → ${op.size}`;
      case "reorder": return `Reorder ${op.slot} by ${op.by.field} ${op.by.direction}`;
      case "addComponent": return `Add ${op.component} to ${op.slot}${op.showWhen ? ` when ${op.showWhen}` : ""}`;
      case "enableSelection": return `Enable ${op.mode} selection on ${op.slot}`;
      case "addView": return `Add view "${op.title}" (${op.entity}${op.filter ? `: ${op.filter}` : ""})`;
      case "addFilter": return `Add filter "${op.label}" on ${op.slot}`;
      case "addWorkflow": return `Add workflow ${op.workflow}`;
      case "addToggle": return `Add toggle "${op.label}" to ${op.slot}`;
      case "setLayout": return `Lay out ${op.slot} as ${op.layout}${op.columns ? ` (${op.columns} columns)` : ""}`;
      case "addRule": return `Style items on ${op.slot} when ${op.when}: ${op.style}`;
    }
  });
}

const nice = (id: string, labels?: Record<string, string>) =>
  labels?.[id] ?? id.split(".").pop()!.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const TOKEN_WORDS: Record<string, (v: string) => string> = {
  fontScale: (v) => `Text size ${Math.round(Number(v) * 100)}%`,
  density: (v) => `${v[0].toUpperCase()}${v.slice(1)} spacing`,
  accent: (v) => `Accent colour ${v}`,
  radius: (v) => `Corner radius ${v}`,
  fontFamily: (v) => `${v[0].toUpperCase()}${v.slice(1)} font`,
  navPosition: (v) => (v === "top" ? "Move the sidebar to the top" : "Keep the sidebar on the left"),
};
const exprWords = (e: string) => e.replace(/\s*(>=|<=|==|!=|>|<)\s*/g, " $1 ").replace(/\band\b/g, "and").trim();

/** Plain-language summary of a patch for end users (no slot ids or op names). */
export function explainPatch(patch: Patch, labels?: Record<string, string>): string[] {
  return patch.ops.map((op) => {
    switch (op.op) {
      case "setTheme": return `Use ${op.theme} mode`;
      case "setToken": return (TOKEN_WORDS[op.token]?.(op.value)) ?? `Set ${op.token} to ${op.value}`;
      case "hide": return `Hide the ${nice(op.target, labels).toLowerCase()}`;
      case "move": return `Move the ${nice(op.target, labels).toLowerCase()} to the ${nice(op.toSlot, labels).toLowerCase()}`;
      case "resize": return `Make the ${nice(op.target, labels).toLowerCase()} ${op.size}`;
      case "reorder": return `Sort the ${nice(op.slot, labels).toLowerCase()} by ${op.by.field} (${op.by.direction === "desc" ? "highest first" : "lowest first"})`;
      case "addComponent": return op.component === "SortControl" ? `Add a sort control` : op.component === "SelectionBar" ? "Show a bar with bulk actions when items are selected" : `Add a ${op.component} to the ${nice(op.slot, labels).toLowerCase()}`;
      case "enableSelection": return `Let me select ${op.mode === "multi" ? "several" : "one"} item${op.mode === "multi" ? "s" : ""} in the ${nice(op.slot, labels).toLowerCase()}`;
      case "addView": return `Add a "${op.title}" tab${op.filter ? ` (${exprWords(op.filter)})` : ""}`;
      case "addFilter": return `Add a "${op.label}" filter chip`;
      case "addWorkflow": return `Add an action: ${op.workflow.replace(/^wf_/, "").replace(/_/g, " ")}`;
      case "addToggle": return `Add a "${op.label}" switch`;
      case "setLayout": return `Show the ${nice(op.slot, labels).toLowerCase()} as a ${op.layout === "grid" ? `grid${op.columns ? ` of ${op.columns} columns` : ""}` : op.layout === "row" ? "horizontal strip" : "list"}`;
      case "addRule": return `${op.style === "highlight" ? "Highlight" : op.style === "dim" ? "Dim" : "Bold"} items where ${exprWords(op.when)}`;
    }
  });
}
