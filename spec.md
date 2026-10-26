# Pliant — Build Spec (v0.1)

> Working name. A framework that separates **what an app can do** (developer-owned) from **how each user sees and uses it** (user-owned), with users able to build new features by composing existing backend capabilities — within hard limits the developer declares.

This spec is written for Claude Code to implement. Build in the phases at the end, in order. Each phase must pass its acceptance checks before the next starts.

---

## 1. The core idea

Today a developer ships one fixed frontend. With Pliant:

- **Developer** declares *capabilities* (what the backend can do), *policies* (hard constraints), and *locks* (what users may not change). Their existing UI becomes the **default profile**.
- **User** asks in natural language ("let me select multiple groups and mute them"). Pliant checks it against policy, generates a change, validates it deterministically, previews it, and saves it to that user's profile.
- **No backend changes** are needed for user-built features. They are compositions of existing capabilities.

### Control layers

| Layer | Examples | Who controls |
|---|---|---|
| L0 Look | theme, fonts, colours, density, text size | User, unless locked |
| L1 Layout | move / hide / resize panels, reorder lists | User, within invariants |
| L2 Views | new tab, dashboard, saved filter, derived columns | User (read-only, low risk) |
| L3 Workflows | multiselect + batch actions, macros, multi-step flows | User, **gated by capability policies** |
| L4 Capabilities | anything the backend cannot already do | Developer only — never generated |

Each app sets a per-layer dial: `open` / `restricted` / `locked`.

---

## 2. Product shape: how developers adopt it

**Decision: importable packages on both sides, plus a customization service.** Not "give us your endpoints and we build the frontend". Developers keep their existing codebase and components. Pliant wraps them.

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
                                          │
                          ┌───────────────▼──────────────┐
                          │ Customization service        │
                          │ classifier → generator →     │
                          │ validator → profile store    │
                          │ (self-hostable; v1 runs      │
                          │  inside the server package)  │
                          └──────────────────────────────┘
```

Why both sides:
- **The client is user-modified, so the client cannot be trusted.** Every policy (fan-out limits, confirmation, rate limits, forbidden batching) must be **enforced on the server** by `@pliant/server`, not just checked in the UI or by the classifier.
- The server package also publishes the manifest the generator reads.
- The client package renders the developer's real components as defaults and applies user overrides.

A later "endpoints-only" mode (generate a whole frontend from an OpenAPI spec + manifest) is a **non-goal for v0.1**. It is a possible future add-on.

### Packages (TypeScript monorepo, pnpm workspaces)

| Package | Purpose |
|---|---|
| `@pliant/core` | Schemas (manifest, UI spec, workflow DSL, profile), validator, policy checker. Pure TS, no I/O. |
| `@pliant/server` | Express middleware: capability registration, `/__pliant/*` routes, server-side policy enforcement, profile storage (SQLite in v0.1). |
| `@pliant/react` | `<PliantProvider>`, `<Screen>`, `<Slot>`, component registry, spec renderer, workflow runner, customization panel UI. |
| `@pliant/studio` | Customization pipeline: classifier → generator → validator. Calls the Claude API; has a deterministic **mock mode** for tests and offline demos. |
| `examples/chat-backend` | Shared backend for the demo app. |
| `examples/chat-classic` | The demo app the **old way** (plain React, no Pliant). |
| `examples/chat-pliant` | **Same app**, adopting Pliant. The diff between classic and pliant should be small. That is the adoption story. |

Stack: Node 20+, TypeScript strict, React 18 + Vite, Express, Zod for all schemas, SQLite (better-sqlite3), Vitest, Playwright for demo e2e.

---

## 3. Capability manifest (developer-authored)

Registered in backend code, next to the route it describes:

```ts
pliant.capability({
  id: "group.mute",
  description: "Mute notifications for a group",
  route: { method: "POST", path: "/groups/:groupId/mute" },
  params: z.object({ groupId: z.string(), hours: z.number().optional() }),
  returns: z.object({ ok: z.boolean() }),
  entity: "group",
  effect: "write",            // "read" | "write" | "destructive" | "external" (sends/notifies others)
  policy: {
    batchable: true,
    maxFanOut: null,          // null = unlimited
    requiresConfirm: false,
    rateLimit: null,          // e.g. { count: 20, perSeconds: 60 }
    schedulable: true,        // may run inside a timed macro
  },
});

pliant.capability({
  id: "message.send",
  entity: "group",
  effect: "external",
  policy: { batchable: true, maxFanOut: 5, requiresConfirm: true, rateLimit: { count: 30, perSeconds: 60 }, schedulable: false },
  ...
});

pliant.capability({
  id: "group.delete",
  effect: "destructive",
  policy: { batchable: false, requiresConfirm: true, schedulable: false },
  ...
});
```

Also declared:

- **Entities and relations**: `group`, `message`, `user`, `group has many messages`, and which fields are readable for views and filters.
- **Layer dials**: `{ L0: "open", L1: "open", L2: "open", L3: "restricted", L4: "locked" }`.
- **Locks**: named elements users cannot hide, move or restyle (e.g. `brand.logo`, `legal.footer`, `billing.price`).
- **Invariants**: declarative rules every generated spec must satisfy, e.g.
  - `effect:destructive ⇒ confirm step present`
  - `locked element visible on its screen`
  - `effect:external ⇒ recipient count shown before confirm`

Sensible defaults by effect type: `read` → batchable, no confirm; `destructive` → not batchable, confirm required; `external` → confirm, fan-out 5. Explicit policy overrides defaults.

Exposed at `GET /__pliant/manifest`.

---

## 4. Frontend adoption surface

The developer wraps existing screens and marks extension points:

```tsx
<PliantProvider manifestUrl="/__pliant/manifest" userId={me.id}>
  <Screen id="chatList">
    <Slot id="chatList.header"><Header /></Slot>
    <Slot id="chatList.items" entity="group" data={groups}>
      <GroupList groups={groups} />
    </Slot>
  </Screen>
</PliantProvider>
```

- `registerComponent("GroupRow", GroupRow, propsSchema)` puts developer components in the catalog the generator can use, so generated UI stays on-brand.
- Built-in catalog: `List`, `Table`, `Card`, `Tabs`, `SelectionBar`, `ActionButton`, `FilterBar`, `Stat`, `Chart`, `ConfirmDialog`, `ProgressToast`.
- A slot with an `entity` lets the user add selection, filtering and actions over that entity's items **in place**.
- User-created views (L2) go in a built-in "My views" tab in v0.1. In-place injection into slots is required for L3 selection and action bars.

---

## 5. User profile spec (what gets generated and stored)

A profile is a list of **patches** on top of the default. Each patch is JSON validated by Zod:

```jsonc
{
  "id": "p_7f2",
  "layer": "L3",
  "request": "let me select multiple groups and mute or archive them",
  "createdAt": "...",
  "enabled": true,
  "ops": [
    { "op": "enableSelection", "slot": "chatList.items", "mode": "multi" },
    { "op": "addComponent", "slot": "chatList.header", "component": "SelectionBar",
      "props": { "actions": ["wf_bulk_mute", "wf_bulk_archive"] }, "showWhen": "selection.count > 0" }
  ],
  "workflows": [ /* see §6 */ ]
}
```

Op types (v0.1): `setTheme`, `setToken`, `hide`, `move`, `resize`, `reorder`, `addComponent`, `enableSelection`, `addView`, `addFilter`, `addWorkflow`.

Patches can be toggled, reordered and deleted, and the user can **reset to default**. A **diff view** shows exactly what a profile changes versus the developer default.

---

## 6. Workflow DSL (L3: the important part)

The LLM **never writes executable JS**. Workflows are data, so they can be statically checked against policy.

```jsonc
{
  "id": "wf_bulk_mute",
  "label": "Mute selected",
  "input": { "from": "selection", "entity": "group" },
  "steps": [
    { "type": "confirm", "message": "Mute {{input.count}} groups?", "when": "input.count > 10" },
    { "type": "forEach", "items": "input", "concurrency": 4,
      "do": [ { "type": "call", "capability": "group.mute", "args": { "groupId": "{{item.id}}", "hours": 8 } } ] },
    { "type": "report" }   // standard partial-failure summary: "Muted 18/20 · 2 failed · Retry"
  ]
}
```

Step types: `call`, `forEach`, `filter`, `confirm`, `input` (ask user for a value), `if`, `report`, `schedule` (macro trigger, only for `schedulable` capabilities).

Expressions use a small safe evaluator (no `eval`). Supported: field access, comparisons, `count`, `and/or/not`.

**Static policy check** (in `@pliant/core`, run before saving and again before every run):
- Every `call` references an existing capability, and its args match the param schema.
- `forEach` over a non-`batchable` capability → reject.
- Possible fan-out exceeds `maxFanOut` → reject, or insert a runtime cap + error if the count is dynamic.
- `destructive` / `external` with no `confirm` before it → auto-insert the confirm, or reject if the layer is `restricted`.
- `schedule` around a non-`schedulable` capability → reject.

**Server enforcement** (in `@pliant/server`): workflow runs send a `X-Pliant-Run` header with run id and declared fan-out. The server tracks per-run and per-user counts and rejects calls beyond `maxFanOut` or `rateLimit`, **regardless of what the client claims**. Plain (non-Pliant) requests keep the app's normal behaviour.

---

## 7. Customization pipeline (`@pliant/studio`)

```
user request
  → 1. Policy classifier   (fast, cheap)
  → 2. Generator           (LLM, emits patch JSON only)
  → 3. Validator           (deterministic: schema + policy + invariants)
  → 4. Preview             (rendered sandboxed, before/after)
  → 5. User accepts        → saved to profile
```

1. **Classifier**: input is the request plus a compact manifest summary. Output:
   `{ verdict: "allow" | "deny" | "needs_clarification", layer: "L0".."L4", reason, capabilitiesNeeded[] }`.
   - L4 requests ("add voice calls") → deny with "this needs the developer to add a capability".
   - Policy conflicts ("message all 200 groups") → deny, naming the limit.
   - **The classifier is for fast, friendly rejection. It is not the security boundary.** Steps 3 and server enforcement are.
2. **Generator**: given the request, manifest, component catalog, current profile and the classifier's layer, it emits **only** a patch matching the Zod schema (use structured output / tool-call JSON). On validation failure, retry up to 2 times with the validator errors fed back.
3. **Validator**: Zod schema, op legality per layer dial, locks untouched, invariants hold, workflow policy check (§6). Fully deterministic, with unit tests.
4. **Preview**: renders default vs patched side by side. Workflows run in **dry-run mode** against a mock (calls are logged, not sent).

LLM config: Claude via the Anthropic SDK. Model id in env (`PLIANT_MODEL`), default to a current Sonnet model for generation and a Haiku model for classification. `PLIANT_MOCK=1` swaps both for a fixture-based mock keyed on demo requests, so tests and demos run offline.

Endpoints:
- `POST /__pliant/customize` → classifier + generator + validator → `{ verdict, patch?, errors?, preview? }`
- `GET/PUT/DELETE /__pliant/profile/:userId/patches/:id`
- `POST /__pliant/run` → server-side run registration for workflows

---

## 8. Demo app: "Groupy" (WhatsApp-like)

Backend (`examples/chat-backend`): users, groups and messages in SQLite, seeded with ~3 users, 40 groups and realistic messages.

Capabilities: `group.list`, `group.get`, `group.mute`, `group.unmute`, `group.archive`, `group.pin`, `group.markRead`, `group.leave` (destructive), `group.delete` (destructive, not batchable), `message.list`, `message.send` (external, fan-out 5).

**chat-classic**: a normal chat-list + conversation UI. One group at a time, fixed layout.

**chat-pliant**: the same components, wrapped as in §4, plus a "Customize" button that opens a natural-language box and a patch list.

### Demo script (each must work end to end, in mock mode and live mode)

| # | User request | Expected result |
|---|---|---|
| 1 | "Dark mode, bigger text, compact list" | L0 patch applied instantly |
| 2 | "Hide the stories bar, put pinned groups on top" | L1 patch |
| 3 | "Give me a tab with groups that have more than 50 unread" | L2 view in "My views" |
| 4 | "Let me select multiple groups and mute or archive them" | **L3**: selection mode in the chat list + action bar; runs with progress + partial-failure report |
| 5 | "Send 'Happy Diwali' to all my groups" | **Classifier denies**: fan-out limit 5. UI offers "send to up to 5 selected" instead |
| 6 | "Delete all groups I haven't opened in a month" | **Denied**: `group.delete` not batchable |
| 7 | "Remove the logo" | **Denied**: locked element |
| 8 | "Add video calling" | **Denied as L4**: needs a developer capability |
| 9 | Tampered client sends 20 `message.send` calls in one run | **Server rejects** after 5 |

Side-by-side page `/compare` shows classic and pliant next to each other for the demo video.

---

## 9. Phases

**Phase 1 — Core schemas and validator**
- Zod schemas for manifest, patch, workflow, profile; expression evaluator; static policy checker; invariant checker.
- ✅ Vitest suite covering every reject rule in §6 and every demo request's expected verdict, using hand-written patches.

**Phase 2 — Demo backend + classic app**
- Seeded backend, chat-classic UI.
- ✅ Classic app usable end to end.

**Phase 3 — Server package**
- `pliant.capability()`, manifest route, profile store, run registration, server-side fan-out and rate enforcement.
- ✅ Demo #9 passes as an API test.

**Phase 4 — React runtime**
- Provider, Screen, Slot, registry, renderer for every op type, workflow runner with dry-run, report UI, diff view, reset.
- Convert chat-classic → chat-pliant with minimal changes. Record the diff size in the README.
- ✅ Hand-written patches for demos 1–4 render and run correctly.

**Phase 5 — Studio pipeline**
- Classifier, generator with retry loop, preview; mock mode fixtures for all 9 demos; live mode with the Claude API.
- ✅ All 9 demos pass in mock mode via Playwright. Live mode passes demos 1–8 in a manual check.

**Phase 6 — Demo polish**
- `/compare` page, customization panel UX, README with architecture diagram and "adopting Pliant in your app" guide.

---

## 10. Non-goals for v0.1

- Endpoints-only mode (generating a whole frontend from OpenAPI).
- Frameworks other than React / Express.
- Auto-inferring the manifest from existing code (planned next; see open questions).
- Sharing patches between users, or a marketplace.
- Learning from implicit usage. Only explicit requests in v0.1.

## 11. Open questions (decide after v0.1)

- Should the manifest be inferred from OpenAPI + route code as a draft the developer approves?
- Should patches survive developer UI updates, e.g. when a slot is renamed? (Probably: slot ids are a stable contract; warn on breakage.)
- Can users share or export features ("install Sai's bulk-mute")?
- Where should the customization service run in production: developer-hosted vs a hosted Pliant service?