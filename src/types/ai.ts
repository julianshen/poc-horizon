/**
 * Streaming events emitted from the agent (PiSession) to the renderer.
 *
 * Mirrors the shape of Anthropic / OpenAI tool-use streams so the AI
 * panel can render a tool-call trace + final response without caring
 * which backend produced the stream. Discriminated union — switch on
 * `type` to render each variant.
 */
export type AgentEvent =
  | { type: "text_delta"; text: string } // partial natural-language output
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "tool_result"; id: string; output: unknown; isError?: boolean }
  | {
      type: "turn_end";
      reason: "stop" | "tool_use" | "max_iterations" | "cancelled";
    }
  | { type: "error"; message: string };

/**
 * Tool definitions exposed to the agent. The keys match the high-level
 * BrowserHarness primitives — the agent calls them by name and Pi
 * (or any other tool-use LLM) routes the call to BrowserHarness.
 */
export const AGENT_TOOLS = [
  "navigate",
  "click",
  "type",
  "scroll",
  "screenshot",
  "evaluate",
  "getDom",
  "getUrl",
  "getTitle",
] as const;

export type AgentToolName = (typeof AGENT_TOOLS)[number];
