import { session, type Session } from 'electron';
import type { Settings } from '../../src/types/browser';

export interface ProxyConfig {
  mode: 'direct' | 'system' | 'fixed_servers';
  proxyRules?: string;
  proxyBypassRules?: string;
}

/** Result of an applyProxySettings* call, including the diagnostic
 *  resolution for a reference URL. `resolved` is null when the probe
 *  failed; the proxy itself was still applied. */
export interface ProxyApplyResult {
  config: ProxyConfig;
  resolved: string | null;
}

/** Reference URL used for the diagnostic `resolveProxy` probe. Picked
 *  because it's stable, neutral, and unlikely to be in anyone's
 *  proxyBypassRules (so the probe actually tests proxy resolution). */
const PROBE_URL = 'https://example.com';

/** Shared accessor for the incognito session so the `{cache: false}`
 *  option is set in exactly one place — three call sites used to
 *  duplicate it (spellcheck, proxy whenReady, proxy settings:set) and
 *  the option only ever applies on the *first* fromPartition call for
 *  a given partition name. Centralizing prevents that fragility. */
export function getIncognitoSession(): Session {
  return session.fromPartition('incognito', { cache: false });
}

/**
 * Build Electron proxy config from user settings.
 *
 * `proxyType === 'manual'` with no `proxyRules` falls back to **direct**
 * (no proxy), not system. Rationale: the user explicitly opted *away*
 * from system mode by picking Manual. Falling back to system means
 * traffic silently routes through the OS proxy the user just tried to
 * bypass — surprising and arguably unsafe (e.g., corp proxy still
 * receives requests). Direct = no proxy = the user's stated intent.
 */
export function proxyConfigFromSettings(
  settings: Pick<Settings, 'proxyType' | 'proxyRules' | 'proxyBypassRules'>
): ProxyConfig {
  if (settings.proxyType === 'direct') return { mode: 'direct' };
  if (settings.proxyType === 'manual') {
    if (!settings.proxyRules) return { mode: 'direct' };
    return {
      mode: 'fixed_servers',
      proxyRules: settings.proxyRules,
      proxyBypassRules: settings.proxyBypassRules,
    };
  }
  return { mode: 'system' };
}

/**
 * Apply proxy settings to an Electron session. Returns the applied
 * config + the diagnostic resolveProxy() result for PROBE_URL — useful
 * for confirming from logs/devtools that the new config is actually
 * taking effect.
 *
 * Throws if Electron rejects the config (malformed proxyRules,
 * unparseable host:port, etc). Callers MUST handle the rejection;
 * `void`-discarding silently breaks the proxy with no user feedback.
 */
export async function applyProxySettingsToSession(
  targetSession: Session,
  settings: Pick<Settings, 'proxyType' | 'proxyRules' | 'proxyBypassRules'>
): Promise<ProxyApplyResult> {
  const config = proxyConfigFromSettings(settings);
  await targetSession.setProxy(config);
  let resolved: string | null = null;
  try {
    resolved = await targetSession.resolveProxy(PROBE_URL);
  } catch {
    // resolveProxy failure is a diagnostic-only miss — the proxy
    // itself is already applied. Don't fail the operation.
  }
  return { config, resolved };
}

/**
 * Apply proxy settings to both regular and incognito core sessions.
 * Rejections from `setProxy` propagate so callers can surface them to
 * the user (Settings panel toast / log). Per-session results are
 * returned for diagnostics.
 */
export async function applyProxySettingsToCoreSessions(
  settings: Pick<Settings, 'proxyType' | 'proxyRules' | 'proxyBypassRules'>
): Promise<{ default: ProxyApplyResult; incognito: ProxyApplyResult }> {
  const [defaultResult, incognitoResult] = await Promise.all([
    applyProxySettingsToSession(session.defaultSession, settings),
    applyProxySettingsToSession(getIncognitoSession(), settings),
  ]);
  return { default: defaultResult, incognito: incognitoResult };
}
