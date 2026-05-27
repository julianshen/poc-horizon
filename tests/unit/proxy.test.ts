import { describe, it, expect, vi } from 'vitest';
const defaultSetProxy = vi.fn().mockResolvedValue(undefined);
const incognitoSetProxy = vi.fn().mockResolvedValue(undefined);

vi.mock('electron', () => ({
  session: {
    defaultSession: { setProxy: defaultSetProxy },
    fromPartition: vi.fn().mockReturnValue({ setProxy: incognitoSetProxy }),
  },
}));

import {
  applyProxySettingsToCoreSessions,
  applyProxySettingsToSession,
  proxyConfigFromSettings,
} from '../../.electron/services/proxy';

describe('proxyConfigFromSettings', () => {
  it('maps system proxy type to system mode', () => {
    expect(proxyConfigFromSettings({ proxyType: 'system', proxyRules: undefined, proxyBypassRules: undefined })).toEqual({ mode: 'system' });
  });

  it('maps direct proxy type to direct mode', () => {
    expect(proxyConfigFromSettings({ proxyType: 'direct', proxyRules: undefined, proxyBypassRules: undefined })).toEqual({ mode: 'direct' });
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

  it('falls back to system mode when manual has no proxy rules', () => {
    expect(proxyConfigFromSettings({ proxyType: 'manual', proxyRules: undefined, proxyBypassRules: undefined })).toEqual({ mode: 'system' });
  });
});

describe('applyProxySettingsToSession', () => {
  it('applies computed proxy config via session.setProxy', async () => {
    const setProxy = vi.fn().mockResolvedValue(undefined);
    const fakeSession = { setProxy } as never;

    const config = await applyProxySettingsToSession(fakeSession, {
      proxyType: 'direct',
      proxyRules: undefined,
      proxyBypassRules: undefined,
    });

    expect(setProxy).toHaveBeenCalledWith({ mode: 'direct' });
    expect(config).toEqual({ mode: 'direct' });
  });
});

describe('applyProxySettingsToCoreSessions', () => {
  it('updates both default and incognito sessions', async () => {
    defaultSetProxy.mockClear();
    incognitoSetProxy.mockClear();

    await applyProxySettingsToCoreSessions({
      proxyType: 'manual',
      proxyRules: 'http=127.0.0.1:8080',
      proxyBypassRules: '<local>',
    });

    expect(defaultSetProxy).toHaveBeenCalledWith({
      mode: 'fixed_servers',
      proxyRules: 'http=127.0.0.1:8080',
      proxyBypassRules: '<local>',
    });
    expect(incognitoSetProxy).toHaveBeenCalledWith({
      mode: 'fixed_servers',
      proxyRules: 'http=127.0.0.1:8080',
      proxyBypassRules: '<local>',
    });
  });
});
