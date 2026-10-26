import { useState } from "react";
import { usePliant } from "./context";
import { CustomizePanel } from "./panel";

function Dialog() {
  const { dialog } = usePliant();
  const [value, setValue] = useState("");
  if (!dialog) return null;
  return (
    <div className="pliant-modal-backdrop" role="presentation">
      <div className="pliant-modal" role="dialog" aria-modal="true" aria-label="Confirm" data-testid="dialog">
        <p data-testid="dialog-message">{dialog.message}</p>
        {dialog.kind === "input" && (
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} data-testid="dialog-input" />
        )}
        <div className="pliant-modal-actions">
          <button onClick={() => { dialog.resolve(dialog.kind === "confirm" ? false : null); setValue(""); }} data-testid="dialog-cancel">Cancel</button>
          <button className="primary" data-testid="dialog-ok" onClick={() => { dialog.resolve(dialog.kind === "confirm" ? true : dialog.inputKind === "number" ? Number(value) : value); setValue(""); }}>
            {dialog.kind === "confirm" ? "Confirm" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RunToast() {
  const p = usePliant();
  const { run } = p;
  if (!run) return null;
  if (run.status === "running") {
    const { done, total } = run.progress;
    return (
      <div className="pliant-toast" role="status" data-testid="progress-toast">
        <div>{run.label}… {done}/{total}</div>
        <progress value={done} max={Math.max(total, 1)} />
      </div>
    );
  }
  const r = run.result;
  const failed = r?.summary?.failed ?? 0;
  return (
    <div className={"pliant-toast " + (run.status === "error" || failed ? "warn" : "ok")} role="status" data-testid="report-toast">
      <div data-testid="report-text">
        {run.status === "error" || r?.status === "cancelled" ? (r?.error ?? "Cancelled") : r?.summary?.text ?? `${run.label}: done`}
      </div>
      {r?.failedItems && r.failedItems.length > 0 && (
        <ul className="pliant-failures" data-testid="report-failures">
          {r.records.filter((x) => !x.ok).map((x, i) => <li key={i}>{String((x.item as any)?.name ?? (x.args as any).groupId ?? x.capability)}: {x.error}</li>)}
        </ul>
      )}
      <div className="pliant-toast-actions">
        {r?.failedItems && r.failedItems.length > 0 && (
          <button data-testid="report-retry" onClick={() => p.runWorkflow(run.workflowId, { input: r.failedItems })}>Retry {r.failedItems.length} failed</button>
        )}
        <button onClick={p.dismissRun} data-testid="report-dismiss">Dismiss</button>
      </div>
    </div>
  );
}

export function Overlays() {
  const { panelOpen } = usePliant();
  return (
    <>
      {panelOpen && <CustomizePanel />}
      <Dialog />
      <RunToast />
    </>
  );
}
