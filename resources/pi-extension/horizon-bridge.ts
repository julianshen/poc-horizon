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
}
