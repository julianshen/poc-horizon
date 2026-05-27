import { describe, it, expect, vi } from 'vitest';
const defaultSetProxy = vi.fn().mockResolvedValue(undefined);
const defaultResolveProxy = vi.fn().mockResolvedValue('DIRECT');
const incognitoSetProxy = vi.fn().mockResolvedValue(undefined);
const incognitoResolveProxy = vi.fn().mockResolvedValue('DIRECT');
const fromPartition = vi.fn().mockReturnValue({
  setProxy: incognitoSetProxy,
  resolveProxy: incognitoResolveProxy,
});

vi.mock('electron', () => ({
  session: {
    defaultSession: { setProxy: defaultSetProxy, resolveProxy: defaultResolveProxy },
    fromPartition,
  },
}));

import {
  applyProxySettingsToCoreSessions,
  applyProxySettingsToSession,
  getIncognitoSession,
  proxyConfigFromSettings,
} from '../../.electron/services/proxy';

describe('proxyConfigFromSettings', () => {
  it('maps system proxy type to system mode', () => {
    expect(proxyConfigFromSettings({ proxyType: 'system', proxyRules: undefined, proxyBypassRules: undefined }))
      .toEqual({ mode: 'system' });
  });

  it('maps direct proxy type to direct mode', () => {
    expect(proxyConfigFromSettings({ proxyType: 'direct', proxyRules: undefined, proxyBypassRules: undefined }))
      .toEqual({ mode: 'direct' });
  });

  it('maps manual proxy type with rules to fixed_servers mode', () => {
    expect(proxyConfigFromSettings({
      proxyType: 'manual',
      proxyRules: 'http=127.0.0.1:8080',
      proxyBypassRules: '<local>',
    })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http=127.0.0.1:8080',
      proxyBypassRules: '<local>',
    });
  });

  it('falls back to DIRECT (not system) when manual has no proxy rules — preserves user intent to opt out of system proxy', () => {
    expect(proxyConfigFromSettings({ proxyType: 'manual', proxyRules: undefined, proxyBypassRules: undefined }))
      .toEqual({ mode: 'direct' });
    expect(proxyConfigFromSettings({ proxyType: 'manual', proxyRules: '', proxyBypassRules: undefined }))
      .toEqual({ mode: 'direct' });
  });
});

describe('applyProxySettingsToSession', () => {
  it('applies the computed config + returns the resolveProxy diagnostic', async () => {
    const setProxy = vi.fn().mockResolvedValue(undefined);
    const resolveProxy = vi.fn().mockResolvedValue('PROXY 127.0.0.1:8080');
    const fakeSession = { setProxy, resolveProxy } as never;
    const r = await applyProxySettingsToSession(fakeSession, {
      proxyType: 'manual', proxyRules: 'http=127.0.0.1:8080', proxyBypassRules: undefined,
    });
    expect(setProxy).toHaveBeenCalledWith({
      mode: 'fixed_servers', proxyRules: 'http=127.0.0.1:8080', proxyBypassRules: undefined,
    });
    expect(r.config.mode).toBe('fixed_servers');
    expect(r.resolved).toBe('PROXY 127.0.0.1:8080');
  });

  it('propagates setProxy rejections (caller is responsible for handling)', async () => {
    const setProxy = vi.fn().mockRejectedValue(new Error('bad config'));
    const resolveProxy = vi.fn();
    await expect(applyProxySettingsToSession({ setProxy, resolveProxy } as never, {
      proxyType: 'direct', proxyRules: undefined, proxyBypassRules: undefined,
    })).rejects.toThrow('bad config');
    expect(resolveProxy).not.toHaveBeenCalled();
  });

  it('returns resolved:null when resolveProxy fails (proxy still applied)', async () => {
    const setProxy = vi.fn().mockResolvedValue(undefined);
    const resolveProxy = vi.fn().mockRejectedValue(new Error('probe failed'));
    const r = await applyProxySettingsToSession({ setProxy, resolveProxy } as never, {
      proxyType: 'direct', proxyRules: undefined, proxyBypassRules: undefined,
    });
    expect(setProxy).toHaveBeenCalled();
    expect(r.resolved).toBeNull();
  });
});

describe('applyProxySettingsToCoreSessions', () => {
  it('updates both default and incognito sessions and returns per-session diagnostics', async () => {
    defaultSetProxy.mockClear(); incognitoSetProxy.mockClear();
    defaultResolveProxy.mockResolvedValueOnce('PROXY 127.0.0.1:8080');
    incognitoResolveProxy.mockResolvedValueOnce('PROXY 127.0.0.1:8080');

    const result = await applyProxySettingsToCoreSessions({
      proxyType: 'manual', proxyRules: 'http=127.0.0.1:8080', proxyBypassRules: '<local>',
    });

    const expected = { mode: 'fixed_servers', proxyRules: 'http=127.0.0.1:8080', proxyBypassRules: '<local>' };
    expect(defaultSetProxy).toHaveBeenCalledWith(expected);
    expect(incognitoSetProxy).toHaveBeenCalledWith(expected);
    expect(result.default.resolved).toBe('PROXY 127.0.0.1:8080');
    expect(result.incognito.resolved).toBe('PROXY 127.0.0.1:8080');
  });

  it('propagates a setProxy rejection from either session', async () => {
    defaultSetProxy.mockClear(); incognitoSetProxy.mockClear();
    defaultSetProxy.mockRejectedValueOnce(new Error('default-bad'));
    await expect(applyProxySettingsToCoreSessions({
      proxyType: 'direct', proxyRules: undefined, proxyBypassRules: undefined,
    })).rejects.toThrow('default-bad');
  });
});

describe('getIncognitoSession', () => {
  it('uses fromPartition("incognito", {cache:false}) — centralized so callers stop duplicating the option set', () => {
    fromPartition.mockClear();
    getIncognitoSession();
    expect(fromPartition).toHaveBeenCalledWith('incognito', { cache: false });
  });
});
