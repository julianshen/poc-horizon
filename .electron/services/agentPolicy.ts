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
  // Sanitize array-shaped fields. A site that publishes
  // `requires_human: {trigger:'payment'}` (object instead of array)
  // would later crash our `.map`/`for..of` iterations. Drop malformed
  // entries silently — spec § 11 says invalid means fall back to
  // defaults, not throw.
  const sanitizeGateArray = (v: unknown): AgentHumanGate[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    return v.filter((e): e is AgentHumanGate =>
      e && typeof e === 'object' && typeof (e as AgentHumanGate).trigger === 'string'
    );
  };
  const sanitized: AgentPolicy = {
    ...(o as AgentPolicy),
    requires_human: sanitizeGateArray(o.requires_human),
    prohibited: sanitizeGateArray(o.prohibited) as AgentProhibition[] | undefined,
    objectives: Array.isArray(o.objectives)
      ? o.objectives.filter((e): e is AgentObjective => !!e && typeof e === 'object' && typeof (e as AgentObjective).id === 'string')
      : undefined,
    actions: Array.isArray(o.actions)
      ? o.actions.filter((e): e is AgentAction =>
          !!e && typeof e === 'object' &&
          typeof (e as AgentAction).name === 'string' &&
          typeof (e as AgentAction).endpoint === 'string')
      : undefined,
    consent: o.consent && typeof o.consent === 'object' && !Array.isArray(o.consent)
      ? o.consent : undefined,
  };
  return sanitized;
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

/**
 * Tools we apply heuristic-based gate matching to. Read-only tools
 * (screenshot, axtree, get_dom, evaluate-without-side-effects) get
 * skipped entirely — gating them on argument substrings produces
 * noisy false-positive prompts when the agent is just inspecting a
 * page that happens to mention "checkout" or "stripe". Spec § 4.5
 * intent is "actions that initiate payment", not "any tool whose
 * args reference payment-shaped strings".
 */
const ACTION_TOOLS = new Set<string>([
  'navigate', 'click', 'type', 'scroll',
  'submit', 'callHelper',
]);

/**
 * Map a tool call to the most-specific spec-defined human-gate trigger
 * the active policy demands, or null if none applies. Returns the
 * matching trigger so the prompt UI can surface why the gate fired.
 *
 * Triggers covered:
 *   - payment              (spec § 4.5 reserved)
 *   - auth_change          (spec § 4.5 reserved)
 *   - data_export          (spec § 4.5 reserved)
 *   - irreversible:<x>     (spec § 4.5 reserved prefix)
 *   - <vendor-custom>      (spec § 4.5 says "MUST treat as ask the user")
 */
export function humanGateForTool(
  tool: string,
  args: Record<string, unknown>,
  policy: AgentPolicy | null,
): string | null {
  if (!policy?.requires_human || policy.requires_human.length === 0) return null;
  const triggers = new Set(policy.requires_human.map((g) => g.trigger));

  // Heuristics only apply to action tools — never to pure reads.
  if (!ACTION_TOOLS.has(tool)) return null;

  const hay = JSON.stringify(args).toLowerCase();

  if (triggers.has('payment') && /\bcheckout\b|\bpayment\b|cart\/submit|pay-now|\bstripe\b|\bpaypal\b/.test(hay)) {
    return 'payment';
  }
  if (triggers.has('auth_change') && /\bpassword\b|\b2fa\b|\botp\b|account\/security|change-password/.test(hay)) {
    return 'auth_change';
  }
  if (triggers.has('data_export') && /\bexport\b|download.*data|account.*download|\bgdpr\b/.test(hay)) {
    return 'data_export';
  }
  // irreversible:<action> — any declared trigger of this shape applies
  // when the args mention a destructive verb. Conservative.
  for (const t of triggers) {
    if (t.startsWith('irreversible:') && /\bdelete\b|\bremove\b|\bdestroy\b|\bclose-account\b|\bdrop\b/.test(hay)) {
      return t;
    }
  }
  // Vendor-custom triggers (anything not reserved). Per spec § 4.5:
  // "Sites MAY define additional trigger strings; agents not recognizing
  // them MUST treat them as 'ask the user.'" Conservative interpretation:
  // any time the policy declares one of these AND the agent is about to
  // run an action tool, ask. Better a noisy prompt than a silent miss.
  for (const t of triggers) {
    if (!RESERVED_HUMAN_TRIGGERS.has(t) && !t.startsWith('irreversible:')) {
      return t;
    }
  }
  return null;
}

/**
 * Map a tool call to a spec-prohibited trigger the active policy
 * declares, or null if none applies. The current trigger→tool
 * mappings are conservative because most prohibitions need per-element
 * `data-agent-prohibited` annotations to be precise; until that lands
 * we honor the cases we *can* map cleanly and fall back to "any
 * unknown prohibition trigger applies to all action tools" — better
 * to deny noisily than silently violate a declared prohibition.
 */
export function prohibitionForTool(
  tool: string,
  policy: AgentPolicy | null,
): string | null {
  if (!policy?.prohibited || policy.prohibited.length === 0) return null;
  for (const p of policy.prohibited) {
    const t = p.trigger;
    // Known mappings.
    if (t === 'dark_pattern_acceptance' && tool === 'dismissOverlays') return t;
    // captcha_solving — we never expose a captcha-solve tool, so this
    // is unreachable by construction. Documented in captcha.md
    // interaction skill.
    if (t === 'captcha_solving') continue;
    // auth_bypass / scraping_pii — without per-element annotation we
    // can't precisely match, but we DO refuse to interact with an
    // action tool when a site declares either. Spec § 8 says agents
    // MUST honor prohibited triggers without retry; the safe default
    // is to deny rather than allow when uncertain.
    if (t === 'auth_bypass' && ACTION_TOOLS.has(tool)) return t;
    if (t === 'scraping_pii' && (tool === 'evaluate' || tool === 'getDom' || tool === 'callHelper')) return t;
    // Vendor-custom prohibited triggers. Spec § 4.6 doesn't have an
    // explicit "treat unknown as deny" — but the conformance § 8
    // language ("MUST honor prohibited triggers") strongly implies it.
    // For action tools, deny. Read tools pass through (the site can't
    // forbid us reading).
    if (!RESERVED_PROHIBITED_TRIGGERS.has(t) && ACTION_TOOLS.has(tool)) return t;
  }
  return null;
}
