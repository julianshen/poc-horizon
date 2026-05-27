// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createConnection, Socket } from "net";
import { HorizonBridgeServer } from "@electron/services/HorizonBridgeServer";
import type { BrowserHarness } from "@electron/services/BrowserHarness";

function fakeHarness() {
  // Track the most recently-navigated URL so getUrl() reflects it.
  // Mirrors real-browser behavior: post-navigate, getUrl returns the
  // committed URL (after any redirects). Tests that need to simulate
  // a redirect override harness.getUrl per-case.
  let currentUrl = "https://x";
  return {
    navigate: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
    click: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    scroll: vi.fn(async () => {}),
    screenshot: vi.fn(async () => ({
      format: "png",
      base64: "X",
      width: 100,
      height: 200,
    })),
    screenshotMarked: vi.fn(async () => ({
      format: "png",
      base64: "M",
      width: 100,
      height: 200,
      marks: [
        {
          id: 1,
          x: 10,
          y: 10,
          w: 50,
          h: 20,
          tag: "button",
          role: null,
          label: "Go",
          href: null,
        },
      ],
    })),
    evaluate: vi.fn(async (e: string) => ({ ok: true, value: e })),
    getDom: vi.fn(async () => ({ nodeId: 1 })),
    getUrl: vi.fn(async () => currentUrl),
    getTitle: vi.fn(async () => "Title"),
    cdp: vi.fn(async (method: string, params: Record<string, unknown>) => ({
      echoed: { method, params },
    })),
    getAxTree: vi.fn(async () => ({
      nodes: [{ nodeId: "1", role: { value: "button" } }],
    })),
    waitFor: vi.fn(async () => ({ ok: true, reason: "selector" })),
    dismissOverlays: vi.fn(async () => ({
      removed: 2,
      nodes: ["div#banner", "div.modal"],
    })),
    describeElementAt: vi.fn(async (x: number, y: number) => ({
      tag: "button",
      rect: { x, y, width: 80, height: 24 },
    })),
    subscribeEvent: vi.fn(async () => ({ ok: true })),
    unsubscribeEvent: vi.fn(() => ({ ok: true, cleared: 1 })),
    collectEvents: vi.fn(() => [
      { at: 0, method: "Network.responseReceived", params: { url: "x" } },
    ]),
    callHelper: vi.fn(async () => ({ ok: true, value: 42 })),
    openTab: vi.fn(() => ({
      id: "t1",
      url: "https://x",
      title: "X",
      isActive: true,
    })),
    switchTab: vi.fn((id: string) => ({
      id,
      url: "https://x",
      title: "X",
      isActive: true,
    })),
    closeTabById: vi.fn(() => ({ closed: true })),
    listTabs: vi.fn(() => [
      { id: "t1", url: "https://x", title: "X", isActive: true },
    ]),
  } as unknown as BrowserHarness;
}

function fakeRegistry() {
  const saved: Array<{
    name: string;
    expression: string;
    description?: string;
    createdAt: number;
  }> = [];
  return {
    list: vi.fn(() => saved),
    get: vi.fn((name: string) => saved.find((h) => h.name === name)),
    save: vi.fn(
      async (h: { name: string; expression: string; description?: string }) => {
        const created = { ...h, createdAt: Date.now() };
        const idx = saved.findIndex((s) => s.name === h.name);
        if (idx === -1) saved.push(created);
        else saved[idx] = created;
        return created;
      },
    ),
    remove: vi.fn(async (name: string) => {
      const i = saved.findIndex((h) => h.name === name);
      if (i !== -1) saved.splice(i, 1);
    }),
    inlineInjection: vi.fn(() => "/* injection */"),
  };
}

function connectClient(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = createConnection({ host: "127.0.0.1", port });
    s.setEncoding("utf8");
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  });
}

function sendRecv(sock: Socket, req: object): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: string): void => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      sock.off("data", onData);
      resolve(JSON.parse(buf.slice(0, nl)) as Record<string, unknown>);
    };
    sock.on("data", onData);
    sock.write(JSON.stringify(req) + "\n");
  });
}

describe("HorizonBridgeServer", () => {
  let server: HorizonBridgeServer;
  let port: number;
  let harness: BrowserHarness;

  beforeEach(async () => {
    harness = fakeHarness();
    server = new HorizonBridgeServer(harness);
    port = await server.listen();
  });

  afterEach(() => {
    server.close();
  });

  it("binds to a non-zero loopback port", () => {
    expect(port).toBeGreaterThan(0);
  });

  it("dispatches a navigate tool call to BrowserHarness.navigate", async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, {
      id: "1",
      tool: "navigate",
      args: { url: "https://example.com" },
    });
    expect(resp).toEqual({ id: "1", ok: true, result: { ok: true } });
    expect(harness.navigate).toHaveBeenCalledWith("https://example.com");
    sock.destroy();
  });

  it("returns evaluate output verbatim", async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, {
      id: "x",
      tool: "evaluate",
      args: { expression: "1+1" },
    });
    expect(resp).toEqual({
      id: "x",
      ok: true,
      result: { ok: true, value: "1+1" },
    });
    sock.destroy();
  });

  it("returns ok:false with the error message on unknown tool", async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, { id: "u", tool: "wat", args: {} });
    expect(resp).toMatchObject({ id: "u", ok: false });
    expect(String(resp.error)).toContain("Unknown tool");
    sock.destroy();
  });

  it("returns ok:false when a harness method throws", async () => {
    (harness.navigate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("boom"),
    );
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, {
      id: "e",
      tool: "navigate",
      args: { url: "x" },
    });
    expect(resp).toMatchObject({ id: "e", ok: false, error: "boom" });
    sock.destroy();
  });

  it("routes browser_compact to the wired compactSession callback", async () => {
    const compactSession = vi.fn();
    const srv2 = new HorizonBridgeServer(
      harness,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      compactSession,
    );
    const p2 = await srv2.listen();
    const sock = await connectClient(p2);
    const resp = await sendRecv(sock, {
      id: "c",
      tool: "compact",
      args: { customInstructions: "preserve last screenshot" },
    });
    expect(resp).toMatchObject({ id: "c", ok: true, result: { ok: true } });
    expect(compactSession).toHaveBeenCalledWith("preserve last screenshot");
    sock.destroy();
    srv2.close();
  });

  it("compact returns ok:false when not wired", async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, { id: "cn", tool: "compact", args: {} });
    expect(resp).toMatchObject({ ok: false });
    expect(String(resp.error)).toContain("not wired");
    sock.destroy();
  });

  it("records side-effecting tool calls and replays them via workflowRun", async () => {
    // Use a real ActionRecorder against a tmpfile so the file format gets exercised.
    const { ActionRecorder } =
      await import("@electron/services/ActionRecorder");
    const { promises: fsp } = await import("fs");
    const path = await import("path");
    const os = await import("os");
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "rec-bridge-"));
    const rec = new ActionRecorder(path.join(tmpDir, "wf.json"));
    const srv2 = new HorizonBridgeServer(
      harness,
      undefined,
      undefined,
      undefined,
      undefined,
      rec,
    );
    const p2 = await srv2.listen();
    const sock = await connectClient(p2);

    await sendRecv(sock, {
      id: "1",
      tool: "workflowRecordStart",
      args: { name: "demo" },
    });
    await sendRecv(sock, {
      id: "2",
      tool: "navigate",
      args: { url: "https://x" },
    });
    await sendRecv(sock, { id: "3", tool: "screenshot", args: {} }); // not recorded
    await sendRecv(sock, { id: "4", tool: "click", args: { x: 10, y: 20 } });
    const stop = await sendRecv(sock, {
      id: "5",
      tool: "workflowRecordStop",
      args: {},
    });
    expect((stop.result as { steps: unknown[] }).steps).toHaveLength(2);

    // Reset call counts to verify replay drives the harness fresh.
    (harness.navigate as ReturnType<typeof vi.fn>).mockClear();
    (harness.click as ReturnType<typeof vi.fn>).mockClear();
    const run = await sendRecv(sock, {
      id: "6",
      tool: "workflowRun",
      args: { name: "demo", stepDelayMs: 0 },
    });
    expect(
      (run.result as { results: Array<{ ok: boolean }> }).results.every(
        (r) => r.ok,
      ),
    ).toBe(true);
    expect(harness.navigate).toHaveBeenCalledWith("https://x");
    expect(harness.click).toHaveBeenCalledWith({ x: 10, y: 20 });

    sock.destroy();
    srv2.close();
  });

  it("routes multi-tab tools through BrowserHarness", async () => {
    const sock = await connectClient(port);
    const open = await sendRecv(sock, {
      id: "to",
      tool: "tabOpen",
      args: { url: "https://x" },
    });
    expect(open).toMatchObject({ id: "to", ok: true, result: { id: "t1" } });
    expect(harness.openTab).toHaveBeenCalledWith("https://x");

    const sw = await sendRecv(sock, {
      id: "tw",
      tool: "tabSwitch",
      args: { id: "t1" },
    });
    expect(sw).toMatchObject({
      ok: true,
      result: { id: "t1", isActive: true },
    });

    const ls = await sendRecv(sock, { id: "tl", tool: "tabList", args: {} });
    expect((ls.result as unknown[]).length).toBe(1);

    const cl = await sendRecv(sock, {
      id: "tc",
      tool: "tabClose",
      args: { id: "t1" },
    });
    expect(cl).toMatchObject({ ok: true, result: { closed: true } });
    sock.destroy();
  });

  it("routes screenshotMarked through harness.screenshotMarked", async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, {
      id: "sm",
      tool: "screenshotMarked",
      args: {},
    });
    expect(resp).toMatchObject({ id: "sm", ok: true });
    expect((resp.result as { marks: unknown[] }).marks).toHaveLength(1);
    expect(harness.screenshotMarked).toHaveBeenCalledOnce();
    sock.destroy();
  });

  it("forwards cdp tool calls to harness.cdp with method + params", async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, {
      id: "c1",
      tool: "cdp",
      args: { method: "Browser.getVersion", params: { foo: 1 } },
    });
    expect(resp).toMatchObject({
      id: "c1",
      ok: true,
      result: { echoed: { method: "Browser.getVersion", params: { foo: 1 } } },
    });
    expect(harness.cdp).toHaveBeenCalledWith("Browser.getVersion", { foo: 1 });
    sock.destroy();
  });

  it("routes JS helper save/list/remove/call through HelperRegistry", async () => {
    const reg = fakeRegistry();
    const srv2 = new HorizonBridgeServer(harness, reg as never);
    const p2 = await srv2.listen();
    const sock = await connectClient(p2);
    const save = await sendRecv(sock, {
      id: "h1",
      tool: "saveHelper",
      args: { name: "dbl", expression: "(x) => x * 2", description: "double" },
    });
    expect(save).toMatchObject({ id: "h1", ok: true });
    expect(reg.save).toHaveBeenCalledOnce();
    const list = await sendRecv(sock, {
      id: "h2",
      tool: "listHelpers",
      args: {},
    });
    expect((list.result as unknown[]).length).toBe(1);
    const call = await sendRecv(sock, {
      id: "h3",
      tool: "callHelper",
      args: { name: "dbl", args: [21] },
    });
    expect(call).toMatchObject({ id: "h3", ok: true, result: { value: 42 } });
    const rm = await sendRecv(sock, {
      id: "h4",
      tool: "removeHelper",
      args: { name: "dbl" },
    });
    expect(rm).toMatchObject({ id: "h4", ok: true });
    sock.destroy();
    srv2.close();
  });

  it("navigate response includes agentPolicy {level, site} when /agent.json exists", async () => {
    const resolver = {
      resolve: vi.fn(async () => ({
        version: "1.0",
        site: "Shop",
        summary: "demo store",
        capabilities: { read: { allowed: true } },
      })),
      cached: vi.fn(),
      clear: vi.fn(),
    };
    // (AgentPolicyResolver.originOf is a static method called by the route; it works on real URLs.)
    const srv2 = new HorizonBridgeServer(
      harness,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resolver as never,
    );
    const p2 = await srv2.listen();
    const sock = await connectClient(p2);
    const resp = await sendRecv(sock, {
      id: "n",
      tool: "navigate",
      args: { url: "https://shop.test/page" },
    });
    expect(resp).toMatchObject({
      ok: true,
      result: {
        ok: true,
        agentPolicy: { level: 1, site: "Shop", summary: "demo store" },
      },
    });
    sock.destroy();
    srv2.close();
  });

  it("navigate resolves policy against the FINAL URL (post-redirect), not the requested one", async () => {
    // Simulate a 302: harness.navigate is called with /checkout but getUrl
    // reports the final origin.
    (harness.navigate as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        /* nav */
      },
    );
    (harness.getUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "https://payments.thirdparty.test/",
    );
    const resolver = {
      resolve: vi.fn(async (url: string) =>
        url.includes("payments.thirdparty.test")
          ? {
              version: "1.0",
              site: "Pay Inc",
              capabilities: { read: { allowed: true } },
            }
          : null,
      ),
      cached: vi.fn(),
      clear: vi.fn(),
    };
    const srv2 = new HorizonBridgeServer(
      harness,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resolver as never,
    );
    const p2 = await srv2.listen();
    const sock = await connectClient(p2);
    const resp = await sendRecv(sock, {
      id: "r",
      tool: "navigate",
      args: { url: "https://shop.test/checkout" },
    });
    // Policy on the post-redirect origin should be resolved + surfaced.
    expect(resp).toMatchObject({
      ok: true,
      result: { agentPolicy: { site: "Pay Inc" } },
    });
    expect(resolver.resolve).toHaveBeenCalledWith(
      "https://payments.thirdparty.test/",
    );
    sock.destroy();
    srv2.close();
  });

  it("navigate clears the previous origin's site policy before resolving the new one", async () => {
    const setSitePolicy = vi.fn();
    const guard = {
      evaluate: vi.fn(() => ({ kind: "allow" })),
      setSitePolicy,
      request: vi.fn(),
      needsApproval: vi.fn(),
    };
    const resolver = {
      resolve: vi.fn(async () => null),
      cached: vi.fn(),
      clear: vi.fn(),
    };
    const srv2 = new HorizonBridgeServer(
      harness,
      undefined,
      undefined,
      undefined,
      guard as never,
      undefined,
      undefined,
      resolver as never,
    );
    const p2 = await srv2.listen();
    const sock = await connectClient(p2);
    await sendRecv(sock, {
      id: "n",
      tool: "navigate",
      args: { url: "https://x.test" },
    });
    // First call must be null — the previous policy is cleared BEFORE
    // the new one is fetched. Without this, a fast tool call after
    // navigate would evaluate against the stale previous policy.
    expect(setSitePolicy.mock.calls[0]).toEqual([null]);
    sock.destroy();
    srv2.close();
  });

  it("getAgentPolicy also refreshes the guard so subsequent tool calls see the policy", async () => {
    const setSitePolicy = vi.fn();
    const guard = {
      evaluate: vi.fn(() => ({ kind: "allow" })),
      setSitePolicy,
      request: vi.fn(),
      needsApproval: vi.fn(),
    };
    const policy = { version: "1.0", site: "X", capabilities: {} };
    const resolver = {
      resolve: vi.fn(async () => policy),
      cached: vi.fn(),
      clear: vi.fn(),
    };
    (harness.getUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "https://x.test/",
    );
    const srv2 = new HorizonBridgeServer(
      harness,
      undefined,
      undefined,
      undefined,
      guard as never,
      undefined,
      undefined,
      resolver as never,
    );
    const p2 = await srv2.listen();
    const sock = await connectClient(p2);
    await sendRecv(sock, { id: "g", tool: "getAgentPolicy", args: {} });
    expect(setSitePolicy).toHaveBeenCalledWith(policy);
    sock.destroy();
    srv2.close();
  });

  it("getAgentPolicy returns conformance level + origin + the resolved policy", async () => {
    const policy = {
      version: "1.0",
      site: "X",
      capabilities: { read: { allowed: true } },
      actions: [{ name: "a", endpoint: "GET /a", auth: "none" }],
    };
    const resolver = {
      resolve: vi.fn(async () => policy),
      cached: vi.fn(),
      clear: vi.fn(),
    };
    (harness.getUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "https://x.test/",
    );
    const srv2 = new HorizonBridgeServer(
      harness,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resolver as never,
    );
    const p2 = await srv2.listen();
    const sock = await connectClient(p2);
    const resp = await sendRecv(sock, {
      id: "g",
      tool: "getAgentPolicy",
      args: {},
    });
    expect(resp).toMatchObject({
      id: "g",
      ok: true,
      result: { level: 2, origin: "https://x.test", policy: { site: "X" } },
    });
    sock.destroy();
    srv2.close();
  });

  it("navigate response includes domainSkillsAvailable when notes exist for the host", async () => {
    // Stub domainSkills so we don't touch disk in this test.
    const ds = {
      list: vi.fn(async (host: string) =>
        host === "shop.example" ? ["login.md", "checkout.md"] : [],
      ),
      read: vi.fn(),
      save: vi.fn(),
      remove: vi.fn(),
      listHosts: vi.fn(),
    };
    const srv2 = new HorizonBridgeServer(harness, undefined, ds as never);
    const p2 = await srv2.listen();
    const sock = await connectClient(p2);
    const withNotes = await sendRecv(sock, {
      id: "n1",
      tool: "navigate",
      args: { url: "https://shop.example/products" },
    });
    expect(withNotes).toMatchObject({
      id: "n1",
      ok: true,
      result: {
        ok: true,
        host: "shop.example",
        domainSkillsAvailable: ["login.md", "checkout.md"],
      },
    });
    const noNotes = await sendRecv(sock, {
      id: "n2",
      tool: "navigate",
      args: { url: "https://unknown.test/" },
    });
    expect(noNotes).toEqual({ id: "n2", ok: true, result: { ok: true } });
    // Non-http URLs don't get queried at all.
    const fileUrl = await sendRecv(sock, {
      id: "n3",
      tool: "navigate",
      args: { url: "horizon://newtab" },
    });
    expect(fileUrl).toEqual({ id: "n3", ok: true, result: { ok: true } });
    expect(ds.list).toHaveBeenCalledTimes(2);
    sock.destroy();
    srv2.close();
  });

  it("routes skill library + domain skill tools", async () => {
    const lib = {
      preamble: vi.fn(async () => "# horizon-browser\n..."),
      listInteractions: vi.fn(async () => ["dropdowns.md", "iframes.md"]),
      readInteraction: vi.fn(async (n: string) =>
        n === "iframes.md" ? "# Iframes\n..." : null,
      ),
    };
    const ds = {
      list: vi.fn(async () => ["a.md"]),
      read: vi.fn(async () => ({
        name: "a.md",
        host: "site.com",
        body: "note",
        bytes: 4,
        updatedAt: 0,
      })),
      save: vi.fn(async () => ({
        name: "a.md",
        host: "site.com",
        body: "note",
        bytes: 4,
        updatedAt: 0,
      })),
      remove: vi.fn(async () => true),
      listHosts: vi.fn(),
    };
    const srv3 = new HorizonBridgeServer(
      harness,
      undefined,
      ds as never,
      lib as never,
    );
    const p3 = await srv3.listen();
    const sock = await connectClient(p3);
    const pre = await sendRecv(sock, {
      id: "p",
      tool: "skillPreamble",
      args: {},
    });
    expect(pre).toMatchObject({ id: "p", ok: true });
    expect(String(pre.result)).toContain("horizon-browser");

    const list = await sendRecv(sock, {
      id: "l",
      tool: "skillListInteractions",
      args: {},
    });
    expect((list.result as unknown[]).length).toBe(2);

    const read = await sendRecv(sock, {
      id: "r",
      tool: "skillReadInteraction",
      args: { name: "iframes.md" },
    });
    expect(String(read.result)).toContain("Iframes");

    const unknown = await sendRecv(sock, {
      id: "u",
      tool: "skillReadInteraction",
      args: { name: "nope.md" },
    });
    expect(unknown).toMatchObject({ ok: false });

    const ls = await sendRecv(sock, {
      id: "dl",
      tool: "domainSkillList",
      args: { host: "site.com" },
    });
    expect(ls.result).toEqual(["a.md"]);

    const sv = await sendRecv(sock, {
      id: "sv",
      tool: "domainSkillSave",
      args: { host: "site.com", name: "a.md", body: "note" },
    });
    expect(sv).toMatchObject({ ok: true });
    expect(ds.save).toHaveBeenCalledOnce();

    const rd = await sendRecv(sock, {
      id: "rd",
      tool: "domainSkillRead",
      args: { host: "site.com", name: "a.md" },
    });
    expect(rd).toMatchObject({ ok: true, result: { name: "a.md" } });

    const rm = await sendRecv(sock, {
      id: "rm",
      tool: "domainSkillRemove",
      args: { host: "site.com", name: "a.md" },
    });
    expect(rm).toMatchObject({ ok: true, result: { ok: true } });

    sock.destroy();
    srv3.close();
  });

  it("routes cdpSubscribe / cdpCollect / cdpUnsubscribe to BrowserHarness", async () => {
    const sock = await connectClient(port);
    const s = await sendRecv(sock, {
      id: "s1",
      tool: "cdpSubscribe",
      args: { method: "Network.responseReceived" },
    });
    expect(s).toMatchObject({ id: "s1", ok: true, result: { ok: true } });
    const c = await sendRecv(sock, { id: "s2", tool: "cdpCollect", args: {} });
    expect((c.result as unknown[]).length).toBe(1);
    const u = await sendRecv(sock, {
      id: "s3",
      tool: "cdpUnsubscribe",
      args: { method: "Network.responseReceived" },
    });
    expect(u).toMatchObject({ id: "s3", ok: true });
    sock.destroy();
  });

  it("routes axtree / waitFor / dismissOverlays / describeAt tool calls", async () => {
    const sock = await connectClient(port);
    const a = await sendRecv(sock, { id: "a", tool: "axtree", args: {} });
    expect(a).toMatchObject({ id: "a", ok: true });
    expect((a.result as { nodes: unknown[] }).nodes).toHaveLength(1);

    const b = await sendRecv(sock, {
      id: "b",
      tool: "waitFor",
      args: { selector: "button" },
    });
    expect(b).toMatchObject({
      id: "b",
      ok: true,
      result: { ok: true, reason: "selector" },
    });

    const c = await sendRecv(sock, {
      id: "c",
      tool: "dismissOverlays",
      args: {},
    });
    expect(c).toMatchObject({ id: "c", ok: true, result: { removed: 2 } });

    const d = await sendRecv(sock, {
      id: "d",
      tool: "describeAt",
      args: { x: 100, y: 50 },
    });
    expect(d).toMatchObject({ id: "d", ok: true, result: { tag: "button" } });
    sock.destroy();
  });

  it("rejects cdp call when method is empty", async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, {
      id: "c2",
      tool: "cdp",
      args: { params: {} },
    });
    expect(resp).toMatchObject({ id: "c2", ok: false });
    expect(String(resp.error)).toContain("method");
    sock.destroy();
  });

  it("handles multiple requests on one connection", async () => {
    const sock = await connectClient(port);
    const r1 = await sendRecv(sock, { id: "1", tool: "getUrl", args: {} });
    const r2 = await sendRecv(sock, { id: "2", tool: "getTitle", args: {} });
    expect(r1).toEqual({ id: "1", ok: true, result: "https://x" });
    expect(r2).toEqual({ id: "2", ok: true, result: "Title" });
    sock.destroy();
  });

  it("close() rejects in-flight connections", async () => {
    const sock = await connectClient(port);
    server.close();
    // Give the socket a tick to receive the FIN.
    await new Promise((r) => setTimeout(r, 50));
    expect(sock.destroyed).toBe(true);
  });

  it("rejects malformed JSON with an error response containing parse error", async () => {
    const sock = await connectClient(port);
    const resp = await new Promise<Record<string, unknown>>((resolve) => {
      sock.on("data", (chunk: string) => {
        const nl = chunk.indexOf("\n");
        if (nl !== -1)
          resolve(JSON.parse(chunk.slice(0, nl)) as Record<string, unknown>);
      });
      sock.write("{not json\n");
    });
    expect(resp).toMatchObject({ ok: false });
    expect(String(resp.error)).toContain("parse error");
    sock.destroy();
  });
});
