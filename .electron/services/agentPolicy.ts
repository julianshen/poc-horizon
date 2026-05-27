/**
 * Agent Policy v1 — types + parser + conformance level computation.
 * See docs/agent/spec/agent-policy-v1.md (the spec we're implementing).
 *
 * Kept minimal: we model only the fields we currently consume. Unknown
 * fields are ignored (forward-compat per spec § 9). x-* vendor
 * extensions are preserved on the object as-is.
 */

export type ConsentLevel = 'auto' | 'ask_once_per_session' | 'ask_each_time' | 'always_human';

export interface AgentCapability {
  allowed?: boolean;
  exclude_selectors?: string[];
  allowed_paths?: string[];
  prohibited_paths?: string[];
  allowed_selectors?: string[];
  prohibited_selectors?: string[];
  allowed_fields?: string[];
  prohibited_fields?: string[];
  allowed_forms?: string[];
  prohibited_forms?: string[];
}

export interface AgentObjective {
  id: string;
  summary?: string;
  preferred_flow?: string;
}

export interface AgentAction {
  name: string;
  endpoint: string;                     // "METHOD path"
  args_schema?: Record<string, unknown>;
  auth: 'none' | 'cookie' | 'bearer' | string;   // header:<name>
  rate_limit?: string;
  idempotent?: boolean;
}

export interface AgentHumanGate {
  trigger: string;
  description?: string;
}

export interface AgentProhibition {
  trigger: string;
  description?: string;
}

export interface AgentSafety {
  rate_limit_user_facing?: string;
  max_actions_per_session?: number;
  abort_on_unexpected_dialog?: boolean;
  abort_on_redirect_to_auth?: boolean;
}

export interface AgentAudit {
  log_actions?: boolean;
  log_url?: string;
}

export interface AgentPolicy {
  $schema?: string;
  version: string;
  site: string;
  summary?: string;
  capabilities: Record<string, AgentCapability | undefined>;
  objectives?: AgentObjective[];
  actions?: AgentAction[];
  requires_human?: AgentHumanGate[];
  prohibited?: AgentProhibition[];
  consent?: Record<string, ConsentLevel>;
  safety?: AgentSafety;
  audit?: AgentAudit;
}

/** Spec § 1 conformance levels. */
export type ConformanceLevel = 0 | 1 | 2 | 3;

export function computeConformanceLevel(policy: AgentPolicy | null): ConformanceLevel {
  if (!policy) return 0;
  // L1: valid with version/site/capabilities (we already validated by parsing)
  let level: ConformanceLevel = 1;
  // L2: actions or data-agent-action annotations (the latter we infer at runtime; here we just check `actions`)
  if (Array.isArray(policy.actions) && policy.actions.length > 0) level = 2;
  // L3: full contract — objectives + requires_human + consent all populated
  if (
    level === 2 &&
    Array.isArray(policy.objectives) && policy.objectives.length > 0 &&
    Array.isArray(policy.requires_human) && policy.requires_human.length > 0 &&
    policy.consent && Object.keys(policy.consent).length > 0
  ) {
    level = 3;
  }
  return level;
}

/**
 * Light-touch validation: confirms required fields are present and the
 * version pattern matches v1. Returns the policy on success, null on
 * shape mismatch. Per spec § 11, an invalid file means falling back to
 * defaults — we never throw.
 *
 * The spec ships a full JSON Schema; we don't validate against it
 * exhaustively here (would pull in ajv). v1 acceptance is permissive on
 * unknown fields by design.
 */
export function parseAgentPolicy(raw: unknown): AgentPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<AgentPolicy>;
  if (typeof o.version !== 'string') return null;
  if (!/^1\.[0-9]+(\.[0-9]+)?$/.test(o.version)) return null;     // v1.x only
  if (typeof o.site !== 'string' || o.site.length === 0) return null;
  if (!o.capabilities || typeof o.capabilities !== 'object') return null;
  return o as AgentPolicy;
}

/** Reserved triggers from spec § 4.6. Agents MUST recognize these. */
export const RESERVED_PROHIBITED_TRIGGERS = new Set<string>([
  'auth_bypass',
  'captcha_solving',
  'scraping_pii',
  'dark_pattern_acceptance',
]);

/** Reserved triggers from spec § 4.5. */
export const RESERVED_HUMAN_TRIGGERS = new Set<string>([
  'payment',
  'data_export',
  'auth_change',
  // irreversible:<action> — checked by prefix
]);

export function isHumanGateTrigger(trigger: string): boolean {
  return RESERVED_HUMAN_TRIGGERS.has(trigger) || trigger.startsWith('irreversible:');
}

/** Map a tool call to the most-specific spec-defined human-gate trigger
 *  the active policy demands, or null if none applies. */
export function humanGateForTool(
  tool: string,
  args: Record<string, unknown>,
  policy: AgentPolicy | null,
): string | null {
  if (!policy?.requires_human) return null;
  const triggers = new Set(policy.requires_human.map((g) => g.trigger));
  // Conservative mapping — when the tool touches a payment-shaped URL
  // or selector, flag it. Most of this matching belongs in per-element
  // data-agent-* once that's implemented; until then we map by tool +
  // hint.
  if (triggers.has('payment')) {
    const hay = JSON.stringify(args).toLowerCase();
    if (/checkout|payment|cart\/submit|pay-now|stripe/.test(hay)) return 'payment';
  }
  if (triggers.has('auth_change')) {
    const hay = JSON.stringify(args).toLowerCase();
    if (/password|2fa|otp|account\/security/.test(hay)) return 'auth_change';
  }
  return null;
}
