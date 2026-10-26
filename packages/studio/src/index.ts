import type { CustomizeHandler } from "@pliant/server";
import { AnthropicLLM, type AnthropicOptions } from "./anthropic";
import { MockLLM } from "./mock";
import { OllamaLLM, type OllamaOptions } from "./ollama";
import { createPipeline } from "./pipeline";
import type { LLM } from "./types";

export { AnthropicLLM, DEFAULT_MODEL, DEFAULT_CLASSIFIER_MODEL } from "./anthropic";
export { MockLLM } from "./mock";
export { OllamaLLM, DEFAULT_OLLAMA_MODEL } from "./ollama";
export { createPipeline, trustVerdict, MAX_RETRIES } from "./pipeline";
export { manifestSummary } from "./prompts";
export type { LLM, PipelineInput } from "./types";

/**
 * Provider choice: `mock` (or PLIANT_MOCK=1) → offline fixtures; PLIANT_PROVIDER=ollama (or `provider: "ollama"`) → local model;
 * otherwise Claude via the Anthropic SDK.
 */
export function createCustomizer(
  opts: { mock?: boolean; provider?: "anthropic" | "ollama"; llm?: LLM; skipClassifier?: boolean } & AnthropicOptions & OllamaOptions = {},
): CustomizeHandler {
  const mock = opts.mock ?? process.env.PLIANT_MOCK === "1";
  const provider = opts.provider ?? (process.env.PLIANT_PROVIDER as "anthropic" | "ollama" | undefined) ?? "anthropic";
  const llm = opts.llm ?? (mock ? new MockLLM() : provider === "ollama" ? new OllamaLLM(opts) : new AnthropicLLM(opts));
  return createPipeline(llm, { skipClassifier: opts.skipClassifier ?? process.env.PLIANT_CLASSIFIER === "off" });
}
