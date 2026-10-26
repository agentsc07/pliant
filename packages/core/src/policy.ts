import type { CapabilityManifest, Dial, Manifest, Step, Workflow } from "./schemas";
import { checkExpr, isTemplated, parseExpr, templateExprs } from "./expr";

export interface WorkflowCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Workflow with auto-fixes applied (inserted confirms, runtime caps). Only meaningful if ok. */
  workflow: Workflow;
}

interface State {
  confirmed: boolean;
  forEachDepth: number;
  inSchedule: boolean;
  /** Static fan-out multiplier from enclosing forEach with known size; null once unknown. */
  known: number | null;
  confirmMsgs: string[];
}

function capOf(manifest: Manifest, id: string): CapabilityManifest | undefined {
  return manifest.capabilities.find((c) => c.id === id);
}

function needsConfirm(c: CapabilityManifest) {
  return c.effect === "destructive" || c.effect === "external" || c.policy.requiresConfirm;
}

/** Capabilities (recursively inside a step) that require a confirm step before running. */
function confirmNeeds(step: Step, manifest: Manifest): CapabilityManifest[] {
  const out: CapabilityManifest[] = [];
  const visit = (s: Step) => {
    if (s.type === "call") {
      const c = capOf(manifest, s.capability);
      if (c && needsConfirm(c)) out.push(c);
    } else if (s.type === "forEach" || s.type === "schedule") s.do.forEach(visit);
    else if (s.type === "if") { s.then.forEach(visit); s.else?.forEach(visit); }
  };
  visit(step);
  return out;
}

function listCalls(step: Step): Extract<Step, { type: "call" }>[] {
  const out: Extract<Step, { type: "call" }>[] = [];
  const visit = (s: Step) => {
    if (s.type === "call") out.push(s);
    else if (s.type === "forEach" || s.type === "schedule") s.do.forEach(visit);
    else if (s.type === "if") { s.then.forEach(visit); s.else?.forEach(visit); }
  };
  visit(step);
  return out;
}

function typeOk(type: string, v: unknown): boolean {
  if (isTemplated(v) || type === "any") return true;
  return typeof v === type;
}

function exprErrors(label: string, src: string | undefined, errors: string[]) {
  if (src === undefined) return;
  const e = checkExpr(src);
  if (e) errors.push(`${label}: invalid expression "${src}" (${e})`);
}

export function checkWorkflow(wf: Workflow, manifest: Manifest, opts: { l3Dial?: Dial } = {}): WorkflowCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dial = opts.l3Dial ?? manifest.dials.L3;
  const where = `workflow ${wf.id}`;

  function walk(steps: Step[], st: State): Step[] {
    const out: Step[] = [];
    let confirmed = st.confirmed;
    for (const original of steps) {
      let step: Step = original;

      // 1. confirm gating (destructive / external / requiresConfirm)
      const needs = confirmNeeds(step, manifest);
      if (needs.length && !confirmed) {
        if (st.inSchedule) {
          errors.push(`${where}: ${needs[0].id} requires confirmation and cannot run unattended in a schedule`);
        } else if (dial === "restricted") {
          errors.push(`${where}: ${needs[0].id} (${needs[0].effect}) requires an explicit confirm step before it (layer L3 is restricted)`);
        } else {
          const labels = [...new Set(needs.map((n) => n.id))].join(", ");
          const showsCount = wf.input.from === "selection";
          const msg = showsCount
            ? `Run ${labels} on {{input.count}} item(s)?`
            : `Run ${labels}?`;
          out.push({ type: "confirm", message: msg });
          st.confirmMsgs.push(msg);
          warnings.push(`${where}: auto-inserted confirm before ${labels}`);
          confirmed = true;
        }
      }

      switch (step.type) {
        case "confirm": {
          exprErrors(`${where} confirm.when`, step.when, errors);
          for (const e of templateExprs(step.message)) exprErrors(`${where} confirm.message`, e, errors);
          if (!step.when) { confirmed = true; st.confirmMsgs.push(step.message); }
          break;
        }
        case "call": {
          const c = capOf(manifest, step.capability);
          if (!c) { errors.push(`${where}: unknown capability "${step.capability}"`); break; }
          // args vs param schema
          for (const [k, v] of Object.entries(step.args)) {
            const spec = c.params[k];
            if (!spec) errors.push(`${where}: ${c.id} has no param "${k}"`);
            else if (!typeOk(spec.type, v)) errors.push(`${where}: ${c.id}.${k} expected ${spec.type}`);
          }
          for (const [k, spec] of Object.entries(c.params))
            if (!spec.optional && !(k in step.args)) errors.push(`${where}: ${c.id} missing required param "${k}"`);
          for (const e of templateExprs(step.args)) exprErrors(`${where} ${c.id} args`, e, errors);

          if (st.forEachDepth > 0) {
            if (!c.policy.batchable) errors.push(`${where}: ${c.id} is not batchable and cannot run inside forEach`);
            if (c.policy.maxFanOut !== null) {
              if (st.forEachDepth > 1)
                errors.push(`${where}: ${c.id} has maxFanOut ${c.policy.maxFanOut} and cannot be nested in multiple forEach loops`);
              else if (st.known !== null && st.known > c.policy.maxFanOut)
                errors.push(`${where}: fan-out ${st.known} exceeds maxFanOut ${c.policy.maxFanOut} for ${c.id}`);
            }
            if (c.effect === "external" && manifest.invariants.includes("external-shows-count")) {
              const shown = st.confirmMsgs.some((m) => /\{\{[^}]*count[^}]*\}\}/.test(m));
              if (!shown) errors.push(`${where}: external call ${c.id} in a loop needs a confirm message showing the recipient count`);
            }
          }
          if (st.inSchedule && !c.policy.schedulable)
            errors.push(`${where}: ${c.id} is not schedulable`);
          break;
        }
        case "forEach": {
          exprErrors(`${where} forEach.items`, typeof step.items === "string" ? step.items : undefined, errors);
          const known = Array.isArray(step.items) ? step.items.length : null;
          const calls = listCalls(step);
          const limits = calls.map((c) => capOf(manifest, c.capability)?.policy.maxFanOut ?? null).filter((n): n is number => n !== null);
          const nextKnown = known === null ? null : st.forEachDepth === 0 ? known : st.known === null ? null : st.known * known;
          let newStep = { ...step } as Extract<Step, { type: "forEach" }>;
          if (limits.length) {
            const limit = Math.min(...limits);
            if (known === null && st.forEachDepth === 0) {
              newStep.cap = Math.min(newStep.cap ?? Infinity, limit);
              warnings.push(`${where}: runtime fan-out cap ${limit} applied to forEach`);
            } else if (newStep.cap !== undefined && newStep.cap > limit) newStep.cap = limit;
          }
          newStep.do = walk(step.do, { ...st, confirmed, forEachDepth: st.forEachDepth + 1, known: nextKnown, confirmMsgs: st.confirmMsgs });
          step = newStep;
          break;
        }
        case "filter":
          exprErrors(`${where} filter.where`, step.where, errors);
          exprErrors(`${where} filter.items`, step.items, errors);
          break;
        case "if": {
          exprErrors(`${where} if.cond`, step.cond, errors);
          step = {
            ...step,
            then: walk(step.then, { ...st, confirmed }),
            else: step.else ? walk(step.else, { ...st, confirmed }) : undefined,
          };
          break;
        }
        case "schedule": {
          step = { ...step, do: walk(step.do, { ...st, confirmed, inSchedule: true }) };
          break;
        }
        case "input":
        case "report":
          break;
      }
      out.push(step);
    }
    return out;
  }

  const steps = walk(wf.steps, { confirmed: false, forEachDepth: 0, inSchedule: false, known: null, confirmMsgs: [] });
  return { ok: errors.length === 0, errors, warnings, workflow: { ...wf, steps } };
}

/** Exposed for the validator. */
export { parseExpr };
