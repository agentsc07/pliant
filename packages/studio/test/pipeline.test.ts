import { describe, expect, it } from "vitest";
import { createCustomizer, createPipeline, MAX_RETRIES, OpenAICompatLLM, trustVerdict, type LLM } from "../src";
import type { Manifest } from "@pliant/core";

const manifest: Manifest = {
  app: "t", capabilities: [], entities: [],
  dials: { L0: "open", L1: "open", L2: "open", L3: "restricted", L4: "locked" },
  locks: ["brand.logo"], invariants: [],
};
const allow = { verdict: "allow" as const, layer: "L1" as const, reason: "ok", capabilitiesNeeded: [] };
const input = { request: "hide stories", userId: "u1", manifest, profile: [] };

describe("pipeline", () => {
  it("does not call the generator when the classifier denies", async () => {
    let generated = false;
    const llm: LLM = { classify: async () => ({ ...allow, verdict: "deny", reason: "no" }), generate: async () => { generated = true; return {}; } };
    const r = await createPipeline(llm)(input);
    expect(r.verdict.verdict).toBe("deny");
    expect(generated).toBe(false);
  });

  it("retries with validator errors fed back, then succeeds", async () => {
    const seen: (string[] | undefined)[] = [];
    const llm: LLM = {
      classify: async () => allow,
      generate: async (i) => {
        seen.push(i.previousErrors);
        return seen.length === 1 ? { layer: "L1", ops: [{ op: "hide", target: "brand.logo" }] } : { layer: "L1", ops: [{ op: "hide", target: "stories" }] };
      },
    };
    const r = await createPipeline(llm)(input);
    expect(r.patch?.ops).toEqual([{ op: "hide", target: "stories" }]);
    expect(seen[0]).toBeUndefined();
    expect(seen[1]?.join()).toMatch(/locked/);
    expect(r.preview).toBeTruthy();
  });

  it("gives up after MAX_RETRIES and returns validator errors (classifier is not the boundary)", async () => {
    let n = 0;
    const llm: LLM = { classify: async () => allow, generate: async () => { n++; return { layer: "L1", ops: [{ op: "hide", target: "brand.logo" }] }; } };
    const r = await createPipeline(llm)(input);
    expect(n).toBe(MAX_RETRIES + 1);
    expect(r.patch).toBeUndefined();
    expect(r.verdict.verdict).toBe("deny");
    expect(r.errors?.join()).toMatch(/locked/);
  });

  it("overrides model-chosen id/request/createdAt", async () => {
    const llm: LLM = { classify: async () => allow, generate: async () => ({ id: "evil", request: "x", createdAt: "1999", layer: "L1", ops: [] }) };
    const r = await createPipeline(llm)(input);
    expect(r.patch?.id).toMatch(/^p_/);
    expect(r.patch?.request).toBe("hide stories");
  });

  it("distrusts a rambling refusal and lets the validator decide", async () => {
    const rambling = { ...allow, verdict: "deny" as const, reason: "Wait, re-reading the prompt: the sidebar is not locked. Verdict should be allow." };
    expect(trustVerdict(rambling).verdict).toBe("allow");
    expect(trustVerdict({ ...allow, verdict: "deny", reason: "x".repeat(400) }).verdict).toBe("allow");
    expect(trustVerdict({ ...allow, verdict: "deny", reason: "The logo is locked by the developer." }).verdict).toBe("deny");
  });

  it("skipClassifier never calls the classifier; the validator still blocks locked targets", async () => {
    let classified = false;
    const llm: LLM = {
      classify: async () => { classified = true; return allow; },
      generate: async () => ({ layer: "L1", ops: [{ op: "hide", target: "brand.logo" }] }),
    };
    const r = await createPipeline(llm, { skipClassifier: true })(input);
    expect(classified).toBe(false);
    expect(r.patch).toBeUndefined();
    expect(r.errors?.join(" ")).toMatch(/locked/);
  });

  it("bring-your-own-key: unknown providers are refused (no arbitrary base URLs)", async () => {
    const r = await createCustomizer({ mock: true })({ ...input, byok: { provider: "https://evil.example", apiKey: "k" } });
    expect(r.verdict.verdict).toBe("deny");
  });

  it("bring-your-own-key: provider errors never echo the key", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("bad key sk-SECRET-123", { status: 401 })) as typeof fetch;
    try {
      const llm = new OpenAICompatLLM({ apiKey: "sk-SECRET-123", baseUrl: "https://x.test/v1", model: "m" });
      const err = await llm.generate({ ...input, layer: "L1" }).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("[key]");
      expect((err as Error).message).not.toContain("SECRET");
    } finally { globalThis.fetch = realFetch; }
  });
});

describe("hosted provider rate limits", () => {
  it("waits and retries on 429, then succeeds", async () => {
    const realFetch = globalThis.fetch, realTimeout = globalThis.setTimeout;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return calls === 1
        ? new Response('{"error":{"message":"Rate limit. Please try again in 1s."}}', { status: 429 })
        : new Response(JSON.stringify({ choices: [{ message: { content: '{"layer":"L0","ops":[]}' } }] }), { status: 200 });
    }) as typeof fetch;
    globalThis.setTimeout = ((fn: () => void) => realTimeout(fn, 0)) as typeof setTimeout; // don't actually wait in the test
    try {
      const llm = new OpenAICompatLLM({ apiKey: "k", baseUrl: "https://x.test/v1", model: "m" });
      await expect(llm.generate({ ...input, layer: "L0" })).resolves.toEqual({ layer: "L0", ops: [] });
      expect(calls).toBe(2);
    } finally { globalThis.fetch = realFetch; globalThis.setTimeout = realTimeout; }
  });
});
