import { Verdict } from "@pliant/core";
import { CLASSIFIER_SYSTEM, GENERATOR_SYSTEM, generatorUser, manifestSummary } from "./prompts";
import type { LLM, PipelineInput } from "./types";

export interface OllamaOptions {
  /** Default: http://localhost:11434 (env OLLAMA_HOST) */
  host?: string;
  /** Used for both steps unless classifierModel is set. Env: PLIANT_MODEL */
  model?: string;
  /** Env: PLIANT_CLASSIFIER_MODEL */
  classifierModel?: string;
}

export const DEFAULT_OLLAMA_MODEL = "qwen3.5:4b";

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["allow", "deny", "needs_clarification"] },
    layer: { type: "string", enum: ["L0", "L1", "L2", "L3", "L4"] },
    reason: { type: "string" },
    capabilitiesNeeded: { type: "array", items: { type: "string" } },
    suggestion: { type: "string" },
  },
  required: ["verdict", "layer", "reason"],
};

const PATCH_SCHEMA = {
  type: "object",
  properties: {
    layer: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
    ops: { type: "array", items: { type: "object" } },
    workflows: { type: "array", items: { type: "object" } },
  },
  required: ["layer", "ops"],
};

/** Local models via Ollama. Output is constrained to a JSON schema; the validator still gates everything. */
export class OllamaLLM implements LLM {
  private host: string;
  private model: string;
  private classifierModel: string;

  constructor(opts: OllamaOptions = {}) {
    this.host = (opts.host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "");
    if (!/^https?:\/\//.test(this.host)) this.host = "http://" + this.host;
    this.model = opts.model ?? process.env.PLIANT_MODEL ?? DEFAULT_OLLAMA_MODEL;
    this.classifierModel = opts.classifierModel ?? process.env.PLIANT_CLASSIFIER_MODEL ?? this.model;
  }

  private async chat(model: string, system: string, user: string, format: object): Promise<unknown> {
    const r = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model, stream: false, think: false, format,
        options: { temperature: 0.1 },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    }).catch((e) => { throw new Error(`Cannot reach Ollama at ${this.host} (${e.message}). Is \`ollama serve\` running?`); });
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const body = (await r.json()) as { message?: { content?: string } };
    try { return JSON.parse(body.message?.content ?? ""); }
    catch { throw new Error("Ollama returned non-JSON output"); }
  }

  async classify(input: PipelineInput): Promise<Verdict> {
    const out = await this.chat(
      this.classifierModel, CLASSIFIER_SYSTEM,
      `${manifestSummary(input.manifest, input.slots, input.catalog)}\n\nUser request: ${input.request}`,
      VERDICT_SCHEMA,
    );
    return Verdict.parse(out);
  }

  async generate(input: Parameters<LLM["generate"]>[0]) {
    return this.chat(this.model, GENERATOR_SYSTEM, generatorUser(input), PATCH_SCHEMA);
  }
}
