import { randomUUID } from "node:crypto";
import type { RateLimit } from "@pliant/core";

export interface Run {
  id: string;
  userId: string;
  workflowId: string;
  declaredFanOut: number;
  createdAt: number;
  /** Calls seen per capability within this run. */
  counts: Map<string, number>;
}

export type Denial = { status: number; error: string; message: string };

const RUN_TTL_MS = 10 * 60_000;

/** Server-side fan-out and rate-limit accounting. Never trusts the client's claims. */
export class Enforcer {
  private runs = new Map<string, Run>();
  private windows = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}

  registerRun(userId: string, workflowId: string, declaredFanOut: number): Run {
    this.gc();
    const run: Run = { id: "run_" + randomUUID().slice(0, 8), userId, workflowId, declaredFanOut, createdAt: this.now(), counts: new Map() };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(id: string) { return this.runs.get(id); }

  /**
   * Account for one capability call. Returns a denial or null.
   * `runId` is optional: calls outside a run are treated as single-call runs (so a client
   * cannot batch a capped capability simply by omitting the header).
   */
  check(opts: { userId: string; capId: string; maxFanOut: number | null; rateLimit: RateLimit | null; runId?: string }): Denial | null {
    const { userId, capId, maxFanOut, rateLimit, runId } = opts;

    if (runId) {
      const run = this.runs.get(runId);
      if (!run) return { status: 403, error: "pliant_unknown_run", message: `Unknown or expired run ${runId}` };
      if (run.userId !== userId) return { status: 403, error: "pliant_run_owner", message: "Run belongs to another user" };
      const n = (run.counts.get(capId) ?? 0) + 1;
      if (maxFanOut !== null && n > maxFanOut)
        return { status: 403, error: "pliant_fanout_exceeded", message: `${capId} allows at most ${maxFanOut} calls per run (declared ${run.declaredFanOut})` };
      run.counts.set(capId, n);
    }

    if (rateLimit) {
      const key = `${userId}:${capId}`;
      const t = this.now();
      const win = (this.windows.get(key) ?? []).filter((x) => t - x < rateLimit.perSeconds * 1000);
      if (win.length >= rateLimit.count) {
        this.windows.set(key, win);
        return { status: 429, error: "pliant_rate_limited", message: `${capId} is limited to ${rateLimit.count} calls per ${rateLimit.perSeconds}s` };
      }
      win.push(t);
      this.windows.set(key, win);
    }
    return null;
  }

  private gc() {
    const t = this.now();
    for (const [id, r] of this.runs) if (t - r.createdAt > RUN_TTL_MS) this.runs.delete(id);
  }
}
