import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  chmodSync,
} from "fs";
import path from "path";
import {
  buildPiSettings,
  buildPiAuth,
  buildProviderOverrideExtension,
  PROVIDER_OVERRIDE_FILE,
  MANAGED_SETTINGS_KEYS,
  type AiProviderConfig,
} from "./piConfig";

/**
 * Read a JSON object file. Returns `{}` only when the file is absent
 * (ENOENT); any other error (malformed JSON, permission denied) is
 * rethrown rather than swallowed, so we never overwrite recoverable
 * Pi-managed state with an empty object.
 */
function readJsonObject(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError(`${file} must contain a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

/** Write a 0600 file, enforcing the mode even when overwriting (the
 *  `writeFileSync` `mode` option only applies on creation). */
function writeSecret(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/**
 * Sidecar (no secrets — provider ids only) recording which auth.json
 * `api_key` entries Horizon wrote, so a cleared key only ever removes
 * Horizon's own entry and never a Pi-created/`/login` credential.
 */
const MANAGED_AUTH_FILE = ".horizon-managed-auth.json";

function readManagedProviders(file: string): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : [],
    );
  } catch {
    // Best-effort bookkeeping: a missing or unreadable marker degrades
    // safely to "Horizon manages nothing" — we never delete an entry we
    // cannot prove we wrote — so swallowing here can't strand a secret.
    return new Set();
  }
}

function writeManagedProviders(file: string, providers: Set<string>): void {
  if (providers.size > 0) {
    writeFileSync(file, JSON.stringify([...providers], null, 2), {
      mode: 0o600,
    });
  } else if (existsSync(file)) {
    rmSync(file);
  }
}

/**
 * Materialize Pi's config files into `agentDir` (the directory Horizon
 * passes to the Pi subprocess via PI_CODING_AGENT_DIR), reconciling only
 * the Horizon-managed pieces so unrelated Pi/user state survives:
 *
 *  - settings.json: rewrite scalar managed keys (defaultProvider/Model),
 *    drop them when cleared, and merge the generated base-URL override
 *    into `extensions` without disturbing other extensions.
 *  - auth.json: merge the current provider's API key in (0600), or remove
 *    only that provider's entry when the key is cleared — preserving other
 *    providers' credentials and OAuth/login tokens.
 *  - the provider-override extension file: written or pruned to match.
 *
 * I/O wrapper around the pure builders in piConfig.ts.
 */
export function writePiConfig(agentDir: string, cfg: AiProviderConfig): void {
  mkdirSync(agentDir, { recursive: true });

  // Provider base-URL override extension (created or pruned).
  const overridePath = path.join(agentDir, PROVIDER_OVERRIDE_FILE);
  const overrideSrc = buildProviderOverrideExtension(cfg);
  if (overrideSrc) {
    writeFileSync(overridePath, overrideSrc, "utf-8");
  } else if (existsSync(overridePath)) {
    // Let removal failures surface — a lingering override would silently
    // keep pointing Pi at a stale endpoint.
    rmSync(overridePath);
  }

  // settings.json — drop managed scalar keys, then reconcile extensions so
  // non-Horizon entries survive while the generated override is toggled.
  const settingsPath = path.join(agentDir, "settings.json");
  const existing = readJsonObject(settingsPath);
  for (const k of MANAGED_SETTINGS_KEYS) delete existing[k];
  const otherExtensions = Array.isArray(existing.extensions)
    ? (existing.extensions as unknown[]).filter(
        (v): v is string =>
          typeof v === "string" && path.basename(v) !== PROVIDER_OVERRIDE_FILE,
      )
    : [];
  const nextExtensions = overrideSrc
    ? [...otherExtensions, overridePath]
    : otherExtensions;
  delete existing.extensions;
  const merged: Record<string, unknown> = {
    ...existing,
    ...buildPiSettings(cfg),
  };
  if (nextExtensions.length > 0) merged.extensions = nextExtensions;
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2), "utf-8");

  // auth.json — merge in / remove only the entry Horizon itself wrote.
  // Ownership is tracked in a sidecar (provider ids only, no secrets); the
  // `api_key` shape is NOT unique to Horizon, so a Pi-created/login api_key
  // for the same provider must never be deleted when the Horizon field is
  // blank. Other providers' entries (and OAuth tokens) are always preserved.
  const authPath = path.join(agentDir, "auth.json");
  const managedPath = path.join(agentDir, MANAGED_AUTH_FILE);
  const managed = readManagedProviders(managedPath);
  const existingAuth = readJsonObject(authPath);
  const auth = buildPiAuth(cfg);
  if (auth) {
    writeSecret(authPath, { ...existingAuth, ...auth });
    managed.add(cfg.provider);
  } else if (cfg.provider && managed.has(cfg.provider)) {
    const entry = existingAuth[cfg.provider] as { type?: string } | undefined;
    // Only a Horizon-written api_key entry is removed; if Pi has since
    // replaced it (e.g. an OAuth login under the same provider), leave it.
    if (entry?.type === "api_key") {
      delete existingAuth[cfg.provider];
      if (Object.keys(existingAuth).length > 0) {
        writeSecret(authPath, existingAuth);
      } else if (existsSync(authPath)) {
        // Surface failures: a swallowed error here would leave the cleared
        // secret on disk to be reused on the next spawn.
        rmSync(authPath);
      }
    }
    managed.delete(cfg.provider);
  }
  writeManagedProviders(managedPath, managed);
}
