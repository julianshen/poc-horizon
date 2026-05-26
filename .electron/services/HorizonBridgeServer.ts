import { createServer, Server, Socket } from 'net';
import type { BrowserHarness } from './BrowserHarness';
import type { HelperRegistry } from './HelperRegistry';
import type { DomainSkills } from './DomainSkills';
import type { SkillsLibrary } from './SkillsLibrary';
import type { AiActionGuard } from './AiActionGuard';
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

  constructor(
    private readonly harness: BrowserHarness,
    private readonly helpers?: HelperRegistry,
    private readonly domainSkills?: DomainSkills,
    private readonly skillsLibrary?: SkillsLibrary,
    private readonly guard?: AiActionGuard,
  ) {}

  /**
   * Pull the registrable host out of a URL. http(s) only — chrome://,
   * file://, data: URLs return null because per-site notes don't make
   * sense for them. Mirrors DomainSkills.normalizeHost.
   */
  private hostFromUrl(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      let h = u.hostname.toLowerCase();
      if (h.startsWith('www.')) h = h.slice(4);
      return h || null;
    } catch {
      return null;
    }
  }

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
      if (this.guard?.needsApproval(req.tool)) {
        const allowed = await this.guard.request(req.tool, req.args);
        if (!allowed) {
          return { id: req.id, ok: false, error: `denied by user: ${req.tool}` };
        }
      }
      const result = await this.run(req.tool, req.args);
      return { id: req.id, ok: true, result };
    } catch (err) {
      return { id: req.id, ok: false, error: (err as Error).message };
    }
  }

  private async run(tool: string, args: Record<string, unknown>): Promise<unknown> {
    switch (tool) {
      case 'navigate': {
        const url = String(args.url);
        await this.harness.navigate(url);
        // Auto-hint: if the agent has saved per-site notes for this host,
        // surface their filenames so it can decide whether to read them.
        // Names only — keeps the navigate response cheap.
        const host = this.hostFromUrl(url);
        if (host && this.domainSkills) {
          const available = await this.domainSkills.list(host);
          if (available.length > 0) return { ok: true, host, domainSkillsAvailable: available };
        }
        return { ok: true };
      }
      case 'click':      await this.harness.click(args as never);                              return { ok: true };
      case 'type':       await this.harness.type(args as never);                               return { ok: true };
      case 'scroll':     await this.harness.scroll(args as never);                             return { ok: true };
      case 'screenshot': return await this.harness.screenshot();
      case 'screenshotMarked': return await this.harness.screenshotMarked();
      case 'evaluate':   return await this.harness.evaluate(String(args.expression));
      case 'getDom':     return await this.harness.getDom(Number(args.depth ?? 4));
      case 'getUrl':     return await this.harness.getUrl();
      case 'getTitle':   return await this.harness.getTitle();
      case 'cdp': {
        const method = String(args.method ?? '');
        if (!method) throw new Error('cdp: method is required');
        const params = (args.params ?? {}) as Record<string, unknown>;
        return await this.harness.cdp(method, params);
      }
      case 'axtree':           return await this.harness.getAxTree();
      case 'tabOpen':          return this.harness.openTab(typeof args.url === 'string' ? args.url : undefined);
      case 'tabSwitch':        return this.harness.switchTab(String(args.id));
      case 'tabClose':         return this.harness.closeTabById(String(args.id));
      case 'tabList':          return this.harness.listTabs();
      case 'waitFor':          return await this.harness.waitFor(args as never);
      case 'dismissOverlays':  return await this.harness.dismissOverlays();
      case 'describeAt':       return await this.harness.describeElementAt(Number(args.x), Number(args.y));
      // ─── JS helper registry ─────────────────────────────────────
      case 'saveHelper': {
        if (!this.helpers) throw new Error('helpers not enabled');
        const name = String(args.name ?? '');
        const expression = String(args.expression ?? '');
        if (!name || !expression) throw new Error('saveHelper: name + expression required');
        const description = typeof args.description === 'string' ? args.description : undefined;
        return await this.helpers.save({ name, expression, description });
      }
      case 'listHelpers': return this.helpers ? this.helpers.list() : [];
      case 'removeHelper': {
        if (!this.helpers) throw new Error('helpers not enabled');
        const name = String(args.name ?? '');
        if (!name) throw new Error('removeHelper: name required');
        await this.helpers.remove(name);
        return { ok: true };
      }
      case 'callHelper': {
        if (!this.helpers) throw new Error('helpers not enabled');
        const name = String(args.name ?? '');
        if (!name) throw new Error('callHelper: name required');
        const helperArgs = Array.isArray(args.args) ? (args.args as unknown[]) : [];
        return await this.harness.callHelper(this.helpers.inlineInjection(), name, helperArgs);
      }
      // ─── CDP event subscription ─────────────────────────────────
      case 'cdpSubscribe': {
        const method = String(args.method ?? '');
        if (!method) throw new Error('cdpSubscribe: method required');
        return await this.harness.subscribeEvent(method);
      }
      case 'cdpUnsubscribe': {
        const method = typeof args.method === 'string' ? args.method : undefined;
        return this.harness.unsubscribeEvent(method);
      }
      case 'cdpCollect': {
        const method = typeof args.method === 'string' ? args.method : undefined;
        const max = typeof args.max === 'number' ? args.max : undefined;
        return this.harness.collectEvents(method, max);
      }
      // ─── Skills library (bundled, read-only) ────────────────────
      case 'skillPreamble': {
        if (!this.skillsLibrary) throw new Error('skills library not enabled');
        return await this.skillsLibrary.preamble();
      }
      case 'skillListInteractions': {
        if (!this.skillsLibrary) throw new Error('skills library not enabled');
        return await this.skillsLibrary.listInteractions();
      }
      case 'skillReadInteraction': {
        if (!this.skillsLibrary) throw new Error('skills library not enabled');
        const name = String(args.name ?? '');
        if (!name) throw new Error('skillReadInteraction: name required');
        const body = await this.skillsLibrary.readInteraction(name);
        if (body === null) throw new Error(`unknown interaction skill: ${name}`);
        return body;
      }
      // ─── Domain skills (per-site, user-writable) ────────────────
      case 'domainSkillList': {
        if (!this.domainSkills) throw new Error('domain skills not enabled');
        const host = String(args.host ?? '');
        if (!host) throw new Error('domainSkillList: host required');
        return await this.domainSkills.list(host);
      }
      case 'domainSkillRead': {
        if (!this.domainSkills) throw new Error('domain skills not enabled');
        const host = String(args.host ?? '');
        const name = String(args.name ?? '');
        if (!host || !name) throw new Error('domainSkillRead: host + name required');
        const skill = await this.domainSkills.read(host, name);
        if (!skill) throw new Error(`not found: ${host}/${name}`);
        return skill;
      }
      case 'domainSkillSave': {
        if (!this.domainSkills) throw new Error('domain skills not enabled');
        const host = String(args.host ?? '');
        const name = String(args.name ?? '');
        const body = String(args.body ?? '');
        if (!host || !name || !body) throw new Error('domainSkillSave: host + name + body required');
        return await this.domainSkills.save(host, name, body);
      }
      case 'domainSkillSearch': {
        if (!this.domainSkills) throw new Error('domain skills not enabled');
        const query = String(args.query ?? '');
        if (!query) throw new Error('domainSkillSearch: query required');
        const limit = typeof args.limit === 'number' ? args.limit : 20;
        return await this.domainSkills.search(query, limit);
      }
      case 'domainSkillRemove': {
        if (!this.domainSkills) throw new Error('domain skills not enabled');
        const host = String(args.host ?? '');
        const name = String(args.name ?? '');
        if (!host || !name) throw new Error('domainSkillRemove: host + name required');
        return { ok: await this.domainSkills.remove(host, name) };
      }
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
