import { describePatch, validatePatch, type Patch, type Verdict } from "@pliant/core";
import type { CustomizeHandler, CustomizeResult } from "@pliant/server";
import { randomUUID } from "node:crypto";
import type { LLM } from "./types";

export const MAX_RETRIES = 2;

export interface PipelineOptions {
  /** Skip the LLM classifier; the deterministic validator alone decides. Useful for small local models. Env: PLIANT_CLASSIFIER=off */
  skipClassifier?: boolean;
}

const MAX_REASON = 300;
const META = /re-?read|\bwait,|correction:|verdict should|the (system|user) (prompt|configuration|request)|let me (think|check)/i;

/**
 * Small models sometimes dump their chain of thought into `reason` and contradict their own verdict.
 * A refusal must carry a short, clean reason; otherwise we don't trust it and let the validator decide.
 */
export function trustVerdict(v: Verdict): Verdict {
  if (v.verdict === "allow") return v;
  const reason = (v.reason ?? "").trim();
  if (!reason || reason.length > MAX_REASON || META.test(reason)) {
    return { ...v, verdict: "allow", reason: "Checking this against the app's rules…" };
  }
  return { ...v, reason };
}

/**
 * request → classifier → generator → validator → preview data.
 * The classifier gives fast, friendly rejections. It is NOT the security boundary:
 * whatever the generator emits is validated deterministically here, and again by the server on save.
 */
export function createPipeline(llm: LLM, opts: PipelineOptions = {}): CustomizeHandler {
  return async (input): Promise<CustomizeResult> => {
    // With no classifier the layer is only a hint for the generator, which picks the patch's real layer.
    const verdict: Verdict = opts.skipClassifier
      ? { verdict: "allow", layer: "L3", reason: "", capabilitiesNeeded: [] }
      : trustVerdict(await llm.classify(input));
    if (verdict.verdict !== "allow") return { verdict };

    let previousErrors: string[] | undefined;
    let previousOutput: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const raw = (await llm.generate({ ...input, layer: verdict.layer, previousErrors, previousOutput })) as Record<string, unknown>;
      const candidate = {
        enabled: true,
        workflows: [],
        ...raw,
        // Identity and provenance are never the model's to choose.
        id: "p_" + randomUUID().slice(0, 8),
        request: input.request,
        createdAt: new Date().toISOString(),
      };
      const knownWorkflowIds = input.profile.flatMap((p) => p.workflows.map((w) => w.id));
      const v = validatePatch(candidate, input.manifest, { slots: input.slots, catalog: input.catalog, knownWorkflowIds });
      if (v.ok && v.patch) {
        const patch: Patch = v.patch;
        return { verdict, patch, warnings: v.warnings, preview: { description: describePatch(patch) } };
      }
      previousErrors = v.errors;
      previousOutput = raw;
    }
    return {
      verdict: { ...verdict, verdict: "deny", reason: "I couldn't produce a change that passes this app's rules." },
      errors: previousErrors,
    };
  };
}
