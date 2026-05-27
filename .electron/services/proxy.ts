import type { Session } from 'electron';
import type { Settings } from '../../src/types/browser';

export interface ProxyConfig {
  mode: 'direct' | 'system' | 'fixed_servers';
  proxyRules?: string;
  proxyBypassRules?: string;
}

/**
 * Build Electron proxy config from user settings.
 */
export function proxyConfigFromSettings(settings: Pick<Settings, 'proxyType' | 'proxyRules'>): ProxyConfig {
  if (settings.proxyType === 'direct') return { mode: 'direct' };
  if (settings.proxyType === 'manual') {
    if (!settings.proxyRules) return { mode: 'system' };
    return {
      mode: 'fixed_servers',
      proxyRules: settings.proxyRules,
    };
  }
  return { mode: 'system' };
}

/**
 * Apply proxy settings to an Electron session.
 */
export async function applyProxySettingsToSession(
  targetSession: Session,
  settings: Pick<Settings, 'proxyType' | 'proxyRules'>
): Promise<ProxyConfig> {
  const config = proxyConfigFromSettings(settings);
  await targetSession.setProxy(config);
  return config;
}
