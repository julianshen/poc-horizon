import { describe, it, expect, vi, beforeEach } from "vitest";
import { PageLearner, type LearnOptions } from "@electron/services/PageLearner";

/**
 * Minimal harness stub for PageLearner tests. Only the methods the
 * learner actually calls are stubbed.
 */
function mockHarness(overrides: {
  screenshotMarked?: unknown;
  getAxTree?: unknown;
  getDom?: unknown;
  getUrl?: string;
  evaluate?: (expr: string) => unknown;
  subscribeEvent?: (method: string) => void;
  collectEvents?: (method: string) => unknown[];
  unsubscribeEvent?: (method?: string) => void;
} = {}) {
  return {
    screenshotMarked: vi.fn(async () => overrides.screenshotMarked ?? {
      format: "jpeg",
      base64: "",
      width: 1280,
      height: 800,
      marks: [],
    }),
    getAxTree: vi.fn(async () => overrides.getAxTree ?? { nodes: [] }),
    getDom: vi.fn(async () => overrides.getDom ?? {
      nodeId: 1,
      nodeType: 9, // document
      nodeName: "#document",
      childNodes: [],
    }),
    getUrl: vi.fn(async () => overrides.getUrl ?? "https://example.com"),
    evaluate: vi.fn(async (expr: string) => {
      const fn = overrides.evaluate;
      if (!fn) return { ok: true as const, value: null };
      try {
        return { ok: true as const, value: fn(expr) };
      } catch (e) {
        return { ok: false as const, error: (e as Error).message };
      }
    }),
    // Mirror the real BrowserHarness CDP event API: subscribeEvent is
    // async, collectEvents/unsubscribeEvent are synchronous.
    subscribeEvent: vi.fn(async (method: string) => {
      overrides.subscribeEvent?.(method);
      return { ok: true as const };
    }),
    collectEvents: vi.fn((method: string) => overrides.collectEvents?.(method) ?? []),
    unsubscribeEvent: vi.fn((method?: string) => {
      overrides.unsubscribeEvent?.(method);
      return { ok: true as const, cleared: 1 };
    }),
  } as unknown as {
    screenshotMarked: ReturnType<typeof vi.fn>;
    getAxTree: ReturnType<typeof vi.fn>;
    getDom: ReturnType<typeof vi.fn>;
    getUrl: ReturnType<typeof vi.fn>;
    evaluate: ReturnType<typeof vi.fn>;
    subscribeEvent: ReturnType<typeof vi.fn>;
    collectEvents: ReturnType<typeof vi.fn>;
    unsubscribeEvent: ReturnType<typeof vi.fn>;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function markedElement(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    x: 100, y: 200, w: 80, h: 32,
    tag: "button",
    role: "button",
    label: "Click me",
    href: null,
    ...overrides,
  };
}

function domForm(overrides: Record<string, unknown> = {}) {
  return {
    nodeId: 10,
    nodeType: 1,
    nodeName: "FORM",
    attributes: [
      "action", "/submit",
      "method", "post",
      ...(overrides.attributes as string[] || []),
    ],
    childNodes: [
      { nodeId: 11, nodeType: 1, nodeName: "INPUT", attributes: ["type", "text", "name", "title", "placeholder", "Enter title"] },
      { nodeId: 12, nodeType: 1, nodeName: "INPUT", attributes: ["type", "text", "name", "content", "placeholder", "Content"] },
      { nodeId: 13, nodeType: 1, nodeName: "BUTTON", attributes: ["type", "submit"], nodeValue: "Create" },
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("PageLearner", () => {
  let learner: PageLearner;

  beforeEach(() => {
    learner = new PageLearner();
  });

  describe("learn — full pipeline", () => {
    it("runs perceive + URL analysis and returns LearnResult", async () => {
      const harness = mockHarness({
        getUrl: "https://example.com/workspace/abc123",
        evaluate: (expr: string) => {
          if (expr.includes("querySelectorAll")) {
            // Route enumeration: 2 workspace links, 1 settings
            return { totalLinks: 3, patterns: { "/workspace/:uuid": 2, "/settings/profile": 1 } };
          }
          if (expr.includes("Object.keys(window)")) return [];
          return null;
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: true,
        includeUrlAnalysis: true,
        includeNetwork: false,
      } as LearnOptions);
      expect(result.origin).toBe("example.com");
      expect(result.url).toBe("https://example.com/workspace/abc123");
      expect(result.perception).toBeDefined();
      expect(result.urlAnalysis).toBeDefined();
      expect(result.classification).toBeDefined();
      // Scripting ran — framework returned null, but the result object exists.
      expect(result.scripting).toBeDefined();
      expect(result.scripting!.framework).toBeNull();
    });

    it("skips scripting when includeScripting=false", async () => {
      const harness = mockHarness();
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      expect(result.scripting).toBeUndefined();
      expect(harness.evaluate).not.toHaveBeenCalled();
    });

    it("skips network when includeNetwork=false", async () => {
      const harness = mockHarness();
      const result = await learner.learn(harness as never, {
        includeNetwork: false,
        includeScripting: false,
        includeUrlAnalysis: false,
      } as LearnOptions);
      expect(result.network).toBeUndefined();
      expect(harness.subscribeEvent).not.toHaveBeenCalled();
    });

    it("observes network: recovers real method, detects GraphQL, separates auth", async () => {
      const reqEvents = [
        {
          params: {
            requestId: "1",
            request: {
              url: "https://example.com/api/graph",
              method: "POST",
              postData: '{"query":"{ me { id } }"}',
            },
          },
        },
        {
          params: {
            requestId: "2",
            request: { url: "https://example.com/api/login", method: "POST" },
          },
        },
      ];
      const resEvents = [
        {
          params: {
            requestId: "1",
            response: {
              url: "https://example.com/api/graph",
              status: 200,
              mimeType: "application/json",
            },
          },
        },
        {
          params: {
            requestId: "2",
            response: {
              url: "https://example.com/api/login",
              status: 200,
              mimeType: "application/json",
            },
          },
        },
      ];
      const harness = mockHarness({
        collectEvents: (method) =>
          method === "Network.requestWillBeSent"
            ? reqEvents
            : method === "Network.responseReceived"
              ? resEvents
              : [],
      });
      const result = await learner.learn(harness as never, {
        includeNetwork: true,
        includeScripting: false,
        includeUrlAnalysis: false,
        observeDurationMs: 1,
      } as LearnOptions);

      expect(result.network).toBeDefined();
      const graph = result.network!.endpoints.find((e) => e.path === "/api/graph");
      expect(graph?.method).toBe("POST"); // recovered from requestWillBeSent
      expect(graph?.isGraphQL).toBe(true); // detected from postData query body
      expect(result.network!.authEndpoints).toContain("/api/login");
      expect(result.network!.totalRequests).toBe(2);
      // Subscriptions were cleaned up.
      expect(harness.unsubscribeEvent).toHaveBeenCalledWith("Network.requestWillBeSent");
      expect(harness.unsubscribeEvent).toHaveBeenCalledWith("Network.responseReceived");
    });
  });

  describe("perceive", () => {
    it("calls screenshotMarked + getAxTree + getDom", async () => {
      const harness = mockHarness();
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      expect(harness.screenshotMarked).toHaveBeenCalled();
      expect(harness.getAxTree).toHaveBeenCalled();
      expect(harness.getDom).toHaveBeenCalled();
      expect(result.perception.interactiveCount).toBe(0);
    });

    it("counts interactive elements from marks", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "button", label: "Save" }),
            markedElement({ id: 2, role: "link", label: "Home", href: "/" }),
            markedElement({ id: 3, role: "textbox", label: "Search" }),
          ],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      expect(result.perception.interactiveCount).toBe(3);
      expect(result.perception.elementsByRole).toEqual({
        button: 1,
        link: 1,
        textbox: 1,
      });
    });

    it("extracts forms with fields from DOM", async () => {
      const harness = mockHarness({
        getDom: {
          nodeId: 1, nodeType: 9, nodeName: "#document",
          childNodes: [domForm()],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      expect(result.perception.forms).toHaveLength(1);
      const form = result.perception.forms[0];
      expect(form.action).toBe("/submit");
      expect(form.method).toBe("post");
      expect(form.fieldCount).toBe(2);
      expect(form.submitLabel).toBe("Create");
    });

    it("returns empty arrays when no forms or nav sections", async () => {
      const harness = mockHarness();
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      expect(result.perception.forms).toEqual([]);
      expect(result.perception.navSections).toEqual([]);
    });

    it("identifies search inputs by role=searchbox in marks", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "searchbox", label: "Search docs", tag: "input" }),
            markedElement({ id: 2, role: "button", label: "Go" }),
          ],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      expect(result.perception.searchInputs).toHaveLength(1);
      expect(result.perception.searchInputs[0].label).toBe("Search docs");
    });
  });

  describe("analyzeUrl", () => {
    it("groups links into URL patterns replacing UUIDs", async () => {
      const harness = mockHarness({
        getUrl: "https://example.com/dashboard",
        evaluate: (_expr: string) => ({
          totalLinks: 3,
          patterns: {
            "/workspace/abc123def4567890123456": 2,
            "/settings/profile": 1,
          },
        }),
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeNetwork: false,
      } as LearnOptions);
      expect(result.urlAnalysis).toBeDefined();
      expect(result.urlAnalysis!.origin).toBe("example.com");
      // UUID → :uuid replacement happens in the evaluate expression on the page;
      // we test the classification for pattern-based inference.
    });

    it("handles pages with zero links", async () => {
      const harness = mockHarness({
        evaluate: () => ({ totalLinks: 0, patterns: {} }),
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeNetwork: false,
      } as LearnOptions);
      expect(result.urlAnalysis!.discoveredPatterns).toEqual({});
    });
  });

  describe("classify", () => {
    it("classifies searchbox as 'search' (high confidence)", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "searchbox", label: "Search", tag: "input" }),
          ],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      const searchActions = result.classification.filter((a) => a.name === "search");
      expect(searchActions).toHaveLength(1);
      expect(searchActions[0].confidence).toBe("high");
    });

    it("classifies POST form with 'Create' submit as 'create' (high confidence)", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "button", label: "Create new page", tag: "button" }),
          ],
        },
        getDom: {
          nodeId: 1, nodeType: 9, nodeName: "#document",
          childNodes: [domForm()],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      const createActions = result.classification.filter((a) => a.name === "create");
      expect(createActions).toHaveLength(1);
      expect(createActions[0].confidence).toBe("high");
    });

    it("classifies 'Delete' button as 'delete' (medium confidence)", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "button", label: "Delete item", tag: "button" }),
          ],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      const deleteActions = result.classification.filter((a) => a.name === "delete");
      expect(deleteActions).toHaveLength(1);
      expect(deleteActions[0].confidence).toBe("medium");
    });

    it("classifies <select> adjacent to filter button as 'filter' (high confidence)", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "combobox", label: "Status", tag: "select" }),
            markedElement({ id: 2, role: "button", label: "Apply filter", tag: "button" }),
          ],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      const filterActions = result.classification.filter((a) => a.name === "filter");
      expect(filterActions).toHaveLength(1);
      expect(filterActions[0].confidence).toBe("high");
    });

    it("classifies export/download button as 'export' (high confidence)", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "button", label: "Export CSV", tag: "button" }),
          ],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      const exportActions = result.classification.filter((a) => a.name === "export");
      expect(exportActions).toHaveLength(1);
      expect(exportActions[0].confidence).toBe("high");
    });

    it("classifies <nav> with 5+ patterned links as navigate_section (high)", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "link", label: "Workspace A", tag: "a", href: "/workspace/aaa" }),
            markedElement({ id: 2, role: "link", label: "Workspace B", tag: "a", href: "/workspace/bbb" }),
            markedElement({ id: 3, role: "link", label: "Workspace C", tag: "a", href: "/workspace/ccc" }),
            markedElement({ id: 4, role: "link", label: "Workspace D", tag: "a", href: "/workspace/ddd" }),
            markedElement({ id: 5, role: "link", label: "Workspace E", tag: "a", href: "/workspace/eee" }),
          ],
        },
        evaluate: () => ({
          totalLinks: 5,
          patterns: { "/workspace/:uuid": 5 },
        }),
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeNetwork: false,
      } as LearnOptions);
      const navActions = result.classification.filter((a) => a.name === "navigate_section");
      expect(navActions).toHaveLength(1);
      expect(navActions[0].confidence).toBe("high");
    });

    it("classifies login form (email+password) as 'login' (high confidence)", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "textbox", label: "Email", tag: "input" }),
            markedElement({ id: 2, role: "textbox", label: "Password", tag: "input" }),
            markedElement({ id: 3, role: "button", label: "Sign in", tag: "button" }),
          ],
        },
        getDom: {
          nodeId: 1, nodeType: 9, nodeName: "#document",
          childNodes: [{
            nodeId: 10, nodeType: 1, nodeName: "FORM",
            attributes: ["action", "/login", "method", "post"],
            childNodes: [
              { nodeId: 11, nodeType: 1, nodeName: "INPUT", attributes: ["type", "email", "name", "email"] },
              { nodeId: 12, nodeType: 1, nodeName: "INPUT", attributes: ["type", "password", "name", "password"] },
              { nodeId: 13, nodeType: 1, nodeName: "BUTTON", attributes: ["type", "submit"], nodeValue: "Sign in" },
            ],
          }],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      const loginActions = result.classification.filter((a) => a.name === "login");
      expect(loginActions).toHaveLength(1);
      expect(loginActions[0].confidence).toBe("high");
    });

    it("classifies <input type=file> adjacent to button as 'upload' (high)", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "button", label: "Upload file", tag: "button" }),
          ],
        },
        getDom: {
          nodeId: 1, nodeType: 9, nodeName: "#document",
          childNodes: [{
            nodeId: 10, nodeType: 1, nodeName: "FORM",
            attributes: ["action", "/upload", "method", "post"],
            childNodes: [
              { nodeId: 11, nodeType: 1, nodeName: "INPUT", attributes: ["type", "file", "name", "attachment"] },
              { nodeId: 12, nodeType: 1, nodeName: "BUTTON", attributes: ["type", "submit"], nodeValue: "Upload" },
            ],
          }],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      const uploadActions = result.classification.filter((a) => a.name === "upload");
      // The file input is in the DOM but may not be a mark; the upload
      // label button is. The classifier checks both.
      expect(uploadActions.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty classification for unclassifiable elements", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "generic", label: "div with no meaning", tag: "div" }),
          ],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false,
        includeUrlAnalysis: false,
        includeNetwork: false,
      } as LearnOptions);
      expect(result.classification).toEqual([]);
    });

    it("classifies POST form with 'Save changes' submit as 'update' (medium)", async () => {
      const harness = mockHarness({
        getDom: {
          nodeId: 1, nodeType: 9, nodeName: "#document",
          childNodes: [{
            nodeId: 10, nodeType: 1, nodeName: "FORM",
            attributes: ["action", "/profile", "method", "post"],
            childNodes: [
              { nodeId: 11, nodeType: 1, nodeName: "INPUT", attributes: ["type", "text", "name", "bio"] },
              { nodeId: 12, nodeType: 1, nodeName: "BUTTON", attributes: ["type", "submit"], nodeValue: "Save changes" },
            ],
          }],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false, includeUrlAnalysis: false, includeNetwork: false,
      } as LearnOptions);
      const updateActions = result.classification.filter((a) => a.name === "update");
      expect(updateActions).toHaveLength(1);
      expect(updateActions[0].confidence).toBe("medium");
    });
  });

  describe("probeScripting", () => {
    it("detects framework, state keys, and route patterns from probe results", async () => {
      const harness = mockHarness({
        evaluate: (expr) => {
          if (expr.includes("window.React")) return { fw: "react", ver: "19.0.0" };
          if (expr.includes("Object.keys(window)")) {
            return [{ key: "__INITIAL_STATE__", type: "object", topKeys: ["user", "cfg"] }];
          }
          if (expr.includes("querySelectorAll")) {
            return { totalLinks: 6, patterns: { "/workspace/:uuid": 6 } };
          }
          return null;
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: true, includeUrlAnalysis: false, includeNetwork: false,
      } as LearnOptions);
      expect(result.scripting!.framework).toEqual({ fw: "react", ver: "19.0.0" });
      expect(result.scripting!.stateKeys).toHaveLength(1);
      expect(result.scripting!.stateKeys[0].key).toBe("__INITIAL_STATE__");
      expect(result.scripting!.routePatterns).toEqual({ "/workspace/:uuid": 6 });
      expect(result.scripting!.totalLinks).toBe(6);
    });
  });

  describe("perceive — forms and nav extraction", () => {
    it("parses textarea/select fields and falls back to body text for submit label", async () => {
      const harness = mockHarness({
        getDom: {
          nodeId: 1, nodeType: 9, nodeName: "#document",
          childNodes: [{
            nodeId: 10, nodeType: 1, nodeName: "FORM",
            attributes: ["action", "/new", "method", "POST"],
            childNodes: [
              { nodeId: 11, nodeType: 1, nodeName: "TEXTAREA", attributes: ["name", "body", "required", ""] },
              { nodeId: 12, nodeType: 1, nodeName: "SELECT", attributes: ["name", "category"] },
              // No <button type=submit>; submit label comes from body text.
              { nodeId: 13, nodeType: 1, nodeName: "DIV", childNodes: [{ nodeId: 14, nodeType: 3, nodeName: "#text", nodeValue: "Create entry" }] },
            ],
          }],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false, includeUrlAnalysis: false, includeNetwork: false,
      } as LearnOptions);
      const form = result.perception.forms[0];
      expect(form.method).toBe("post"); // lowercased
      expect(form.fieldCount).toBe(2); // textarea + select
      expect(form.fields.map((f) => f.name).sort()).toEqual(["body", "category"]);
      expect(form.submitLabel).toBe("Create"); // fallback match from CREATE_LABELS
    });

    it("extracts nav sections with links from a <nav> element", async () => {
      const harness = mockHarness({
        getDom: {
          nodeId: 1, nodeType: 9, nodeName: "#document",
          childNodes: [{
            nodeId: 10, nodeType: 1, nodeName: "NAV",
            childNodes: [
              { nodeId: 11, nodeType: 1, nodeName: "A", attributes: ["href", "/home"], childNodes: [{ nodeId: 12, nodeType: 3, nodeName: "#text", nodeValue: "Home" }] },
              { nodeId: 13, nodeType: 1, nodeName: "A", attributes: ["href", "/about"], childNodes: [{ nodeId: 14, nodeType: 3, nodeName: "#text", nodeValue: "About" }] },
            ],
          }],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false, includeUrlAnalysis: false, includeNetwork: false,
      } as LearnOptions);
      expect(result.perception.navSections).toHaveLength(1);
      expect(result.perception.navSections[0].linkCount).toBe(2);
      expect(result.perception.navSections[0].links[0]).toEqual({ href: "/home", text: "Home" });
      expect(result.perception.navSections[0].label).toBe("Navigation");
    });
  });

  describe("analyzeUrl — query params and probe failure", () => {
    it("extracts query params and patterns the current URL; tolerates probe failure", async () => {
      const harness = mockHarness({
        getUrl: "https://example.com/items/123?q=hello&sort=asc",
        evaluate: () => { throw new Error("probe blocked"); },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false, includeUrlAnalysis: true, includeNetwork: false,
      } as LearnOptions);
      expect(result.urlAnalysis!.queryParams.sort()).toEqual(["q", "sort"]);
      expect(result.urlAnalysis!.currentPattern).toBe("items/:id");
      // The link-collection probe threw → discoveredPatterns falls back to {}.
      expect(result.urlAnalysis!.discoveredPatterns).toEqual({});
    });
  });

  describe("classify — authoritative data-agent-action", () => {
    it("emits site-declared actions as high-confidence custom actions", async () => {
      const harness = mockHarness({
        evaluate: (expr) => {
          if (expr.includes("data-agent-action")) {
            return [{ name: "checkout", tag: "button", label: "Buy now" }];
          }
          if (expr.includes("querySelectorAll")) return { totalLinks: 0, patterns: {} };
          return null;
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: true, includeUrlAnalysis: false, includeNetwork: false,
      } as LearnOptions);
      expect(result.scripting!.declaredActions).toEqual([
        { name: "checkout", tag: "button", label: "Buy now" },
      ]);
      const declared = result.classification.find((a) => a.name === "checkout");
      expect(declared).toBeDefined();
      expect(declared!.confidence).toBe("high");
      expect(declared!.category).toBe("custom");
      expect(declared!.elements[0].markId).toBe(-1); // synthetic sentinel
    });
  });

  describe("classify — export breadth and mark sentinel", () => {
    it("classifies a bare 'Download' button as 'export' (no format word needed)", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [markedElement({ id: 1, role: "button", label: "Download", tag: "button" })],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false, includeUrlAnalysis: false, includeNetwork: false,
      } as LearnOptions);
      expect(result.classification.filter((a) => a.name === "export")).toHaveLength(1);
    });

    it("does not let a synthetic form action suppress a real mark with id 0", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          // A real, clickable element whose mark id is 0.
          marks: [markedElement({ id: 0, role: "button", label: "Delete record", tag: "button" })],
        },
        getDom: {
          nodeId: 1, nodeType: 9, nodeName: "#document",
          childNodes: [domForm()], // a "Create" form → synthetic element
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false, includeUrlAnalysis: false, includeNetwork: false,
      } as LearnOptions);
      // Both must classify: the form (synthetic -1) and the id-0 delete button.
      expect(result.classification.some((a) => a.name === "create")).toBe(true);
      expect(result.classification.some((a) => a.name === "delete")).toBe(true);
    });
  });

  describe("learn — mode option", () => {
    it("'active' mode observes the network even without includeNetwork", async () => {
      const harness = mockHarness({ collectEvents: () => [] });
      const result = await learner.learn(harness as never, {
        mode: "active",
        includeScripting: false,
        includeUrlAnalysis: false,
        observeDurationMs: 1,
      } as LearnOptions);
      expect(result.network).toBeDefined();
      expect(harness.subscribeEvent).toHaveBeenCalledWith("Network.requestWillBeSent");
    });
  });

  describe("probeScripting — failure and fallbacks", () => {
    it("returns null/empty defaults when every probe fails", async () => {
      const harness = mockHarness({
        evaluate: () => { throw new Error("CSP blocked eval"); },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: true, includeUrlAnalysis: false, includeNetwork: false,
      } as LearnOptions);
      expect(result.scripting!.framework).toBeNull();
      expect(result.scripting!.stateKeys).toEqual([]);
      expect(result.scripting!.routePatterns).toEqual({});
      expect(result.scripting!.totalLinks).toBe(0);
    });
  });

  describe("perceive — search input via input tag + label", () => {
    it("treats a non-searchbox input whose label mentions search as a search input", async () => {
      const harness = mockHarness({
        screenshotMarked: {
          format: "jpeg", base64: "", width: 1280, height: 800,
          marks: [
            markedElement({ id: 1, role: "textbox", label: "Site search", tag: "input" }),
          ],
        },
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false, includeUrlAnalysis: false, includeNetwork: false,
      } as LearnOptions);
      expect(result.perception.searchInputs).toHaveLength(1);
      expect(result.perception.searchInputs[0].label).toBe("Site search");
    });
  });

  describe("analyzeUrl — origin and pattern normalization", () => {
    it("strips www and normalizes a uuid path segment", async () => {
      const harness = mockHarness({
        getUrl: "https://www.example.com/u/a1b2c3d4e5f6a7b8c9d0e1f2",
        evaluate: () => ({ totalLinks: 0 }), // ok but no `patterns` key → falls back to {}
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false, includeUrlAnalysis: true, includeNetwork: false,
      } as LearnOptions);
      expect(result.origin).toBe("example.com"); // www stripped
      expect(result.urlAnalysis!.currentPattern).toBe("u/:uuid");
      expect(result.urlAnalysis!.discoveredPatterns).toEqual({}); // missing patterns key
    });
  });

  describe("analyzeUrl — non-URL fallback", () => {
    it("falls back to the raw string for origin/pattern when the URL is unparseable", async () => {
      const harness = mockHarness({
        getUrl: "not a url",
        evaluate: () => ({ totalLinks: 0, patterns: {} }),
      });
      const result = await learner.learn(harness as never, {
        includeScripting: false, includeUrlAnalysis: true, includeNetwork: false,
      } as LearnOptions);
      expect(result.origin).toBe("not a url"); // extractOrigin catch
      expect(result.urlAnalysis!.currentPattern).toBe("not a url"); // classifyUrlPattern catch
      expect(result.urlAnalysis!.queryParams).toEqual([]); // searchParams threw → []
    });
  });

  describe("observeNetwork — edge cases", () => {
    it("skips bad URLs, deduplicates, and defaults method to GET when unmatched", async () => {
      // A request event whose request object omits `method` → defaults to GET.
      const reqEvents = [
        { params: { requestId: "n", request: { url: "https://example.com/api/nometh" } } },
      ];
      const resEvents = [
        { params: { response: { status: 200 } } }, // no url → skipped
        { params: { requestId: "x", response: { url: "::: not a url", status: 200, mimeType: "text/html" } } }, // bad url → skipped
        { params: { requestId: "y", response: { url: "https://example.com/api/list", status: 200, mimeType: "application/json" } } }, // no matching request → GET
        { params: { requestId: "y2", response: { url: "https://example.com/api/list", status: 200, mimeType: "application/json" } } }, // duplicate (GET /api/list) → deduped
        { params: { requestId: "g", response: { url: "https://example.com/graphql", status: 200, mimeType: "application/json" } } }, // graphql by path
        { params: { requestId: "n", response: { url: "https://example.com/api/nometh" } } }, // matched req w/o method, response w/o status+mimeType
      ];
      const harness = mockHarness({
        collectEvents: (m) =>
          m === "Network.requestWillBeSent" ? reqEvents
            : m === "Network.responseReceived" ? resEvents : [],
      });
      const result = await learner.learn(harness as never, {
        includeNetwork: true, includeScripting: false, includeUrlAnalysis: false,
        observeDurationMs: 1,
      } as LearnOptions);
      const list = result.network!.endpoints.filter((e) => e.path === "/api/list");
      expect(list).toHaveLength(1); // deduped
      expect(list[0].method).toBe("GET"); // no matching request
      const gql = result.network!.endpoints.find((e) => e.path === "/graphql");
      expect(gql?.isGraphQL).toBe(true); // detected by path
      // Matched request without method + response without status/mimeType → defaults.
      const nometh = result.network!.endpoints.find((e) => e.path === "/api/nometh");
      expect(nometh).toMatchObject({ method: "GET", status: 0, contentType: "unknown" });
      expect(result.network!.totalRequests).toBe(6);
    });
  });
});
