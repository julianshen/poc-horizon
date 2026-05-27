// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  parseAgentPolicy,
  computeConformanceLevel,
  humanGateForTool,
  prohibitionForTool,
  isHumanGateTrigger,
} from '@electron/services/agentPolicy';

describe('parseAgentPolicy', () => {
  it('parses a minimal valid v1 policy', () => {
    const policy = parseAgentPolicy({
      version: '1.0', site: 'Example', capabilities: { read: { allowed: true } },
    });
    expect(policy?.site).toBe('Example');
  });

  it('rejects when version is missing or non-v1', () => {
    expect(parseAgentPolicy({ site: 'X', capabilities: {} })).toBeNull();
    expect(parseAgentPolicy({ version: '2.0', site: 'X', capabilities: {} })).toBeNull();
    expect(parseAgentPolicy({ version: 'abc', site: 'X', capabilities: {} })).toBeNull();
  });

  it('accepts v1.x.y patches', () => {
    expect(parseAgentPolicy({ version: '1.0', site: 'X', capabilities: {} })).not.toBeNull();
    expect(parseAgentPolicy({ version: '1.1', site: 'X', capabilities: {} })).not.toBeNull();
    expect(parseAgentPolicy({ version: '1.0.3', site: 'X', capabilities: {} })).not.toBeNull();
  });

  it('rejects when required fields are missing', () => {
    expect(parseAgentPolicy({ version: '1.0', site: '' })).toBeNull();           // empty site
    expect(parseAgentPolicy({ version: '1.0', site: 'X' })).toBeNull();          // no capabilities
    expect(parseAgentPolicy(null)).toBeNull();
    expect(parseAgentPolicy('not an object')).toBeNull();
  });
});

describe('computeConformanceLevel', () => {
  it('level 0 for null policy', () => {
    expect(computeConformanceLevel(null)).toBe(0);
  });

  it('level 1 for valid policy with just capabilities', () => {
    const p = parseAgentPolicy({ version: '1.0', site: 'X', capabilities: { read: { allowed: true } } })!;
    expect(computeConformanceLevel(p)).toBe(1);
  });

  it('level 2 when actions[] is non-empty', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: { read: { allowed: true } },
      actions: [{ name: 'search', endpoint: 'GET /q', auth: 'none' }],
    })!;
    expect(computeConformanceLevel(p)).toBe(2);
  });

  it('level 3 requires objectives + requires_human + consent', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: { read: { allowed: true } },
      actions: [{ name: 'a', endpoint: 'GET /a', auth: 'none' }],
      objectives: [{ id: 'shop' }],
      requires_human: [{ trigger: 'payment' }],
      consent: { money: 'always_human' },
    })!;
    expect(computeConformanceLevel(p)).toBe(3);
  });

  it('only L2 if L3 prerequisites are partial', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: { read: { allowed: true } },
      actions: [{ name: 'a', endpoint: 'GET /a', auth: 'none' }],
      objectives: [{ id: 'shop' }],
      // missing requires_human + consent
    })!;
    expect(computeConformanceLevel(p)).toBe(2);
  });
});

describe('humanGateForTool', () => {
  const policy = parseAgentPolicy({
    version: '1.0', site: 'X',
    capabilities: { click: { allowed: true } },
    requires_human: [{ trigger: 'payment' }, { trigger: 'auth_change' }],
  })!;

  it('returns "payment" when navigate URL looks like checkout', () => {
    expect(humanGateForTool('navigate', { url: 'https://shop.example/checkout/payment' }, policy)).toBe('payment');
  });

  it('returns "auth_change" when args mention password', () => {
    expect(humanGateForTool('type', { text: 'new-password' }, policy)).toBe('auth_change');
  });

  it('returns null when no policy is set', () => {
    expect(humanGateForTool('click', { x: 1, y: 1 }, null)).toBeNull();
  });

  it('returns null when args do not trigger any rule', () => {
    expect(humanGateForTool('click', { x: 1, y: 1 }, policy)).toBeNull();
  });

  it('does not flag triggers the policy does not declare', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      requires_human: [{ trigger: 'auth_change' }],   // no payment
    })!;
    expect(humanGateForTool('navigate', { url: 'https://shop.example/checkout' }, p)).toBeNull();
  });
});

describe('humanGateForTool — extended trigger coverage', () => {
  it('matches data_export trigger when args mention export/download', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      requires_human: [{ trigger: 'data_export' }],
    })!;
    expect(humanGateForTool('click', { x: 1, y: 1, label: 'Export my data' }, p)).toBe('data_export');
    expect(humanGateForTool('navigate', { url: 'https://x/account/download-data' }, p)).toBe('data_export');
  });

  it('matches irreversible:* triggers when args mention destructive verbs', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      requires_human: [{ trigger: 'irreversible:account_delete' }],
    })!;
    expect(humanGateForTool('click', { x: 1, y: 1, label: 'Delete account' }, p)).toBe('irreversible:account_delete');
  });

  it('falls back to vendor/custom triggers as "ask the user" per spec § 4.5', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      requires_human: [{ trigger: 'x-acme:transfer_funds' }],
    })!;
    // Any action tool with this policy active should prompt — better
    // noisy than silent.
    expect(humanGateForTool('click', {}, p)).toBe('x-acme:transfer_funds');
  });

  it('does NOT apply heuristics to read-only tools (no false-positive prompts)', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      requires_human: [{ trigger: 'payment' }],
    })!;
    // Reading the page should never trigger a payment prompt just
    // because the args JSON happens to mention checkout / stripe.
    expect(humanGateForTool('screenshot', { format: 'jpeg' }, p)).toBeNull();
    expect(humanGateForTool('axtree', {}, p)).toBeNull();
    expect(humanGateForTool('evaluate', { expression: 'document.querySelector(".stripe-logo").src' }, p)).toBeNull();
    expect(humanGateForTool('getDom', {}, p)).toBeNull();
  });
});

describe('prohibitionForTool', () => {
  it('maps dark_pattern_acceptance → dismissOverlays', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      prohibited: [{ trigger: 'dark_pattern_acceptance' }],
    })!;
    expect(prohibitionForTool('dismissOverlays', p)).toBe('dark_pattern_acceptance');
    expect(prohibitionForTool('screenshot', p)).toBeNull();
  });

  it('denies auth_bypass for any action tool', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      prohibited: [{ trigger: 'auth_bypass' }],
    })!;
    expect(prohibitionForTool('click', p)).toBe('auth_bypass');
    expect(prohibitionForTool('navigate', p)).toBe('auth_bypass');
    expect(prohibitionForTool('screenshot', p)).toBeNull();    // reads OK
  });

  it('denies scraping_pii for read-everything tools (evaluate/getDom/callHelper)', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      prohibited: [{ trigger: 'scraping_pii' }],
    })!;
    expect(prohibitionForTool('evaluate', p)).toBe('scraping_pii');
    expect(prohibitionForTool('getDom', p)).toBe('scraping_pii');
    expect(prohibitionForTool('callHelper', p)).toBe('scraping_pii');
    // Plain screenshot / axtree don't extract arbitrary data — pass.
    expect(prohibitionForTool('axtree', p)).toBeNull();
  });

  it('denies vendor-custom prohibited triggers on action tools (default-deny under uncertainty)', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      prohibited: [{ trigger: 'x-acme:no-bulk-delete' }],
    })!;
    expect(prohibitionForTool('click', p)).toBe('x-acme:no-bulk-delete');
    expect(prohibitionForTool('screenshot', p)).toBeNull();
  });

  it('returns null when no policy or no prohibitions', () => {
    expect(prohibitionForTool('click', null)).toBeNull();
    const p = parseAgentPolicy({ version: '1.0', site: 'X', capabilities: {} })!;
    expect(prohibitionForTool('click', p)).toBeNull();
  });
});

describe('parseAgentPolicy — array sanitization (defends against malformed JSON)', () => {
  it('drops requires_human when not an array', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      requires_human: { trigger: 'payment' },     // object instead of array
    });
    expect(p?.requires_human).toBeUndefined();
  });

  it('drops malformed entries from requires_human while keeping valid ones', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      requires_human: [{ trigger: 'payment' }, null, 'bad', { description: 'no trigger' }],
    });
    expect(p?.requires_human).toEqual([{ trigger: 'payment' }]);
  });

  it('drops prohibited when not an array; sanitizes valid entries', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      prohibited: 'not an array',
    });
    expect(p?.prohibited).toBeUndefined();
  });

  it('drops actions missing required fields', () => {
    const p = parseAgentPolicy({
      version: '1.0', site: 'X', capabilities: {},
      actions: [
        { name: 'good', endpoint: 'GET /x', auth: 'none' },
        { name: 'missing-endpoint' },               // no endpoint
        'completely wrong',
      ],
    });
    expect(p?.actions).toHaveLength(1);
    expect(p?.actions?.[0].name).toBe('good');
  });
});

describe('isHumanGateTrigger', () => {
  it('recognizes reserved triggers', () => {
    expect(isHumanGateTrigger('payment')).toBe(true);
    expect(isHumanGateTrigger('data_export')).toBe(true);
    expect(isHumanGateTrigger('auth_change')).toBe(true);
  });

  it('recognizes irreversible:* prefix', () => {
    expect(isHumanGateTrigger('irreversible:account_delete')).toBe(true);
    expect(isHumanGateTrigger('irreversible:foo')).toBe(true);
  });

  it('returns false for unknowns', () => {
    expect(isHumanGateTrigger('whatever')).toBe(false);
  });
});
