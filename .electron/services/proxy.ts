import { session, type Session } from 'electron';
import type { Settings } from '../../src/types/browser';

export interface ProxyConfig {
  mode: 'direct' | 'system' | 'fixed_servers';
  proxyRules?: string;
  proxyBypassRules?: string;
}

/**
 * Build Electron proxy config from user settings.
 */
export function proxyConfigFromSettings(
  settings: Pick<Settings, 'proxyType' | 'proxyRules' | 'proxyBypassRules'>
): ProxyConfig {
  if (settings.proxyType === 'direct') return { mode: 'direct' };
  if (settings.proxyType === 'manual') {
    if (!settings.proxyRules) return { mode: 'system' };
    return {
      mode: 'fixed_servers',
      proxyRules: settings.proxyRules,
      proxyBypassRules: settings.proxyBypassRules,
    };
  }
  return { mode: 'system' };
}

/**
 * Apply proxy settings to an Electron session.
 */
export async function applyProxySettingsToSession(
  targetSession: Session,
  settings: Pick<Settings, 'proxyType' | 'proxyRules' | 'proxyBypassRules'>
): Promise<ProxyConfig> {
  const config = proxyConfigFromSettings(settings);
  await targetSession.setProxy(config);
  return config;
}

/**
 * Apply proxy settings to both regular and incognito core sessions.
 */
export async function applyProxySettingsToCoreSessions(
  settings: Pick<Settings, 'proxyType' | 'proxyRules' | 'proxyBypassRules'>
): Promise<void> {
  await Promise.all([
    applyProxySettingsToSession(session.defaultSession, settings),
    applyProxySettingsToSession(session.fromPartition('incognito', { cache: false }), settings),
  ]);
}
