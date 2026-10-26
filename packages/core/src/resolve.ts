import type { Patch, Workflow } from "./schemas";

export interface ResolvedComponent {
  key: string;
  patchId: string;
  component: string;
  props: Record<string, unknown>;
  showWhen?: string;
}
export interface ResolvedView {
  patchId: string; id: string; title: string; entity: string; filter?: string; columns?: string[]; component?: string;
}
export interface ResolvedFilter { key: string; patchId: string; label: string; expr: string }

export interface ResolvedToggle {
  key: string; patchId: string; label: string; defaultOn: boolean;
  effect: { kind: "filter"; expr: string } | { kind: "hide"; target: string } | { kind: "token"; token: string; value: string };
}
export interface ResolvedRule { key: string; patchId: string; when: string; style: "highlight" | "dim" | "bold" }

export interface Resolved {
  toggles: Record<string, ResolvedToggle[]>;
  layouts: Record<string, { layout: "list" | "grid" | "row"; columns?: number }>;
  rules: Record<string, ResolvedRule[]>;
  theme: "light" | "dark" | null;
  tokens: Record<string, string>;
  hidden: Set<string>;
  moves: Record<string, { toSlot: string; index?: number }>;
  sizes: Record<string, string>;
  reorders: Record<string, { field: string; direction: "asc" | "desc" }>;
  components: Record<string, ResolvedComponent[]>;
  selection: Record<string, "single" | "multi">;
  views: ResolvedView[];
  filters: Record<string, ResolvedFilter[]>;
  workflows: Record<string, Workflow>;
}

export function emptyResolved(): Resolved {
  return { toggles: {}, layouts: {}, rules: {}, theme: null, tokens: {}, hidden: new Set(), moves: {}, sizes: {}, reorders: {}, components: {}, selection: {}, views: [], filters: {}, workflows: {} };
}

/**
 * Fold enabled patches (in order) over the developer default.
 * Later patches win for scalar settings; list-like ops accumulate.
 * `locks` is a defence-in-depth guard: the runtime never applies hide/move/resize to a locked element
 * even if a bad patch somehow reached storage.
 */
export function resolveProfile(patches: Patch[], opts: { locks?: string[] } = {}): Resolved {
  const r = emptyResolved();
  const locked = (t: string) => (opts.locks ?? []).some((l) => l === t || l.startsWith(t + "."));
  for (const p of patches) {
    if (!p.enabled) continue;
    for (const wf of p.workflows) r.workflows[wf.id] = wf;
    p.ops.forEach((op, i) => {
      const key = `${p.id}:${i}`;
      switch (op.op) {
        case "setTheme": r.theme = op.theme; break;
        case "setToken": r.tokens[op.token] = op.value; break;
        case "hide": if (!locked(op.target)) r.hidden.add(op.target); break;
        case "move": if (!locked(op.target)) r.moves[op.target] = { toSlot: op.toSlot, index: op.index }; break;
        case "resize": if (!locked(op.target)) r.sizes[op.target] = op.size; break;
        case "reorder": r.reorders[op.slot] = op.by; break;
        case "addComponent":
          (r.components[op.slot] ??= []).push({ key, patchId: p.id, component: op.component, props: op.props, showWhen: op.showWhen });
          break;
        case "enableSelection": r.selection[op.slot] = op.mode; break;
        case "addView":
          r.views.push({ patchId: p.id, id: op.id, title: op.title, entity: op.entity, filter: op.filter, columns: op.columns, component: op.component });
          break;
        case "addFilter": (r.filters[op.slot] ??= []).push({ key, patchId: p.id, label: op.label, expr: op.expr }); break;
        case "addWorkflow": break;
        case "addToggle":
          if (op.effect.kind === "hide" && locked(op.effect.target)) break;
          (r.toggles[op.slot] ??= []).push({ key, patchId: p.id, label: op.label, defaultOn: !!op.defaultOn, effect: op.effect });
          break;
        case "setLayout": if (!locked(op.slot)) r.layouts[op.slot] = { layout: op.layout, columns: op.columns }; break;
        case "addRule": (r.rules[op.slot] ??= []).push({ key, patchId: p.id, when: op.when, style: op.style }); break;
      }
    });
  }
  return r;
}
