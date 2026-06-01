import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  chmodSync,
} from "fs";
import { createHash } from "crypto";
import path from "path";
import {
  buildPiSettings,
  buildPiAuth,
  buildProviderOverrideExtension,
  PROVIDER_OVERRIDE_FILE,
  MANAGED_SETTINGS_KEYS,
  type PiProvidersConfig,
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
 * Sidecar mapping each provider Horizon wrote an `api_key` for to a SHA-256
 * of that key (not the key itself). Lets the writer prune only an entry it
 * still owns *by value* — if Pi/`/login` or the user later replaced the
 * provider's credential with a different one, the hash won't match and it's
 * left intact. A non-reversible digest of a high-entropy secret is safe to
 * store; the file is 0600 regardless.
 */
const MANAGED_AUTH_FILE = ".horizon-managed-auth.json";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function readManagedProviders(file: string): Record<string, string> {
  // Reuse readJsonObject's contract: {} only on ENOENT; a malformed or
  // unreadable sidecar surfaces (aborts the write) rather than silently
  // degrading to "nothing managed", which would strand a cleared secret.
  const out: Record<string, string> = {};
  for (const [provider, hash] of Object.entries(readJsonObject(file))) {
    if (typeof hash === "string") out[provider] = hash;
  }
  return out;
}

function writeManagedProviders(
  file: string,
  managed: Record<string, string>,
): void {
  if (Object.keys(managed).length > 0) {
    writeFileSync(file, JSON.stringify(managed, null, 2), { mode: 0o600 });
  } else if (existsSync(file)) {
    rmSync(file);
  }
}

/**
 * Write or prune the generated base-URL override extension. Returns its path
 * and source so settings reconciliation can register/deregister it.
 */
function reconcileOverrideExtension(
  agentDir: string,
  cfg: PiProvidersConfig,
): { overridePath: string; overrideSrc: string | null } {
  const overridePath = path.join(agentDir, PROVIDER_OVERRIDE_FILE);
  const overrideSrc = buildProviderOverrideExtension(cfg);
  if (overrideSrc) {
    writeFileSync(overridePath, overrideSrc, "utf-8");
  } else if (existsSync(overridePath)) {
    // Let removal failures surface — a lingering override would silently
    // keep pointing Pi at a stale endpoint.
    rmSync(overridePath);
  }
  return { overridePath, overrideSrc };
}

/**
 * Rewrite Horizon's managed settings.json keys (defaultProvider/Model,
 * enabledModels) and reconcile the generated override into `extensions`,
 * leaving unrelated keys and non-Horizon extensions untouched.
 */
function reconcileSettings(
  agentDir: string,
  cfg: PiProvidersConfig,
  overridePath: string,
  overrideSrc: string | null,
): void {
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
  const settings: Record<string, unknown> = {
    ...existing,
    ...buildPiSettings(cfg),
  };
  if (nextExtensions.length > 0) settings.extensions = nextExtensions;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

/**
 * Write an api_key for every configured provider so they co-exist (Pi gates
 * model availability on auth), and prune only the exact entries Horizon
 * previously wrote — tracked by key hash in a secrets-free sidecar. Pi
 * `/login` credentials, OAuth tokens, and replaced keys are preserved.
 */
function reconcileAuth(agentDir: string, cfg: PiProvidersConfig): void {
  const authPath = path.join(agentDir, "auth.json");
  const managedPath = path.join(agentDir, MANAGED_AUTH_FILE);
  const previouslyManaged = readManagedProviders(managedPath);
  const authObj = readJsonObject(authPath);
  const desired = buildPiAuth(cfg);
  const nextManaged: Record<string, string> = {};
  for (const [provider, entry] of Object.entries(desired)) {
    authObj[provider] = entry;
    nextManaged[provider] = hashKey(entry.key);
  }
  for (const [provider, hash] of Object.entries(previouslyManaged)) {
    if (desired[provider]) continue;
    const entry = authObj[provider] as
      | { type?: string; key?: string }
      | undefined;
    if (
      entry?.type === "api_key" &&
      typeof entry.key === "string" &&
      hashKey(entry.key) === hash
    ) {
      delete authObj[provider];
    }
  }
  if (Object.keys(authObj).length > 0) {
    writeSecret(authPath, authObj);
  } else if (existsSync(authPath)) {
    // Surface failures: a swallowed error would leave a cleared secret on
    // disk to be reused on the next spawn.
    rmSync(authPath);
  }
  writeManagedProviders(managedPath, nextManaged);
}

/**
 * Materialize Pi's config files into `agentDir` (the directory Horizon
 * passes to the Pi subprocess via PI_CODING_AGENT_DIR), reconciling only the
 * Horizon-managed pieces (override extension → settings.json → auth.json) so
 * unrelated Pi/user state survives. I/O wrapper around piConfig.ts builders.
 */
export function writePiConfig(agentDir: string, cfg: PiProvidersConfig): void {
  mkdirSync(agentDir, { recursive: true });
  const { overridePath, overrideSrc } = reconcileOverrideExtension(
    agentDir,
    cfg,
  );
  reconcileSettings(agentDir, cfg, overridePath, overrideSrc);
  reconcileAuth(agentDir, cfg);
}
