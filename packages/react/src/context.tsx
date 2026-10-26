import {
  checkWorkflow, resolveProfile, runWorkflow, type Manifest, type Patch, type Resolved, type RunResult, type Workflow,
} from "@pliant/core";
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { callCapability, pliantApi, type ApiConfig, type CustomizeResponse } from "./api";
import { Overlays } from "./overlays";

export interface SlotData { entity: string; items: any[] }

export interface RunState {
  label: string;
  status: "running" | "report" | "error";
  progress: { done: number; total: number };
  result?: RunResult;
  workflowId: string;
}

export interface PendingDialog {
  kind: "confirm" | "input";
  message: string;
  inputKind?: "string" | "number";
  resolve: (v: any) => void;
}

export interface PliantCtx {
  ready: boolean;
  error: string | null;
  manifest: Manifest | null;
  userId: string;
  patches: Patch[];
  resolved: Resolved;
  /** Patch being previewed (not yet saved). */
  preview: Patch | null;
  setPreview: (p: Patch | null) => void;
  showBefore: boolean;
  setShowBefore: (b: boolean) => void;

  panelOpen: boolean;
  setPanelOpen: (b: boolean) => void;

  slotData: Record<string, SlotData>;
  registerSlotData: (slot: string, d: SlotData) => void;
  portalTargets: Record<string, HTMLElement | null>;
  setPortalTarget: (slot: string, el: HTMLElement | null) => void;

  selections: Record<string, string[]>;
  setSelection: (slot: string, ids: string[]) => void;
  activeFilters: Record<string, string[]>;
  toggleFilter: (slot: string, key: string) => void;
  sorts: Record<string, { field: string; direction: "asc" | "desc" }>;
  setSort: (slot: string, s: { field: string; direction: "asc" | "desc" } | null) => void;
  /** Slot that currently drives `selection` in showWhen / workflows. */
  selectionSource: string | null;

  run: RunState | null;
  dismissRun: () => void;
  dialog: PendingDialog | null;
  runWorkflow: (id: string, opts?: { input?: unknown[] }) => Promise<void>;
  dryRun: (wf: Workflow) => Promise<string[]>;

  customize: (request: string) => Promise<CustomizeResponse>;
  savePatch: (p: Patch) => Promise<string[]>;
  togglePatch: (id: string) => Promise<void>;
  deletePatch: (id: string) => Promise<void>;
  movePatch: (id: string, dir: -1 | 1) => Promise<void>;
  resetProfile: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  notifyChanged: () => void;
}

const Ctx = createContext<PliantCtx | null>(null);
export function usePliant(): PliantCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePliant must be used inside <PliantProvider>");
  return c;
}

const DENSITY: Record<string, string> = { compact: "4px", comfortable: "10px", spacious: "18px" };
const FONT: Record<string, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
};

/** Map validated tokens → CSS custom properties / root font-size. The contract is documented in the README. */
function tokenStyle(tokens: Record<string, string>): React.CSSProperties {
  const s: Record<string, string> = {};
  if (tokens.fontScale) s.fontSize = `${16 * Number(tokens.fontScale)}px`;
  if (tokens.density) s["--row-pad"] = DENSITY[tokens.density];
  if (tokens.accent) s["--accent"] = tokens.accent;
  if (tokens.radius) s["--radius"] = tokens.radius;
  if (tokens.fontFamily) s["--font-family"] = FONT[tokens.fontFamily];
  return s as React.CSSProperties;
}

export interface PliantProviderProps {
  manifestUrl: string;
  userId: string;
  /** Where the app's backend lives. Default: same origin. */
  baseUrl?: string;
  /** Called after a workflow mutated data, so the app can refetch. */
  onChange?: () => void;
  children: ReactNode;
}

export function PliantProvider({ manifestUrl, userId, baseUrl = "", onChange, children }: PliantProviderProps) {
  const cfg: ApiConfig = useMemo(() => ({ baseUrl, userId }), [baseUrl, userId]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Patch | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [slotData, setSlotData] = useState<Record<string, SlotData>>({});
  const [portalTargets, setPortalTargets] = useState<Record<string, HTMLElement | null>>({});
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sorts, setSorts] = useState<Record<string, { field: string; direction: "asc" | "desc" }>>({});
  const [run, setRun] = useState<RunState | null>(null);
  const [dialog, setDialog] = useState<PendingDialog | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const refreshProfile = useCallback(async () => {
    setPatches((await pliantApi.profile(cfg)).patches);
  }, [cfg]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [m, p] = await Promise.all([pliantApi.manifest(cfg, manifestUrl), pliantApi.profile(cfg)]);
        if (!live) return;
        setManifest(m);
        setPatches(p.patches);
      } catch (e) { if (live) setError((e as Error).message); }
    })();
    return () => { live = false; };
  }, [cfg, manifestUrl]);

  const active = useMemo(() => {
    if (showBefore) return [];
    return preview ? [...patches, preview] : patches;
  }, [patches, preview, showBefore]);
  const resolved = useMemo(() => resolveProfile(active, { locks: manifest?.locks }), [active, manifest]);

  const slotDataRef = useRef(slotData);
  slotDataRef.current = slotData;
  const registerSlotData = useCallback((slot: string, d: SlotData) => {
    const prev = slotDataRef.current[slot];
    if (prev && prev.entity === d.entity && prev.items === d.items) return;
    setSlotData((s) => ({ ...s, [slot]: d }));
  }, []);
  const setPortalTarget = useCallback((slot: string, el: HTMLElement | null) => {
    setPortalTargets((t) => (t[slot] === el ? t : { ...t, [slot]: el }));
  }, []);
  const setSelection = useCallback((slot: string, ids: string[]) => setSelections((s) => ({ ...s, [slot]: ids })), []);
  const toggleFilter = useCallback((slot: string, key: string) => {
    setActiveFilters((f) => {
      const cur = f[slot] ?? [];
      return { ...f, [slot]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
    });
  }, []);

  const setSort = useCallback((slot: string, s: { field: string; direction: "asc" | "desc" } | null) => {
    setSorts((cur) => {
      const { [slot]: _drop, ...rest } = cur;
      return s ? { ...rest, [slot]: s } : rest;
    });
  }, []);

  const selectionSource = useMemo(() => Object.keys(resolved.selection)[0] ?? null, [resolved]);

  // ----- workflows -----
  const makeIO = useCallback((runId: string | undefined, onProgress?: (p: { done: number; total: number }) => void) => ({
    call: (cap: string, args: Record<string, unknown>) => callCapability(cfg, manifest!, cap, args, runId),
    confirm: (message: string) => new Promise<boolean>((resolve) => setDialog({ kind: "confirm", message, resolve: (v) => { setDialog(null); resolve(!!v); } })),
    ask: (message: string, inputKind: "string" | "number") =>
      new Promise<unknown>((resolve) => setDialog({ kind: "input", message, inputKind, resolve: (v) => { setDialog(null); resolve(v); } })),
    schedule: (every: string, tick: () => Promise<void>) => {
      const ms = /^(\d+)([smhd])$/.exec(every);
      const unit: Record<string, number> = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };
      if (ms) setInterval(() => void tick().catch(() => {}), Number(ms[1]) * unit[ms[2]]);
    },
    onProgress,
  }), [cfg, manifest]);

  const runWf = useCallback(async (id: string, opts: { input?: unknown[] } = {}) => {
    if (!manifest) return;
    const wf = resolved.workflows[id];
    if (!wf) return;
    // Re-check policy before every run (spec §6).
    const check = checkWorkflow(wf, manifest);
    if (!check.ok) {
      setRun({ label: wf.label, workflowId: id, status: "error", progress: { done: 0, total: 0 }, result: { status: "error", records: [], failedItems: [], error: check.errors.join("; ") } });
      return;
    }
    let input = opts.input;
    if (!input) {
      const src = selectionSource;
      const ids = new Set(src ? selections[src] ?? [] : []);
      input = src ? (slotData[src]?.items ?? []).filter((i: any) => ids.has(String(i.id))) : [];
    }
    setRun({ label: wf.label, workflowId: id, status: "running", progress: { done: 0, total: input.length } });
    try {
      const { runId } = await pliantApi.registerRun(cfg, id, input.length);
      const result = await runWorkflow(check.workflow, manifest, input, makeIO(runId, (progress) => setRun((r) => (r ? { ...r, progress } : r))));
      setRun({ label: wf.label, workflowId: id, status: result.status === "error" ? "error" : "report", progress: { done: input.length, total: input.length }, result });
    } catch (e) {
      setRun({ label: wf.label, workflowId: id, status: "error", progress: { done: 0, total: 0 }, result: { status: "error", records: [], failedItems: [], error: (e as Error).message } });
    }
    if (selectionSource) setSelection(selectionSource, []);
    onChangeRef.current?.();
  }, [manifest, resolved, selectionSource, selections, slotData, cfg, makeIO, setSelection]);

  const dryRun = useCallback(async (wf: Workflow): Promise<string[]> => {
    if (!manifest) return [];
    const entity = wf.input.entity;
    const src = Object.values(slotData).find((d) => d.entity === entity) ?? Object.values(slotData)[0];
    const sample = (src?.items ?? []).slice(0, 3);
    const log: string[] = [];
    const check = checkWorkflow(wf, manifest);
    const result = await runWorkflow(check.workflow, manifest, sample, {
      call: async (cap, args) => { log.push(`${cap} ${JSON.stringify(args)}`); },
      confirm: async (m) => { log.push(`confirm: ${m}`); return true; },
      ask: async () => 1,
    });
    if (result.error) log.push(`error: ${result.error}`);
    return log;
  }, [manifest, slotData]);

  // ----- profile management -----
  const customize = useCallback((request: string) => pliantApi.customize(cfg, request), [cfg]);
  const savePatch = useCallback(async (p: Patch) => {
    const r = await pliantApi.savePatch(cfg, p);
    await refreshProfile();
    return r.warnings;
  }, [cfg, refreshProfile]);
  const togglePatch = useCallback(async (id: string) => {
    const p = patches.find((x) => x.id === id);
    if (p) await savePatch({ ...p, enabled: !p.enabled });
  }, [patches, savePatch]);
  const deletePatch = useCallback(async (id: string) => { await pliantApi.deletePatch(cfg, id); await refreshProfile(); }, [cfg, refreshProfile]);
  const movePatch = useCallback(async (id: string, dir: -1 | 1) => {
    const ids = patches.map((p) => p.id);
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setPatches((await pliantApi.reorder(cfg, ids)).patches);
  }, [cfg, patches]);
  const resetProfile = useCallback(async () => { await pliantApi.reset(cfg); setPreview(null); await refreshProfile(); }, [cfg, refreshProfile]);

  const value: PliantCtx = {
    ready: !!manifest, error, manifest, userId, patches, resolved, preview, setPreview, showBefore, setShowBefore,
    panelOpen, setPanelOpen, slotData, registerSlotData, portalTargets, setPortalTarget, selections, setSelection,
    activeFilters, toggleFilter, sorts, setSort, selectionSource, run, dismissRun: () => setRun(null), dialog,
    runWorkflow: runWf, dryRun, customize, savePatch, togglePatch, deletePatch, movePatch, resetProfile, refreshProfile,
    notifyChanged: () => onChangeRef.current?.(),
  };

  return (
    <Ctx.Provider value={value}>
      <div className="pliant-root" data-theme={resolved.theme ?? undefined} data-nav={resolved.tokens.navPosition ?? undefined} style={tokenStyle(resolved.tokens)}>
        {children}
        <Overlays />
      </div>
    </Ctx.Provider>
  );
}
