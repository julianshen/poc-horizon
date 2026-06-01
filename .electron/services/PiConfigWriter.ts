import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "fs";
import path from "path";
import {
  buildPiSettings,
  buildPiAuth,
  buildProviderOverrideExtension,
  PROVIDER_OVERRIDE_FILE,
  type AiProviderConfig,
} from "./piConfig";

/**
 * Materialize Pi's config files into `agentDir` (the directory Horizon
 * passes to the Pi subprocess via PI_CODING_AGENT_DIR). Read-merge-write
 * for settings.json so Pi-managed keys (sessions, telemetry, …) survive;
 * auth.json is written 0600. The provider-override extension is written
 * or removed to match the current base-URL setting.
 *
 * I/O wrapper around the pure builders in piConfig.ts — excluded from
 * coverage; the builders carry the tested logic.
 */
export function writePiConfig(agentDir: string, cfg: AiProviderConfig): void {
  mkdirSync(agentDir, { recursive: true });

  // Provider base-URL override extension (created or pruned).
  const overridePath = path.join(agentDir, PROVIDER_OVERRIDE_FILE);
  const overrideSrc = buildProviderOverrideExtension(cfg);
  const extensions: string[] = [];
  if (overrideSrc) {
    writeFileSync(overridePath, overrideSrc, "utf-8");
    extensions.push(overridePath);
  } else if (existsSync(overridePath)) {
    try {
      rmSync(overridePath);
    } catch {
      /* best-effort cleanup */
    }
  }

  // settings.json — preserve unknown keys Pi may have written.
  const settingsPath = path.join(agentDir, "settings.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    existing = {};
  }
  const merged = { ...existing, ...buildPiSettings(cfg, extensions) };
  // Drop a stale extensions entry when the override is no longer used.
  if (extensions.length === 0) delete merged.extensions;
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2), "utf-8");

  // auth.json — written 0600 when an API key is configured, otherwise
  // removed so a cleared key never leaves stale credentials on disk (the
  // user may have switched to env vars or OAuth).
  const auth = buildPiAuth(cfg);
  const authPath = path.join(agentDir, "auth.json");
  if (auth) {
    writeFileSync(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 });
  } else if (existsSync(authPath)) {
    try {
      rmSync(authPath);
    } catch {
      /* best-effort cleanup */
    }
  }
}
