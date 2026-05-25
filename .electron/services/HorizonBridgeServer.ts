import { createServer, Server, Socket } from 'net';
import type { BrowserHarness } from './BrowserHarness';
import { readerExtract } from './readerExtract';

interface ToolRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

interface ToolResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Local TCP bridge between our Pi extension (running inside the Pi
 * subprocess) and BrowserHarness (in our main process). Loopback only,
 * random ephemeral port — no auth needed beyond OS process boundaries.
 *
 * Protocol: JSON object per line. Extension sends ToolRequest, server
 * runs the corresponding BrowserHarness method, replies ToolResponse
 * with the same id. One connection per Pi subprocess; closes when Pi
 * exits.
 */
export class HorizonBridgeServer {
  private server: Server | null = null;
  private connections = new Set<Socket>();

  constructor(private readonly harness: BrowserHarness) {}

  /** Listen on a random loopback port. Resolves with the bound port. */
  async listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer((sock) => this.onConnection(sock));
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          this.server = srv;
          resolve(addr.port);
        } else {
          reject(new Error('Bridge server failed to bind'));
        }
      });
    });
  }

  close(): void {
    for (const s of this.connections) s.destroy();
    this.connections.clear();
    this.server?.close();
    this.server = null;
  }

  private onConnection(sock: Socket): void {
    this.connections.add(sock);
    sock.setEncoding('utf8');
    let buf = '';
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.length === 0) continue;
        void this.handleLine(sock, line);
      }
    });
    sock.on('close', () => this.connections.delete(sock));
    sock.on('error', () => this.connections.delete(sock));
  }

  private async handleLine(sock: Socket, line: string): Promise<void> {
    let req: ToolRequest;
    try {
      req = JSON.parse(line) as ToolRequest;
    } catch (err) {
      sock.write(JSON.stringify({ id: '?', ok: false, error: `parse error: ${(err as Error).message}` }) + '\n');
      return;
    }
    const resp = await this.dispatch(req);
    sock.write(JSON.stringify(resp) + '\n');
  }

  private async dispatch(req: ToolRequest): Promise<ToolResponse> {
    try {
      const result = await this.run(req.tool, req.args);
      return { id: req.id, ok: true, result };
    } catch (err) {
      return { id: req.id, ok: false, error: (err as Error).message };
    }
  }

  private async run(tool: string, args: Record<string, unknown>): Promise<unknown> {
    switch (tool) {
      case 'navigate':   await this.harness.navigate(String(args.url));                       return { ok: true };
      case 'click':      await this.harness.click(args as never);                              return { ok: true };
      case 'type':       await this.harness.type(args as never);                               return { ok: true };
      case 'scroll':     await this.harness.scroll(args as never);                             return { ok: true };
      case 'screenshot': return await this.harness.screenshot();
      case 'evaluate':   return await this.harness.evaluate(String(args.expression));
      case 'getDom':     return await this.harness.getDom(Number(args.depth ?? 4));
      case 'getUrl':     return await this.harness.getUrl();
      case 'getTitle':   return await this.harness.getTitle();
      case 'reader_extract': {
        const url = await this.harness.getUrl();
        const html = await this.harness.getHtml();
        const article = readerExtract(html, url);
        return article ?? { error: 'Could not extract article — page may not have reader-mode-compatible content.' };
      }
      default: throw new Error(`Unknown tool: ${tool}`);
    }
  }
}
