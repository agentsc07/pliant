import { Verdict } from "@pliant/core";
import { CLASSIFIER_SYSTEM, GENERATOR_SYSTEM, generatorUser, manifestSummary } from "./prompts";
import type { LLM, PipelineInput } from "./types";

/**
 * Hosted OpenAI-compatible providers a user can bring their own key for.
 * The base URL is looked up here, never taken from the request, so a bring-your-own-key
 * request can't point the server at an arbitrary host (SSRF).
 */
export const PROVIDER_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free" },
};

export interface OpenAICompatOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  classifierModel?: string;
}

const VERDICT_SHAPE = `Respond with ONE JSON object: {"verdict":"allow"|"deny"|"needs_clarification","layer":"L0"|"L1"|"L2"|"L3"|"L4","reason":"one or two short sentences","capabilitiesNeeded":[],"suggestion":"optional"}. No prose outside the JSON.`;
const PATCH_SHAPE = `Respond with ONE JSON object: {"layer":"L0"|"L1"|"L2"|"L3","ops":[...],"workflows":[...]}. No prose outside the JSON.`;

/** Any OpenAI-style /chat/completions endpoint in JSON mode (Groq, Gemini, OpenRouter, OpenAI…). */
export class OpenAICompatLLM implements LLM {
  constructor(private o: OpenAICompatOptions) {}

  private async chat(model: string, system: string, user: string): Promise<unknown> {
    const r = await fetch(`${this.o.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.o.apiKey}` },
      body: JSON.stringify({
        model, temperature: 0.1, response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    }).catch((e) => { throw new Error(this.scrub(`Cannot reach the model provider (${e.message})`)); });
    if (!r.ok) throw new Error(this.scrub(`Model provider returned ${r.status}: ${(await r.text()).slice(0, 200)}`));
    const body = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (body.choices?.[0]?.message?.content ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    try { return JSON.parse(text); } catch { throw new Error("The model returned non-JSON output"); }
  }

  /** The key must never end up in an error message that could reach logs or the browser. */
  private scrub(s: string) { return this.o.apiKey ? s.split(this.o.apiKey).join("[key]") : s; }

  async classify(input: PipelineInput): Promise<Verdict> {
    const out = await this.chat(
      this.o.classifierModel ?? this.o.model, `${CLASSIFIER_SYSTEM}\n\n${VERDICT_SHAPE}`,
      `${manifestSummary(input.manifest, input.slots, input.catalog)}\n\nUser request: ${input.request}`,
    );
    return Verdict.parse(out);
  }

  async generate(input: Parameters<LLM["generate"]>[0]) {
    return this.chat(this.o.model, `${GENERATOR_SYSTEM}\n\n${PATCH_SHAPE}`, generatorUser(input));
  }
}

export interface ByokConfig { provider: string; apiKey: string; model?: string }

/** Build an LLM from a per-request bring-your-own-key config, or null if the provider isn't a known preset. */
export function llmFromByok(c: ByokConfig): LLM | null {
  const preset = PROVIDER_PRESETS[c.provider];
  if (!preset || !c.apiKey) return null;
  return new OpenAICompatLLM({ apiKey: c.apiKey, baseUrl: preset.baseUrl, model: c.model?.trim() || preset.model });
}
