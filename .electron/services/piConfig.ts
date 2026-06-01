/**
 * Pure builders for Pi's on-disk configuration (settings.json, auth.json,
 * and an optional provider-override extension). Kept side-effect free so
 * they can be unit-tested without touching the filesystem; PiConfigWriter
 * does the actual I/O.
 *
 * Pi resolves its config from the directory named by the
 * `PI_CODING_AGENT_DIR` env var (see config.ts → getAgentDir). Horizon
 * points that at an app-local folder and materializes these files from the
 * user's per-provider Settings so that **every** configured provider
 * co-exists: Pi only surfaces a provider in `/model` / `get_available_models`
 * / `cycle_model` when its auth is present, so all keys are written and the
 * active provider is just the default the session opens on.
 *
 * Provider ids double as auth.json keys for the built-in API-key providers
 * (anthropic, openai, google, …), matching Pi's `providers.md`.
 */

export interface PiProvidersConfig {
  /** The provider the session opens on (Pi's `defaultProvider`). */
  activeProvider: string;
  /** API key per provider id. Empty/absent → that provider isn't authed. */
  apiKeys: Record<string, string>;
  /** Default model id per provider; empty → Pi's provider default. */
  models: Record<string, string>;
  /** Custom endpoint per provider (proxy / gateway / self-host). */
  baseUrls: Record<string, string>;
}

/** Filename of the generated provider-override extension, when used. */
export const PROVIDER_OVERRIDE_FILE = "horizon-provider-override.mjs";

/**
 * settings.json keys Horizon fully owns and rewrites on every spawn.
 * Deleted before the read-merge so clearing a field in the UI removes the
 * stale value (buildPiSettings omits unset keys rather than nulling them).
 * `extensions` is NOT here — it's a shared array where only the generated
 * override entry is Horizon-managed, so the writer reconciles it in place.
 */
export const MANAGED_SETTINGS_KEYS = [
  "defaultProvider",
  "defaultModel",
  "enabledModels",
] as const;

/** Providers with a non-empty API key — the ones Pi can actually use. */
function authedProviders(cfg: PiProvidersConfig): string[] {
  return Object.keys(cfg.apiKeys).filter((p) => cfg.apiKeys[p]);
}

/**
 * Build the settings.json subset Horizon manages: the active provider's
 * default + model, and the Ctrl+P / `cycle_model` rotation (`enabledModels`)
 * built from every authed provider that has an explicit model id. Unset
 * fields are omitted so the writer can drop stale values.
 *
 * @param cfg - The user's per-provider configuration.
 * @param authed - Every provider Pi can authenticate: Horizon's own keys
 *   plus any preserved `auth.json` entry (`/login`, OAuth, …). The default
 *   and the cycle are gated on this so the session opens on a usable
 *   provider — including ones authed outside Horizon — and never on an
 *   unauthenticated one.
 * @returns A partial settings.json object with only the keys that are set.
 */
export function buildPiSettings(
  cfg: PiProvidersConfig,
  authed: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ordered = [...authed].sort();
  // Pi opens on `defaultProvider`, so only point it at a provider that has
  // auth — otherwise the first turn is a guaranteed auth failure. Prefer the
  // user's active selection when it's authed, else fall back to an authed
  // provider (one with a model, if any).
  const defaultProvider =
    cfg.activeProvider && authed.has(cfg.activeProvider)
      ? cfg.activeProvider
      : (ordered.find((p) => cfg.models[p]) ?? ordered[0] ?? "");
  if (defaultProvider) {
    out.defaultProvider = defaultProvider;
    if (cfg.models[defaultProvider]) {
      out.defaultModel = cfg.models[defaultProvider];
    }
  }
  // Cycle over the explicit models of authed providers (a model needs both
  // a usable provider and a known id). De-duplicated; ordered by provider id
  // for a stable rotation.
  const enabled = [
    ...new Set(
      ordered.map((p) => cfg.models[p]).filter((m): m is string => Boolean(m)),
    ),
  ];
  if (enabled.length > 0) out.enabledModels = enabled;
  return out;
}

/**
 * Build auth.json entries for **all** authed providers so they co-exist.
 *
 * @param cfg - The user's per-provider configuration.
 * @returns A `{ [provider]: { type, key } }` map (possibly empty). The
 *   writer merges these in and prunes the Horizon-owned entries that are
 *   no longer present, leaving OAuth/login tokens and other entries intact.
 */
export function buildPiAuth(
  cfg: PiProvidersConfig,
): Record<string, { type: "api_key"; key: string }> {
  const out: Record<string, { type: "api_key"; key: string }> = {};
  for (const p of authedProviders(cfg)) {
    out[p] = { type: "api_key", key: cfg.apiKeys[p] };
  }
  return out;
}

/**
 * Build a Pi extension that overrides the base URL of every provider that
 * has one. Pi exposes endpoint overrides only via `pi.registerProvider()`
 * (see custom-provider.md), not via settings.json. Plain JS (no type
 * imports) so Pi's jiti loader needs nothing resolved at runtime.
 *
 * @param cfg - The user's per-provider configuration.
 * @returns The extension source, or null when no base URL is configured.
 */
export function buildProviderOverrideExtension(
  cfg: PiProvidersConfig,
): string | null {
  const overrides = Object.keys(cfg.baseUrls)
    .filter((p) => cfg.baseUrls[p])
    .map(
      (p) =>
        `  pi.registerProvider(${JSON.stringify(p)}, { baseUrl: ${JSON.stringify(
          cfg.baseUrls[p],
        )} });`,
    );
  if (overrides.length === 0) return null;
  return `// Generated by Horizon — do not edit. Overrides provider base URLs.
export default function (pi) {
${overrides.join("\n")}
}
`;
}
