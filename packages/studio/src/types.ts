import type { Manifest, Patch, Verdict } from "@pliant/core";

export interface PipelineInput {
  request: string;
  manifest: Manifest;
  profile: Patch[];
  slots?: string[];
  catalog?: string[];
  byok?: { provider: string; apiKey: string; model?: string };
}

/** The two model-backed steps. Everything around them is deterministic. */
export interface LLM {
  classify(input: PipelineInput): Promise<Verdict>;
  /** Returns the raw (unvalidated) patch body: { layer, ops, workflows }. */
  generate(input: PipelineInput & { layer: Verdict["layer"]; previousErrors?: string[]; previousOutput?: unknown }): Promise<unknown>;
}
