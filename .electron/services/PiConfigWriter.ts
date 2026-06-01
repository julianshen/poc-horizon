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
    return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
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
    try {
      rmSync(overridePath);
    } catch {
      /* best-effort cleanup */
    }
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

  // auth.json — merge in / remove only the managed provider's entry so a
  // cleared key never leaves a stale secret, and other providers' creds
  // (and OAuth/login tokens) are preserved.
  const authPath = path.join(agentDir, "auth.json");
  const existingAuth = readJsonObject(authPath);
  const auth = buildPiAuth(cfg);
  if (auth) {
    writeSecret(authPath, { ...existingAuth, ...auth });
  } else if (cfg.provider && existingAuth[cfg.provider] !== undefined) {
    delete existingAuth[cfg.provider];
    if (Object.keys(existingAuth).length > 0) {
      writeSecret(authPath, existingAuth);
    } else if (existsSync(authPath)) {
      try {
        rmSync(authPath);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}
