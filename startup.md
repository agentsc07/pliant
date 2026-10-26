# Pliant: startup

## Prerequisites
- Node 20–26, pnpm 12 (`npm i -g pnpm@12`). Docker only for the container route.

## Setup
```bash
pnpm install
```

## Run the whole demo (one service, one port)
```bash
pnpm demo                      # builds both frontends, serves everything on http://localhost:4000
# or
docker build -t pliant-demo . && docker run -p 4000:4000 pliant-demo
```
- `/` Pliant app · `/classic/` plain app · `/compare` side by side · `/compare?view=users` three users, three UIs
- `/dev` developer console (layer dials, locks, capability limits, try-it box, audit log, safety demo). Changes apply to your session only.
- Every browser gets its own throwaway session (`v_…` id in localStorage) with a fresh copy of the data. Add `?user=u2` / `?user=u3` for the fixed seeded users.
- Mock studio by default (`PLIANT_MOCK=1`, free, offline); SQLite is in-memory and reseeds on every boot.

## Dev mode (hot reload, 3 ports)
```bash
pnpm dev:mock                  # backend :4000, classic :5173, pliant :5174
```

## Real models (optional)
- Your own key: open ✨ Customize → "Use your own model key" (Groq / Gemini / OpenRouter). Stays in your browser.
- Local Ollama: `PLIANT_PROVIDER=ollama PLIANT_MODEL=qwen3.5:4b PLIANT_CLASSIFIER=off pnpm dev`
- Server-side hosted default: `PLIANT_PROVIDER=openai PLIANT_PRESET=groq OPENAI_API_KEY=… pnpm dev`

## Stop / test
- Stop: Ctrl-C (or `docker rm -f <container>`).
- `pnpm test` (unit + API), `pnpm typecheck`, `pnpm e2e` (Playwright; needs `pnpm exec playwright install chromium`; **stop any `pnpm dev` first**, e2e reuses ports 4000/5174).

## Common problems
- Segfault / `better_sqlite3.node` / NODE_MODULE_VERSION error (you switched Node versions) → `pnpm rebuild better-sqlite3`.
- Port 4000 busy → `lsof -ti:4000 | xargs kill`, or set `PORT=4001`.
- e2e fails with "verdict not found" → a real-model dev server is holding port 4000; stop it.
