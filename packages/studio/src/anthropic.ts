import Anthropic from "@anthropic-ai/sdk";
import { Verdict } from "@pliant/core";
import { CLASSIFIER_SYSTEM, GENERATOR_SYSTEM, generatorUser, manifestSummary } from "./prompts";
import type { LLM, PipelineInput } from "./types";

export interface AnthropicOptions {
  apiKey?: string;
  /** Generation model. Env: PLIANT_MODEL */
  model?: string;
  /** Classification model. Env: PLIANT_CLASSIFIER_MODEL */
  classifierModel?: string;
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_CLASSIFIER_MODEL = "claude-haiku-5-5";

export class AnthropicLLM implements LLM {
  private client: Anthropic;
  private model: string;
  private classifierModel: string;

  constructor(opts: AnthropicOptions = {}) {
    this.client = new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
    this.model = opts.model ?? process.env.PLIANT_MODEL ?? DEFAULT_MODEL;
    this.classifierModel = opts.classifierModel ?? process.env.PLIANT_CLASSIFIER_MODEL ?? DEFAULT_CLASSIFIER_MODEL;
  }

  private async tool(model: string, system: string, user: string, name: string, description: string, schema: Record<string, unknown>) {
    const msg = await this.client.messages.create({
      model, max_tokens: 4096, system,
      messages: [{ role: "user", content: user }],
      tools: [{ name, description, input_schema: { type: "object", ...schema } as Anthropic.Tool.InputSchema }],
      tool_choice: { type: "tool", name },
    });
    const block = msg.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error(`Model did not call ${name}`);
    return block.input;
  }

  async classify(input: PipelineInput): Promise<Verdict> {
    const out = await this.tool(
      this.classifierModel, CLASSIFIER_SYSTEM,
      `${manifestSummary(input.manifest, input.slots, input.catalog)}\n\nUser request: ${input.request}`,
      "classify", "Report the verdict for this customisation request.",
      {
        properties: {
          verdict: { type: "string", enum: ["allow", "deny", "needs_clarification"] },
          layer: { type: "string", enum: ["L0", "L1", "L2", "L3", "L4"] },
          reason: { type: "string", description: "One or two friendly sentences for the end user." },
          capabilitiesNeeded: { type: "array", items: { type: "string" } },
          suggestion: { type: "string", description: "Optional rephrased request that would be allowed." },
        },
        required: ["verdict", "layer", "reason"],
      },
    );
    return Verdict.parse(out);
  }

  async generate(input: Parameters<LLM["generate"]>[0]) {
    return this.tool(
      this.model, GENERATOR_SYSTEM, generatorUser(input), "emit_patch", "Emit the patch JSON for this request.",
      {
        properties: {
          layer: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
          ops: { type: "array", items: { type: "object" } },
          workflows: { type: "array", items: { type: "object" } },
        },
        required: ["layer", "ops"],
      },
    );
  }
}
