import { session, type Session } from 'electron';
import type { Settings } from '../../src/types/browser';

export interface ProxyConfig {
  mode: 'direct' | 'system' | 'fixed_servers';
  proxyRules?: string;
  proxyBypassRules?: string;
}

/**
 * Result of an applyProxySettings* call.
 * @property config       The Electron proxy config that was applied.
 * @property resolved     Output of `session.resolveProxy(PROBE_URL)` —
 *                        e.g. `"DIRECT"` or `"PROXY 127.0.0.1:8080"`.
 *                        `null` when the probe itself failed (see
 *                        `resolveError` for the cause); the proxy
 *                        config was still applied in that case.
 * @property resolveError The diagnostic-probe error message, if any.
 *                        Surfaces failures instead of dropping them
 *                        silently.
 */
export interface ProxyApplyResult {
  config: ProxyConfig;
  resolved: string | null;
  resolveError?: string;
}

/** Reference URL used for the diagnostic `resolveProxy` probe. Picked
 *  because it's stable, neutral, and unlikely to be in anyone's
 *  proxyBypassRules (so the probe actually tests proxy resolution). */
const PROBE_URL = 'https://example.com';

/**
 * Shared accessor for the incognito Electron session.
 *
 * Centralizes `session.fromPartition('incognito', { cache: false })`
 * so the `{ cache: false }` option is set in exactly one place.
 * Three call sites used to duplicate it (spellcheck, agent-id header,
 * proxy apply) — and `fromPartition`'s option only ever takes effect
 * on the **first** call per partition name. Centralizing prevents the
 * future-refactor footgun where dropping the option from one caller
 * silently changes cache behavior based on import order.
 *
 * @returns The cached `Session` instance for the `incognito` partition.
 */
export function getIncognitoSession(): Session {
  return session.fromPartition('incognito', { cache: false });
}

/**
 * Build an Electron proxy config from user settings.
 *
 * `proxyType === 'manual'` with no `proxyRules` falls back to
 * **direct** (no proxy), not system. The user explicitly opted *away*
 * from system mode by picking Manual; falling back to system would
 * silently route through the OS proxy the user just tried to bypass
 * (a real risk on corporate machines). Direct = no proxy = the user's
 * stated intent.
 *
 * @param settings  Subset of {@link Settings} containing `proxyType`,
 *                  `proxyRules`, and `proxyBypassRules`.
 *                    - `proxyType`: `'system'` | `'direct'` | `'manual'`.
 *                    - `proxyRules`: Electron rules string (e.g.
 *                       `"http=127.0.0.1:8080"`). Required for manual.
 *                    - `proxyBypassRules`: optional bypass list.
 * @returns A {@link ProxyConfig} suitable for `session.setProxy`.
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
 * Apply proxy settings to an Electron session.
 *
 * `setProxy` rejection is propagated — callers MUST handle it
 * (`void`-discarding silently breaks the proxy with no user feedback).
 *
 * The `resolveProxy(PROBE_URL)` diagnostic is best-effort: if it
 * throws, the proxy itself is still applied and the failure is
 * surfaced through `ProxyApplyResult.resolveError` (plus logged via
 * `console.warn`) so troubleshooting remains possible.
 *
 * @param targetSession  The Electron `Session` to configure.
 * @param settings       Subset of {@link Settings} (see
 *                       {@link proxyConfigFromSettings}).
 * @returns A {@link ProxyApplyResult} with the applied config and the
 *          diagnostic resolution string (or error).
 * @throws If `session.setProxy` rejects (malformed proxyRules,
 *         unparseable host:port, etc).
 */
export async function applyProxySettingsToSession(
  targetSession: Session,
  settings: Pick<Settings, 'proxyType' | 'proxyRules' | 'proxyBypassRules'>
): Promise<ProxyApplyResult> {
  const config = proxyConfigFromSettings(settings);
  await targetSession.setProxy(config);
  let resolved: string | null = null;
  let resolveError: string | undefined;
  try {
    resolved = await targetSession.resolveProxy(PROBE_URL);
  } catch (err) {
    resolveError = (err as Error).message ?? String(err);
    // Diagnostic-only — proxy is already applied. Surface the failure
    // so callers / log readers can see it instead of silently dropping.
    console.warn(`[proxy] resolveProxy(${PROBE_URL}) failed: ${resolveError}`);
  }
  return resolveError !== undefined
    ? { config, resolved, resolveError }
    : { config, resolved };
}

/**
 * Apply proxy settings to both regular and incognito core sessions.
 *
 * Errors from `setProxy` (on either session) propagate via Promise
 * rejection — callers should attach a `.catch()` to surface failure
 * to the user (Settings panel toast, log, etc).
 *
 * Per-session results are returned so callers can correlate the
 * diagnostic probe output across sessions.
 *
 * @param settings  Subset of {@link Settings} (see
 *                  {@link proxyConfigFromSettings}).
 * @returns An object with the {@link ProxyApplyResult} for the default
 *          and incognito sessions.
 * @throws If either session's `setProxy` rejects.
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
