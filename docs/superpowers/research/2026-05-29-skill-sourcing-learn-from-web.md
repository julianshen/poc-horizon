# Research: Skill Sourcing & "Learn from Web Page"

**Date:** 2026-05-29
**Status:** Research complete — ready for design spec

---

## 1. Current landscape

Horizon already has **three layers** of site knowledge and one input channel:

| Layer | Source | Editable | Purpose |
|---|---|---|---|
| `SKILL.md` + `interaction-skills/*.md` | Bundled with browser | ❌ | Generic — teach the agent how to use browser primitives (click, type, scroll) |
| `domain-skills/<host>/` | Agent-written via `domain_skill_save` | ✅ | Quirks learned about a specific site ("CAPTCHA after 3 searches on Amazon") |
| `agent.json` (Agent Policy v1) | Site-published at `/agent.json` | ❌ (site authors) | Declares `actions[]` (API endpoints), `objectives`, safety gates |
| `/llms.txt` + `/llms-full.txt` | Site-published | ❌ (site authors) | Documentation index in LLM-friendly markdown — injected as prompt context |

The design spec (2026-05-29) carves out **Sub-project B: Skill lifecycle** — "rewrite Pi skill when llms.txt content changes; move skill storage out of `~/.pi/agent/skills/`" — which means you already identified that `llms.txt` → `SKILL.md` is the wrong pipeline.

---

## 2. Idea 1: `skill.md` on websites → skip it, extend `agent.json`

### Why `llms.txt` → skill conversion is problematic

- **Wrong format.** `llms.txt` is a documentation *index* (links to docs, examples, APIs). Turning it into a behavioral guide loses structure — a list of URLs doesn't tell the agent *how* to perform tasks.
- **Static and outdated quickly.** The skill gets frozen at fetch time. The site evolves; the skill doesn't.
- **Trust boundary.** Site-authored agent instructions could inject malicious prompts. Your policy system handles `prohibited`/`requires_human` gates, but an instruction-file is agent-injection by design.

### What already exists: `agent.json`

Your own **Agent Policy v1 spec** (parsed, ETag-cached, partially enforced) already has the right shape:

```json
{
  "version": "1.0",
  "site": "notion.so",
  "actions": [
    {
      "name": "create_page",
      "endpoint": "POST /api/v3/pages",
      "args_schema": { "title": "string", "content": "string" },
      "auth": "cookie",
      "idempotent": false
    },
    {
      "name": "search",
      "endpoint": "GET /api/v3/search",
      "args_schema": { "query": "string" },
      "auth": "cookie",
      "idempotent": true
    }
  ],
  "objectives": [
    {
      "id": "create_document",
      "summary": "Create a new Notion page",
      "preferred_flow": "call actions.create_page with title+content"
    }
  ]
}
```

The gap is that **structured action invocation** (`browser_invoke_structured_action`) is roadmap item #3 but not yet built. Once it exists, `agent.json` alone handles the "Google declares `search`" case — no `skill.md` needed.

### Recommendation

1. **Implement structured action invocation** first. Highest-leverage piece in the roadmap.
2. **Extend `agent.json`** with optional `tasks: [{name, description, steps}]` for composed multi-step operations.
3. **Keep llms.txt as context injection**, not skill generation. It's correct for "tell the agent how this site's docs work" — wrong for "tell the agent what actions it can take."

---

## 3. Idea 2: "Learn from Web Page" — browser observes, agent reasons, saves to existing layers

This is the observational (push) model — complementary to the declarative (pull) model of `agent.json`.

### 3.1 What Horizon already gives you

| Primitive | What it returns | When it's useful |
|---|---|---|
| `screenshot_marked` | Every clickable element as `{id, x, y, w, h, tag, role, label, href}` in reading order | Inventory of everything interactive |
| `axtree` | Accessibility tree — names, roles, bounding rects | Semantic structure the page declares to screen readers |
| `get_dom({ depth })` | Structured DOM snapshot at configurable depth | Form structures, data attributes, ARIA annotations |
| `describe_at({ x, y })` | Tag, id, classes, rect, text under a pixel | Inspecting what's there before classifying it |
| `reader_extract` | Mozilla Readability output | Extracting main content (for article-like pages) |
| `cdp_subscribe` / `cdp_collect` | Buffered CDP events per method | Watching network, console, navigation, DOM mutations |
| `browser_evaluate({ expression })` | Arbitrary JS return value | Probing the page programmatically |

### 3.2 Technique A: CDP event hooking — observe what the page *does*

Horizon's `cdp_subscribe` → act → `cdp_collect` pattern (from `network-spying.md`) is the foundation. For page learning, subscribe to a richer set:

```
browser_cdp_subscribe({ method: "Network.requestWillBeSent" })
browser_cdp_subscribe({ method: "Network.responseReceived" })
browser_cdp_subscribe({ method: "Runtime.consoleAPICalled" })
browser_cdp_subscribe({ method: "Page.frameNavigated" })
```

Then passively observe what the page does during normal user interaction:

| CDP Event | What it reveals for learning |
|---|---|
| `Network.requestWillBeSent` | API endpoints the page calls naturally — `POST /api/v3/pages`, `GET /api/v3/search?q=...`, `DELETE /api/v3/blocks/:id`. No agent clicking needed. |
| `Network.responseReceived` | Response status, content-type, headers. JSON responses reveal schema. GraphQL endpoints identifiable by `{"query":"..."}` bodies. |
| `Network.getResponseBody` | Full response body (call per requestId). Schema extraction: "this endpoint returns `{id, title, content, created_at}`". |
| `Runtime.consoleAPICalled` | Framework debug output, state dumps, feature flags. Some apps log available routes or feature toggles. |
| `Page.frameNavigated` | SPA route transitions. `/workspace/:id` → `/settings/profile` → the page's information architecture reveals itself through navigation. |
| `DOMDebugger.getEventListeners` | Per-node event listeners. Call on identified interactive elements to see what handler fires — reveals custom behavior not in the DOM. |
| `Runtime.evaluate` + `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` | React fiber tree access. Walk the component tree for semantic component names, props, and state. |

**Key insight for network observation:** Subscribe *before* the user demonstrates a task. Each API call the page fires is a candidate `action` entry. A single session on a page may reveal 5-20 endpoints naturally — no clicking needed.

**Passive vs. active observation:**

```
Passive (no agent interaction):
  Subscribe → user browses normally → collect → analyze collected URLs

Active (agent clicks around):
  Subscribe → agent clicks "New Page" → collect → see POST /api/v3/pages
```

Both modes are useful. Passive is zero-interaction and works in the background. Active is targeted.

### 3.3 Technique B: Scripting — programmatic page probing

`browser_evaluate` gives arbitrary JS execution. For page learning, inject probes:

#### Framework detection

```js
// Detect the frontend framework — tells you which hooks to try next
() => {
  if (window.React?.version) return { framework: "react", version: window.React.version };
  if (window.__VUE__) return { framework: "vue", version: window.__VUE__ };
  if (window.angular) return { framework: "angular", version: window.angular.version.full };
  if (document.querySelector("[data-reactroot]")) return { framework: "react", detected: "data-reactroot" };
  if (document.querySelector("[data-v-]")) return { framework: "vue", detected: "scoped-styles" };
  return { framework: "unknown" };
}
```

#### Form extraction

```js
// Extract all forms with their methods, actions, and fields
() => [...document.forms].map(f => ({
  action: f.action,
  method: f.method,
  fields: [...f.elements].map(e => ({
    name: e.name,
    type: e.type,
    required: e.required,
    placeholder: e.placeholder
  }))
}))
```

#### Event listener enumeration

```js
// For a given element, list bound listeners (requires CDP, but evaluate can discover listeners via framework internals)
// React: fiber._debugOwner, fiber.memoizedProps.onClick
// Vue: __vueParentComponent, __vue_app__
// Vanilla: getEventListeners(node) — CDP-only, not available in evaluate
() => {
  const root = document.getElementById("root");
  const fiberKey = Object.keys(root).find(k => k.startsWith("__reactFiber"));
  if (!fiberKey) return null;
  // Walk React fiber tree, collect component names and their handler props
  const components = [];
  const walk = (node) => {
    if (!node) return;
    const name = node.type?.displayName || node.type?.name || node.elementType?.name;
    const props = node.memoizedProps || {};
    const handlers = Object.keys(props).filter(k => k.startsWith("on") && typeof props[k] === "function");
    if (name && handlers.length > 0) components.push({ name, handlers });
    walk(node.child);
    walk(node.sibling);
  };
  walk(root[fiberKey]);
  return components;
}
```

#### State dump discovery

```js
// Many SPAs dump initial state on window
() => {
  const keys = Object.keys(window).filter(k =>
    k.startsWith("__") || k.includes("STATE") || k.includes("STORE") || k === "APP_CONFIG"
  );
  return keys.map(k => ({ key: k, type: typeof window[k], keysHint: typeof window[k] === "object" ? Object.keys(window[k] || {}).slice(0, 10) : null }));
}
```

#### Route enumeration (SPA routers)

```js
// Try common SPA router internals
() => {
  const routes = [];
  // React Router v6: window.__reactRouterManifest or data-router
  // Vue Router: app.config.globalProperties.$router
  // Check for common patterns
  const links = [...document.querySelectorAll("a[href]")];
  const paths = new Set(links.map(l => new URL(l.href, location.origin).pathname));
  // Group by pattern: /users/123, /users/456 → /users/:id
  const patterns = {};
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    const key = parts.map(s => /^\d+$/.test(s) ? ":id" : /^[a-f0-9-]{20,}$/.test(s) ? ":uuid" : s).join("/");
    patterns[key] = (patterns[key] || 0) + 1;
  }
  return patterns;
}
```

#### Scripting during learning workflow

A full learn session could run a batch of probes:

```
browser_evaluate({ expression: FRAMEWORK_DETECT })
browser_evaluate({ expression: FORM_EXTRACTION })
browser_evaluate({ expression: STATE_DUMP_DISCOVERY })
browser_evaluate({ expression: ROUTE_ENUMERATION })

→ Agent receives: { framework: "react", forms: [...], stateKeys: ["__INITIAL_STATE__"], routes: { "workspace/:uuid": 8, "settings/profile": 1 } }
→ Agent infers: "This is a React SPA with workspace-level routing, has a settings form, and dumps initial state on window.__INITIAL_STATE__"
→ Saves as domain skill: workspace-navigation.md
```

### 3.4 Technique C: URL pattern analysis

Horizon already has `browser_get_url()`. The learn tool should also:

#### Current URL structure

| Pattern | Inference |
|---|---|
| `/docs/`, `/docs/getting-started` | Documentation site — `reader_extract` useful, `llms.txt` likely available |
| `/admin/`, `/dashboard/` | Admin interface — CRUD operations, likely has forms, tables, filters |
| `/api/v1/` (in page links or observed network) | REST API surface — `agent.json` candidate endpoints |
| `/product/:id`, `/user/:id/settings` | Resource-oriented — actions are CRUD on resources |
| `/search?q=...`, `?filter=...&sort=...` | Query parameters reveal filter dimensions |
| `#/workspace/123`, `#/settings` | Hash-based SPA routing — route inventory |
| `/login`, `/signup`, `/auth/` | Auth surface — `login-walls.md` skill applies |

#### Link inventory + pattern grouping

```
browser_evaluate: collect all <a href> on page
→ Group by URL pattern (replace IDs with placeholders)
→ Report: "Discovered 8 links matching /workspace/:uuid, 3 matching /settings/:section"
→ Inference: workspace detail pages are the primary content type; settings has subsections
```

#### Cross-reference with `agent.json`

```
browser_get_url() → origin is notion.so
browser_get_agent_policy() → level 0 (no /agent.json)
browser_cdp_collect({ method: "Network.requestWillBeSent" })
  → Observed: GET /api/v3/search, POST /api/v3/pages, PATCH /api/v3/blocks/:id
→ Suggestion: "This origin doesn't publish agent.json, but we observed these API endpoints.
              Would you like to save them as structured actions for this domain?"
```

---

## 4. `browser_learn_page_actions` — full tool design

### 4.1 Interface

```
browser_learn_page_actions({
  mode?: "passive" | "active",       // passive = just observe, active = probe + CDP
  includeNetwork?: boolean,           // subscribe to Network.* CDP events
  includeScripting?: boolean,         // run framework/state probes via evaluate
  includeUrlAnalysis?: boolean,       // analyze URL patterns + link inventory
  observeDurationMs?: number,         // how long to collect CDP events (default 2000ms)
})
```

### 4.2 Internal phases

```
PHASE 1: Perception (always runs)
  screenshot_marked()  → marks[] — inventory of interactive elements
  axtree()             → semantic roles, labels, hierarchy
  get_dom({ depth: 3 }) → DOM structure summary

PHASE 2: URL analysis (if includeUrlAnalysis)
  get_url()            → current URL structure
  evaluate(collect all <a href> → group by pattern)
  Cross-reference with agent policy level

PHASE 3: Scripting probes (if includeScripting)
  evaluate(framework detection)
  evaluate(form extraction)
  evaluate(state dump discovery)
  evaluate(route enumeration)

PHASE 4: CDP observation (if includeNetwork)
  cdp_subscribe(Network.requestWillBeSent)
  cdp_subscribe(Network.responseReceived)
  Wait observeDurationMs for natural page activity
  cdp_collect(Network.requestWillBeSent)
  cdp_collect(Network.responseReceived)
  cdp_unsubscribe(all)
  For interesting endpoints: cdp(Network.getResponseBody) per requestId
```

### 4.3 Output shape

```ts
interface LearnResult {
  origin: string;
  url: string;
  agentPolicyLevel: 0 | 1 | 2 | 3;
  perception: {
    interactiveCount: number;
    elementsByRole: Record<string, number>;     // { button: 12, link: 45, textbox: 3, ... }
    forms: Array<{
      action: string;
      method: string;
      fieldCount: number;
      submitLabel: string;
    }>;
    navSections: Array<{
      label: string;
      linkCount: number;
      links: Array<{ href: string; text: string }>;
    }>;
  };
  scripting?: {
    framework: string | null;
    stateKeys: string[];
    routePatterns: Record<string, number>;      // { "workspace/:id": 8, "settings/:section": 3 }
  };
  network?: {
    observedEndpoints: Array<{
      method: string;
      path: string;
      status: number;
      contentType: string;
      sampleResponse?: unknown;                  // from getResponseBody
    }>;
    graphqlEndpoints: string[];
    authEndpoints: string[];
  };
  urlAnalysis?: {
    currentPattern: string;                      // "resource/:id/action"
    queryParams: string[];
    discoveredPatterns: Record<string, number>;
  };
  suggestedActions: Array<{
    name: string;                                // "search", "create_page", "filter_by_status"
    category: "crud" | "navigation" | "filter" | "auth" | "export" | "custom";
    elements: Array<{ markId: number; role: string; label: string }>;
    observedEndpoint?: { method: string; path: string };
    confidence: "high" | "medium" | "low";
  }>;
}
```

### 4.4 Suggested action classification rules

| Element pattern | Inferred action | Confidence |
|---|---|---|
| `<input type="search">` or `role="searchbox"` with adjacent submit button | `search` | high |
| `<form>` with method=POST and submit label "Create"/"New"/"Add"/"Save" | `create` | high |
| `<form>` with method=POST/PUT/PATCH and submit "Update"/"Save changes" | `update` | medium |
| `<button>` or `<a>` with "Delete"/"Remove"/"Archive" visible text | `delete` | medium (need confirm — could be benign) |
| `<select>` + adjacent `<button>` with "Filter"/"Apply" label | `filter` | high |
| `<nav>` with 5+ `<a>` children sharing a URL pattern | `navigate_section` | high |
| `<button>` with "Export"/"Download"/"CSV"/"PDF" | `export` | high |
| `<form>` with `<input type="file">` | `upload` | high |
| `<form>` with `<input type="email">` + `<input type="password">` | `login` or `signup` | high |
| Any element with `data-agent-action="name"` attribute — spec § 6 (Agent Policy v1) | Whatever the attribute says | authoritative |

---

## 5. Output should feed into existing knowledge layers

Learned actions become **domain skills**, **helpers**, or **workflows** — not a new format:

| Discovered pattern | Best output target | Example |
|---|---|---|
| Search bar with text input + submit | `domain_skill_save({ name: "search.md", ... })` | "To search: click the search input at ~(x,y), type query, results load via XHR to /api/search" |
| Button that fires `POST /api/v3/pages` | `save_helper({ name: "create_page", expression: "(title) => fetch(...)" })` + domain skill note | Helper handles the API; domain skill documents the button for UI-driven workflows |
| Form with 5 fields → submit creates item | `workflow_record` the steps, `workflow_save`, then domain skill note | Workflow for replay; domain skill describes what it does |
| Navigation sidebar with 8 workspace links | `domain_skill_save({ name: "navigation.md", ... })` | "8 workspaces available. Navigate by clicking sidebar links. Use /workspace/:id URL pattern directly for faster access." |

---

## 6. Architecture

```
                         DECLARATIVE                               OBSERVATIONAL
                      (site authors publish)                     (browser discovers)
                              │                                           │
                              ▼                                           ▼
                    ┌─────────────────┐                     ┌──────────────────────────┐
                    │   /agent.json   │                     │  browser_learn_page_actions│
                    │                  │                     │                            │
                    │  actions[]       │── structured ──→   │  Phase 1: Perception       │
                    │  objectives[]    │   invocation       │    screenshot_marked + axtree│
                    │  capabilities    │   (when built)     │                            │
                    │  safety gates    │                    │  Phase 2: URL analysis      │
                    └────────┬─────────┘                    │    pattern + link inventory │
                             │                              │                            │
                             │                              │  Phase 3: Scripting probes  │
                             │                              │    framework, forms, state  │
                             │                              │                            │
                             │                              │  Phase 4: CDP observation   │
                             │                              │    Network.* subscription   │
                             │                              │                            │
                             │                              │  → LearnResult output       │
                             │                              └────────────┬───────────────┘
                             │                                           │
                             │                               ┌───────────▼───────────────┐
                             │                               │  When agent.json absent:  │
                             │                               │  learn fills the gap      │
                             │                               │  (UI-based actions via     │
                             │                               │   domain skills/helpers)  │
                             │                               └───────────────────────────┘
                             ▼
               ┌─────────────────────────────────────────────────────────┐
               │                  Knowledge Layers (userData/)            │
               │                                                         │
               │  domain-skills/<host>/  ← domain_skill_save             │
               │  js-helpers.json        ← save_helper                   │
               │  action-workflows.json  ← workflow_record_start/stop    │
               └─────────────────────────────────────────────────────────┘
```

---

## 7. Implementation plan (priority order)

### Phase 1: Structured action invocation — `browser_invoke_structured_action` (~2 days)
- Build the tool that looks up `actions[].endpoint`, resolves auth, performs HTTP request via page session
- Unlocks `agent.json` from "parsed but not actionable" to "agent skips UI entirely"
- Requires: new method on `BrowserHarness`, new route in `HorizonBridgeServer`, new tool in `horizon-bridge.ts`

### Phase 2: Perception + URL analysis in learn tool (~2 days)
- Build `browser_learn_page_actions({ mode: "passive" })` with Phase 1 + Phase 2 only
- Agent reasons over `LearnResult.perception` + `LearnResult.urlAnalysis` to propose domain skills
- No CDP or scripting yet — just what's already available from `screenshot_marked` + `axtree` + `get_dom`
- This is the minimum viable learn tool

### Phase 3: Scripting probes (~1 day)
- Add Phase 3 to the learn tool
- Framework detection, form extraction, state dump discovery, route enumeration
- These are all `browser_evaluate` calls — no new CDP subscription needed

### Phase 4: CDP network observation (~2 days)
- Add Phase 4 — the highest-value but most complex piece
- Subscribe to `Network.requestWillBeSent` + `Network.responseReceived`
- `Network.getResponseBody` for schema extraction
- Timeout-based collection (passive) or action-triggered (active)

### Phase 5: Agent-driven confirmation flow (~1 day)
- `browser_suggest_skill` tool that surfaces the LLM's proposed skills to the user
- Confirmation → saves via existing `domain_skill_save` / `save_helper` / `workflow_save`
- Rejection or edit → agent revises and re-proposes

### Phase 6: Extend `agent.json` with task composition (~1 day)
- Add `tasks: [{name, description, steps: string[]}]` to `AgentPolicy` type
- Steps reference action names from `actions[]`
- Handles the "Notion → create document = create_page + set_title" case

---

## 8. Key design principles

1. **No new `skill.md` format for websites.** Extend `agent.json` — already parsed, cached, spec'd.

2. **Learn tool is a data-collection primitive.** Browser gathers structured inventory; LLM reasons about it. Pattern recognition lives in the LLM, not in the tool.

3. **Output feeds existing knowledge layers.** Domain skills, helpers, workflows — not a new storage format. The agent already knows how to read all three.

4. **CDP hooking makes learn passive-first.** Subscribe before the user interacts; collect endpoints without clicking. Active probing (clicking around) is a secondary mode for when passive isn't enough.

5. **Scripting provides semantic depth.** Framework detection tells you _what_ to look for. State dump discovery tells you _what data is available_. Route enumeration tells you the _information architecture_.

6. **URL patterns are the cheapest signal.** Link inventory + pattern grouping takes one `browser_evaluate` call. Do it first; skip heavier probes when the pattern is clear.

7. **Trust boundary: always confirm learned skills with the user.** The agent proposes; the user confirms or edits. Sites could inject misleading labels ("Delete account" → labeled "Preferences"). The confirmation flow is non-negotiable.
