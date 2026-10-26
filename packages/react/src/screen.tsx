import { useState, type ReactNode } from "react";
import { EntityTable, viewKey } from "./catalog";
import { usePliant } from "./context";

/** A screen. When the profile defines views, a built-in "My views" tab appears next to the default screen. */
export function Screen({ id, children }: { id: string; children: ReactNode }) {
  const p = usePliant();
  const views = p.resolved.views;
  const [tab, setTab] = useState<"home" | "views">("home");
  const [viewId, setViewId] = useState<string | null>(null);
  const current = views.find((v) => viewKey(v) === viewId) ?? views[0];

  return (
    <div className="pliant-screen" data-screen={id}>
      {views.length > 0 && (
        <div className="pliant-tabbar" role="tablist" data-testid="screen-tabs">
          <button role="tab" aria-selected={tab === "home"} className={tab === "home" ? "on" : ""} onClick={() => setTab("home")}>Home</button>
          <button role="tab" aria-selected={tab === "views"} className={tab === "views" ? "on" : ""} onClick={() => setTab("views")} data-testid="tab-my-views">My views ({views.length})</button>
        </div>
      )}
      <div className="pliant-screen-body" hidden={tab === "views" && views.length > 0}>{children}</div>
      {tab === "views" && views.length > 0 && current && (
        <div className="pliant-views" data-testid="my-views">
          <div className="pliant-viewchips">
            {views.map((v) => (
              <button key={viewKey(v)} className={"pliant-chip" + (viewKey(v) === viewKey(current) ? " on" : "")} onClick={() => setViewId(viewKey(v))}>{v.title}</button>
            ))}
          </div>
          <h3 data-testid="view-title">{current.title}</h3>
          <EntityTable entity={current.entity} columns={current.columns} filter={current.filter} component={current.component} />
        </div>
      )}
    </div>
  );
}
