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
		name: "browser_screenshot_marked",
		label: "Screenshot with marks",
		description:
			"Screenshot the viewport with numbered boxes overlaid on every visible " +
			"interactive element (links, buttons, inputs, role=button, tabindex, etc). " +
			"Returns the PNG plus `marks`: an array of {id, x, y, w, h, tag, role, label, href}. " +
			"PREFER this over browser_screenshot when you're about to click — pick a mark id " +
			"and click its (x, y) directly, instead of eyeballing pixel coordinates from a raw " +
			"image. Up to 80 marks per call; off-screen and hidden elements are filtered.",
		parameters: Type.Object({}),
		execute: async () => {
			try {
				const result = (await callBridge("screenshotMarked", {})) as {
					base64: string; width: number; height: number; marks: Array<Record<string, unknown>>
				};
				return {
					content: [
						{ type: "image" as const, data: result.base64, mimeType: "image/png" },
						{ type: "text" as const, text: JSON.stringify({ marks: result.marks, width: result.width, height: result.height }) },
					],
					details: { width: result.width, height: result.height, marks: result.marks },
				};
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Marked screenshot failed: ${(err as Error).message}` }],
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

	// ─── JS helper registry ──────────────────────────────────────────────
	pi.registerTool({
		name: "browser_save_helper",
		label: "Save JS helper",
		description:
			"Save a JS function for reuse across this and future turns. The first time " +
			"you figure out a useful page-specific snippet (dismissing a site's modal, " +
			"extracting a structured value, normalising a date format), save it with a " +
			"descriptive name and call it later via browser_call_helper. Helpers persist to " +
			"disk and are available across app restarts.\n\n" +
			"expression MUST be a JS expression that evaluates to a function. Examples:\n" +
			"  expression: '(x) => x * 2'\n" +
			"  expression: 'function(url) { return fetch(url).then(r => r.json()); }'\n" +
			"  expression: '() => document.querySelectorAll(\"article h2\").length'\n\n" +
			"Saving with an existing name overwrites — use this to refine a helper that " +
			"didn't work the first time. Functions run in the page's context (full DOM access).",
		parameters: Type.Object({
			name: Type.String(),
			expression: Type.String(),
			description: Type.Optional(Type.String()),
		}),
		execute: async (_id, params) => bridge("saveHelper", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_call_helper",
		label: "Call JS helper",
		description:
			"Invoke a previously-saved JS helper on the active page. Helpers are defined " +
			"on window.__horizon.helpers by name; we inject the definitions then call " +
			"(helpers[name])(...args) and return the result.\n\n" +
			"Returns {ok:true, value} on success or {ok:false, error} when the helper throws " +
			"or doesn't exist.",
		parameters: Type.Object({
			name: Type.String(),
			args: Type.Optional(Type.Array(Type.Any())),
		}),
		execute: async (_id, params) => bridge("callHelper", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_list_helpers",
		label: "List JS helpers",
		description: "List the saved JS helpers — names + descriptions. Check this first before deriving a snippet you may already have.",
		parameters: Type.Object({}),
		execute: async () => bridge("listHelpers", {}),
	});

	pi.registerTool({
		name: "browser_remove_helper",
		label: "Remove JS helper",
		description: "Delete a saved JS helper by name. Use when a helper no longer applies (site redesigned, wrong implementation, etc).",
		parameters: Type.Object({ name: Type.String() }),
		execute: async (_id, params) => bridge("removeHelper", params as Record<string, unknown>),
	});

	// ─── CDP event subscription (hooks) ──────────────────────────────────
	pi.registerTool({
		name: "browser_cdp_subscribe",
		label: "Subscribe to CDP event",
		description:
			"Hook into a CDP event method — events arriving from now on are buffered until " +
			"you call browser_cdp_collect. Auto-enables the matching CDP domain (Network, " +
			"Page, etc.) so you don't have to call .enable separately.\n\n" +
			"Common methods:\n" +
			"  'Network.responseReceived' — watch every HTTP response on the page\n" +
			"  'Network.webSocketFrameReceived' — capture WS traffic\n" +
			"  'Page.frameNavigated' — observe SPA route changes\n" +
			"  'Page.javascriptDialogOpening' — see alert/confirm/prompt dialogs\n" +
			"  'Runtime.consoleAPICalled' — capture console.log output\n\n" +
			"Pattern: subscribe → take user action (click, type, navigate) → collect to read " +
			"what the page actually did. Far better than scraping the DOM post-hoc.",
		parameters: Type.Object({ method: Type.String() }),
		execute: async (_id, params) => bridge("cdpSubscribe", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_cdp_collect",
		label: "Collect CDP events",
		description:
			"Drain the buffer of events you've subscribed to. After collect, the buffer for " +
			"the given method (or all methods if none given) is cleared so the next collect " +
			"returns only NEW events. Optionally cap by `max` if you only want the first N.\n\n" +
			"Returns an array of {at, method, params} objects in arrival order.",
		parameters: Type.Object({
			method: Type.Optional(Type.String()),
			max: Type.Optional(Type.Number()),
		}),
		execute: async (_id, params) => bridge("cdpCollect", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_cdp_unsubscribe",
		label: "Unsubscribe CDP",
		description: "Stop receiving a specific event method, or all methods if no arg.",
		parameters: Type.Object({ method: Type.Optional(Type.String()) }),
		execute: async (_id, params) => bridge("cdpUnsubscribe", params as Record<string, unknown>),
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

	// ─── Workflow recording / replay ─────────────────────────────────────
	pi.registerTool({
		name: "browser_workflow_record_start",
		label: "Start recording",
		description:
			"Begin capturing the tool calls you make into a named, replayable sequence. " +
			"Use when you're about to perform a multi-step task you'd want to repeat (an " +
			"order-history export, a daily report download, a form submission). After this " +
			"call, every side-effecting tool you run (click, type, navigate, evaluate, etc.) " +
			"is appended to the recording until browser_workflow_record_stop. Read-only " +
			"tools (screenshot, axtree) are NOT recorded — they don't need replay.",
		parameters: Type.Object({
			name: Type.String(),
			description: Type.Optional(Type.String()),
		}),
		execute: async (_id, params) => bridge("workflowRecordStart", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_workflow_record_stop",
		label: "Stop recording",
		description:
			"Stop the in-progress recording and persist it to disk. Returns the saved " +
			"workflow with all captured steps. Overwrites by name if one already exists with " +
			"the same name (refining an existing recording is one stop call, not a delete + " +
			"redo).",
		parameters: Type.Object({}),
		execute: async () => bridge("workflowRecordStop", {}),
	});

	pi.registerTool({
		name: "browser_workflow_run",
		label: "Run workflow",
		description:
			"Replay a saved workflow. Each step dispatches through the same tool router as a " +
			"fresh agent call, so all the existing safety checks (AiActionGuard, etc.) still " +
			"apply. Stops on the first failed step — the page state has diverged from the " +
			"recording at that point. `stepDelayMs` (default 200ms) is the pause between " +
			"steps so the page can settle between actions.",
		parameters: Type.Object({
			name: Type.String(),
			stepDelayMs: Type.Optional(Type.Number()),
		}),
		execute: async (_id, params) => bridge("workflowRun", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_workflow_list",
		label: "List workflows",
		description: "List saved workflows by name (no step bodies). Check first before recording — you may already have one.",
		parameters: Type.Object({}),
		execute: async () => bridge("workflowList", {}),
	});

	pi.registerTool({
		name: "browser_workflow_delete",
		label: "Delete workflow",
		description: "Delete a saved workflow by name. Returns {removed: true|false}.",
		parameters: Type.Object({ name: Type.String() }),
		execute: async (_id, params) => bridge("workflowDelete", params as Record<string, unknown>),
	});

	// ─── Multi-tab orchestration ────────────────────────────────────────
	pi.registerTool({
		name: "browser_tab_open",
		label: "Open new tab",
		description:
			"Open a new tab in the current window and switch to it (the agent's " +
			"subsequent tool calls will target the new tab). Optional `url` — omitted = newtab page. " +
			"Returns {id, url, title, isActive}. Use when you need to drill into a result while " +
			"keeping the current page available (browser_tab_switch back to it later).",
		parameters: Type.Object({ url: Type.Optional(Type.String()) }),
		execute: async (_id, params) => bridge("tabOpen", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_tab_switch",
		label: "Switch tab",
		description:
			"Switch to the tab with the given id. Subsequent tool calls target it. " +
			"Use after browser_tab_list when you have multiple tabs open and want to act on a " +
			"specific one. Returns the tab descriptor.",
		parameters: Type.Object({ id: Type.String() }),
		execute: async (_id, params) => bridge("tabSwitch", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_tab_close",
		label: "Close tab",
		description:
			"Close the tab with the given id. After closing the previously-active tab, " +
			"call browser_tab_list to see which tab became active next.",
		parameters: Type.Object({ id: Type.String() }),
		execute: async (_id, params) => bridge("tabClose", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_tab_list",
		label: "List tabs",
		description:
			"List all tabs in the current window: [{id, url, title, isActive}]. Use to see " +
			"what's open and to find a tab id for browser_tab_switch.",
		parameters: Type.Object({}),
		execute: async () => bridge("tabList", {}),
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

	// ─── Skills library (bundled, read-only) ─────────────────────────────
	pi.registerTool({
		name: "browser_skill_preamble",
		label: "Read SKILL.md",
		description:
			"Read the top-level browser SKILL.md — the playbook for using these tools. " +
			"Call this once at the start of a browser-automation task to load the patterns " +
			"and footguns. Returns the markdown body as a single string.",
		parameters: Type.Object({}),
		execute: async () => bridge("skillPreamble", {}),
	});

	pi.registerTool({
		name: "browser_skill_list_interactions",
		label: "List interaction skills",
		description:
			"List the available interaction-skill files — short markdown notes on reusable " +
			"web mechanics (scrolling, dropdowns, iframes, shadow-dom, dialogs, uploads, " +
			"downloads, infinite-scroll, login-walls, captcha, network-spying, helpers, forms). " +
			"Read one with browser_skill_read_interaction when you hit that specific mechanic.",
		parameters: Type.Object({}),
		execute: async () => bridge("skillListInteractions", {}),
	});

	pi.registerTool({
		name: "browser_skill_read_interaction",
		label: "Read interaction skill",
		description:
			"Read a specific interaction-skill markdown file by name (e.g. 'iframes.md', " +
			"'dropdowns.md'). Use when you're stuck on a particular web mechanic. Returns the " +
			"file body as a single string. Throws if the name doesn't match a bundled skill.",
		parameters: Type.Object({ name: Type.String() }),
		execute: async (_id, params) => bridge("skillReadInteraction", params as Record<string, unknown>),
	});

	// ─── Domain skills (per-site playbooks, user-writable) ──────────────
	pi.registerTool({
		name: "browser_domain_skill_list",
		label: "List domain skills",
		description:
			"List the per-site notes you (the agent) have previously saved for a host. " +
			"Host should be a bare domain like 'amazon.com' (the bridge normalizes 'www.'). " +
			"browser_navigate also includes this list as `domainSkillsAvailable` in its response " +
			"when notes exist — read those files before inventing a fresh approach.",
		parameters: Type.Object({ host: Type.String() }),
		execute: async (_id, params) => bridge("domainSkillList", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_domain_skill_read",
		label: "Read domain skill",
		description:
			"Read a saved per-site note. Returns {name, host, body, bytes, updatedAt}. Throws " +
			"if not found.",
		parameters: Type.Object({ host: Type.String(), name: Type.String() }),
		execute: async (_id, params) => bridge("domainSkillRead", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_domain_skill_save",
		label: "Save domain skill",
		description:
			"Persist a per-site playbook to disk. Use when you discover a quirk specific to " +
			"this site that would help future-you (or another agent) avoid the same dead-end: " +
			"selector that survives a redesign, captcha trigger condition, hidden export URL, " +
			"non-obvious login flow. Keep entries short (<500 words), one quirk per file. " +
			"`name` must end in `.md` and use kebab-case. Overwrites by name. " +
			"Don't save anything that's discoverable from the page itself — only the lessons " +
			"that took effort to learn.",
		parameters: Type.Object({
			host: Type.String(),
			name: Type.String(),
			body: Type.String(),
		}),
		execute: async (_id, params) => bridge("domainSkillSave", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_domain_skill_search",
		label: "Search domain skills",
		description:
			"Case-insensitive substring search across every saved domain skill, across all " +
			"hosts. Use when you suspect you've handled a similar problem before but you're on " +
			"a new site (e.g. 'captcha', 'infinite scroll', 'oauth flow'). Returns up to `limit` " +
			"files with the matching line numbers + snippets and a score (more matching lines = " +
			"higher score). Read promising hits in full with browser_domain_skill_read.",
		parameters: Type.Object({
			query: Type.String(),
			limit: Type.Optional(Type.Number()),
		}),
		execute: async (_id, params) => bridge("domainSkillSearch", params as Record<string, unknown>),
	});

	pi.registerTool({
		name: "browser_domain_skill_remove",
		label: "Remove domain skill",
		description:
			"Delete a saved domain skill by host + name. Use when the note is stale (the " +
			"site changed and the playbook no longer applies) and you can't usefully refine it.",
		parameters: Type.Object({ host: Type.String(), name: Type.String() }),
		execute: async (_id, params) => bridge("domainSkillRemove", params as Record<string, unknown>),
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
