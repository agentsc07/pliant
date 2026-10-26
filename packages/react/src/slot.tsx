import { evalBool } from "@pliant/core";
import {
  cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, type ReactElement, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { RenderComponent } from "./catalog";
import { usePliant } from "./context";

interface SlotCtx { slotId: string; mode: "single" | "multi" | null; selected: string[]; toggle: (id: string) => void }
const SlotContext = createContext<SlotCtx | null>(null);

function safeBool(expr: string, ctx: Record<string, unknown>) {
  try { return evalBool(expr, ctx); } catch { return false; }
}

function compare(field: string, dir: "asc" | "desc") {
  const m = dir === "asc" ? 1 : -1;
  return (a: any, b: any) => {
    const x = a?.[field], y = b?.[field];
    if (x === y) return 0;
    if (typeof x === "string" && typeof y === "string") return x.localeCompare(y) * m;
    return (Number(x) - Number(y)) * m;
  };
}

export interface SlotProps {
  id: string;
  /** Entity type of `data`; lets users add selection / filters / actions over items in place. */
  entity?: string;
  data?: any[];
  /** Locked elements can never be hidden, moved or resized by a profile. */
  locked?: boolean;
  children?: ReactNode;
}

/** An extension point. Renders the developer's default children plus whatever the user's profile adds. */
export function Slot({ id, entity, data, locked, children }: SlotProps) {
  const p = usePliant();
  const { resolved } = p;
  const { registerSlotData } = p;

  useEffect(() => {
    if (entity && data) registerSlotData(id, { entity, items: data });
  }, [id, entity, data, registerSlotData]);

  const targetRef = useCallback((el: HTMLDivElement | null) => p.setPortalTarget(id, el), [id, p.setPortalTarget]);

  const mode = resolved.selection[id] ?? null;
  const selected = p.selections[id] ?? [];
  const toggle = useCallback((itemId: string) => {
    const cur = p.selections[id] ?? [];
    if (mode === "single") p.setSelection(id, cur.includes(itemId) ? [] : [itemId]);
    else p.setSelection(id, cur.includes(itemId) ? cur.filter((x) => x !== itemId) : [...cur, itemId]);
  }, [id, mode, p.selections, p.setSelection]);
  const slotCtx = useMemo<SlotCtx>(() => ({ slotId: id, mode, selected, toggle }), [id, mode, selected, toggle]);

  const filters = resolved.filters[id] ?? [];
  const activeKeys = p.activeFilters[id] ?? [];
  const processed = useMemo(() => {
    if (!data) return undefined;
    let out = data;
    for (const f of filters) if (activeKeys.includes(f.key)) out = out.filter((i) => safeBool(f.expr, i));
    for (const t of resolved.toggles[id] ?? [])
      if (t.effect.kind === "filter" && (p.toggleStates[t.key] ?? t.defaultOn)) { const ex = t.effect.expr; out = out.filter((i) => safeBool(ex, i)); }
    const ro = resolved.reorders[id];
    if (ro) out = [...out].sort(compare(ro.field, ro.direction));
    const so = p.sorts[id];
    if (so) out = [...out].sort(compare(so.field, so.direction));
    return out;
  }, [data, filters, activeKeys, resolved.reorders, resolved.toggles, p.toggleStates, p.sorts, id]);

  if (resolved.hidden.has(id) && !locked) return null;

  let child: ReactNode = children;
  if (entity && data && processed && isValidElement(children)) {
    const el = children as ReactElement<any>;
    const key = Object.keys(el.props).find((k) => el.props[k] === data);
    if (key) child = cloneElement(el, { [key]: processed });
  }

  const sel = p.selectionSource ? { count: (p.selections[p.selectionSource] ?? []).length, ids: p.selections[p.selectionSource] ?? [] } : { count: 0, ids: [] };
  const added = (resolved.components[id] ?? []).filter((c) => !c.showWhen || safeBool(c.showWhen, { selection: sel }));

  const move = resolved.moves[id];
  const toggles = resolved.toggles[id] ?? [];
  const layout = resolved.layouts[id];
  const size = resolved.sizes[id];

  const content = (
    <SlotContext.Provider value={slotCtx}>
      <div className="pliant-slot" data-slot={id} data-size={size} data-testid={`slot-${id}`}>
        {filters.length > 0 && (
          <div className="pliant-filterbar" data-testid={`filters-${id}`}>
            {filters.map((f) => (
              <button
                key={f.key} className={"pliant-chip" + (activeKeys.includes(f.key) ? " on" : "")}
                aria-pressed={activeKeys.includes(f.key)} onClick={() => p.toggleFilter(id, f.key)}
              >{f.label}</button>
            ))}
          </div>
        )}
        {toggles.length > 0 && (
          <div className="pliant-toggles" data-testid={`toggles-${id}`}>
            {toggles.map((t) => {
              const on = p.toggleStates[t.key] ?? t.defaultOn;
              return (
                // A div, not a <label>: a label around a button re-dispatches the click and the switch would flip twice.
                <div key={t.key} className="pliant-toggle">
                  <span onClick={() => p.setToggle(t.key, !on)}>{t.label}</span>
                  <button role="switch" aria-checked={on} aria-label={t.label} className={"pliant-switch" + (on ? " on" : "")} data-testid={`toggle-${t.label}`} onClick={() => p.setToggle(t.key, !on)}><i /></button>
                </div>
              );
            })}
          </div>
        )}
        {layout && layout.layout !== "list" ? (
          <div className="pliant-layout" data-layout={layout.layout} style={{ ["--cols" as any]: layout.columns ?? 2 }}>{child}</div>
        ) : child}
        {added.map((c) => <RenderComponent key={c.key} component={c.component} props={c.props} slotId={id} />)}
        <div className="pliant-moved-in" ref={targetRef} />
      </div>
    </SlotContext.Provider>
  );

  if (move) {
    const target = p.portalTargets[move.toSlot];
    if (target) return createPortal(content, target);
  }
  return content;
}

/** Wrap one row/card of an entity list so users can select it when selection is enabled on the slot. */
export function Item({ id, children }: { id: string; children: ReactNode }) {
  const s = useContext(SlotContext);
  const p = usePliant();
  // addRule: style items whose data matches (highlight / dim / bold). Safe expressions only.
  const rules = s ? p.resolved.rules[s.slotId] ?? [] : [];
  const data = rules.length ? p.slotData[s!.slotId]?.items.find((i: any) => String(i.id) === id) : undefined;
  const hit = data ? rules.filter((r) => safeBool(r.when, data)).map((r) => `pliant-rule-${r.style}`).join(" ") : "";
  if (!s || !s.mode) return hit ? <div className={"pliant-ruled " + hit}>{children}</div> : <>{children}</>;
  const checked = s.selected.includes(id);
  return (
    <div
      className={"pliant-item" + (checked ? " selected" : "") + (hit ? " " + hit : "")} data-testid={`item-${id}`}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("input")) return;
        e.stopPropagation(); e.preventDefault(); s.toggle(id);
      }}
    >
      <input
        type={s.mode === "multi" ? "checkbox" : "radio"} checked={checked} onChange={() => s.toggle(id)}
        aria-label={`Select ${id}`} data-testid={`select-${id}`}
      />
      <div className="pliant-item-body">{children}</div>
    </div>
  );
}
