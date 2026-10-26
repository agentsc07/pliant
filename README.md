# Pliant

A framework that separates **what an app can do** (developer-owned) from **how each user sees and uses it** (user-owned). Users describe changes in natural language; Pliant classifies the request, generates a patch, validates it deterministically, previews it, and saves it to that user's profile. Users can even build new features, as compositions of capabilities the backend already has, within hard limits the developer declares.

See [`spec.md`](./spec.md) for the full design. This repo is the v0.1 implementation.

## Architecture

```
┌──────────────── Developer's existing app ────────────────┐
│                                                          │
│  Frontend (React)            Backend (Node/Express)      │
│  ┌────────────────────┐      ┌──────────────────────┐    │
│  │ <PliantProvider>   │      │ pliant.capability()  │    │
│  │  existing screens  │◄────►│ existing routes      │    │
│  │  wrapped in        │      │ + /__pliant/* routes │    │
│  │  <Slot> / <Screen> │      │ + policy enforcement │    │
│  └────────────────────┘      └──────────┬───────────┘    │
└─────────────────────────────────────────┼────────────────┘
                                          │ injected handler
                          ┌───────────────▼──────────────┐
                          │ @pliant/studio               │
                          │ classifier → generator →     │
                          │ validator → preview          │
                          └──────────────────────────────┘
```

| Package | What it is |
|---|---|
| `@pliant/core` | Zod schemas (manifest, patch, workflow, profile), safe expression evaluator, static workflow policy checker, patch validator, profile resolver, workflow runner (I/O injected, so it also does dry-runs). Pure TS, no I/O. |
| `@pliant/server` | Express: `pliant.capability()`, `/__pliant/*` routes, **server-side fan-out and rate-limit enforcement**, SQLite profile store. |
| `@pliant/react` | `PliantProvider`, `Screen`, `Slot`, `Item`, component registry + built-in catalog, op renderer, workflow runner UI (confirm / progress / partial-failure report / retry), customization panel (preview, dry-run, patch list, diff, reset). |
| `@pliant/studio` | Classifier → generator (retries ×2 with validator errors) → validator. Claude via the Anthropic SDK, or a deterministic mock. |
| `examples/chat-backend` | Groupy backend: SQLite, 3 users, 40 groups, 11 capabilities. |
| `examples/chat-classic` | The demo app the old way (plain React). |
| `examples/chat-pliant` | The same app adopting Pliant, plus `/compare`. |

### Where the security boundary is

The client is user-modified, so it is never trusted:

1. **Classifier**: fast, friendly rejection. *Not* a security boundary.
2. **Validator** (`@pliant/core`, deterministic): schema, layer dials, locks, token values, expression syntax, invariants, and the §6 static policy check (capability exists, args match, `forEach` only over batchable capabilities, fan-out ≤ `maxFanOut` or a runtime cap is inserted, confirm before destructive/external, `schedule` only around schedulable capabilities). It runs in the studio **and again on the server when a patch is saved**, and workflows are re-checked **before every run** in the browser.
3. **Server enforcement**: `X-Pliant-Run` ties calls to a registered run. The server counts calls per run per capability and rejects beyond `maxFanOut` regardless of what the client declared. `rateLimit` always applies. A call with no run header counts as its own single-call run, so a capped capability can't be batched by omitting the header. Plain requests otherwise behave as normal.

## Run it

```bash
pnpm install
pnpm dev:mock            # backend :4000, classic :5173, pliant :5174 — offline, mock studio
# open http://localhost:5174          (Pliant app)
# open http://localhost:5174/compare  (side-by-side for the demo video)
```

Add `?user=u2` / `?user=u3` to use another seeded user.

**Local model via Ollama** (no API key): `PLIANT_PROVIDER=ollama PLIANT_MODEL=qwen3.5:4b pnpm dev`. Uses Ollama's `/api/chat` with JSON-schema-constrained output (`OLLAMA_HOST` defaults to `http://localhost:11434`; `PLIANT_CLASSIFIER_MODEL` optionally uses a different model for the classifier). Spot-checked with `qwen3.5:4b`: demos 1–8 gave the right outcome (demo 4 took ~45–145s on that model, and small models sometimes need the validator's retry loop). Small models can contradict themselves in the classifier step, so a rambling or self-contradicting refusal is ignored and the validator decides; `PLIANT_CLASSIFIER=off` skips the classifier entirely (recommended for ≤4B models). Try your own requests with `pnpm --filter @pliant/studio exec tsx test/ollama.live.ts "your request"`.

**Live mode** (real Claude): `ANTHROPIC_API_KEY=... pnpm dev`. Models come from `PLIANT_MODEL` (default `claude-sonnet-5-5`, generation) and `PLIANT_CLASSIFIER_MODEL` (default `claude-haiku-5-5`). `PLIANT_MOCK=1` swaps both for fixtures keyed on the demo requests.

### Tests

```bash
pnpm test                 # core 42 · server 4 · studio 4 · react 5 · backend 19
pnpm e2e                  # Playwright, all 9 demos in mock mode (needs: pnpm exec playwright install chromium)
```

## Adopting Pliant in your app

**Backend**: declare what the app can do, next to the route:

```ts
const pliant = createPliant({
  app: "Groupy",
  locks: ["brand.logo", "legal.footer", "billing.price"],
  dials: { L3: "restricted", L4: "locked" },
  entities: [{ id: "group", fields: { name: "string", unread: "number" } }],
  customize: createCustomizer(),          // from @pliant/studio
  slots: [...], catalog: [...],           // what the frontend exposes
});

pliant.capability({
  id: "message.send", description: "...", entity: "message", effect: "external",
  route: { method: "POST", path: "/groups/:groupId/messages" },
  params: z.object({ groupId: z.string(), text: z.string() }),
  policy: { batchable: true, maxFanOut: 5, requiresConfirm: true, rateLimit: { count: 30, perSeconds: 60 }, schedulable: false },
  handler: ({ groupId, text }, req) => ...,
});
app.use(pliant.router);
```

Policy defaults by effect: `read`/`write` → batchable; `destructive` → not batchable, confirm; `external` → confirm, fan-out 5. Explicit policy overrides defaults. Identify users with the `x-user-id` header (swap `userIdOf` for your auth).

**Frontend**: wrap screens and mark extension points:

```tsx
<PliantProvider manifestUrl="/__pliant/manifest" baseUrl={API} userId={me.id} onChange={refetch}>
  <Screen id="chatList">
    <Slot id="chatList.header"><Header /></Slot>
    <Slot id="chatList.items" entity="group" data={groups}>
      <GroupList groups={groups} />          {/* data prop is swapped for filtered/sorted items */}
    </Slot>
    <Slot id="legal.footer" locked><Footer /></Slot>
  </Screen>
</PliantProvider>
```

- Wrap each row in `<Item id={g.id}>` so selection can be added in place.
- Drop `<CustomizeButton />` anywhere.
- `registerComponent("GroupRow", Comp, propsSchema?)` adds your component to the catalog so generated views stay on-brand (add its name to the server's `catalog`).
- **Theming contract** (L0 tokens): the runtime sets `data-theme` on its root, `font-size` (fontScale), and the CSS variables `--accent`, `--radius`, `--row-pad` (density), `--font-family`. Style your app with those variables and define your own `[data-theme="dark"]` palette.

### The adoption diff

Classic → Pliant for the Groupy frontend is **5 files, +45 / −17 lines** (of ~225 lines of app code):
`App.tsx` (provider/screen/slots), `GroupList.tsx` (`<Item>`), `Header.tsx` (locked slots + button), `main.tsx` (register `GroupRow`), `styles.css` (dark palette, height). Reproduce with `diff -ru examples/chat-classic/src examples/chat-pliant/src`.

## Control layers

| Layer | Examples | Ops |
|---|---|---|
| L0 Look | theme, text size, density, accent | `setTheme`, `setToken` (allow-listed tokens with validated values) |
| L1 Layout | hide / move / resize / reorder | `hide`, `move`, `resize`, `reorder` |
| L2 Views | new tab, saved filter | `addView`, `addFilter` |
| L3 Workflows | selection + batch actions | `enableSelection`, `addComponent`, `addWorkflow` + workflow DSL |
| L4 Capabilities | anything new | never generated: denied with "needs the developer" |

Workflows are data (`call`, `forEach`, `filter`, `confirm`, `input`, `if`, `report`, `schedule`) and expressions use a small hand-written evaluator, with no `eval`.

## Status vs. the spec

| Phase | Status |
|---|---|
| 1 Core | ✅ every §6 reject rule and demo verdict covered by Vitest |
| 2 Backend + classic | ✅ |
| 3 Server | ✅ demo #9 as an API test (and in Playwright) |
| 4 React runtime | ✅ demos 1–4 via hand-written patches (Vitest + RTL) |
| 5 Studio | ✅ all 9 demos pass in mock mode via Playwright. Ollama provider spot-checked on demos 1–8 with `qwen3.5:4b`. ⚠️ The Anthropic provider is implemented but **has not been run** (needs an `ANTHROPIC_API_KEY`). |
| 6 Polish | ✅ `/compare`, panel UX, this README |

### Known limits / v0.1 choices

- Preview applies the patch live with a "compare with before" toggle and a workflow dry-run log, rather than rendering two sandboxed copies (`/compare` is classic vs. Pliant).
- `schedule` runs via in-browser timers while the page is open.
- The demo identifies users via a header, not real auth.
- Slot renames break patches silently (spec open question: slot ids are treated as a stable contract).
