import { describe, it, expect, vi } from 'vitest';
import { scheduleAutoUpdate, FOUR_HOURS_MS } from '@electron/services/autoUpdateScheduler';

describe('autoUpdateScheduler', () => {
  it('fires an immediate check on startup', () => {
    const checker = { checkForUpdatesAndNotify: vi.fn() };
    const setInterval = vi.fn();
    scheduleAutoUpdate(checker, { setInterval });
    expect(checker.checkForUpdatesAndNotify).toHaveBeenCalledOnce();
  });

  it('schedules a recurring check at the configured interval', () => {
    const checker = { checkForUpdatesAndNotify: vi.fn() };
    const setInterval = vi.fn();
    scheduleAutoUpdate(checker, { intervalMs: 1000, setInterval });
    expect(setInterval).toHaveBeenCalledOnce();
    expect(setInterval.mock.calls[0][1]).toBe(1000);
  });

  it('the recurring callback also runs checkForUpdatesAndNotify', () => {
    const checker = { checkForUpdatesAndNotify: vi.fn() };
    let scheduledCb: (() => void) | undefined;
    const setInterval = vi.fn((cb: () => void) => {
      scheduledCb = cb;
    });
    scheduleAutoUpdate(checker, { setInterval });
    checker.checkForUpdatesAndNotify.mockClear(); // clear startup call
    scheduledCb!();
    expect(checker.checkForUpdatesAndNotify).toHaveBeenCalledOnce();
  });

  it('defaults to a 4-hour interval', () => {
    const checker = { checkForUpdatesAndNotify: vi.fn() };
    const setInterval = vi.fn();
    scheduleAutoUpdate(checker, { setInterval });
    expect(setInterval.mock.calls[0][1]).toBe(FOUR_HOURS_MS);
    expect(FOUR_HOURS_MS).toBe(14_400_000);
  });

  it('returns the interval handle from the scheduler', () => {
    const checker = { checkForUpdatesAndNotify: vi.fn() };
    const handle = { id: 42 };
    const setInterval = vi.fn().mockReturnValue(handle);
    expect(scheduleAutoUpdate(checker, { setInterval })).toBe(handle);
  });
});
