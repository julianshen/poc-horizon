import { createServer, Server, Socket } from "net";
import type { BrowserHarness } from "./BrowserHarness";
import type { HelperRegistry } from "./HelperRegistry";
import type { DomainSkills } from "./DomainSkills";
import type { SkillsLibrary } from "./SkillsLibrary";
import type { AiActionGuard } from "./AiActionGuard";
import type { ActionRecorder } from "./ActionRecorder";
import { AgentPolicyResolver } from "./AgentPolicyResolver";
import { computeConformanceLevel } from "./agentPolicy";
import { readerExtract } from "./readerExtract";
import type { StructuredActionInvoker } from "./StructuredActionInvoker";
import type { PageLearner } from "./PageLearner";

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
  private proposalSeq = 0;
  private nextProposalSeq(): number {
    this.proposalSeq += 1;
    return this.proposalSeq;
  }

  constructor(
    private readonly harness: BrowserHarness,
    private readonly helpers?: HelperRegistry,
    private readonly domainSkills?: DomainSkills,
    private readonly skillsLibrary?: SkillsLibrary,
    private readonly guard?: AiActionGuard,
    private readonly recorder?: ActionRecorder,
    /** Called when the agent invokes browser_compact. Wired by main to
     *  the currently-active PiSession. */
    private readonly compactSession?: (customInstructions?: string) => void,
    private readonly policyResolver?: AgentPolicyResolver,
    private readonly structuredInvoker?: StructuredActionInvoker,
    private readonly pageLearner?: PageLearner,
    /** Surfaces an agent-drafted save proposal to the renderer. Wired by
     *  main to broadcast ai:saveProposal. */
    private readonly onSaveProposal?: (proposal: {
      id: string;
      kind: "skill" | "action";
      name: string;
      content: string;
      host?: string;
      attach?: "activeTab" | "allTabs" | "none";
    }) => void,
  ) {}

  /**
   * Pull the registrable host out of a URL. http(s) only — chrome://,
   * file://, data: URLs return null because per-site notes don't make
   * sense for them. Mirrors DomainSkills.normalizeHost.
   */
  private hostFromUrl(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      let h = u.hostname.toLowerCase();
      if (h.startsWith("www.")) h = h.slice(4);
      return h || null;
    } catch {
      return null;
    }
  }

  /** Listen on a random loopback port. Resolves with the bound port. */
  async listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer((sock) => this.onConnection(sock));
      srv.on("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (addr && typeof addr === "object") {
          this.server = srv;
          resolve(addr.port);
        } else {
          reject(new Error("Bridge server failed to bind"));
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
    sock.setEncoding("utf8");
    let buf = "";
    sock.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line.length === 0) continue;
        void this.handleLine(sock, line);
      }
    });
    sock.on("close", () => this.connections.delete(sock));
    sock.on("error", () => this.connections.delete(sock));
  }

  private async handleLine(sock: Socket, line: string): Promise<void> {
    let req: ToolRequest;
    try {
      req = JSON.parse(line) as ToolRequest;
    } catch (err) {
      sock.write(
        JSON.stringify({
          id: "?",
          ok: false,
          error: `parse error: ${(err as Error).message}`,
        }) + "\n",
      );
      return;
    }
    const resp = await this.dispatch(req);
    sock.write(JSON.stringify(resp) + "\n");
  }

  private async dispatch(req: ToolRequest): Promise<ToolResponse> {
    try {
      if (this.guard) {
        const decision = this.guard.evaluate(req.tool, req.args);
        if (decision.kind === "deny") {
          // Hard deny — site policy prohibits this action. No user
          // prompt; surface the reason so the agent learns.
          return { id: req.id, ok: false, error: decision.reason };
        }
        if (decision.kind === "prompt") {
          const allowed = await this.guard.request(req.tool, req.args);
          if (!allowed) {
            return {
              id: req.id,
              ok: false,
              error: `denied by user: ${req.tool}`,
            };
          }
        }
      }
      const result = await this.run(req.tool, req.args);
      // Append to in-progress recording after success (read-only + meta
      // tools are filtered inside capture()).
      this.recorder?.capture(req.tool, req.args);
      return { id: req.id, ok: true, result };
    } catch (err) {
      return { id: req.id, ok: false, error: (err as Error).message };
    }
  }

  private async run(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (tool) {
      case "navigate": {
        const url = String(args.url);
        // Clear the active site policy BEFORE navigating. The
        // previous page's policy must not apply on the new page even
        // for the brief window between navigate-start and policy-
        // resolved. Default-deny semantics: no policy = apply user
        // defaults, not stale site rules.
        this.guard?.setSitePolicy(null);
        await this.harness.navigate(url);
        // Resolve against the FINAL URL (post-redirects) so a 302 to
        // a different origin gets that origin's policy, not the
        // requested URL's. harness.getUrl returns the committed URL.
        let finalUrl = url;
        try {
          finalUrl = await this.harness.getUrl();
        } catch {
          /* best effort */
        }
        const host = this.hostFromUrl(finalUrl);
        const out: Record<string, unknown> = { ok: true };
        let included = false;
        if (host && this.domainSkills) {
          const available = await this.domainSkills.list(host);
          if (available.length > 0) {
            out.host = host;
            out.domainSkillsAvailable = available;
            included = true;
          }
        }
        if (this.policyResolver) {
          const policy = await this.policyResolver.resolve(finalUrl);
          const level = computeConformanceLevel(policy);
          if (level > 0) {
            if (host && !included) out.host = host;
            out.agentPolicy = {
              level,
              site: policy?.site,
              summary: policy?.summary,
            };
          }
          // Apply the new origin's policy.
          this.guard?.setSitePolicy(policy);
        }
        return out;
      }
      case "click":
        await this.harness.click(args as never);
        return { ok: true };
      case "type":
        await this.harness.type(args as never);
        return { ok: true };
      case "scroll":
        await this.harness.scroll(args as never);
        return { ok: true };
      case "screenshot": {
        const format = args.format === "jpeg" ? "jpeg" : "png";
        const quality =
          typeof args.quality === "number" ? args.quality : undefined;
        const scale = typeof args.scale === "number" ? args.scale : 0.5;
        return await this.harness.screenshot({ format, quality, scale });
      }
      case "screenshotMarked": {
        const order = args.order === "dom" ? "dom" : "reading";
        const format = args.format === "png" ? "png" : "jpeg";
        const quality =
          typeof args.quality === "number" ? args.quality : undefined;
        const scale = typeof args.scale === "number" ? args.scale : 0.5;
        return await this.harness.screenshotMarked({
          order,
          format,
          quality,
          scale,
        });
      }
      case "evaluate":
        return await this.harness.evaluate(String(args.expression));
      case "getDom":
        return await this.harness.getDom(Number(args.depth ?? 4));
      case "getUrl":
        return await this.harness.getUrl();
      case "getTitle":
        return await this.harness.getTitle();
      case "cdp": {
        const method = String(args.method ?? "");
        if (!method) throw new Error("cdp: method is required");
        const params = (args.params ?? {}) as Record<string, unknown>;
        return await this.harness.cdp(method, params);
      }
      case "axtree":
        return await this.harness.getAxTree();
      case "tabOpen":
        return this.harness.openTab(
          typeof args.url === "string" ? args.url : undefined,
        );
      case "tabSwitch":
        return this.harness.switchTab(String(args.id));
      case "tabClose":
        return this.harness.closeTabById(String(args.id));
      case "tabList":
        return this.harness.listTabs();
      case "waitFor":
        return await this.harness.waitFor(args as never);
      case "dismissOverlays":
        return await this.harness.dismissOverlays();
      case "describeAt":
        return await this.harness.describeElementAt(
          Number(args.x),
          Number(args.y),
        );
      // ─── JS helper registry ─────────────────────────────────────
      case "saveHelper": {
        if (!this.helpers) throw new Error("helpers not enabled");
        const name = String(args.name ?? "");
        const expression = String(args.expression ?? "");
        if (!name || !expression)
          throw new Error("saveHelper: name + expression required");
        const description =
          typeof args.description === "string" ? args.description : undefined;
        return await this.helpers.save({ name, expression, description });
      }
      case "listHelpers":
        return this.helpers ? this.helpers.list() : [];
      case "removeHelper": {
        if (!this.helpers) throw new Error("helpers not enabled");
        const name = String(args.name ?? "");
        if (!name) throw new Error("removeHelper: name required");
        await this.helpers.remove(name);
        return { ok: true };
      }
      case "callHelper": {
        if (!this.helpers) throw new Error("helpers not enabled");
        const name = String(args.name ?? "");
        if (!name) throw new Error("callHelper: name required");
        const helperArgs = Array.isArray(args.args)
          ? (args.args as unknown[])
          : [];
        return await this.harness.callHelper(
          this.helpers.inlineInjection(),
          name,
          helperArgs,
        );
      }
      // ─── CDP event subscription ─────────────────────────────────
      case "cdpSubscribe": {
        const method = String(args.method ?? "");
        if (!method) throw new Error("cdpSubscribe: method required");
        return await this.harness.subscribeEvent(method);
      }
      case "cdpUnsubscribe": {
        const method =
          typeof args.method === "string" ? args.method : undefined;
        return this.harness.unsubscribeEvent(method);
      }
      case "cdpCollect": {
        const method =
          typeof args.method === "string" ? args.method : undefined;
        const max = typeof args.max === "number" ? args.max : undefined;
        return this.harness.collectEvents(method, max);
      }
      // ─── Skills library (bundled, read-only) ────────────────────
      case "skillPreamble": {
        if (!this.skillsLibrary) throw new Error("skills library not enabled");
        return await this.skillsLibrary.preamble();
      }
      case "skillListInteractions": {
        if (!this.skillsLibrary) throw new Error("skills library not enabled");
        return await this.skillsLibrary.listInteractions();
      }
      case "skillReadInteraction": {
        if (!this.skillsLibrary) throw new Error("skills library not enabled");
        const name = String(args.name ?? "");
        if (!name) throw new Error("skillReadInteraction: name required");
        const body = await this.skillsLibrary.readInteraction(name);
        if (body === null)
          throw new Error(`unknown interaction skill: ${name}`);
        return body;
      }
      // ─── Domain skills (per-site, user-writable) ────────────────
      case "domainSkillList": {
        if (!this.domainSkills) throw new Error("domain skills not enabled");
        const host = String(args.host ?? "");
        if (!host) throw new Error("domainSkillList: host required");
        return await this.domainSkills.list(host);
      }
      case "domainSkillRead": {
        if (!this.domainSkills) throw new Error("domain skills not enabled");
        const host = String(args.host ?? "");
        const name = String(args.name ?? "");
        if (!host || !name)
          throw new Error("domainSkillRead: host + name required");
        const skill = await this.domainSkills.read(host, name);
        if (!skill) throw new Error(`not found: ${host}/${name}`);
        return skill;
      }
      case "domainSkillSave": {
        if (!this.domainSkills) throw new Error("domain skills not enabled");
        const host = String(args.host ?? "");
        const name = String(args.name ?? "");
        const body = String(args.body ?? "");
        if (!host || !name || !body)
          throw new Error("domainSkillSave: host + name + body required");
        return await this.domainSkills.save(host, name, body);
      }
      case "domainSkillSearch": {
        if (!this.domainSkills) throw new Error("domain skills not enabled");
        const query = String(args.query ?? "");
        if (!query) throw new Error("domainSkillSearch: query required");
        const limit = typeof args.limit === "number" ? args.limit : 20;
        return await this.domainSkills.search(query, limit);
      }
      case "domainSkillRemove": {
        if (!this.domainSkills) throw new Error("domain skills not enabled");
        const host = String(args.host ?? "");
        const name = String(args.name ?? "");
        if (!host || !name)
          throw new Error("domainSkillRemove: host + name required");
        return { ok: await this.domainSkills.remove(host, name) };
      }
      // ─── Agent Policy v1 (spec § 4) ─────────────────────────────
      case "getAgentPolicy": {
        if (!this.policyResolver)
          return { level: 0, origin: null, policy: null };
        const url = await this.harness.getUrl();
        const origin = AgentPolicyResolver.originOf(url);
        const policy = await this.policyResolver.resolve(url);
        // Refresh the guard too — this is the path the agent takes
        // when it lands on an already-loaded page (no navigate to
        // trigger the auto-resolve), so without this update click /
        // type / dismissOverlays would evaluate against whatever
        // stale policy the guard happens to hold.
        this.guard?.setSitePolicy(policy);
        return { level: computeConformanceLevel(policy), origin, policy };
      }
      // ─── Structured action invocation ────────────────────────
      case "invokeStructuredAction": {
        const actionName = String(args.actionName ?? "");
        const actionArgs =
          args.args && typeof args.args === "object"
            ? (args.args as Record<string, unknown>)
            : {};
        if (!this.policyResolver)
          throw new Error("policy resolver not enabled");
        if (!this.structuredInvoker)
          throw new Error("structured invoker not enabled");
        const url = await this.harness.getUrl();
        const policy = await this.policyResolver.resolve(url);
        if (!policy)
          throw new Error(`no agent.json found for ${url}`);
        return await this.structuredInvoker.invoke(
          this.harness,
          policy,
          actionName,
          actionArgs,
        );
      }
      // ─── Page learning ───────────────────────────────────────
      case "learnPageActions": {
        if (!this.pageLearner)
          throw new Error("page learner not enabled");
        const mode =
          args.mode === "active"
            ? "active"
            : args.mode === "passive"
              ? "passive"
              : undefined;
        const learnResult = await this.pageLearner.learn(this.harness, {
          mode,
          includeNetwork: args.includeNetwork === true,
          includeScripting: args.includeScripting !== false,
          includeUrlAnalysis: args.includeUrlAnalysis !== false,
        });
        // The learner is policy-agnostic; the bridge owns policy
        // resolution, so fill in the conformance level here. Best-effort:
        // a resolver miss leaves the learner's default (0).
        if (this.policyResolver) {
          try {
            const policy = await this.policyResolver.resolve(learnResult.url);
            learnResult.agentPolicyLevel = computeConformanceLevel(policy);
          } catch {
            /* leave default level 0 */
          }
        }
        return learnResult;
      }
      // ─── Save proposal (agent drafts, user confirms in UI) ───────────
      case "proposeSave": {
        if (!this.onSaveProposal) throw new Error("save proposal sink not enabled");
        const kind = args.kind;
        if (kind !== "skill" && kind !== "action")
          throw new Error("proposeSave: kind must be 'skill' or 'action'");
        const name = String(args.name ?? "").trim();
        if (!name) throw new Error("proposeSave: name required");
        const content = String(args.content ?? "");
        if (!content.trim()) throw new Error("proposeSave: content required");
        const host = typeof args.host === "string" ? args.host : undefined;
        const attach =
          kind === "action" &&
          (args.attach === "activeTab" || args.attach === "allTabs" || args.attach === "none")
            ? args.attach
            : undefined;
        let resolvedHost = host;
        if (kind === "skill" && !resolvedHost) {
          resolvedHost = this.hostFromUrl(await this.harness.getUrl()) ?? undefined;
        }
        const id = `save-${this.nextProposalSeq()}`;
        this.onSaveProposal({ id, kind, name, content, host: resolvedHost, attach });
        return { proposed: true, id };
      }
      // ─── Conversation maintenance ───────────────────────────────
      case "compact": {
        if (!this.compactSession)
          throw new Error("compact not wired to a Pi session");
        const customInstructions =
          typeof args.customInstructions === "string"
            ? args.customInstructions
            : undefined;
        this.compactSession(customInstructions);
        return { ok: true };
      }
      // ─── Workflow recording / replay ────────────────────────────
      case "workflowRecordStart": {
        if (!this.recorder) throw new Error("recorder not enabled");
        const name = String(args.name ?? "");
        const description =
          typeof args.description === "string" ? args.description : undefined;
        this.recorder.start(name, description);
        return { recording: name };
      }
      case "workflowRecordStop": {
        if (!this.recorder) throw new Error("recorder not enabled");
        return await this.recorder.stop();
      }
      case "workflowList":
        return this.recorder ? this.recorder.list() : [];
      case "workflowDelete": {
        if (!this.recorder) throw new Error("recorder not enabled");
        const name = String(args.name ?? "");
        return { removed: await this.recorder.remove(name) };
      }
      case "workflowRun": {
        if (!this.recorder) throw new Error("recorder not enabled");
        const name = String(args.name ?? "");
        const wf = this.recorder.get(name);
        if (!wf) throw new Error(`workflow not found: ${name}`);
        const stepDelayMs =
          typeof args.stepDelayMs === "number" ? args.stepDelayMs : 200;
        const results: Array<{
          step: number;
          tool: string;
          ok: boolean;
          error?: string;
        }> = [];
        for (let i = 0; i < wf.steps.length; i++) {
          const step = wf.steps[i];
          try {
            await this.run(step.tool, step.args);
            results.push({ step: i, tool: step.tool, ok: true });
          } catch (err) {
            results.push({
              step: i,
              tool: step.tool,
              ok: false,
              error: (err as Error).message,
            });
            // Stop on first failure — the page state has diverged from the recording.
            break;
          }
          if (stepDelayMs > 0 && i < wf.steps.length - 1)
            await new Promise((r) => setTimeout(r, stepDelayMs));
        }
        return { name, steps: wf.steps.length, results };
      }
      case "reader_extract": {
        const url = await this.harness.getUrl();
        const html = await this.harness.getHtml();
        const article = readerExtract(html, url);
        return (
          article ?? {
            error:
              "Could not extract article — page may not have reader-mode-compatible content.",
          }
        );
      }
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }
}
