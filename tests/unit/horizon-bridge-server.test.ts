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
    evaluate: vi.fn(async (e: string) => ({ ok: true, value: e })),
    getDom: vi.fn(async () => ({ nodeId: 1 })),
    getUrl: vi.fn(async () => 'https://x'),
    getTitle: vi.fn(async () => 'Title'),
    cdp: vi.fn(async (method: string, params: Record<string, unknown>) => ({ echoed: { method, params } })),
    getAxTree: vi.fn(async () => ({ nodes: [{ nodeId: '1', role: { value: 'button' } }] })),
    waitFor: vi.fn(async () => ({ ok: true, reason: 'selector' })),
    dismissOverlays: vi.fn(async () => ({ removed: 2, nodes: ['div#banner', 'div.modal'] })),
    describeElementAt: vi.fn(async (x: number, y: number) => ({ tag: 'button', rect: { x, y, width: 80, height: 24 } })),
  } as unknown as BrowserHarness;
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
