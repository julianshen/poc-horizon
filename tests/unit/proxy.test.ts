import { describe, it, expect, vi } from 'vitest';
import { applyProxySettingsToSession, proxyConfigFromSettings } from '../../.electron/services/proxy';

describe('proxyConfigFromSettings', () => {
  it('maps system proxy type to system mode', () => {
    expect(proxyConfigFromSettings({ proxyType: 'system', proxyRules: undefined })).toEqual({ mode: 'system' });
  });

  it('maps direct proxy type to direct mode', () => {
    expect(proxyConfigFromSettings({ proxyType: 'direct', proxyRules: undefined })).toEqual({ mode: 'direct' });
  });

  it('maps manual proxy type with rules to fixed_servers mode', () => {
    expect(proxyConfigFromSettings({ proxyType: 'manual', proxyRules: 'http=127.0.0.1:8080' })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http=127.0.0.1:8080',
    });
  });

  it('falls back to system mode when manual has no proxy rules', () => {
    expect(proxyConfigFromSettings({ proxyType: 'manual', proxyRules: undefined })).toEqual({ mode: 'system' });
  });
});

describe('applyProxySettingsToSession', () => {
  it('applies computed proxy config via session.setProxy', async () => {
    const setProxy = vi.fn().mockResolvedValue(undefined);
    const fakeSession = { setProxy } as never;

    const config = await applyProxySettingsToSession(fakeSession, { proxyType: 'direct', proxyRules: undefined });

    expect(setProxy).toHaveBeenCalledWith({ mode: 'direct' });
    expect(config).toEqual({ mode: 'direct' });
  });
});
