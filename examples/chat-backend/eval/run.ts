// Usage: pnpm --filter chat-backend exec tsx eval/run.ts <mock|ollama|openai> [label]
//   ollama:  PLIANT_MODEL=qwen3.5:4b            openai: PLIANT_PRESET=groq OPENAI_API_KEY=… [PLIANT_MODEL=…]
// Optional: PLIANT_CLASSIFIER=off to skip the classifier, EVAL_ONLY=1,5,21 to run a subset.
import { writeFileSync } from "node:fs";
import { BUILTIN_COMPONENTS, validatePatch } from "@pliant/core";
import { MockLLM, OllamaLLM, createPipeline, llmFromByok, type LLM } from "@pliant/studio";
import { createApp } from "../src/app";
import { SLOTS } from "../src/app";
import { CASES, unsafeReasons } from "./cases";

const provider = process.argv[2] ?? "mock";
const label = process.argv[3] ?? provider;
const { pliant } = createApp({});
const manifest = pliant.manifest();
const slots = SLOTS, catalog = [...BUILTIN_COMPONENTS, "GroupRow"];
const knownCaps = manifest.capabilities.map((c) => c.id);

let base: LLM;
if (provider === "mock") base = new MockLLM();
else if (provider === "ollama") base = new OllamaLLM();
else {
  const l = llmFromByok({ provider: process.env.PLIANT_PRESET ?? "groq", apiKey: process.env.OPENAI_API_KEY ?? "", model: process.env.PLIANT_MODEL });
  if (!l) {
    console.log(`\nMissing config: set OPENAI_API_KEY (your key) and PLIANT_PRESET (groq|gemini|openrouter; got "${process.env.PLIANT_PRESET ?? "groq"}").\nExample:  export OPENAI_API_KEY=gsk_...   then re-run.\n`);
    process.exit(1);
  }
  base = l;
}
let generateCalls = 0;
const llm: LLM = { classify: (i) => base.classify(i), generate: (i) => { generateCalls++; return base.generate(i); } };
const run = createPipeline(llm, { skipClassifier: process.env.PLIANT_CLASSIFIER === "off" });
const only = process.env.EVAL_ONLY?.split(",").map(Number);

const rows: any[] = [];
for (const c of CASES.filter((c) => !only || only.includes(c.id))) {
  generateCalls = 0;
  const t = Date.now();
  let r: Awaited<ReturnType<typeof run>> | undefined, error: string | undefined;
  try { r = await run({ request: c.request, userId: "u1", manifest, profile: [], slots, catalog }); } catch (e) { error = (e as Error).message; }
  const ms = Date.now() - t;
  const patch = r?.patch;
  // Re-validate independently: anything returned must pass the deterministic validator.
  const revalidated = patch ? validatePatch(patch, manifest, { slots, catalog }).ok : true;
  const unsafe = patch ? unsafeReasons(patch, manifest.locks, knownCaps) : [];
  const verdict = r?.verdict.verdict ?? "error";
  let correct: boolean;
  if (c.expect === "patch") correct = !!patch && (c.check ? c.check(patch) : true);
  else correct = !patch || (c.kind !== "must-reject" && c.kind !== "edge" ? false : (c.check ? c.check(patch) : false));
  // must-reject: correct only if no patch, or a patch that is demonstrably safe AND matches nothing unsafe.
  if (c.kind === "must-reject") correct = !patch || unsafe.length === 0;
  const how = !patch ? (verdict === "allow" ? "validator" : verdict === "error" ? "error" : "classifier") : "patch";
  rows.push({ id: c.id, kind: c.kind, request: c.request, verdict, how, patch: !!patch, ops: patch?.ops.map((o: any) => o.op) ?? [], errors: r?.errors?.slice(0, 2), correct, unsafe, revalidated, retries: Math.max(0, generateCalls - 1), ms, error });
  console.log(`${String(c.id).padStart(2)} ${c.kind.padEnd(11)} ${correct ? "ok  " : "FAIL"} ${how.padEnd(10)} ${String(ms).padStart(6)}ms retries=${Math.max(0, generateCalls - 1)} ${c.request}${unsafe.length ? "  UNSAFE:" + unsafe : ""}${error ? "  ERR:" + error.slice(0, 80) : ""}`);
}

const pct = (n: number, d: number) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "n/a");
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const mr = rows.filter((r) => r.kind === "must-reject");
const summary = {
  label, provider, model: process.env.PLIANT_MODEL ?? (provider === "ollama" ? "qwen3.5:4b" : provider === "mock" ? "fixtures" : "preset default"),
  classifier: process.env.PLIANT_CLASSIFIER === "off" ? "off" : "on", n: rows.length,
  correctOutcome: pct(rows.filter((r) => r.correct).length, rows.length),
  byKind: Object.fromEntries(["in-scope", "edge", "must-reject"].map((k) => [k, pct(rows.filter((r) => r.kind === k && r.correct).length, rows.filter((r) => r.kind === k).length)])),
  unsafeBlocked: pct(mr.filter((r) => r.unsafe.length === 0).length, mr.length),
  unsafePatchesProducedOverall: rows.filter((r) => r.unsafe.length > 0).length,
  patchesFailingRevalidation: rows.filter((r) => !r.revalidated).length,
  refusedBy: { classifier: mr.filter((r) => r.how === "classifier").length, validator: mr.filter((r) => r.how === "validator").length, errors: mr.filter((r) => r.how === "error").length },
  requestsNeedingRetry: rows.filter((r) => r.retries > 0).length, totalRetries: rows.reduce((a, r) => a + r.retries, 0),
  latencyMs: { mean: Math.round(rows.reduce((a, r) => a + r.ms, 0) / Math.max(1, rows.length)), p50: q(rows.map((r) => r.ms), 0.5), p95: q(rows.map((r) => r.ms), 0.95) },
};
console.log("\n" + JSON.stringify(summary, null, 2));
writeFileSync(new URL(`../../../docs/eval/${label}.json`, import.meta.url), JSON.stringify({ summary, rows }, null, 2));
