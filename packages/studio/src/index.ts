import type { CustomizeHandler } from "@pliant/server";
import { AnthropicLLM, type AnthropicOptions } from "./anthropic";
import { MockLLM } from "./mock";
import { llmFromByok } from "./openai";
import { OllamaLLM, type OllamaOptions } from "./ollama";
import { createPipeline } from "./pipeline";
import type { LLM } from "./types";

export { AnthropicLLM, DEFAULT_MODEL, DEFAULT_CLASSIFIER_MODEL } from "./anthropic";
export { MockLLM } from "./mock";
export { OpenAICompatLLM, PROVIDER_PRESETS, llmFromByok } from "./openai";
export { OllamaLLM, DEFAULT_OLLAMA_MODEL } from "./ollama";
export { createPipeline, trustVerdict, MAX_RETRIES } from "./pipeline";
export { manifestSummary } from "./prompts";
export type { LLM, PipelineInput } from "./types";

/** Server-side hosted default: PLIANT_PRESET (groq|gemini|openrouter) + OPENAI_API_KEY (or PLIANT_API_KEY) [+ PLIANT_MODEL]. */
function serverOpenAI(model?: string): LLM {
  const preset = process.env.PLIANT_PRESET ?? "groq";
  const llm = llmFromByok({ provider: preset, apiKey: process.env.OPENAI_API_KEY ?? process.env.PLIANT_API_KEY ?? "", model: model ?? process.env.PLIANT_MODEL });
  if (!llm) throw new Error(`PLIANT_PROVIDER=openai needs PLIANT_PRESET (groq|gemini|openrouter) and OPENAI_API_KEY`);
  return llm;
}

/**
 * Provider choice: `mock` (or PLIANT_MOCK=1) → offline fixtures; PLIANT_PROVIDER=ollama (or `provider: "ollama"`) → local model;
 * otherwise Claude via the Anthropic SDK.
 */
export function createCustomizer(
  opts: { mock?: boolean; provider?: "anthropic" | "ollama" | "openai"; llm?: LLM; skipClassifier?: boolean } & AnthropicOptions & OllamaOptions = {},
): CustomizeHandler {
  const mock = opts.mock ?? process.env.PLIANT_MOCK === "1";
  const provider = opts.provider ?? (process.env.PLIANT_PROVIDER as "anthropic" | "ollama" | "openai" | undefined) ?? "anthropic";
  const llm = opts.llm ?? (mock ? new MockLLM() : provider === "ollama" ? new OllamaLLM(opts) : provider === "openai" ? serverOpenAI(opts.model) : new AnthropicLLM(opts));
  const skipClassifier = opts.skipClassifier ?? process.env.PLIANT_CLASSIFIER === "off";
  const base = createPipeline(llm, { skipClassifier });
  // A user's own key overrides the default (mock) model for that one request. The key is never kept.
  return async (input) => {
    if (!input.byok) return base(input);
    const { byok, ...rest } = input;
    const own = llmFromByok(byok);
    if (!own) return { verdict: { verdict: "deny", layer: "L0", reason: `Unknown provider "${byok.provider}". Choose Groq, Gemini or OpenRouter.`, capabilitiesNeeded: [] } };
    return createPipeline(own, { skipClassifier })(rest);
  };
}
