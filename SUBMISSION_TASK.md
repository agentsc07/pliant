# Submission task: Pliant (side project)

Context: Pliant is a framework that separates what an app can do (developer-owned) from how each user sees it (user-owned). Users ask for UI changes in natural language; an LLM generates a patch that a deterministic validator checks. v0.1 is done (see README.md, spec.md). It needs to be deployed so a grader can try it from a link.

## Scope: feature freeze
No new framework features. The only code changes are the ones below. Goal: one link a grader opens and plays with, and one command that runs it locally.

## Steps
0. Read README.md and spec.md. `pnpm install && pnpm test`. This folder is **not a git repo yet**: `git init`, a proper .gitignore (node_modules, *.db, .env, dist), first commit. Log the state in `SUBMISSION_LOG.md`. If files fail to read (iCloud eviction), move the broken ones into `_holding/` and reinstall.
1. **One deployable unit.** Make the backend also serve the built `chat-pliant` frontend (with /compare), so the whole demo is ONE Node service on ONE port. Add a `Dockerfile` and a `pnpm demo` script: `docker run -p 4000:4000 pliant-demo` or `pnpm demo` gives the full app at localhost:4000. Reseed SQLite on boot.
2. **Real-model path, minimal.** Add an OpenAI-compatible provider (Groq / Gemini / OpenRouter free tiers) and a "use your own key" field in the customisation panel (key kept in the browser, sent per request, never stored or logged). Default stays mock, so the public demo costs nothing. Run the 9 demos once against one real provider and record pass/fail and latency.
3. **Small evaluation:** ~20-30 requests (in scope, edge cases, must-reject like "delete all users" or "message 500 groups"). Report correct-outcome rate, unsafe requests blocked, retries, latency for mock / Ollama qwen3.5:4b / one hosted model. Unsafe-blocked must be 100%; that is the headline.
4. **Deploy** the Docker image to Render free tier (render.yaml). Add a small banner: "demo resets on restart; first load can take ~50 s". Write `docs/deploy.md`. Give me the exact commands for anything that needs my login (gh repo create --private, Render).
5. **Packaging:** `pnpm pack` tarballs for the 4 packages and a 5-minute "add Pliant to your app" quickstart in the README. Do NOT publish to npm unless I say so.
6. Deliverables below. The demo script centres on /compare: same app, three users, three different UIs, plus one unsafe request being blocked.

## Rules
- Never delete files. Move anything unwanted into `_holding/` inside this repo.
- Never commit secrets (`*.pem`, `.env`, keys). Check `git status` and `.gitignore` before every commit.
- Push to `github.com/agentsc07/<repo>` with `gh`. Ask me before making the repo public or publishing a package.
- Ask me only when blocked on something only I can do (hardware, accounts, labelling, listening). Otherwise decide, and note the decision in `SUBMISSION_LOG.md`.
- Keep a task list. Commit small and often.

## Deliverables (every project)
1. `README.md` rewritten for a grader: one-line pitch, the problem, how it works (diagram), **results with numbers**, live links, how to run.
2. `docs/report.md`: one page. Problem, method, evaluation, limitations, next steps.
3. `docs/demo-script.md`: a 2-minute screen-recording script, shot by shot.
4. All deployed links working and listed at the top of the README.
