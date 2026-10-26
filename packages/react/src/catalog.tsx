import { evalBool, type Resolved } from "@pliant/core";
import { useMemo, useState, type ReactNode } from "react";
import { usePliant } from "./context";
import { getRegistered } from "./registry";

function safeBool(expr: string | undefined, ctx: Record<string, unknown>) {
  if (!expr) return true;
  try { return evalBool(expr, ctx); } catch { return false; }
}

function itemsOf(p: ReturnType<typeof usePliant>, entity: string, filter?: string) {
  const src = Object.values(p.slotData).find((d) => d.entity === entity);
  return (src?.items ?? []).filter((i) => safeBool(filter, i));
}

function fmt(v: unknown): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v == null) return "—";
  return String(v);
}

export function EntityTable({ entity, columns, filter, component }: { entity: string; columns?: string[]; filter?: string; component?: string }) {
  const p = usePliant();
  const items = itemsOf(p, entity, filter);
  const ent = p.manifest?.entities.find((e) => e.id === entity);
  const cols = columns ?? (ent ? Object.keys(ent.fields).slice(0, 3) : []);
  const Reg = component ? getRegistered(component) : undefined;
  if (Reg) {
    const C = Reg.component;
    return <div className="pliant-list" data-testid="view-items">{items.map((i) => <C key={i.id} {...{ [Reg.itemProp]: i }} />)}{items.length === 0 && <div className="pliant-empty">Nothing matches</div>}</div>;
  }
  return (
    <table className="pliant-table" data-testid="view-items">
      <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {items.map((i) => <tr key={i.id}>{cols.map((c) => <td key={c}>{fmt(i[c])}</td>)}</tr>)}
        {items.length === 0 && <tr><td colSpan={Math.max(cols.length, 1)} className="pliant-empty">Nothing matches</td></tr>}
      </tbody>
    </table>
  );
}

function SelectionBar({ actions = [], slotId }: { actions?: string[]; slotId: string }) {
  const p = usePliant();
  const src = p.selectionSource;
  const ids = src ? p.selections[src] ?? [] : [];
  return (
    <div className="pliant-selection-bar" data-testid="selection-bar" data-slot-host={slotId}>
      <strong data-testid="selection-count">{ids.length} selected</strong>
      <span className="pliant-spacer" />
      {actions.map((a) => {
        const wf = p.resolved.workflows[a];
        return wf ? <button key={a} className="primary" data-testid={`action-${a}`} disabled={!ids.length || p.run?.status === "running"} onClick={() => p.runWorkflow(a)}>{wf.label}</button> : null;
      })}
      <button onClick={() => src && p.setSelection(src, [])} data-testid="selection-clear">Clear</button>
    </div>
  );
}

function ActionButton({ label, workflow }: { label?: string; workflow?: string }) {
  const p = usePliant();
  const wf = workflow ? p.resolved.workflows[workflow] : undefined;
  if (!wf) return null;
  return <button className="primary" onClick={() => p.runWorkflow(wf.id)}>{label ?? wf.label}</button>;
}

function Stat({ label, entity, filter }: { label?: string; entity?: string; filter?: string }) {
  const p = usePliant();
  const n = entity ? itemsOf(p, entity, filter).length : 0;
  return <div className="pliant-stat"><div className="pliant-stat-value" data-testid="stat-value">{n}</div><div className="pliant-stat-label">{label}</div></div>;
}

function Card({ title, text }: { title?: string; text?: string }) {
  return <div className="pliant-card">{title && <strong>{title}</strong>}{text && <div>{text}</div>}</div>;
}

function Tabs({ tabs = [] }: { tabs?: { label: string; text?: string }[] }) {
  const [i, setI] = useState(0);
  return (
    <div className="pliant-tabs">
      <div role="tablist">{tabs.map((t, k) => <button key={k} role="tab" aria-selected={k === i} className={k === i ? "on" : ""} onClick={() => setI(k)}>{t.label}</button>)}</div>
      <div className="pliant-tab-body">{tabs[i]?.text}</div>
    </div>
  );
}

function Chart({ entity, field, label }: { entity?: string; field?: string; label?: string }) {
  const p = usePliant();
  if (!entity || !field) return null;
  const rows = itemsOf(p, entity).slice(0, 10);
  const max = Math.max(1, ...rows.map((r) => Number(r[field]) || 0));
  return (
    <div className="pliant-chart" role="img" aria-label={label ?? `${field} by ${entity}`}>
      {rows.map((r) => (
        <div key={r.id} className="pliant-bar-row">
          <span className="pliant-bar-label">{String(r.name ?? r.id)}</span>
          <span className="pliant-bar" style={{ width: `${((Number(r[field]) || 0) / max) * 100}%` }} />
          <span>{fmt(r[field])}</span>
        </div>
      ))}
    </div>
  );
}

/** Interactive sort control: lets the user pick a field and direction for an entity slot's list. */
function SortControl({ slot, fields = [] }: { slot?: string; fields?: string[] }) {
  const p = usePliant();
  const target = slot ?? Object.keys(p.slotData)[0];
  const entity = p.slotData[target]?.entity;
  const known = p.manifest?.entities.find((e) => e.id === entity)?.fields ?? {};
  const options = (fields.length ? fields : Object.keys(known)).filter((f) => f in known);
  if (!target || !options.length) return null;
  const cur = p.sorts[target];
  return (
    <div className="pliant-sort" data-testid="sort-control">
      <label>Sort by{" "}
        <select
          value={cur?.field ?? ""} data-testid="sort-field"
          onChange={(e) => p.setSort(target, e.target.value ? { field: e.target.value, direction: cur?.direction ?? "desc" } : null)}
        >
          <option value="">default</option>
          {options.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      {cur && (
        <button data-testid="sort-direction" onClick={() => p.setSort(target, { ...cur, direction: cur.direction === "asc" ? "desc" : "asc" })}>
          {cur.direction === "asc" ? "↑ asc" : "↓ desc"}
        </button>
      )}
    </div>
  );
}

function FilterBar({ slot }: { slot?: string }) {
  const p = usePliant();
  const slots = slot ? [slot] : Object.keys(p.resolved.filters);
  return (
    <div className="pliant-filterbar">
      {slots.flatMap((s) => (p.resolved.filters[s] ?? []).map((f) => (
        <button key={f.key} className={"pliant-chip" + ((p.activeFilters[s] ?? []).includes(f.key) ? " on" : "")} onClick={() => p.toggleFilter(s, f.key)}>{f.label}</button>
      )))}
    </div>
  );
}

function ListC({ entity, filter }: { entity?: string; filter?: string }) {
  const p = usePliant();
  if (!entity) return null;
  return <ul className="pliant-ul">{itemsOf(p, entity, filter).map((i) => <li key={i.id}>{String(i.name ?? i.id)}</li>)}</ul>;
}

/** ConfirmDialog and ProgressToast are rendered by the runtime itself during workflow runs; they are inert if placed in a slot. */
const BUILTIN: Record<string, (props: any) => ReactNode> = {
  SelectionBar, ActionButton, Stat, Card, Tabs, Chart, FilterBar, SortControl, List: ListC,
  Table: (props) => (props.entity ? <EntityTable {...props} /> : null),
  ConfirmDialog: () => null,
  ProgressToast: () => null,
};

export function RenderComponent({ component, props, slotId }: { component: string; props: Record<string, unknown>; slotId: string }) {
  const reg = getRegistered(component);
  if (reg) {
    const parsed = reg.propsSchema ? reg.propsSchema.safeParse(props) : { success: true as const, data: props };
    if (!parsed.success) return null;
    const C = reg.component;
    return <C {...(parsed.data as object)} />;
  }
  const B = BUILTIN[component];
  if (!B) return null;
  return <>{B({ ...props, slotId })}</>;
}

export function viewKey(v: Resolved["views"][number]) { return `${v.patchId}:${v.id}`; }
export function useViews() { const p = usePliant(); return useMemo(() => p.resolved.views, [p.resolved.views]); }
