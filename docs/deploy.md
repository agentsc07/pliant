# Deploying the Pliant demo

The whole demo is **one Node service on one port** (Express API + built frontends), packaged by the root `Dockerfile`.
It defaults to the mock studio, so a public deployment costs nothing and needs **no secrets**.

## Local
```bash
pnpm demo                                          # http://localhost:4000
docker build -t pliant-demo . && docker run -p 4000:4000 pliant-demo
```

## Render (free tier, from the Dockerfile)
`render.yaml` is a Blueprint: one `web` service, `runtime: docker`, `plan: free`, health check `/__pliant/manifest`.

1. Push the repo to GitHub (private is fine; Render can read private repos you authorise).
2. Render dashboard → **New → Blueprint** → pick the repo → **Apply**. First build takes ~5 min.
3. Open `https://pliant-demo.onrender.com` (name may get a suffix). Links: `/`, `/classic/`, `/compare`, `/compare?view=users`.

Notes
- Free instances sleep after ~15 min idle; the first request takes ~50 s. The app shows a banner saying so.
- SQLite is in-memory (`PLIANT_DEMO=1`): every boot reseeds, every restart wipes user profiles. That is intentional for a public demo.
- No env vars are required. Visitors can paste their own Groq/Gemini/OpenRouter key in the customise panel; it is kept in their browser, sent per request in headers, and never stored or logged by the server.
- To use a hosted model server-side instead, set `PLIANT_MOCK=0`, `PLIANT_PROVIDER=openai`, `PLIANT_PRESET=groq`, `OPENAI_API_KEY` (as a Render secret) — this will spend your key's quota, so keep it off for the public demo.

## Health / troubleshooting
- `curl https://<url>/__pliant/manifest` should return JSON.
- Build fails on `better-sqlite3` → the Dockerfile installs `python3 make g++`; make sure the base image stays on Node ≥ 22.
