// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  parseAgentPolicy,
  computeConformanceLevel,
  humanGateForTool,
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
