// Scheduling logic for electron-updater check-on-startup + recurring poll.
//
// Extracted from main.ts so the timing contract can be tested without
// instantiating Electron or making real HTTP calls. The adapter wires
// our scheduler to electron-updater's checkForUpdatesAndNotify().

export interface UpdateChecker {
  checkForUpdatesAndNotify(): unknown;
}

export interface SchedulerOptions {
  /** Milliseconds between recurring checks after the startup check. */
  intervalMs?: number;
  /** Override for setInterval — tests substitute a fake timer here. */
  setInterval?: (cb: () => void, ms: number) => unknown;
}

export const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * Kick off an immediate update check and schedule recurring polls.
 * Returns the interval handle so callers can cancel on shutdown.
 *
 * Two side effects:
 * 1. One immediate `checkForUpdatesAndNotify()` call (the "on startup" check).
 * 2. A recurring `setInterval` repeating the same call.
 */
export function scheduleAutoUpdate(
  checker: UpdateChecker,
  {
    intervalMs = FOUR_HOURS_MS,
    setInterval: scheduler = setInterval,
  }: SchedulerOptions = {},
): unknown {
  checker.checkForUpdatesAndNotify();
  return scheduler(() => {
    checker.checkForUpdatesAndNotify();
  }, intervalMs);
}
