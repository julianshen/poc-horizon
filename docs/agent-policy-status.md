# Agent Policy v1 — implementation status

Tracks Horizon's implementation against the [Agent Policy v1 spec](https://github.com/julianshen/horizon/blob/main/docs/agent/spec/agent-policy-v1.md) and the [llms.txt extensions v1 spec](https://github.com/julianshen/horizon/blob/main/docs/agent/spec/llms-txt-extensions-v1.md). Last updated: 2026-05-27.

## Summary

Horizon is currently an **agent-side v1 partial conformance**:

- ✅ Resolves `/agent.json` per origin, with ETag caching and TTL.
- ✅ Parses + validates the v1 shape.
- ✅ Computes conformance level (0–3) per spec § 1.
- ✅ Surfaces level + site to the agent on `browser_navigate` and via `browser_get_agent_policy`.
- ✅ Wires `prohibited` and `requires_human` triggers into the in-app safety guard.
- ✅ Sends the canonical `X-Horizon-Agent: true` request header (user-toggleable).
- ⏳ Per-page `<meta name="agent-*">` and per-element `data-agent-*` reading — not yet.
- ⏳ Structured action invocation (`actions[].endpoint`) — not yet.
- ⏳ `## Tools` / `## Authentication` / `## Examples` in llms.txt — not yet.
- ⏳ Audit log POSTs to `audit.log_url` — not yet.
- ⏳ Sideloaded skills (`~/.horizon/skills/*.md`) — not yet.

## Agent Policy v1 — per-section status

### § 1 Conformance levels — ✅ implemented

`.electron/services/agentPolicy.ts#computeConformanceLevel` derives 0–3 from the parsed policy:

- **0** — no `/agent.json` or invalid shape
- **1** — valid `version` + `site` + `capabilities`
- **2** — Level 1 plus a non-empty `actions[]`
- **3** — Level 2 plus `objectives`, `requires_human`, and `consent` all populated

The level is surfaced to the agent in two places: `browser_navigate` response (`agentPolicy.level`) and the dedicated `browser_get_agent_policy` tool.

### § 2 Delivery surfaces

- **§ 2.1 `/agent.json` well-known URL** — ✅ implemented. `AgentPolicyResolver` fetches from `<origin>/agent.json`, honors `ETag`/`If-None-Match`, 24h soft TTL, negative-caches 404s.
- **§ 2.2 `<link rel="agent-policy">`** — ⏳ not yet. Requires per-page DOM read on navigation-commit.
- **§ 2.3 `<meta name="agent-*">`** — ⏳ not yet. Same.
- **§ 2.4 Per-element `data-agent-*`** — ⏳ not yet. Best paired with the `screenshot_marked` overlay so each Mark carries its policy hint.

### § 3 Resolution rules — partial

Currently we resolve site-wide policy from `/agent.json` (step 2 of the spec's four-step resolution). Steps 3 and 4 (per-page meta, per-element attrs) are the work above. Step 1 (agent defaults) is encoded by the user's `aiConfirmActions` setting: `'never'` (trust) / `'risky'` / `'all'`.

The **most-restrictive-wins** ordering is preserved: site policy can only raise the bar (force prompt or hard deny) on top of the user's default; it can never lower it.

### § 4.1 Top-level fields — ✅ all parsed

Everything from `version` / `site` / `capabilities` through `safety` and `audit` is parsed into TypeScript types in `.electron/services/agentPolicy.ts`. Unknown fields are preserved (forward-compat per spec § 9). `x-<vendor>-*` extensions are passed through untouched.

### § 4.2 `capabilities` — parsed, not yet enforced

The fields land in the type but enforcement happens only via `prohibited` / `requires_human` today. Filling in per-capability gating (e.g., `click.prohibited_selectors`) requires per-element matching — same dependency as § 2.4.

### § 4.3 `objectives` — surfaced, not actioned

Available to the agent via `browser_get_agent_policy`; agents are told (in `SKILL.md`) to read them as planning hints. We don't enforce that the agent uses them.

### § 4.4 `actions` (structured) — ⏳ not yet

`actions[]` is parsed; calling them is a separate piece. Implementing this means a new `browser_invoke_structured_action` tool that:

1. Looks up the action by name
2. Substitutes `args_schema`-validated arguments
3. Resolves `auth` (cookie → from session; bearer → from a configured secret; header:<name> → ditto)
4. Performs the HTTP request via the page's session so cookies attach naturally

This is the highest-leverage missing piece. It's what turns "agent clicks the UI" into "agent calls the API directly" — far more reliable.

### § 4.5 `requires_human` — ✅ enforced

`AiActionGuard.evaluate()` consults the active site policy. When `requires_human` matches a tool call (currently via `payment` URL/arg substring heuristics for `payment` and `auth_change`), the guard returns `prompt` regardless of the user's `aiConfirmActions` setting. Reserved triggers — `payment`, `data_export`, `auth_change`, `irreversible:*` — are all recognized.

The heuristics are intentionally conservative pre-per-element. Once `data-agent-requires-human` is read on click targets, gate decisions become exact rather than substring-matched.

### § 4.6 `prohibited` — ✅ partial

Hard-deny path implemented for `dark_pattern_acceptance` (currently mapped to the `dismiss_overlays` tool). The other reserved triggers (`auth_bypass`, `captcha_solving`, `scraping_pii`) are recognized but no agent tool currently triggers them by construction — captchas are handled by the `captcha.md` interaction-skill (detect, surface to user, never solve), and auth-bypass / pii-scraping don't map to a single tool we can intercept.

### § 4.7 `consent` — parsed, not yet enforced

Per-category consent levels (`auto` / `ask_once_per_session` / `ask_each_time` / `always_human`) are parsed but not wired to per-category prompting yet. The hook point is the `AiActionGuard.evaluate()` decision; adding category-keyed cache keys for `ask_once_per_session` is the next step.

### § 4.8 `safety` — ⏳ not yet

`rate_limit_user_facing`, `max_actions_per_session`, `abort_on_unexpected_dialog`, `abort_on_redirect_to_auth` — all parsed, none enforced. Each maps cleanly to a bridge-level hook; the easy first one is `abort_on_unexpected_dialog` since we already subscribe to `Page.javascriptDialogOpening`.

### § 4.9 `audit` — ⏳ not yet

No audit POST implemented. The record shape is also TBD in the spec ("v1.1"), so we're not blocked by Horizon — the spec needs to converge first.

### § 7 Reverse direction — agent identification — ✅ implemented

`X-Horizon-Agent: true` is sent on every outgoing request via `webRequest.onBeforeSendHeaders`. User-toggleable via the `aiAdvertiseAgent` setting (default on). The optional `X-Horizon-Agent-Intent` and the `User-Agent: ... (Agent: <model_id>)` suffix are not yet sent — UA modification is more disruptive and the optional intent header needs the active objective to be plumbed from the agent's planner.

### § 8 Conformance checklist for agents

| Requirement | Status |
|---|---|
| MUST resolve effective policy per § 3 ordering | partial (site-wide done; per-page + per-element pending) |
| MUST honor `prohibited` triggers without retry | partial (the triggers we map are honored; agent doesn't infinitely retry by construction) |
| MUST gate `requires_human` triggers via user confirmation | ✅ |
| MUST prefer structured actions when `data-agent-action` is present | ⏳ (depends on `data-agent-*` + structured-action invocation) |
| MUST send `X-Horizon-Agent: true` when configured to advertise presence | ✅ |
| MUST report effective policy provenance to the user on request | ⏳ (level is surfaced to the agent; no UI chip yet for the user) |

## llms.txt extensions v1 — status

| Section | Status | Notes |
|---|---|---|
| Standard `llms.txt` parsing | ✅ | `LlmsTxtResolver` + `llmsTxtParser` since pre-spec |
| `## Tools` | ⏳ | Same blocker as Agent Policy § 4.4 — needs structured-action invocation |
| `## Authentication` | ⏳ | Auth resolution is the long pole |
| `## Examples` | ⏳ | Cheap to parse + surface; low priority |
| Sideloaded skills (`~/.horizon/skills/*.md`) | ⏳ | Path TBD; the existing `domain-skills/` system covers the per-host case |

## Roadmap (priority order)

1. **Per-page `<meta name="agent-*">` and `<link rel="agent-policy">`** — small, unblocks per-page policy overrides
2. **Per-element `data-agent-*` on `screenshot_marked` output** — promotes marks from "clickable elements" to "policy-aware clickable elements"
3. **Structured action invocation (`actions[]` + `browser_invoke_structured_action`)** — biggest agent-quality lever
4. **llms.txt `## Tools` parsing** — same plumbing as (3), drops in for free once it's built
5. **§ 4.8 `safety.abort_on_*` triggers** — low effort, real safety win
6. **`X-Horizon-Agent-Intent` header injection from the agent's active objective** — needs objective threading through Pi tool descriptions
7. **§ 4.7 per-category consent caching** — promotes `requires_human` from prompt-every-time to prompt-once-per-session where the site says it's okay
8. **§ 4.9 audit log POSTs** — wait for spec v1.1 to define the record shape

## Files

| Module | Purpose |
|---|---|
| `.electron/services/agentPolicy.ts` | Types, parser, conformance-level computation, trigger constants |
| `.electron/services/AgentPolicyResolver.ts` | `/agent.json` fetcher with ETag + TTL cache |
| `.electron/services/AiActionGuard.ts` | Three-state decision (`allow`/`prompt`/`deny`) consulting both user policy and site policy |
| `.electron/services/HorizonBridgeServer.ts` | `getAgentPolicy` route; navigate auto-hint includes `agentPolicy.{level,site,summary}` |
| `.electron/main.ts` | `installAgentIdentificationHeader()` adds `X-Horizon-Agent: true` |
| `resources/pi-extension/horizon-bridge.ts` | `browser_get_agent_policy` Pi tool registration |
| `resources/pi-extension/skills/SKILL.md` | Teaches the agent to consult policy before deep workflows |
