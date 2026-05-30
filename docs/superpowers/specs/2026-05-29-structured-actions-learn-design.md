# Structured Action Invocation & Page Learning — Design Spec

**Date:** 2026-05-29
**Status:** Implemented (sub-project A) as of 2026-05-30 — this doc reflects the as-built code. Sub-project B (confirmation flow + `tasks[]`) remains future work.
**Depends on:** Research doc `docs/superpowers/research/2026-05-29-skill-sourcing-learn-from-web.md`
**Sub-projects:**
- A (this doc): Structured action invocation + page learning tool
- B (follow-up): Agent confirmation flow + `agent.json` `tasks[]` extension

## 1. Goal

Give the agent two new tools:

1. **`browser_invoke_structured_action`** — Call a site-declared action from `/agent.json`'s `actions[]` array directly via HTTP, bypassing UI entirely. This is roadmap item #3 from the Agent Policy status doc.

2. **`browser_learn_page_actions`** — Analyze the current page using `screenshot_marked`, `axtree`, CDP network observation, scripting probes, and URL pattern analysis to discover what actions the user can perform on this site, then propose domain skills, helpers, or workflows.

When a site publishes `agent.json` → agent uses structured API calls (fast, reliable). When it doesn't → agent uses the learn tool to build a UI-driven mental model (fallback, interactive).

## 2. Architecture

Two new services, zero changes to existing public APIs.

```
┌─────────────────────────────────────────────────────────────────────┐
│  HorizonBridgeServer                                                │
│                                                                     │
│  + case "invokeStructuredAction"                                    │
│  + case "learnPageActions"                                          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                                       ▼
┌───────────────────────┐             ┌───────────────────────────────┐
│  StructuredAction     │             │  PageLearner                   │
│  Invoker              │             │  (new service)                 │
│  (new service)        │             │                                │
│                       │             │  .perceive(harness)            │
│  .invoke(policy,      │             │  .analyzeUrl(harness)          │
│    actionName, args)  │             │  .probeScripting(harness)      │
│                       │             │  .observeNetwork(harness)      │
│                       │             │  .classify(learnResult)        │
└───────────────────────┘             └───────────────────────────────┘
        │                                       │
        ▼                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Existing services (no changes)                                      │
│  BrowserHarness  AgentPolicyResolver  DomainSkills  HelperRegistry   │
│  ActionRecorder  SkillsLibrary                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1 StructuredActionInvoker

Lives in `.electron/services/StructuredActionInvoker.ts`. Stateless — takes a harness + policy + action name + arguments, performs the HTTP request through the page's session.

**As-built note:** the harness is passed **per call**, not stored on the instance. The single global `BrowserHarness` re-attaches to the active tab at the start of each AI turn, so a construction-time reference could go stale; passing it per `invoke()` always uses the live harness. Only the rate-limit map is instance state.

```ts
export class StructuredActionInvoker {
  /** Per-action-name last-call timestamps for rate-limit enforcement. */
  private rateLimitMap = new Map<string, number>();

  /**
   * Look up an action by name in the policy, validate args against
   * args_schema, perform the HTTP request through the active tab's
   * session.
   *
   * @param harness - The live BrowserHarness (subset with `evaluate`).
   * @param policy - Parsed AgentPolicy from agentPolicy resolver.
   * @param actionName - Must match an entry in policy.actions[].
   * @param args - Caller-supplied arguments; validated against action.args_schema.
   * @returns The JSON-decoded response body (or raw text), or throws on failure.
   */
  async invoke(
    harness: Pick<BrowserHarness, "evaluate">,
    policy: AgentPolicy,
    actionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
}
```

`:param` path segments in `endpoint` (e.g. `DELETE /api/items/:id`) are resolved from `args` and URL-encoded.

**Auth resolution** (spec § 4.4):

| `auth` value | How to resolve |
|---|---|
| `"none"` | No auth header. |
| `"cookie"` | Evaluate `fetch(endpoint, {credentials:'include'})` in the page — cookies attach from the active session. |
| `"bearer"` | Read from a configured secret store (out of scope for v1; throw "not configured"). |
| `"header:<name>"` | Read from a configured secret store (same as bearer). |

For v1, only `"none"` and `"cookie"` are implemented. The invocation runs via `browser_evaluate`:
```js
async (endpoint, method, body) => {
  const res = await fetch(endpoint, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include"
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}
```

This runs in the page context so cookies, CSRF tokens, and origin are correct. The response is JSON-serialised back through the bridge.

**Rate limiting:** If `action.rate_limit` is specified, the invoker tracks last-call timestamps per action name in an in-memory `Map` and rejects with a clear error if the rate limit is exceeded. The map is per-session (cleared on app restart).

**Idempotency:** If `action.idempotent === true`, the invoker retries once on network error with a 1s delay.

### 2.2 PageLearner

Lives in `.electron/services/PageLearner.ts`. Stateless — takes a `BrowserHarness` reference **per call** (same rationale as the invoker above), runs the four-phase pipeline, returns a `LearnResult`. The LLM (agent) reads the result and proposes actions; the user confirms and saves.

```ts
export interface LearnOptions {
  mode?: "passive" | "active";   // "active" opts into network observation
  includeNetwork?: boolean;      // default: false (adds CDP subscription overhead)
  includeScripting?: boolean;    // default: true
  includeUrlAnalysis?: boolean;  // default: true
  observeDurationMs?: number;    // default: 2000
}

export interface LearnResult {
  origin: string;
  url: string;
  agentPolicyLevel: 0 | 1 | 2 | 3;
  perception: PerceptionResult;
  urlAnalysis?: UrlAnalysisResult;
  scripting?: ScriptingResult;
  network?: NetworkResult;
  classification: ClassifiedAction[];
}

export class PageLearner {
  async learn(harness: Harness, options?: LearnOptions): Promise<LearnResult>;
  private async perceive(harness: Harness): Promise<PerceptionResult>;
  private async analyzeUrl(harness: Harness, url: string): Promise<UrlAnalysisResult>;
  private async probeScripting(harness: Harness): Promise<ScriptingResult>;
  private async observeNetwork(harness: Harness, durationMs: number): Promise<NetworkResult>;
  private classify(result: Omit<LearnResult, "classification">): ClassifiedAction[];
}
```

`Harness` is `Pick<BrowserHarness, …>` (screenshotMarked, getAxTree, getDom, getUrl, evaluate, subscribeEvent, collectEvents, unsubscribeEvent) — deriving it from the real class means a harness-method rename breaks compilation rather than failing at runtime. `agentPolicyLevel` is set by the bridge after `learn()` returns (the learner is policy-agnostic).

#### Phase 1: Perception (always runs)

```
screenshotMarked({ order: "reading", format: "jpeg", quality: 50 })
  → marks[] — every interactive element, numbered, with role + label + tag + href

axtree()
  → semantic structure — roles, names, hierarchy

getDom({ depth: 2 })
  → top-level DOM structure + forms
```

Output:
```ts
interface PerceptionResult {
  interactiveCount: number;
  elementsByRole: Record<string, number>;
  forms: Array<{
    action: string;
    method: string;
    fieldCount: number;
    fields: Array<{ name: string; type: string; required: boolean; placeholder?: string }>;
    submitLabel: string;
  }>;
  navSections: Array<{
    label: string;
    linkCount: number;
    links: Array<{ href: string; text: string }>;
  }>;
  searchInputs: Array<{ markId: number; label: string; placeholder?: string }>;
  markedElements: Array<{
    markId: number;
    tag: string;
    role: string | null;
    label: string;
    href: string | null;
    rect: { x: number; y: number; w: number; h: number };
  }>;
}
```

#### Phase 2: URL analysis

```
getUrl() → current URL
evaluate: collect all <a href> → group by pattern
evaluate: extract URL query parameters
```

Output:
```ts
interface UrlAnalysisResult {
  currentUrl: string;
  currentPattern: string;
  queryParams: string[];
  discoveredPatterns: Record<string, number>;
  origin: string;
}
```

Pattern grouping: `["/workspace/abc123", "/workspace/def456"]` → `{ "workspace/:uuid": 2 }`. UUIDs matched by `[a-f0-9-]{20,}`, numeric IDs by `^\d+$`.

#### Phase 3: Scripting probes (if `includeScripting`)

Four `browser_evaluate` calls in sequence:

1. **Framework detection**

```js
() => {
  if (window.React?.version) return { fw: "react", ver: window.React.version };
  if (window.__VUE__) return { fw: "vue", ver: window.__VUE__ };
  if (window.angular) return { fw: "angular", ver: window.angular.version?.full };
  if (document.querySelector("[data-reactroot],[data-react-server-root]")) return { fw: "react", detected: true };
  if (document.querySelector("[data-v-]")) return { fw: "vue", detected: true };
  return { fw: "unknown" };
}
```

2. **State dump discovery**

```js
() => Object.keys(window).filter(k => k.startsWith("__") || k.includes("STATE") || k.includes("STORE") || k === "APP_CONFIG")
  .map(k => ({ key: k, type: typeof window[k], topKeys: typeof window[k] === "object" && window[k] ? Object.keys(window[k]).slice(0, 10) : null }))
```

3. **Route enumeration**

```js
() => {
  const paths = new Set([...document.querySelectorAll("a[href]")].map(l => {
    try { return new URL(l.href, location.origin).pathname; } catch { return null; }
  }).filter(Boolean));
  const pats = {};
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    const key = parts.map(s => /^\d+$/.test(s) ? ":id" : /^[a-f0-9-]{20,}$/.test(s) ? ":uuid" : s).join("/") || "/";
    pats[key] = (pats[key] || 0) + 1;
  }
  return { totalLinks: paths.size, patterns: pats };
}
```

4. **Form extraction** (if not already covered by perception's `getDom`)

```js
() => [...document.forms].map(f => ({ action: f.action, method: f.method, fields: [...f.elements].map(e => ({ name: e.name, type: e.type, required: e.required, placeholder: e.placeholder })) }))
```

5. **Declared actions** — `[...document.querySelectorAll("[data-agent-action]")]` → `{ name, tag, label }[]`. These are authoritative (the site explicitly tagged the element); classification emits them ahead of any heuristic. Lives in the scripting phase so `includeScripting: false` keeps perception JS-injection-free.

Output:
```ts
interface ScriptingResult {
  framework: { fw: string; ver?: string; detected?: boolean } | null;
  stateKeys: Array<{ key: string; type: string; topKeys: string[] | null }>;
  routePatterns: Record<string, number>;
  totalLinks: number;
  declaredActions: Array<{ name: string; tag: string; label: string }>;
}
```

#### Phase 4: CDP network observation (if `includeNetwork`, or `mode === "active"`)

Uses the real `BrowserHarness` CDP-event API — `subscribeEvent` (async), `collectEvents` (synchronous buffer drain), `unsubscribeEvent` (synchronous):

```
await subscribeEvent("Network.requestWillBeSent")
await subscribeEvent("Network.responseReceived")
wait observeDurationMs (default 2000ms) — passive collection
const reqEvents = collectEvents("Network.requestWillBeSent")   // sync
const resEvents = collectEvents("Network.responseReceived")    // sync
unsubscribeEvent("Network.requestWillBeSent")
unsubscribeEvent("Network.responseReceived")
```

`requestWillBeSent` events are indexed by `requestId`, then each response is correlated back to its request to recover:
- The real HTTP **method** (responses alone don't carry it).
- **GraphQL** detection — `/graphql` path, or a request `postData` body matching `"query":`.
- Unique `(method, pathname)` pairs → deduplicated API endpoints.
- Content-Type (`response.mimeType`) per endpoint.
- Auth endpoints (paths containing `/auth/`, `/login`, `/oauth/`, `/signin`, `/signup`).

`Network.getResponseBody` body sampling is **out of scope for v1** (see §7) — the endpoint list alone is the deliverable; `sampleKeys` is always `null`.

Output:
```ts
interface NetworkResult {
  endpoints: Array<{
    method: string;
    path: string;
    status: number;
    contentType: string;
    isGraphQL: boolean;
    sampleKeys: string[] | null;
  }>;
  authEndpoints: string[];
  totalRequests: number;
}
```

### 2.3 Classification (deterministic, in the learner)

The `classify()` method runs after all phases complete. It maps element patterns → suggested actions using heuristics only — no LLM.

| Pattern | Action | Parameters |
|---|---|---|
| `<input type="search">` or `role="searchbox"` | `search` | `{ query: string }` |
| `<form>` method=POST with submit label matching /create\|new\|add\|save/i | `create` | form field names |
| `<form>` method=POST/PUT/PATCH with submit matching /update\|save changes/i | `update` | form field names |
| `<a>` or `<button>` text matching /delete\|remove\|archive/i | `delete` | `{ id?: string }` |
| `<select>` adjacent to button with /filter\|apply/i | `filter` | `{ [param]: value }` |
| `<nav>` with 5+ links sharing URL pattern | `navigate_section` | `{ section: string }` |
| Button text matching /export\|download\|csv\|pdf/i | `export` | `{ format: string }` |
| `<input type="file">` | `upload` | `{ file: string }` |
| `<form>` with `<input type="email">` + `<input type="password">` | `login` | `{ email, password }` |
| Any element with `data-agent-action="name"` | the declared name | per `args_schema` |

Output:
```ts
interface ClassifiedAction {
  name: string;
  category: "crud" | "navigation" | "filter" | "auth" | "export" | "search" | "upload" | "custom";
  confidence: "high" | "medium" | "low";
  elements: Array<{ markId: number; tag: string; label: string }>;
  formFields?: Array<{ name: string; type: string }>;
  observedEndpoint?: { method: string; path: string };
  description: string;
}
```

### 2.4 Tool registrations

#### `browser_invoke_structured_action`

```ts
pi.registerTool({
  name: "browser_invoke_structured_action",
  label: "Invoke structured action",
  description:
    "Call a site-declared action from its agent.json via HTTP. Prefer this over UI clicking when the site publishes structured actions." +
    " Look up action names from browser_get_agent_policy. Returns the JSON response body.",
  parameters: Type.Object({
    actionName: Type.String(),
    args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
  execute: async (_id, params) =>
    bridge("invokeStructuredAction", params as Record<string, unknown>),
});
```

#### `browser_learn_page_actions`

```ts
pi.registerTool({
  name: "browser_learn_page_actions",
  label: "Learn page actions",
  description:
    "Analyze the current page to discover what actions the user can perform." +
    " Returns interactive elements grouped by inferred action type (search, create, filter, etc.)," +
    " plus any observed API endpoints and URL patterns." +
    " Use this on sites that don't publish agent.json — the result helps you propose domain skills and helpers.",
  parameters: Type.Object({
    mode: Type.Optional(Type.String()),   // "passive" (default) | "active"
    includeNetwork: Type.Optional(Type.Boolean()),
    includeScripting: Type.Optional(Type.Boolean()),
    includeUrlAnalysis: Type.Optional(Type.Boolean()),
  }),
  execute: async (_id, params) =>
    bridge("learnPageActions", params as Record<string, unknown>),
});
```

### 2.5 Bridge routing (HorizonBridgeServer)

```ts
case "invokeStructuredAction": {
  const actionName = String(args.actionName ?? "");
  const actionArgs =
    args.args && typeof args.args === "object"
      ? (args.args as Record<string, unknown>)
      : {};
  if (!this.policyResolver) throw new Error("policy resolver not enabled");
  if (!this.structuredInvoker) throw new Error("structured invoker not enabled");
  const url = await this.harness.getUrl();
  const policy = await this.policyResolver.resolve(url);
  if (!policy) throw new Error(`no agent.json found for ${url}`);
  // Harness passed per call (see §2.1).
  return await this.structuredInvoker.invoke(this.harness, policy, actionName, actionArgs);
}

case "learnPageActions": {
  if (!this.pageLearner) throw new Error("page learner not enabled");
  const mode =
    args.mode === "active" ? "active" : args.mode === "passive" ? "passive" : undefined;
  const learnResult = await this.pageLearner.learn(this.harness, {
    mode,
    includeNetwork: args.includeNetwork === true,
    includeScripting: args.includeScripting !== false,  // default true
    includeUrlAnalysis: args.includeUrlAnalysis !== false, // default true
  });
  // The learner is policy-agnostic; the bridge owns policy resolution and
  // fills in the conformance level (best-effort; a miss leaves 0).
  if (this.policyResolver) {
    try {
      const policy = await this.policyResolver.resolve(learnResult.url);
      learnResult.agentPolicyLevel = computeConformanceLevel(policy);
    } catch { /* leave default level 0 */ }
  }
  return learnResult;
}
```

## 3. Shared CDP management

Both `PageLearner.observeNetwork()` and the existing CDP-event path use `BrowserHarness`'s subscription buffer. `PageLearner`:

1. Subscribes before observing → pushes events into the same `eventBuf` map
2. Observes for `durationMs`
3. Collects (drains) only events that arrived during the observation window
4. Unsubscribes to clean up

The learn tool uses the same `subscribeEvent` / `collectEvents` / `unsubscribeEvent` harness methods (note: `collectEvents`/`unsubscribeEvent` are synchronous) — it doesn't directly manage CDP. This avoids two code paths managing the same subscription state.

## 4. Service map (updated)

```
.electron/services/
├── BrowserHarness.ts            — unchanged
├── HorizonBridgeServer.ts       — +2 cases, +2 constructor deps
├── StructuredActionInvoker.ts   — NEW
├── PageLearner.ts               — NEW
├── AgentPolicyResolver.ts       — unchanged (already provides policy)
├── agentPolicy.ts               — unchanged
├── AiActionGuard.ts             — unchanged
├── DomainSkills.ts              — unchanged
├── HelperRegistry.ts            — unchanged
├── ActionRecorder.ts            — unchanged
└── ...
```

Constructor changes to `HorizonBridgeServer`:

```ts
constructor(
  private readonly harness: BrowserHarness,
  private readonly helpers?: HelperRegistry,
  private readonly domainSkills?: DomainSkills,
  private readonly skillsLibrary?: SkillsLibrary,
  private readonly guard?: AiActionGuard,
  private readonly recorder?: ActionRecorder,
  private readonly compactSession?: (customInstructions?: string) => void,
  private readonly policyResolver?: AgentPolicyResolver,
  private readonly structuredInvoker?: StructuredActionInvoker,  // +NEW
  private readonly pageLearner?: PageLearner,                    // +NEW
)
```

Wiring in `main.ts`:

```ts
// Stateless — the live harness is passed per call by the bridge, not stored.
const structuredInvoker = new StructuredActionInvoker();
const pageLearner = new PageLearner();
const bridgeServer = new HorizonBridgeServer(
  harness, helpers, domainSkills, skillsLibrary,
  guard, recorder, compactSession, policyResolver,
  structuredInvoker, pageLearner,
);
```

## 5. Testing

### 5.1 StructuredActionInvoker — unit tests

Real `BrowserHarness` mock (just `evaluate` needed). Real `AgentPolicy` objects.

- `invoke` with valid action name + matching args → returns JSON response
- `invoke` with missing action name → throws descriptive error
- `invoke` with args not matching `args_schema` → throws validation error
- `invoke` with `auth: "none"` → fetch without credentials
- `invoke` with `auth: "cookie"` → fetch with `credentials: "include"`
- `invoke` with `auth: "bearer"` → throws "not configured in v1"
- `invoke` with `auth: "header:X-Custom"` → throws "not configured in v1"
- Rate limit enforcement: second call within window → throws rate-limit error
- Idempotent retry: network error on first attempt → retries once, succeeds on second
- Non-idempotent: network error → throws immediately

### 5.2 PageLearner — unit tests

Mock `BrowserHarness`. Real classification logic.

- Phase 1: `perceive()` calls `screenshotMarked` + `axtree` + `getDom`; returns structured result
- Phase 2: `analyzeUrl()` groups links into patterns correctly
- Phase 3: `probeScripting()` detects React, Vue, or unknown framework
- Phase 4: `observeNetwork()` subscribes, waits, collects, unsubscribes
- Classification: search input → `search` action with high confidence
- Classification: create form → `create` action with high confidence
- Classification: delete button → `delete` action with medium confidence
- Classification: navigation sidebar → `navigate_section` actions
- Classification: `data-agent-action="custom_action"` → authoritative classification
- Full pipeline: `learn()` calls all phases, returns complete `LearnResult`

### 5.3 Integration tests

- `invokeStructuredAction` through bridge with mocked evaluate
- `learnPageActions` through bridge with mocked harness

### 5.4 Existing tests — untouched

All existing tests continue to pass. No breaking API changes.

### 5.5 Coverage

Both new files added to `vite.config.ts` `coverage.include`. Target: ≥90% all metrics per project rules.

## 6. Migration / rollout

- **No data migration needed.** Both tools are stateless; no new on-disk format.
- **Settings impact:** none. No new user-facing settings in v1.
- **`agent.json` sites:** immediately benefit from `invokeStructuredAction` — agent skips UI.
- **Non-`agent.json` sites:** agent uses `learnPageActions` to discover UI-driven actions. The agent proposes domain skills; user confirms.
- **Pi skill writer (Sub-project B):** unchanged by this design. The "rewrite SKILL.md when llms.txt changes" concern is separate.

## 7. Out of scope (parked)

- **`agent.json` `tasks[]` field** — composed multi-step operations. Follow-up.
- **`browser_suggest_skill`** — user confirmation flow for learned actions. Sub-project B's confirmation UI.
- **Bearer/header auth** — secret store integration for agent.json auth beyond "cookie" and "none".
- **`Network.getResponseBody` in learn tool v1** — the passive endpoint list alone is useful; body inspection adds complexity and potential PII exposure.
- **Per-page `<meta name="agent-*">` and the broader `data-agent-*` annotation system** (`data-agent-prohibited`, `data-agent-field`, etc.) — Agent Policy roadmap items, not this sub-project. **Exception:** `data-agent-action="name"` *is* implemented here — the learn tool's scripting phase collects these and classification treats them as authoritative (§2.3 classification table). This is the one per-element annotation in scope for this sub-project.

## 8. File checklist

- Create: `.electron/services/StructuredActionInvoker.ts`
- Create: `.electron/services/PageLearner.ts`
- Modify: `.electron/services/HorizonBridgeServer.ts` (2 new cases, 2 new constructor deps)
- Modify: `.electron/main.ts` (instantiate + wire new services)
- Modify: `resources/pi-extension/horizon-bridge.ts` (2 new tool registrations)
- Create: `tests/unit/structured-action-invoker.test.ts`
- Create: `tests/unit/page-learner.test.ts`
- Modify: `vite.config.ts` (add new files to coverage.include)
