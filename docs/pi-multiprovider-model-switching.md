# Study: multi-provider coexistence & runtime model switching (Ctrl+P) in Pi

**Status:** discovery / feasibility — no implementation yet.
**Question:** Pi's CLI can switch models with **Ctrl+P**, and multiple providers
should be able to co-exist. Can Horizon expose the same, and what would it take?

**Short answer:** Yes, and most of the hard parts are already in Pi. Pi's RPC
protocol — the exact transport Horizon already speaks (`pi --mode rpc`) — exposes
`set_model`, `cycle_model`, and `get_available_models`, which are the
programmatic equivalents of the TUI's Ctrl+P. Multiple providers co-exist
natively through `auth.json` + `models.json`. Horizon's settings already store
provider config **per provider** (`aiApiKeys` / `aiModels` / `aiBaseUrls`), so
the data model is ready. What's missing is (a) materializing *all* providers
into Pi's config instead of only the active one, and (b) wiring the RPC
model commands through to a renderer model picker.

Sources are Pi's own docs, shipped in the package and bundled into the binary
under `resources/bin/docs/`: `rpc.md`, `models.md`, `providers.md`,
`settings.md`, `keybindings.md`, `usage.md`.

---

## 1. What Pi supports natively

### 1.1 Ctrl+P is a TUI keybinding — but RPC has the same primitives

From `keybindings.md` (interactive TUI):

| Keybinding id | Default | Description |
|---|---|---|
| `app.model.select` | `ctrl+l` | Open model selector |
| `app.model.cycleForward` | `ctrl+p` | Cycle to next model |
| `app.model.cycleBackward` | `shift+ctrl+p` | Cycle to previous model |
| `app.thinking.cycle` | `shift+tab` | Cycle thinking level |

Horizon does **not** run the TUI — it runs `--mode rpc`. The TUI keybindings are
irrelevant to us, but `rpc.md` exposes the same operations as JSON commands on
stdin (which is exactly how `PiSession` already talks to Pi):

```jsonc
// Switch to a specific provider+model
{"type": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4-20250514"}

// Cycle to the next available model (the Ctrl+P equivalent)
{"type": "cycle_model"}
// → response.data = { model: {…}, thinkingLevel: "medium", isScoped: false }

// List every configured/available model
{"type": "get_available_models"}
// → response.data = { models: [ {…}, … ] }

// Thinking level (Ctrl+Shift+Tab equivalent)
{"type": "set_thinking_level", "level": "high"}
{"type": "cycle_thinking_level"}

// Current model is also reported by get_state → data.model
{"type": "get_state"}
```

Each command takes an optional `id` for request/response correlation —
`PiSession` already uses this pattern for `get_state`. **Model switching is a
live, in-session operation: no subprocess respawn is required.**

### 1.2 Multiple providers co-exist

Two on-disk files, both inside Pi's agent dir (which Horizon already controls via
`PI_CODING_AGENT_DIR`):

- **`auth.json`** (`providers.md`) — a map keyed by provider id, e.g.
  `{ "anthropic": {…}, "openai": {…}, "google": {…} }`. Many providers at once.
- **`models.json`** (`models.md`) — a `providers` map for custom/proxy/local
  providers (Ollama, vLLM, LM Studio, gateways, custom base URLs), each with its
  own `baseUrl` / `api` / `apiKey` / `models[]`. Built-in providers ship their
  own model lists; `models.json` can also just override a built-in provider's
  `baseUrl` while keeping its models.

Credential **resolution order** (`providers.md`): `--api-key` → `auth.json` →
env var → `models.json` keys. Importantly, **`/model` (and therefore
`get_available_models`/`cycle_model`) only surface providers whose auth is
present** — "availability checks use configured auth presence." So for multiple
providers to appear in the picker, each must have an entry in `auth.json`
(or env/`models.json`).

### 1.3 Which models are in the cycle (Ctrl+P rotation)

`settings.md` / `usage.md`:

- `enabledModels: string[]` in `settings.json` — patterns for the Ctrl+P /
  `cycle_model` rotation, same format as the `--models "claude-*,gpt-4o"` flag.
- `/scoped-models` is the interactive editor for that set; in RPC we just write
  `enabledModels` directly.
- `--provider` / `--model <pattern>` (supports `provider/id` and `:<thinking>`)
  seed the *initial* model; `defaultProvider` / `defaultModel` in `settings.json`
  do the same.

So the cycle order is data Horizon can set declaratively in `settings.json`.

---

## 2. What Horizon does today

Horizon already stores provider config **per provider** — the data model is
ready for multi-provider:

- `shared/constants.ts` / `src/types/browser.ts`: `aiProvider` (active) plus
  per-provider maps `aiApiKeys`, `aiModels`, `aiBaseUrls`
  (`{ [providerId]: value }`).
- `src/components/overlays/AiProviderSettings.tsx`: the Settings UI reads/writes
  the **active** provider's slot in each map.

But materialization and runtime are **single-provider**:

- `.electron/main.ts` → `writePiConfigFromSettings()` resolves only the *active*
  provider's `aiApiKeys[p]` / `aiModels[p]` / `aiBaseUrls[p]`.
- `.electron/services/PiConfigWriter.ts` writes:
  - `settings.json` → `defaultProvider` + `defaultModel` (active only),
  - `auth.json` → a single `{ [activeProvider]: { type:"api_key", key } }`,
  - a generated `horizon-provider-override.mjs` extension that calls
    `pi.registerProvider(activeProvider, { baseUrl })` for the active provider
    only.
- `.electron/services/PiSession.ts` only interprets the `get_state` response
  (to capture the session file, `PiSession.ts:~374`). Responses to `set_model` /
  `cycle_model` / `get_available_models` would fall through the generic
  `response` case and be **silently ignored**. No model events reach the
  renderer; there is no model picker in `AIPanel`.

**Net:** Horizon pins Pi to one provider/model per spawn and changes it by
disposing + respawning the subprocess (`onAiConfigChanged`). Pi never sees more
than one provider, so `cycle_model` would have nothing to cycle to.

---

## 3. The gap

1. **Only the active provider is authed.** `auth.json` gets one entry, so
   `get_available_models` / `cycle_model` see one provider. Need to write *all*
   configured providers' keys.
2. **Custom base URLs are active-only and use a generated extension.** For
   multiple custom endpoints, `models.json` is the declarative, multi-provider
   mechanism (and it hot-reloads on `/model`); the single generated
   `registerProvider` extension doesn't scale to N providers.
3. **`enabledModels` is unset**, so the cycle rotation is undefined/everything.
4. **No RPC plumbing** for `set_model` / `cycle_model` / `get_available_models`,
   no IPC channels, no renderer model picker, no events.

None of these are blockers — they're additive.

---

## 4. Feasibility & proposed design

Feasibility: **high.** Pi does the heavy lifting; Horizon's per-provider settings
already hold the inputs.

### Phase 1 — Materialize all providers (config-only, no new UI)

In `PiConfigWriter` / `writePiConfigFromSettings`, switch from "active provider"
to "all configured providers":

- **`auth.json`**: write/merge an `api_key` entry for **every** provider that has
  a non-empty `aiApiKeys[p]` (keep the surgical clear-on-empty + preserve
  non-Horizon/OAuth entries logic already in place). Keep `0600`.
- **`models.json`**: for every provider with a non-empty `aiBaseUrls[p]`, emit a
  `providers[p] = { baseUrl, … }` entry (built-in providers keep their models;
  custom ones list models). This replaces the single generated
  `horizon-provider-override.mjs` and scales to N providers. (`models.md`.)
- **`settings.json`**: keep `defaultProvider`/`defaultModel` = the active
  selection, and set `enabledModels` to the configured set (e.g. each provider's
  chosen `aiModels[p]`, or `"<provider>/*"` patterns) so Ctrl+P/`cycle_model`
  rotates over exactly the user's providers.

Outcome with **zero UI work**: Pi boots with every configured provider available;
`get_available_models` and `cycle_model` immediately work. Even before a picker
exists, this fixes "providers should co-exist."

### Phase 2 — Runtime switching wired to the renderer

This is a **session command**, not a browser tool — it does *not* go through the
`HorizonBridgeServer`/`registerTool` path. It goes through `PiSession` + IPC:

- **`PiSession`** (`.electron/services/PiSession.ts`): add `setModel(provider,
  modelId)`, `cycleModel()`, `listAvailableModels()` that `send()` the RPC
  commands with correlation ids; extend the `response` switch to handle
  `set_model` / `cycle_model` / `get_available_models` and emit new events
  (`model_changed`, `available_models`). Capture `data.model` from `get_state`
  too.
- **IPC** (the standard three-step, AGENTS.md §2.2): channel constants in
  `shared/constants.ts` (`IPC_CHANNELS`), handlers in `.electron/main.ts`
  (route to the active window's `PiSession`), typed preload wrappers.
  Suggested: `ai:listModels`, `ai:setModel`, `ai:cycleModel`, plus an
  `ai:modelChanged` push event.
- **Renderer**: a model picker in `AIPanel` (dropdown sourced from
  `ai:listModels`, current model highlighted) + a Ctrl+P shortcut bound to
  `ai:cycleModel`; hold `availableModels` + `currentModel` in `browserStore`.
  No respawn — switching is live.

### Phase 3 — polish

- Persist last-used model per window kind (mirrors `aiSessions`).
- Thinking-level control (`set_thinking_level` / `cycle_thinking_level`).
- A scoped-models editor (edit `enabledModels`) if we want to limit the cycle.

---

## 5. Risks & considerations

- **Auth-presence gating.** Providers without resolvable auth won't appear in
  `get_available_models`. Phase 1 (write all keys) is a prerequisite for any
  picker. (`models.md`, `providers.md`.)
- **Multiple plaintext keys at rest.** We already store `aiApiKeys` (a map) in
  Horizon's `settings.json` and write `auth.json` `0600`; Phase 1 doesn't change
  the posture, just writes more entries. If we want stronger at-rest protection,
  route keys through `safeStorage` (as `PasswordManager` does) — a separate,
  pre-existing follow-up noted in the PR.
- **`models.json` vs the generated extension.** Recommend migrating the base-URL
  override to `models.json` (declarative, multi-provider, hot-reloads). The
  current `horizon-provider-override.mjs` path can be retired once Phase 1 lands.
- **Cycle scope.** If `enabledModels` is unset, `cycle_model` may rotate over a
  large built-in list. Set `enabledModels` to the user's configured models to
  keep Ctrl+P predictable.
- **Live switch vs respawn.** `set_model`/`cycle_model` are in-session, so the
  current dispose-and-respawn on AI-config change can stay for *structural*
  changes (keys/endpoints) while model selection becomes a live command — no
  respawn, no lost conversation.
- **Per-window isolation.** Model state is per `PiSession` (keyed by
  `webContents.id`), so incognito vs regular windows switch independently — no
  new isolation work.
- **RPC response handling.** `PiSession`'s generic `response` case currently
  ignores unknown commands; new handlers must be added or the picker gets no
  data. Use correlation `id`s as `get_state` already does.

---

## 6. Concrete next steps

- [x] **Phase 1 (done):** `PiConfigWriter` writes an `api_key` for every keyed
      provider into `auth.json` (with a secrets-free ownership sidecar so it
      only prunes its own), registers each provider's base URL in the generated
      override extension, and sets `enabledModels` from the authed providers'
      models in `settings.json`. `writePiConfigFromSettings` passes the full
      per-provider maps. Pure builders stay unit-tested (100% covered).
      _Deviation from the original sketch:_ base URLs are materialized via the
      generated `registerProvider` extension (already Horizon-owned/reconciled)
      rather than `models.json`, avoiding a second ownership-tracking mechanism;
      `models.json` remains available if we later need declarative custom models.
- [ ] **Phase 2a (main):** `PiSession.setModel/cycleModel/listAvailableModels`
      + response/event handling; IPC channels + handlers + preload wrappers.
- [ ] **Phase 2b (renderer):** model picker in `AIPanel`, Ctrl+P binding,
      `browserStore` state, consume `ai:modelChanged`.
- [ ] **Phase 3:** per-window last-model persistence, thinking-level control,
      optional scoped-models editor.

### Appendix — key source references

| Area | Where |
|---|---|
| RPC model commands | `resources/bin/docs/rpc.md` → *Model* (`set_model`, `cycle_model`, `get_available_models`), *Thinking* |
| Multi-provider auth / resolution order | `resources/bin/docs/providers.md` |
| `models.json` providers map | `resources/bin/docs/models.md` |
| `enabledModels` / Ctrl+P cycle | `resources/bin/docs/settings.md`, `usage.md`, `keybindings.md` |
| Horizon per-provider settings | `shared/constants.ts`, `src/types/browser.ts`, `src/components/overlays/AiProviderSettings.tsx` |
| Horizon config materialization | `.electron/services/PiConfigWriter.ts`, `.electron/services/piConfig.ts`, `.electron/main.ts` (`writePiConfigFromSettings`) |
| Horizon RPC session | `.electron/services/PiSession.ts` (`dispatch` → `response`/`get_state`) |
