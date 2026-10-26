import { evalBool, evalExpr, resolveTemplate } from "./expr";
import type { Manifest, Step, Workflow } from "./schemas";

export interface CallRecord {
  capability: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
  /** The input item this call ran on behalf of, for retry. */
  item?: unknown;
}

export interface RunSummary { ok: number; failed: number; total: number; text: string }

export interface RunResult {
  status: "done" | "cancelled" | "error";
  records: CallRecord[];
  summary?: RunSummary;
  failedItems: unknown[];
  error?: string;
}

/** I/O is injected so the same runner powers real runs (HTTP) and dry-runs (log only). */
export interface RunIO {
  call(capability: string, args: Record<string, unknown>): Promise<unknown>;
  confirm(message: string): Promise<boolean>;
  ask(prompt: string, kind: "string" | "number"): Promise<unknown>;
  schedule?(every: string, tick: () => Promise<void>): void;
  onProgress?(p: { done: number; total: number }): void;
}

class Abort extends Error { constructor(public kind: "cancelled" | "error", msg: string) { super(msg); } }

async function pool<T>(items: T[], concurrency: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

export async function runWorkflow(wf: Workflow, manifest: Manifest, input: unknown[], io: RunIO): Promise<RunResult> {
  const records: CallRecord[] = [];
  const failedItems = new Set<unknown>();
  let total = 0, done = 0;
  const root: Record<string, unknown> = { input };
  let summary: RunSummary | undefined;
  let mark = 0; // records index at last report

  const cap = (id: string) => manifest.capabilities.find((c) => c.id === id);

  async function exec(steps: Step[], ctx: Record<string, unknown>): Promise<void> {
    for (const s of steps) {
      switch (s.type) {
        case "confirm": {
          if (s.when && !evalBool(s.when, ctx)) break;
          if (!(await io.confirm(String(resolveTemplate(s.message, ctx))))) throw new Abort("cancelled", "Cancelled");
          break;
        }
        case "input":
          ctx[s.name] = await io.ask(s.prompt, s.kind ?? "string");
          break;
        case "filter": {
          const items = evalExpr(s.items, ctx);
          ctx[s.into] = Array.isArray(items) ? items.filter((item) => evalBool(s.where, { ...ctx, item })) : [];
          break;
        }
        case "if":
          await exec(evalBool(s.cond, ctx) ? s.then : (s.else ?? []), ctx);
          break;
        case "forEach": {
          const raw = Array.isArray(s.items) ? s.items : evalExpr(s.items, ctx);
          const items = Array.isArray(raw) ? raw : [];
          let limit = s.cap ?? Infinity;
          for (const c of s.do) if (c.type === "call") limit = Math.min(limit, cap(c.capability)?.policy.maxFanOut ?? Infinity);
          if (items.length > limit)
            throw new Abort("error", `This action supports at most ${limit} item${limit === 1 ? "" : "s"} at a time (you selected ${items.length}).`);
          total += items.length;
          await pool(items, s.concurrency ?? 1, async (item) => {
            await exec(s.do, { ...ctx, item });
            done++;
            io.onProgress?.({ done, total });
          });
          break;
        }
        case "call": {
          const args = resolveTemplate(s.args, ctx) as Record<string, unknown>;
          const rec: CallRecord = { capability: s.capability, args, ok: true, item: ctx.item };
          try { await io.call(s.capability, args); }
          catch (e) { rec.ok = false; rec.error = (e as Error).message; if (ctx.item !== undefined) failedItems.add(ctx.item); }
          records.push(rec);
          break;
        }
        case "report": {
          const slice = records.slice(mark);
          mark = records.length;
          const ok = slice.filter((r) => r.ok).length;
          const failed = slice.length - ok;
          summary = {
            ok, failed, total: slice.length,
            text: `${wf.label}: ${ok}/${slice.length} done${failed ? ` · ${failed} failed` : ""}`,
          };
          break;
        }
        case "schedule":
          io.schedule?.(s.every, async () => { await exec(s.do, { ...ctx }); });
          break;
      }
    }
  }

  try {
    await exec(wf.steps, root);
  } catch (e) {
    if (e instanceof Abort) return { status: e.kind, records, summary, failedItems: [...failedItems], error: e.message };
    return { status: "error", records, summary, failedItems: [...failedItems], error: (e as Error).message };
  }
  if (!summary && records.length) {
    const ok = records.filter((r) => r.ok).length;
    summary = { ok, failed: records.length - ok, total: records.length, text: `${wf.label}: ${ok}/${records.length} done${ok < records.length ? ` · ${records.length - ok} failed` : ""}` };
  }
  return { status: "done", records, summary, failedItems: [...failedItems] };
}
