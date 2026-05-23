import { describe, it, expect, vi } from 'vitest';
import { PermissionBroker } from '@electron/services/PermissionBroker';

describe('PermissionBroker', () => {
  it('broadcasts a prompt and resolves the callback with the user decision', () => {
    const broadcast = vi.fn();
    const broker = new PermissionBroker(broadcast, () => 'req-1');
    const cb = vi.fn();
    broker.request('geolocation', 'https://example.com', cb);

    expect(broadcast).toHaveBeenCalledWith({
      id: 'req-1',
      permission: 'geolocation',
      origin: 'https://example.com',
    });
    expect(broker.pendingCount()).toBe(1);

    const handled = broker.respond('req-1', 'allow');
    expect(handled).toBe(true);
    expect(cb).toHaveBeenCalledWith(true);
    expect(broker.pendingCount()).toBe(0);
  });

  it('passes false to the callback on a block decision', () => {
    const broker = new PermissionBroker(vi.fn(), () => 'r2');
    const cb = vi.fn();
    broker.request('media', 'https://a', cb);
    broker.respond('r2', 'block');
    expect(cb).toHaveBeenCalledWith(false);
  });

  it('respond returns false for an unknown id (no callback fired)', () => {
    const broker = new PermissionBroker(vi.fn());
    expect(broker.respond('missing', 'allow')).toBe(false);
  });

  it('cancelAll denies every pending callback and clears the queue', () => {
    let counter = 0;
    const broker = new PermissionBroker(vi.fn(), () => `r${++counter}`);
    const a = vi.fn();
    const b = vi.fn();
    broker.request('media', 'https://a', a);
    broker.request('notifications', 'https://b', b);
    expect(broker.pendingCount()).toBe(2);

    broker.cancelAll();
    expect(a).toHaveBeenCalledWith(false);
    expect(b).toHaveBeenCalledWith(false);
    expect(broker.pendingCount()).toBe(0);
  });

  it('assigns unique ids per request when using the default generator', () => {
    const broker = new PermissionBroker(vi.fn());
    const ids = new Set<string>();
    const broadcast = (p: { id: string }): void => {
      ids.add(p.id);
    };
    const b2 = new PermissionBroker(broadcast);
    for (let i = 0; i < 10; i++) b2.request('media', 'https://x', () => {});
    expect(ids.size).toBe(10);
  });
});
