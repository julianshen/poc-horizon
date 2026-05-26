/**
 * Horizon bridge extension for Pi.
 *
 * Loaded via `pi --mode rpc -e <path-to-this-file>`. Registers browser
 * tools that, when called by the LLM, forward the call to Horizon's
 * main process over a loopback TCP socket. The port is supplied by the
 * parent process via the HORIZON_BRIDGE_PORT environment variable.
 *
 * Protocol: JSON object per line over TCP. Request {id, tool, args},
 * response {id, ok, result?, error?} with the same id.
 *
 * No external deps — Pi's runtime provides ExtensionAPI + TypeBox.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createConnection, type Socket } from "net";

interface PendingCall {
	resolve: (v: unknown) => void;
	reject: (err: Error) => void;
}

const PORT = Number(process.env.HORIZON_BRIDGE_PORT ?? 0);

let sock: Socket | null = null;
let buf = "";
const pending = new Map<string, PendingCall>();
let nextId = 0;

function getConn(): Promise<Socket> {
	if (sock && !sock.destroyed) return Promise.resolve(sock);
	if (!PORT) return Promise.reject(new Error("HORIZON_BRIDGE_PORT not set"));
	return new Promise((resolve, reject) => {
		const s = createConnection({ host: "127.0.0.1", port: PORT });
		s.setEncoding("utf8");
		s.on("connect", () => {
			sock = s;
			resolve(s);
		});
		s.on("error", (err) => {
			sock = null;
			reject(err);
		});
		s.on("close", () => {
			sock = null;
			for (const p of pending.values()) p.reject(new Error("bridge closed"));
			pending.clear();
		});
		s.on("data", (chunk: string) => {
			buf += chunk;
			let nl: number;
			while ((nl = buf.indexOf("\n")) !== -1) {
				const line = buf.slice(0, nl).replace(/\r$/, "");
				buf = buf.slice(nl + 1);
				if (!line) continue;
				try {
					const resp = JSON.parse(line) as {
						id: string;
						ok: boolean;
						result?: unknown;
						error?: string;
					};
					const p = pending.get(resp.id);
					if (!p) continue;
					pending.delete(resp.id);
					if (resp.ok) p.resolve(resp.result);
					else p.reject(new Error(resp.error ?? "unknown bridge error"));
				} catch {
					/* ignore malformed lines */
				}
			}
		});
	});
}

async function callBridge(tool: string, args: Record<string, unknown>): Promise<unknown> {
	const conn = await getConn();
	const id = String(++nextId);
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		conn.write(JSON.stringify({ id, tool, args }) + "\n");
	});
}

/** Pi expects an AgentToolResult; wrap a bridge call into one. */
async function bridge(tool: string, args: Record<string, unknown>) {
	try {
		const result = await callBridge(tool, args);
		const text = typeof result === "string" ? result : JSON.stringify(result);
		return {
			content: [{ type: "text" as const, text }],
			details: result,
		};
	} catch (err) {
		return {
			content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
			details: { error: (err as Error).message },
		};
	}
}

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "browser_navigate",
		label: "Navigate browser",
		description: "Navigate Horizon's active browser tab to a URL.",
		parameters: Type.Object({ url: Type.String() }),
		execute: async (_id, params) => bridge("navigate", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_click",
		label: "Click in browser",
		description: "Click at viewport (x, y) coordinates in the active tab. Use a screenshot first to know what to click.",
		parameters: Type.Object({
			x: Type.Number(),
			y: Type.Number(),
			button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")])),
		}),
		execute: async (_id, params) => bridge("click", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_type",
		label: "Type text",
		description: "Type text into the currently focused input. Click a field first to focus it.",
		parameters: Type.Object({
			text: Type.String(),
			delayMs: Type.Optional(Type.Number()),
		}),
		execute: async (_id, params) => bridge("type", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_scroll",
		label: "Scroll page",
		description: "Scroll the active page by a delta. deltaY positive = scroll down.",
		parameters: Type.Object({
			x: Type.Optional(Type.Number()),
			y: Type.Optional(Type.Number()),
			deltaX: Type.Optional(Type.Number()),
			deltaY: Type.Optional(Type.Number()),
		}),
		execute: async (_id, params) => bridge("scroll", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_screenshot",
		label: "Screenshot",
		description: "Take a PNG screenshot of the visible viewport. Returns an image the LLM can see directly (vision-capable models only).",
		parameters: Type.Object({}),
		execute: async () => {
			try {
				const result = (await callBridge("screenshot", {})) as { base64: string; width: number; height: number };
				return {
					// Vision-capable models receive the PNG bytes directly via the
					// image content block. Non-vision models will see a placeholder
					// (Pi/the upstream API decides) — we don't fall back to base64
					// text because that wastes ~200KB of context per screenshot.
					content: [{ type: "image" as const, data: result.base64, mimeType: "image/png" }],
					details: { width: result.width, height: result.height },
				};
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Screenshot failed: ${(err as Error).message}` }],
					details: { error: (err as Error).message },
				};
			}
		},
	});

	pi.registerTool({
		name: "browser_evaluate",
		label: "Evaluate JS",
		description: "Run a JavaScript expression in the page and return the value. Useful for reading page data without a screenshot.",
		parameters: Type.Object({ expression: Type.String() }),
		execute: async (_id, params) => bridge("evaluate", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_getDom",
		label: "Get DOM",
		description: "Get a depth-limited DOM tree of the current page. Cheaper than screenshot for structural queries.",
		parameters: Type.Object({ depth: Type.Optional(Type.Number()) }),
		execute: async (_id, params) => bridge("getDom", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_getUrl",
		label: "Get URL",
		description: "Get the current URL of the active tab.",
		parameters: Type.Object({}),
		execute: async () => bridge("getUrl", {}),
	});

	pi.registerTool({
		name: "browser_getTitle",
		label: "Get title",
		description: "Get the current page title of the active tab.",
		parameters: Type.Object({}),
		execute: async () => bridge("getTitle", {}),
	});

	pi.registerTool({
		name: "browser_axtree",
		label: "Accessibility tree",
		description:
			"Get the page's accessibility tree — the semantic structure screen readers use " +
			"(headings, links, buttons, ARIA roles + names). PREFER over browser_getDom for " +
			"'find the X button' / 'list the links' / 'what are the form labels' tasks: " +
			"much cheaper in tokens and far easier for an LLM to reason over than raw HTML. " +
			"Returns the CDP Accessibility.getFullAXTree response.",
		parameters: Type.Object({}),
		execute: async () => bridge("axtree", {}),
	});

	pi.registerTool({
		name: "browser_wait_for",
		label: "Wait for condition",
		description:
			"Wait for a page condition to become true rather than sleeping a fixed time. " +
			"Use AFTER any action that triggers async work (click that submits a form, " +
			"navigate, type in a search box). One or more conditions can be combined; the " +
			"call returns as soon as ANY of them holds.\n\n" +
			"Conditions:\n" +
			"  selector: 'button.submit'  — element exists AND is visible\n" +
			"  selectorGone: '.spinner'   — element no longer in DOM\n" +
			"  networkIdleMs: 500         — no in-flight requests for N ms\n" +
			"  urlMatch: '/checkout/'     — current URL matches regex\n" +
			"  predicate: 'document.title === \"Done\"' — arbitrary JS truthy\n" +
			"  timeoutMs: 10000           — total wait budget (default 10s)\n\n" +
			"Returns {ok: true, reason: 'selector'|'urlMatch'|...} on match or " +
			"{ok: false, reason: 'timeout'}. Use this instead of repeated browser_evaluate " +
			"in a loop — it's the difference between 100ms and 3000ms response times.",
		parameters: Type.Object({
			selector: Type.Optional(Type.String()),
			selectorGone: Type.Optional(Type.String()),
			networkIdleMs: Type.Optional(Type.Number()),
			urlMatch: Type.Optional(Type.String()),
			predicate: Type.Optional(Type.String()),
			timeoutMs: Type.Optional(Type.Number()),
		}),
		execute: async (_id, params) => bridge("waitFor", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_dismiss_overlays",
		label: "Dismiss overlays",
		description:
			"Detect and remove modal/overlay/dialog elements that intercept clicks. " +
			"Call this when a click 'should have worked' but the page didn't respond — " +
			"common cause is a cookie banner, newsletter popup, login modal, or " +
			"chat-widget bubble sitting over the target. Heuristics: fixed/sticky/absolute " +
			"position, z-index >= 100 or aria-modal/role=dialog, covering >25% of the " +
			"viewport. Also strips overflow:hidden scroll locks on body/html. " +
			"Returns {removed: N, nodes: ['div#cookie-banner', ...]} so you can " +
			"see what was zapped and decide whether to re-attempt the original action.",
		parameters: Type.Object({}),
		execute: async () => bridge("dismissOverlays", {}),
	});

	pi.registerTool({
		name: "browser_describe_at",
		label: "Describe element at (x, y)",
		description:
			"Describe the element that elementFromPoint(x, y) returns. Use when a click " +
			"at coordinates seems to do nothing — this tells you what's ACTUALLY at the " +
			"point so you can detect overlays / wrong target / click-jacking layers. " +
			"Returns {tag, id, classes, role, ariaLabel, text, rect}.",
		parameters: Type.Object({ x: Type.Number(), y: Type.Number() }),
		execute: async (_id, params) => bridge("describeAt", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_cdp",
		label: "Raw CDP",
		description:
			"Send an arbitrary Chrome DevTools Protocol command to the active tab. " +
			"Power-user escape hatch when the high-level browser_* tools don't cover the " +
			"operation. Pass {method, params} where method is the CDP method name " +
			"(e.g. 'Network.enable', 'Page.captureSnapshot', 'Emulation.setDeviceMetricsOverride', " +
			"'Runtime.compileScript', 'Accessibility.getFullAXTree') and params is the " +
			"method-specific parameter object. Returns the CDP method's response object verbatim. " +
			"See https://chromedevtools.github.io/devtools-protocol/ for the full method catalog. " +
			"Prefer the higher-level browser_* tools when they fit — they're cheaper in tokens " +
			"and less error-prone. Use browser_cdp when you need a method we haven't wrapped.",
		parameters: Type.Object({
			method: Type.String(),
			params: Type.Optional(Type.Record(Type.String(), Type.Any())),
		}),
		execute: async (_id, params) => bridge("cdp", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "reader_extract",
		label: "Reader mode",
		description:
			"Extract the main article from the active tab using Mozilla's Readability " +
			"(same algorithm as Firefox Reader View). Strips nav/ads/comments and returns " +
			"the cleaned text. PREFER this over browser_getDom for reading-comprehension " +
			"tasks — far cheaper in tokens and noise-free. Returns {title, byline, " +
			"excerpt, contentHtml, textContent, length, readingMinutes, lang, siteName} " +
			"or {error: ...} when the page isn't article-shaped (app shells, login walls).",
		parameters: Type.Object({}),
		execute: async () => bridge("reader_extract", {}),
	});

	// ─── A2UI: declarative UI inside the AI panel ────────────────────────
	pi.registerTool({
		name: "render_ui",
		label: "Render UI",
		description:
			"Render rich UI inside the AI panel using A2UI v0.8 (https://a2ui.org/specification/v0_8). " +
			"Use for comparisons, summaries, dashboards.\n\n" +
			"PREFERRED shape — single call, complete tree:\n" +
			"  render_ui({ message: { surfaceId: 's1', root: 'root', components: [\n" +
			"    { id: 'root', component: { Card: { child: 'col' } } },\n" +
			"    { id: 'col', component: { Column: { children: ['title', 'body'], gap: 6 } } },\n" +
			"    { id: 'title', component: { Heading: { text: { literalString: 'Hello' }, level: 2 } } },\n" +
			"    { id: 'body', component: { Text: { text: { literalString: 'World' } } } },\n" +
			"  ] } })\n\n" +
			"Components are adjacency-list: container components reference children by id. " +
			"Standard catalog: Text (with usageHint h1..h5|body|caption), Heading (level 1..5), " +
			"Image (src,alt), Row (children, gap, align), Column (children, gap, align), " +
			"Card (child), Button (label, action), TextInput (placeholder, value, path), " +
			"Divider, List (children). All text fields take {literalString:'...'} or {path:'/data/key'}.\n\n" +
			"Alternate shape — strict envelope (one message per call):\n" +
			"  render_ui({ message: { beginRendering: { surfaceId, root, styles? } } })\n" +
			"  render_ui({ message: { surfaceUpdate: { surfaceId, components: [...] } } })\n" +
			"  render_ui({ message: { dataModelUpdate: { surfaceId, path: '/x', contents: ... } } })",
		parameters: Type.Object({
			message: Type.Any({
				description: "An A2UI v0.8 message object. See spec link above.",
			}),
		}),
		execute: async (_id, params) => {
			// The 'execute' just echoes the message back as the tool result.
			// Pi sends it via tool_execution_end → PiSession.tool_result →
			// AI panel detects render_ui and renders <A2UISurface>.
			const message = (params as { message: unknown }).message;
			return {
				content: [{ type: "text" as const, text: JSON.stringify(message) }],
				details: message,
			};
		},
	});
}
