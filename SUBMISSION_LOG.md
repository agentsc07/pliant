# Submission log

## Step 0 — state
- Read README.md, spec.md, SUBMISSION_TASK.md. 111 source files, all readable (no iCloud eviction → no `_holding/` needed).
- `pnpm install && pnpm test`: initially chat-backend failed (better-sqlite3 11 has no build for Node v26). **Decision:** bumped better-sqlite3 to ^13.0.3 (needs Node ≥22). All tests then pass: core 42, server 4, studio 6, react 7, backend 19.
- `git init`, .gitignore (node_modules, *.db, .env*, dist, *.pem, *.key).

## Step 1 — one deployable unit (done)
- `examples/chat-backend/src/server.ts` now also serves `chat-pliant/dist` (/ and /compare) and `chat-classic/dist` (/classic/). Frontends build with `VITE_API=` (same origin).
- `PLIANT_DEMO=1` → in-memory SQLite, reseeded on every boot. `pnpm demo` and `docker run -p 4000:4000 pliant-demo` both verified (HTTP 200 on /, /classic/, /compare, /__pliant/manifest; Playwright smoke: 40 groups, dark-mode patch applied, 3-user compare view loads, no console/network errors).
- **Decision:** `/compare` gained a `?view=users` mode (three users, three UIs) because the demo script needs it. Banner "resets on restart; first load can take ~50 s" added (build-time flag VITE_DEMO).

## Step 2 — real-model path (code done, real-provider run PENDING a key)
- `packages/studio/src/openai.ts`: OpenAI-compatible provider (JSON mode). Presets for Groq, Gemini, OpenRouter. **Decision:** base URLs come from a fixed preset table, never from the request (SSRF guard); provider errors are scrubbed of the key.
- Customise panel: "Use your own model key" (provider, key, optional model, "remember in this browser"). Headers `x-pliant-llm-*` per request; server never stores/logs it. Tests added (unknown provider refused; key never echoed).
- Server-side default: `PLIANT_PROVIDER=openai PLIANT_PRESET=groq OPENAI_API_KEY=…`.
- **Blocked on the owner:** no hosted-model key exists on this machine, so the "9 demos on one real provider" run is not done yet (see Step 3).

## Step 4 — deploy prep (done; Render click-through needs the owner's login)
- `Dockerfile`, `.dockerignore`, `render.yaml`, `docs/deploy.md`, `startup.md`.

## Step 3 — evaluation (mock + Ollama done; hosted model PENDING a key)
- Harness: `examples/chat-backend/eval/` (30 cases) → `docs/eval/*.json`, summary in `docs/eval/README.md`.
- mock: 19/30 correct, unsafe blocked 10/10. Ollama qwen3.5:4b: 26/30 correct, **unsafe blocked 10/10**, 0 unsafe patches, 1 retry, p50 7.8 s / p95 45 s.
- Found a real issue: one request hung the 4B model ~5 min. **Decision:** added a 120 s timeout (Ollama) / 60 s (hosted); left the case recorded as a failure.
- Hosted column and "9 demos on a real provider" need an API key from the owner (see login block).

## Fix — Node version mismatch
- better-sqlite3 13 only supports Node ≥ 22, but the owner's shell runs Node 20.20.2 → native-module segfault (exit 139) when running the eval/tests. **Decision:** pinned `better-sqlite3@^12.11.1` (supports Node 20–26). After switching Node versions run `pnpm rebuild better-sqlite3`.

## Decision — hosted evaluation skipped
- Owner chose MVP scope: no hosted-model evaluation. Column marked "not run" in docs/eval/README.md. Groq default model updated (llama-3.3-70b-versatile was retired 2026-08-16) and 429 retry added.
