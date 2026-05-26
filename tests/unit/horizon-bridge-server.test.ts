// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConnection, Socket } from 'net';
import { HorizonBridgeServer } from '@electron/services/HorizonBridgeServer';
import type { BrowserHarness } from '@electron/services/BrowserHarness';

function fakeHarness() {
  return {
    navigate: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    scroll: vi.fn(async () => {}),
    screenshot: vi.fn(async () => ({ format: 'png', base64: 'X', width: 100, height: 200 })),
    screenshotMarked: vi.fn(async () => ({ format: 'png', base64: 'M', width: 100, height: 200, marks: [{ id: 1, x: 10, y: 10, w: 50, h: 20, tag: 'button', role: null, label: 'Go', href: null }] })),
    evaluate: vi.fn(async (e: string) => ({ ok: true, value: e })),
    getDom: vi.fn(async () => ({ nodeId: 1 })),
    getUrl: vi.fn(async () => 'https://x'),
    getTitle: vi.fn(async () => 'Title'),
    cdp: vi.fn(async (method: string, params: Record<string, unknown>) => ({ echoed: { method, params } })),
    getAxTree: vi.fn(async () => ({ nodes: [{ nodeId: '1', role: { value: 'button' } }] })),
    waitFor: vi.fn(async () => ({ ok: true, reason: 'selector' })),
    dismissOverlays: vi.fn(async () => ({ removed: 2, nodes: ['div#banner', 'div.modal'] })),
    describeElementAt: vi.fn(async (x: number, y: number) => ({ tag: 'button', rect: { x, y, width: 80, height: 24 } })),
    subscribeEvent: vi.fn(async () => ({ ok: true })),
    unsubscribeEvent: vi.fn(() => ({ ok: true, cleared: 1 })),
    collectEvents: vi.fn(() => [{ at: 0, method: 'Network.responseReceived', params: { url: 'x' } }]),
    callHelper: vi.fn(async () => ({ ok: true, value: 42 })),
  } as unknown as BrowserHarness;
}

function fakeRegistry() {
  const saved: Array<{ name: string; expression: string; description?: string; createdAt: number }> = [];
  return {
    list: vi.fn(() => saved),
    get: vi.fn((name: string) => saved.find((h) => h.name === name)),
    save: vi.fn(async (h: { name: string; expression: string; description?: string }) => {
      const created = { ...h, createdAt: Date.now() };
      const idx = saved.findIndex((s) => s.name === h.name);
      if (idx === -1) saved.push(created); else saved[idx] = created;
      return created;
    }),
    remove: vi.fn(async (name: string) => { const i = saved.findIndex((h) => h.name === name); if (i !== -1) saved.splice(i, 1); }),
    inlineInjection: vi.fn(() => '/* injection */'),
  };
}

function connectClient(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = createConnection({ host: '127.0.0.1', port });
    s.setEncoding('utf8');
    s.once('connect', () => resolve(s));
    s.once('error', reject);
  });
}

function sendRecv(sock: Socket, req: object): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let buf = '';
    const onData = (chunk: string): void => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      sock.off('data', onData);
      resolve(JSON.parse(buf.slice(0, nl)) as Record<string, unknown>);
    };
    sock.on('data', onData);
    sock.write(JSON.stringify(req) + '\n');
  });
}

describe('HorizonBridgeServer', () => {
  let server: HorizonBridgeServer;
  let port: number;
  let harness: BrowserHarness;

  beforeEach(async () => {
    harness = fakeHarness();
    server = new HorizonBridgeServer(harness);
    port = await server.listen();
  });

  afterEach(() => { server.close(); });

  it('binds to a non-zero loopback port', () => {
    expect(port).toBeGreaterThan(0);
  });

  it('dispatches a navigate tool call to BrowserHarness.navigate', async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, { id: '1', tool: 'navigate', args: { url: 'https://example.com' } });
    expect(resp).toEqual({ id: '1', ok: true, result: { ok: true } });
    expect(harness.navigate).toHaveBeenCalledWith('https://example.com');
    sock.destroy();
  });

  it('returns evaluate output verbatim', async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, { id: 'x', tool: 'evaluate', args: { expression: '1+1' } });
    expect(resp).toEqual({ id: 'x', ok: true, result: { ok: true, value: '1+1' } });
    sock.destroy();
  });

  it('returns ok:false with the error message on unknown tool', async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, { id: 'u', tool: 'wat', args: {} });
    expect(resp).toMatchObject({ id: 'u', ok: false });
    expect(String(resp.error)).toContain('Unknown tool');
    sock.destroy();
  });

  it('returns ok:false when a harness method throws', async () => {
    (harness.navigate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, { id: 'e', tool: 'navigate', args: { url: 'x' } });
    expect(resp).toMatchObject({ id: 'e', ok: false, error: 'boom' });
    sock.destroy();
  });

  it('routes screenshotMarked through harness.screenshotMarked', async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, { id: 'sm', tool: 'screenshotMarked', args: {} });
    expect(resp).toMatchObject({ id: 'sm', ok: true });
    expect((resp.result as { marks: unknown[] }).marks).toHaveLength(1);
    expect(harness.screenshotMarked).toHaveBeenCalledOnce();
    sock.destroy();
  });

  it('forwards cdp tool calls to harness.cdp with method + params', async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, {
      id: 'c1',
      tool: 'cdp',
      args: { method: 'Browser.getVersion', params: { foo: 1 } },
    });
    expect(resp).toMatchObject({
      id: 'c1',
      ok: true,
      result: { echoed: { method: 'Browser.getVersion', params: { foo: 1 } } },
    });
    expect(harness.cdp).toHaveBeenCalledWith('Browser.getVersion', { foo: 1 });
    sock.destroy();
  });

  it('routes JS helper save/list/remove/call through HelperRegistry', async () => {
    const reg = fakeRegistry();
    const srv2 = new HorizonBridgeServer(harness, reg as never);
    const p2 = await srv2.listen();
    const sock = await connectClient(p2);
    const save = await sendRecv(sock, { id: 'h1', tool: 'saveHelper', args: { name: 'dbl', expression: '(x) => x * 2', description: 'double' } });
    expect(save).toMatchObject({ id: 'h1', ok: true });
    expect(reg.save).toHaveBeenCalledOnce();
    const list = await sendRecv(sock, { id: 'h2', tool: 'listHelpers', args: {} });
    expect((list.result as unknown[]).length).toBe(1);
    const call = await sendRecv(sock, { id: 'h3', tool: 'callHelper', args: { name: 'dbl', args: [21] } });
    expect(call).toMatchObject({ id: 'h3', ok: true, result: { value: 42 } });
    const rm = await sendRecv(sock, { id: 'h4', tool: 'removeHelper', args: { name: 'dbl' } });
    expect(rm).toMatchObject({ id: 'h4', ok: true });
    sock.destroy();
    srv2.close();
  });

  it('navigate response includes domainSkillsAvailable when notes exist for the host', async () => {
    // Stub domainSkills so we don't touch disk in this test.
    const ds = {
      list: vi.fn(async (host: string) => host === 'shop.example' ? ['login.md', 'checkout.md'] : []),
      read: vi.fn(), save: vi.fn(), remove: vi.fn(), listHosts: vi.fn(),
    };
    const srv2 = new HorizonBridgeServer(harness, undefined, ds as never);
    const p2 = await srv2.listen();
    const sock = await connectClient(p2);
    const withNotes = await sendRecv(sock, { id: 'n1', tool: 'navigate', args: { url: 'https://shop.example/products' } });
    expect(withNotes).toMatchObject({ id: 'n1', ok: true, result: { ok: true, host: 'shop.example', domainSkillsAvailable: ['login.md', 'checkout.md'] } });
    const noNotes = await sendRecv(sock, { id: 'n2', tool: 'navigate', args: { url: 'https://unknown.test/' } });
    expect(noNotes).toEqual({ id: 'n2', ok: true, result: { ok: true } });
    // Non-http URLs don't get queried at all.
    const fileUrl = await sendRecv(sock, { id: 'n3', tool: 'navigate', args: { url: 'horizon://newtab' } });
    expect(fileUrl).toEqual({ id: 'n3', ok: true, result: { ok: true } });
    expect(ds.list).toHaveBeenCalledTimes(2);
    sock.destroy(); srv2.close();
  });

  it('routes skill library + domain skill tools', async () => {
    const lib = {
      preamble: vi.fn(async () => '# horizon-browser\n...'),
      listInteractions: vi.fn(async () => ['dropdowns.md', 'iframes.md']),
      readInteraction: vi.fn(async (n: string) => n === 'iframes.md' ? '# Iframes\n...' : null),
    };
    const ds = {
      list: vi.fn(async () => ['a.md']),
      read: vi.fn(async () => ({ name: 'a.md', host: 'site.com', body: 'note', bytes: 4, updatedAt: 0 })),
      save: vi.fn(async () => ({ name: 'a.md', host: 'site.com', body: 'note', bytes: 4, updatedAt: 0 })),
      remove: vi.fn(async () => true),
      listHosts: vi.fn(),
    };
    const srv3 = new HorizonBridgeServer(harness, undefined, ds as never, lib as never);
    const p3 = await srv3.listen();
    const sock = await connectClient(p3);
    const pre = await sendRecv(sock, { id: 'p', tool: 'skillPreamble', args: {} });
    expect(pre).toMatchObject({ id: 'p', ok: true });
    expect(String(pre.result)).toContain('horizon-browser');

    const list = await sendRecv(sock, { id: 'l', tool: 'skillListInteractions', args: {} });
    expect((list.result as unknown[]).length).toBe(2);

    const read = await sendRecv(sock, { id: 'r', tool: 'skillReadInteraction', args: { name: 'iframes.md' } });
    expect(String(read.result)).toContain('Iframes');

    const unknown = await sendRecv(sock, { id: 'u', tool: 'skillReadInteraction', args: { name: 'nope.md' } });
    expect(unknown).toMatchObject({ ok: false });

    const ls = await sendRecv(sock, { id: 'dl', tool: 'domainSkillList', args: { host: 'site.com' } });
    expect(ls.result).toEqual(['a.md']);

    const sv = await sendRecv(sock, { id: 'sv', tool: 'domainSkillSave', args: { host: 'site.com', name: 'a.md', body: 'note' } });
    expect(sv).toMatchObject({ ok: true });
    expect(ds.save).toHaveBeenCalledOnce();

    const rd = await sendRecv(sock, { id: 'rd', tool: 'domainSkillRead', args: { host: 'site.com', name: 'a.md' } });
    expect(rd).toMatchObject({ ok: true, result: { name: 'a.md' } });

    const rm = await sendRecv(sock, { id: 'rm', tool: 'domainSkillRemove', args: { host: 'site.com', name: 'a.md' } });
    expect(rm).toMatchObject({ ok: true, result: { ok: true } });

    sock.destroy(); srv3.close();
  });

  it('routes cdpSubscribe / cdpCollect / cdpUnsubscribe to BrowserHarness', async () => {
    const sock = await connectClient(port);
    const s = await sendRecv(sock, { id: 's1', tool: 'cdpSubscribe', args: { method: 'Network.responseReceived' } });
    expect(s).toMatchObject({ id: 's1', ok: true, result: { ok: true } });
    const c = await sendRecv(sock, { id: 's2', tool: 'cdpCollect', args: {} });
    expect((c.result as unknown[]).length).toBe(1);
    const u = await sendRecv(sock, { id: 's3', tool: 'cdpUnsubscribe', args: { method: 'Network.responseReceived' } });
    expect(u).toMatchObject({ id: 's3', ok: true });
    sock.destroy();
  });

  it('routes axtree / waitFor / dismissOverlays / describeAt tool calls', async () => {
    const sock = await connectClient(port);
    const a = await sendRecv(sock, { id: 'a', tool: 'axtree', args: {} });
    expect(a).toMatchObject({ id: 'a', ok: true });
    expect((a.result as { nodes: unknown[] }).nodes).toHaveLength(1);

    const b = await sendRecv(sock, { id: 'b', tool: 'waitFor', args: { selector: 'button' } });
    expect(b).toMatchObject({ id: 'b', ok: true, result: { ok: true, reason: 'selector' } });

    const c = await sendRecv(sock, { id: 'c', tool: 'dismissOverlays', args: {} });
    expect(c).toMatchObject({ id: 'c', ok: true, result: { removed: 2 } });

    const d = await sendRecv(sock, { id: 'd', tool: 'describeAt', args: { x: 100, y: 50 } });
    expect(d).toMatchObject({ id: 'd', ok: true, result: { tag: 'button' } });
    sock.destroy();
  });

  it('rejects cdp call when method is empty', async () => {
    const sock = await connectClient(port);
    const resp = await sendRecv(sock, { id: 'c2', tool: 'cdp', args: { params: {} } });
    expect(resp).toMatchObject({ id: 'c2', ok: false });
    expect(String(resp.error)).toContain('method');
    sock.destroy();
  });

  it('handles multiple requests on one connection', async () => {
    const sock = await connectClient(port);
    const r1 = await sendRecv(sock, { id: '1', tool: 'getUrl', args: {} });
    const r2 = await sendRecv(sock, { id: '2', tool: 'getTitle', args: {} });
    expect(r1).toEqual({ id: '1', ok: true, result: 'https://x' });
    expect(r2).toEqual({ id: '2', ok: true, result: 'Title' });
    sock.destroy();
  });

  it('close() rejects in-flight connections', async () => {
    const sock = await connectClient(port);
    server.close();
    // Give the socket a tick to receive the FIN.
    await new Promise((r) => setTimeout(r, 50));
    expect(sock.destroyed).toBe(true);
  });

  it('rejects malformed JSON with an error response containing parse error', async () => {
    const sock = await connectClient(port);
    const resp = await new Promise<Record<string, unknown>>((resolve) => {
      sock.on('data', (chunk: string) => {
        const nl = chunk.indexOf('\n');
        if (nl !== -1) resolve(JSON.parse(chunk.slice(0, nl)) as Record<string, unknown>);
      });
      sock.write('{not json\n');
    });
    expect(resp).toMatchObject({ ok: false });
    expect(String(resp.error)).toContain('parse error');
    sock.destroy();
  });
});
