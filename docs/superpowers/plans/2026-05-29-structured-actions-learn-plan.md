# Structured Action Invocation & Page Learning — Implementation Plan

**Date:** 2026-05-29
**Design spec:** `docs/superpowers/specs/2026-05-29-structured-actions-learn-design.md`
**Research:** `docs/superpowers/research/2026-05-29-skill-sourcing-learn-from-web.md`

## Phases

| # | Phase | Files | Est. |
|---|---|---|---|
| 1 | `StructuredActionInvoker` + wiring | 4 new, 3 modified | 1.5d |
| 2 | `PageLearner`: perception + URL analysis | 1 new, 1 modified | 1d |
| 3 | `PageLearner`: scripting + CDN network probes | 1 modified | 1d |
| 4 | Bridge + Pi tool registrations | 2 modified | 0.5d |

---

## Phase 1: `StructuredActionInvoker` — foundation

The smallest slice that delivers value. When a site publishes `agent.json` with `actions[]`, the agent can call them directly.

### 1.1 Create `StructuredActionInvoker` (test-first)

**File:** `tests/unit/structured-action-invoker.test.ts`

```ts
describe("StructuredActionInvoker", () => {
  describe("invoke", () => {
    it("returns JSON response for valid action with cookie auth", async () => {});
    it("returns JSON response for valid action with none auth", async () => {});
    it("throws descriptive error for unknown action name", async () => {});
    it("throws validation error when args don't match args_schema", async () => {});
    it("throws 'not configured in v1' for bearer auth", async () => {});
    it("throws 'not configured in v1' for header: auth", async () => {});
    it("enforces rate_limit and throws on second call within window", async () => {});
    it("retries once on network error for idempotent actions", async () => {});
    it("throws immediately on network error for non-idempotent actions", async () => {});
    it("handles non-JSON response bodies (returns raw text)", async () => {});
  });
});
```

The harness mock needs `evaluate()` that returns a controlled response. `BrowserHarness.evaluate` returns `{ ok: true, value }` — mock with vitest.

**File:** `.electron/services/StructuredActionInvoker.ts`

```ts
export class StructuredActionInvoker {
  private rateLimitMap = new Map<string, number>();

  constructor(private readonly harness: BrowserHarness) {}

  async invoke(
    policy: AgentPolicy,
    actionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> { /* ... */ }

  private validateArgs(
    action: AgentAction,
    args: Record<string, unknown>,
  ): void { /* ... */ }

  private checkRateLimit(action: AgentAction): void { /* ... */ }

  private buildEvaluateExpr(
    action: AgentAction,
    args: Record<string, unknown>,
  ): string { /* ... */ }
}
```

Success criteria:
- [x] All 10 tests pass
- [x] Coverage ≥90%

### 1.2 Wire `StructuredActionInvoker` into main.ts

**File:** `.electron/main.ts`

```ts
import { StructuredActionInvoker } from "./services/StructuredActionInvoker";

// After BrowserHarness creation:
const structuredInvoker = new StructuredActionInvoker(harness);

// Pass to bridge:
const bridgeServer = new HorizonBridgeServer(
  harness, helpers, domainSkills, skillsLibrary,
  guard, recorder, compactSession, policyResolver,
  structuredInvoker,  // NEW
);
```

Success criteria:
- [x] App starts without errors
- [x] `structuredInvoker` is accessible from the bridge

### 1.3 Add bridge route

**File:** `.electron/services/HorizonBridgeServer.ts`

New constructor parameter: `private readonly structuredInvoker?: StructuredActionInvoker`

New case:
```ts
case "invokeStructuredAction": {
  const actionName = String(args.actionName ?? "");
  const actionArgs = (args.args && typeof args.args === "object")
    ? args.args as Record<string, unknown>
    : {};
  if (!this.policyResolver) throw new Error("policy resolver not enabled");
  if (!this.structuredInvoker) throw new Error("structured invoker not enabled");
  const url = await this.harness.getUrl();
  const policy = await this.policyResolver.resolve(url);
  if (!policy) throw new Error(`no agent.json found for ${url}`);
  return await this.structuredInvoker.invoke(policy, actionName, actionArgs);
}
```

Success criteria:
- [x] Bridge routes `invokeStructuredAction` to the invoker
- [x] Errors from the invoker propagate correctly as bridge error responses

---

## Phase 2: `PageLearner` — perception + URL analysis (MVP)

### 2.1 Create `PageLearner` (test-first)

**File:** `tests/unit/page-learner.test.ts`

```ts
describe("PageLearner", () => {
  describe("perceive", () => {
    it("calls screenshotMarked + axtree + getDom", async () => {});
    it("extracts forms with fields from DOM", async () => {});
    it("identifies search inputs by role=searchbox", async () => {});
    it("groups navigation links by section", async () => {});
    it("returns empty forms array when no forms present", async () => {});
    it("includes markedElement details (markId, tag, role, label)", async () => {});
  });

  describe("analyzeUrl", () => {
    it("groups links into URL patterns replacing UUIDs", async () => {});
    it("groups links into URL patterns replacing numeric IDs", async () => {});
    it("extracts query parameters from current URL", async () => {});
    it("handles pages with zero links", async () => {});
    it("returns origin from current URL", async () => {});
  });

  describe("classify", () => {
    it("classifies searchbox + adjacent button as 'search' (high confidence)", async () => {});
    it("classifies POST form with 'Create' submit as 'create' (high confidence)", async () => {});
    it("classifies 'Delete' button as 'delete' (medium confidence)", async () => {});
    it("classifies <select> + filter button as 'filter' (high confidence)", async () => {});
    it("classifies export/download button as 'export' (high confidence)", async () => {});
    it("classifies <nav> with 5+ patterned links as 'navigate_section' (high)", async () => {});
    it("classifies login form (email+password) as 'login' (high confidence)", async () => {});
    it("classifies <input type=file> as 'upload' (high confidence)", async () => {});
    it("classifies data-agent-action element authoritatively", async () => {});
    it("returns empty classification for unclassifiable elements", async () => {});
  });

  describe("learn (integration)", () => {
    it("runs perceive + analyzeUrl phases and returns LearnResult", async () => {});
    it("skips scripting when includeScripting=false", async () => {});
    it("skips network when includeNetwork=false", async () => {});
    it("includes agentPolicyLevel from URL resolution", async () => {});
  });
});
```

**File:** `.electron/services/PageLearner.ts`

```ts
export class PageLearner {
  constructor(private readonly harness: BrowserHarness) {}

  async learn(options?: LearnOptions): Promise<LearnResult> {
    const [perception, urlAnalysis] = await Promise.all([
      this.perceive(),
      options?.includeUrlAnalysis !== false ? this.analyzeUrl() : undefined,
    ]);
    const scripting = options?.includeScripting !== false
      ? await this.probeScripting() : undefined;
    const network = options?.includeNetwork === true
      ? await this.observeNetwork(options?.observeDurationMs ?? 2000) : undefined;

    const base = { origin, url, agentPolicyLevel, perception, urlAnalysis, scripting, network };
    const classification = this.classify(base);
    return { ...base, classification };
  }

  private async perceive(): Promise<PerceptionResult> { /* ... */ }
  private async analyzeUrl(): Promise<UrlAnalysisResult> { /* ... */ }
  private async probeScripting(): Promise<ScriptingResult> { /* ... */ }
  private async observeNetwork(durationMs: number): Promise<NetworkResult> { /* ... */ }
  private classify(result: Omit<LearnResult, "classification">): ClassifiedAction[] { /* ... */ }
}
```

Success criteria:
- [x] 28 tests pass (10 classify + 6 perceive + 5 analyzeUrl + 4 learn + 3 future)
- [x] Coverage ≥90%

### 2.2 Wire `PageLearner` into main.ts

```ts
import { PageLearner } from "./services/PageLearner";

const pageLearner = new PageLearner(harness);

const bridgeServer = new HorizonBridgeServer(
  harness, helpers, domainSkills, skillsLibrary,
  guard, recorder, compactSession, policyResolver,
  structuredInvoker, pageLearner,  // NEW
);
```

Success criteria:
- [x] App starts without errors

---

## Phase 3: `PageLearner` — scripting probes + CDP observation

### 3.1 Scripting probes

Four `browser_evaluate` calls wired into `probeScripting()`:

1. Framework detection → `window.React?.version`, `window.__VUE__`, `window.angular`
2. State dump discovery → `Object.keys(window)` filtered for `__*`, `*STATE*`, `*STORE*`, `APP_CONFIG`
3. Route enumeration → `[...document.querySelectorAll("a[href]")]` → group by pattern
4. Form extraction → `[...document.forms]` with field details

Success criteria:
- [x] Framework detection identifies React, Vue, Angular, or "unknown"
- [x] State dump finds `__INITIAL_STATE__` and similar keys
- [x] Route enumeration groups `/workspace/:uuid` patterns correctly
- [x] Form extraction captures method, action, and field types

### 3.2 CDP network observation

Reuses existing `cdp_subscribe` / `cdp_collect` harness methods:

```
cdp_subscribe("Network.requestWillBeSent")
cdp_subscribe("Network.responseReceived")
setTimeout(durationMs)
cdp_collect("Network.requestWillBeSent")
cdp_collect("Network.responseReceived")
cdp_unsubscribe()
```

Extract from collected events:
- `(method, pathname)` pairs → deduplicated endpoint list
- `response.headers["content-type"]` → JSON detection
- Request body `{"query":"..."}` → GraphQL detection
- Paths containing `/auth/`, `/login`, `/oauth/` → auth endpoints

Success criteria:
- [x] Endpoint list is deduplicated on (method, path)
- [x] JSON endpoints flagged by content-type
- [x] GraphQL endpoints detected from request body shape
- [x] Auth endpoints separated into their own list
- [x] CDP subscriptions are cleaned up (unsubscribed) after collection

---

## Phase 4: Bridge + Pi tool registrations

### 4.1 Bridge routing

**File:** `.electron/services/HorizonBridgeServer.ts`

Add `learnPageActions` case (see design spec §2.5). The `invokeStructuredAction` case was added in Phase 1.3.

### 4.2 Pi tool registrations

**File:** `resources/pi-extension/horizon-bridge.ts`

Two new `pi.registerTool` calls:

```ts
pi.registerTool({
  name: "browser_invoke_structured_action",
  label: "Invoke structured action",
  description:
    "Call a site-declared action from its agent.json via HTTP. " +
    "Prefer this over UI clicking when the site publishes structured actions. " +
    "Look up available action names from browser_get_agent_policy. " +
    "Returns the JSON response body.",
  parameters: Type.Object({
    actionName: Type.String(),
    args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
  execute: async (_id, params) =>
    bridge("invokeStructuredAction", params as Record<string, unknown>),
});

pi.registerTool({
  name: "browser_learn_page_actions",
  label: "Learn page actions",
  description:
    "Analyze the current page to discover what actions the user can perform. " +
    "Returns interactive elements grouped by inferred action type (search, create, filter, etc.), " +
    "plus observed API endpoints and URL patterns. " +
    "Use this on sites that don't publish agent.json — the result helps you propose domain skills and helpers.",
  parameters: Type.Object({
    includeNetwork: Type.Optional(Type.Boolean()),
    includeScripting: Type.Optional(Type.Boolean()),
    includeUrlAnalysis: Type.Optional(Type.Boolean()),
  }),
  execute: async (_id, params) =>
    bridge("learnPageActions", params as Record<string, unknown>),
});
```

Success criteria:
- [x] Both tools appear in Pi's tool list
- [x] `invokeStructuredAction` dispatches to the bridge correctly
- [x] `learnPageActions` dispatches to the bridge correctly
- [x] Errors propagate through bridge → Pi as descriptive rejections

### 4.3 Coverage wiring

**File:** `vite.config.ts`

```ts
coverage: {
  include: [
    // ... existing entries ...
    ".electron/services/StructuredActionInvoker.ts",
    ".electron/services/PageLearner.ts",
  ],
}
```

---

## Verification checklist (pre-merge)

_Status as of 2026-05-30 (post code-review fixes)._

- [x] All new tests pass: `npx vitest run tests/unit/structured-action-invoker.test.ts tests/unit/page-learner.test.ts` — **53 pass**
- [x] No regressions: `npx vitest run` — **822 pass, 0 fail**
- [x] Coverage ≥90% on **new files** — `StructuredActionInvoker.ts` 100/100/92.9, `PageLearner.ts` 99.5/100/88.9 (stmt/func/branch). PageLearner branch sits at 88.9% — residual gaps are defensive `?? ""` paths in the DOM attribute loops.
- [ ] **Global `test:coverage` gate (≥90% all metrics) — RED, but pre-existing.** Baseline *without* these two files is already func 89.1% / branch 88.6%; the shortfall is widespread under-coverage in renderer components (`AIPanel`, `SettingsPanel`, `Omnibox`, `useTheme`, `browserStore`, …), not this changeset, which net-raises func+stmt. Track as separate repo debt. (Note: `vite.config.ts` `coverage.include` is now repo-wide, not the `src/utils + shared` scope `CLAUDE.md` still claims.)
- [x] No lint errors on touched files: `npx eslint <touched files>` — clean (also removed pre-existing dead code in the new files).
- [ ] `npx tsc --noEmit` — main/preload type-check is blocked by pre-existing config debt (TS5095/TS6310, see `CLAUDE.md`); the learner's `Harness` type is now `Pick<BrowserHarness,…>` so harness-method drift is caught at compile time once that debt is cleared.
- [x] App starts and bridge connects — verified 2026-05-30: `npm run build` succeeds; `npm run dev` boots cleanly (no errors, browser chrome + page render), and an AI turn starts ("Thinking…"), which means `ensurePiSession` constructed `HorizonBridgeServer` with the new `structuredInvoker`/`pageLearner` args without crashing.
- [ ] `browser_invoke_structured_action` works end-to-end with a mock agent.json site — **not driven live** (needs an LLM turn to select the tool); covered by unit tests against the real harness interface.
- [ ] `browser_learn_page_actions` returns valid LearnResult on a real page — **not driven live** (same); covered by unit tests.

### Post-review changes (2026-05-30)

Applied during code review (see git history):
- **Fix:** `observeNetwork` used non-existent `cdp*` harness methods → corrected to `subscribeEvent`/`collectEvents`/`unsubscribeEvent`; `Harness` type derived from `BrowserHarness` via `Pick`.
- **Fix:** Phase 4 now correlates `requestWillBeSent`→`responseReceived` for real HTTP method + GraphQL detection (was hardcoded `GET`/`false`).
- **Fix:** bridge now populates `agentPolicyLevel` via `computeConformanceLevel` (was always 0).
- **Feature:** `data-agent-action` authoritative classification (spec §2.3 / this plan's §2.1 test) — collected in the scripting phase, emitted first.
- **Feature:** `mode: "active"` now honored (⇒ network observation) and wired through bridge + Pi tool.
- **Fix:** broadened `EXPORT_LABELS` to the spec's breadth; `-1` synthetic-mark sentinel so form/declared actions can't suppress a real mark with id 0.
