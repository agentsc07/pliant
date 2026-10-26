import { describePatch, explainPatch, type Patch } from "@pliant/core";
import { useEffect, useRef, useState } from "react";
import type { CustomizeResponse, LlmKey } from "./api";
import { usePliant } from "./context";

const LAYER_NAMES: Record<string, string> = { L0: "Look", L1: "Layout", L2: "Views", L3: "Workflows", L4: "Capabilities" };

const KEY_STORE = "pliant.llmKey";
function loadKey(): LlmKey & { remember: boolean } {
  try {
    const raw = localStorage.getItem(KEY_STORE);
    if (raw) return { ...JSON.parse(raw), remember: true };
  } catch { /* storage unavailable: keep the key in memory only */ }
  return { provider: "groq", apiKey: "", model: "", remember: false };
}

/** Button the developer drops anywhere (usually in a header slot) to open the customization panel. */
export function CustomizeButton({ label = "Customize" }: { label?: string }) {
  const p = usePliant();
  return <button onClick={() => p.setPanelOpen(!p.panelOpen)} data-testid="customize-open" aria-expanded={p.panelOpen}>✨ {label}</button>;
}

export function CustomizePanel() {
  const p = usePliant();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CustomizeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dry, setDry] = useState<string[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [llm, setLlm] = useState(loadKey);
  const [elapsed, setElapsed] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const [undo, setUndo] = useState<{ id: string; text: string } | null>(null);
  const [reply, setReply] = useState("");
  const [asked, setAsked] = useState("");

  // Leaving the panel drops any unsaved preview.
  useEffect(() => () => { p.setPreview(null); p.setShowBefore(false); }, []);

  async function submit(request = text, original = request) {
    if (!request.trim()) return;
    setAsked(original); setReply("");
    setBusy(true); setErr(null); setRes(null); setDry(null); setUndo(null); p.setPreview(null); setElapsed(0);
    const ctl = new AbortController(); abort.current = ctl;
    const t0 = Date.now(); const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    try {
      const r = await p.customize(request, llm.apiKey ? { provider: llm.provider, apiKey: llm.apiKey, model: llm.model } : undefined, ctl.signal);
      setRes(r);
      if (r.verdict.verdict === "allow" && r.patch) p.setPreview(r.patch);
    } catch (e) { if ((e as Error).name !== "AbortError") setErr((e as Error).message); }
    clearInterval(tick); abort.current = null;
    setBusy(false);
  }

  /** The model has no memory between calls, so a clarification answer is sent together with the original request. */
  function answer(a: string) {
    if (!a.trim() || !v) return;
    submit(`${asked}\n(You asked: "${v.reason}" — my answer: ${a.trim()})`, asked);
  }

  function updateLlm(next: Partial<typeof llm>) {
    const n = { ...llm, ...next };
    setLlm(n);
    try {
      if (n.remember && n.apiKey) localStorage.setItem(KEY_STORE, JSON.stringify({ provider: n.provider, apiKey: n.apiKey, model: n.model }));
      else localStorage.removeItem(KEY_STORE);
    } catch { /* ignore */ }
  }

  async function accept() {
    if (!res?.patch) return;
    try {
      await p.savePatch(res.patch);
      setUndo({ id: res.patch.id, text: res.patch.request });
      p.setPreview(null); p.setShowBefore(false); setRes(null); setText(""); setDry(null);
    } catch (e) { setErr((e as Error).message); }
  }
  function discard() { p.setPreview(null); p.setShowBefore(false); setRes(null); setDry(null); }

  async function doDry() {
    if (!res?.patch) return;
    const logs: string[] = [];
    for (const wf of res.patch.workflows) logs.push(`▸ ${wf.label} (dry run, nothing is sent)`, ...(await p.dryRun(wf)));
    setDry(logs.length ? logs : ["This change has no workflows to run."]);
  }

  const v = res?.verdict;
  return (
    <aside className="pliant-panel" aria-label="Customize" data-testid="customize-panel">
      <div className="pliant-panel-head">
        <h2>Customize</h2>
        <button onClick={() => p.setPanelOpen(false)} aria-label="Close" data-testid="customize-close">✕</button>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={3} data-testid="customize-input"
          placeholder='Describe what you want, e.g. "dark mode, bigger text"'
        />
        <div className="pliant-row">
          <button type="submit" className="primary" disabled={busy || !text.trim()} data-testid="customize-submit">{busy ? `Working… ${elapsed}s` : "Customize"}</button>
          {busy && <button type="button" onClick={() => abort.current?.abort()} data-testid="customize-cancel">Cancel</button>}
        </div>
        {busy && elapsed > 8 && <p className="pliant-hint">Slower models can take a minute. You can cancel and try something simpler.</p>}
      </form>

      <details className="pliant-byok" data-testid="byok">
        <summary>{llm.apiKey ? `Using your ${llm.provider} key` : "Use your own model key (optional)"}</summary>
        <p className="pliant-hint">Without a key the public demo answers a fixed set of example requests. A free Groq, Gemini or OpenRouter key lets it handle anything. Your key stays in this browser and is sent only with each request. The server never stores or logs it.</p>
        <div className="pliant-clarify">
          <select value={llm.provider} onChange={(e) => updateLlm({ provider: e.target.value })} aria-label="Provider" data-testid="byok-provider">
            <option value="groq">Groq</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option>
          </select>
          <input type="password" autoComplete="off" placeholder="API key" value={llm.apiKey} onChange={(e) => updateLlm({ apiKey: e.target.value })} data-testid="byok-key" />
          <input placeholder="Model (optional)" value={llm.model ?? ""} onChange={(e) => updateLlm({ model: e.target.value })} data-testid="byok-model" />
          <label className="pliant-hint"><input type="checkbox" checked={llm.remember} onChange={(e) => updateLlm({ remember: e.target.checked })} /> Remember in this browser</label>
        </div>
      </details>

      <p className="pliant-hint">You can change: look (theme, text size, colours, density, nav bar left/top), layout (hide, move, resize, sort), views and filters, and selection with bulk actions. Backend-level features need the developer.</p>

      {!busy && !res?.patch && (p.manifest?.examples?.length ?? 0) > 0 && (
        <div className="pliant-examples" data-testid="examples">
          <span className="pliant-hint">Try:</span>
          {p.manifest!.examples!.map((ex) => (
            <button key={ex} className="pliant-example" onClick={() => { setText(ex); submit(ex); }}>{ex}</button>
          ))}
        </div>
      )}

      {undo && (
        <div className="pliant-note ok" role="status" data-testid="applied">
          Applied ✓ <span className="pliant-muted">“{undo.text.slice(0, 50)}{undo.text.length > 50 ? "…" : ""}”</span>
          <button className="link" onClick={() => { p.deletePatch(undo.id); setUndo(null); }} data-testid="undo">Undo</button>
        </div>
      )}

      {err && <div className="pliant-note bad" role="alert" data-testid="customize-error">{err}</div>}

      {v && (
        <div className={"pliant-verdict " + (v.note === "demo_limit" ? "info" : v.verdict)} data-testid="verdict" data-verdict={v.verdict}>
          <div className="pliant-verdict-head">
            <span className="pliant-chip on">{v.layer} · {LAYER_NAMES[v.layer]}</span>
            <strong>{v.verdict === "allow" ? "Looks good" : v.note === "demo_limit" ? "Demo model" : v.verdict === "deny" ? "Can't do that" : "Quick question"}</strong>
          </div>
          <p data-testid="verdict-reason">{v.reason}</p>
          {v.verdict === "needs_clarification" && (
            <form className="pliant-clarify" data-testid="clarify" onSubmit={(e) => { e.preventDefault(); answer(reply); }}>
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your answer…" data-testid="clarify-input" autoFocus />
              <div className="pliant-row">
                <button type="submit" className="primary" disabled={busy || !reply.trim()} data-testid="clarify-send">Answer</button>
                <button type="button" onClick={() => answer("yes")} disabled={busy}>Yes</button>
                <button type="button" onClick={() => answer("no")} disabled={busy}>No</button>
              </div>
            </form>
          )}
          {v.verdict === "deny" && v.suggestion && (
            <button data-testid="suggestion" onClick={() => { setText(v.suggestion!); submit(v.suggestion!); }}>Try instead: {v.suggestion}</button>
          )}
        </div>
      )}

      {res?.errors && res.errors.length > 0 && (
        <div className="pliant-note bad" data-testid="validation-errors">
          <strong>Rejected by policy</strong>
          <ul>{res.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {res?.patch && (
        <div className="pliant-preview" data-testid="preview">
          <h3>Preview</h3>
          <ul data-testid="preview-changes">{explainPatch(res.patch, p.manifest?.labels).map((l, i) => <li key={i}>{l}</li>)}</ul>
          {res.warnings?.map((w, i) => <div key={i} className="pliant-note">{w}</div>)}
          <div className="pliant-row">
            <button onMouseDown={() => p.setShowBefore(true)} onMouseUp={() => p.setShowBefore(false)} onMouseLeave={() => p.setShowBefore(false)}
              onClick={() => p.setShowBefore(!p.showBefore)} data-testid="preview-before" aria-pressed={p.showBefore}>
              {p.showBefore ? "Showing before" : "Compare with before"}
            </button>
            {res.patch.workflows.length > 0 && <button onClick={doDry} data-testid="dry-run">Dry run</button>}
          </div>
          {dry && <pre className="pliant-dry" data-testid="dry-log">{dry.join("\n")}</pre>}
          <div className="pliant-row">
            <button className="primary" onClick={accept} data-testid="patch-accept">Accept</button>
            <button onClick={discard} data-testid="patch-discard">Discard</button>
          </div>
        </div>
      )}

      <h3>Your changes</h3>
      <PatchList open={open} setOpen={setOpen} />
    </aside>
  );
}

function PatchList({ open, setOpen }: { open: string | null; setOpen: (id: string | null) => void }) {
  const p = usePliant();
  const [diff, setDiff] = useState(false);
  if (!p.patches.length) return <p className="pliant-muted" data-testid="no-patches">Nothing yet — you're seeing the default app.</p>;
  return (
    <div data-testid="patch-list">
      <ul className="pliant-patches">
        {p.patches.map((pt: Patch, i) => (
          <li key={pt.id} className={pt.enabled ? "" : "off"} data-testid={`patch-${pt.id}`}>
            <div className="pliant-row">
              <input type="checkbox" checked={pt.enabled} onChange={() => p.togglePatch(pt.id)} aria-label={`Enable ${pt.request}`} />
              <span className="pliant-chip on">{pt.layer}</span>
              <button className="link" onClick={() => setOpen(open === pt.id ? null : pt.id)}>{pt.request}</button>
              <span className="pliant-spacer" />
              <button onClick={() => p.movePatch(pt.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button onClick={() => p.movePatch(pt.id, 1)} disabled={i === p.patches.length - 1} aria-label="Move down">↓</button>
              <button onClick={() => p.deletePatch(pt.id)} aria-label="Delete" data-testid={`delete-${pt.id}`}>🗑</button>
            </div>
            {open === pt.id && <ul className="pliant-changes">{explainPatch(pt, p.manifest?.labels).map((l, k) => <li key={k}>{l}</li>)}</ul>}
          </li>
        ))}
      </ul>
      <div className="pliant-row">
        <button onClick={() => setDiff(!diff)} data-testid="show-diff">{diff ? "Hide" : "Show"} diff vs default</button>
        <button className="danger" data-testid="reset" onClick={() => p.resetProfile()}>Reset to default</button>
      </div>
      {diff && (
        <pre className="pliant-diff" data-testid="diff">
          {p.patches.filter((x) => x.enabled).flatMap((x) => describePatch(x).map((l) => `+ ${l}`)).join("\n") || "(no active changes)"}
        </pre>
      )}
    </div>
  );
}
