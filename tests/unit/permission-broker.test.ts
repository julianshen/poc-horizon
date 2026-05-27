import { describe, it, expect, vi } from "vitest";
import { PermissionBroker } from "@electron/services/PermissionBroker";

describe("PermissionBroker", () => {
  it("broadcasts a prompt and resolves the callback with the user decision", () => {
    const broadcast = vi.fn();
    const broker = new PermissionBroker(broadcast, () => "req-1");
    const cb = vi.fn();
    const id = broker.request("geolocation", "https://example.com", cb);

    expect(id).toBe("req-1");
    expect(broadcast).toHaveBeenCalledWith({
      id: "req-1",
      permission: "geolocation",
      origin: "https://example.com",
    });
    expect(broker.pendingCount()).toBe(1);

    const handled = broker.respond("req-1", "allow");
    expect(handled).toBe(true);
    expect(cb).toHaveBeenCalledWith(true);
    expect(broker.pendingCount()).toBe(0);
  });

  it("passes false to the callback on a block decision", () => {
    const broker = new PermissionBroker(vi.fn(), () => "r2");
    const cb = vi.fn();
    broker.request("media", "https://a", cb);
    broker.respond("r2", "block");
    expect(cb).toHaveBeenCalledWith(false);
  });

  it("respond returns false for an unknown id (no callback fired)", () => {
    const broker = new PermissionBroker(vi.fn());
    expect(broker.respond("missing", "allow")).toBe(false);
  });

  it("cancelAll denies every pending callback and clears the queue", () => {
    let counter = 0;
    const broker = new PermissionBroker(vi.fn(), () => `r${++counter}`);
    const a = vi.fn();
    const b = vi.fn();
    broker.request("media", "https://a", a);
    broker.request("notifications", "https://b", b);
    expect(broker.pendingCount()).toBe(2);

    broker.cancelAll();
    expect(a).toHaveBeenCalledWith(false);
    expect(b).toHaveBeenCalledWith(false);
    expect(broker.pendingCount()).toBe(0);
  });

  it("assigns unique ids per request when using the default generator", () => {
    const ids = new Set<string>();
    const broker = new PermissionBroker((p) => ids.add(p.id));
    for (let i = 0; i < 10; i++) broker.request("media", "https://x", () => {});
    expect(ids.size).toBe(10);
  });

  it("auto-denies a pending request after the timeout fires", () => {
    let scheduled: (() => void) | null = null;
    const broker = new PermissionBroker(
      vi.fn(),
      () => "rT",
      (cb) => {
        scheduled = cb;
        return 1 as unknown as NodeJS.Timeout;
      },
      vi.fn(),
      30_000,
    );
    const cb = vi.fn();
    broker.request("media", "https://a", cb);
    expect(cb).not.toHaveBeenCalled();
    expect(scheduled).toBeTruthy();
    scheduled!();
    expect(cb).toHaveBeenCalledWith(false);
    expect(broker.pendingCount()).toBe(0);
  });

  it("cancels the auto-deny timer when respond arrives first", () => {
    const cancel = vi.fn();
    const broker = new PermissionBroker(
      vi.fn(),
      () => "rC",
      () => "timer-handle" as unknown as NodeJS.Timeout,
      cancel,
      30_000,
    );
    const cb = vi.fn();
    broker.request("media", "https://a", cb);
    broker.respond("rC", "allow");
    expect(cancel).toHaveBeenCalledWith("timer-handle");
  });

  it("cancelAll clears all auto-deny timers and denies", () => {
    const cancel = vi.fn();
    let counter = 0;
    const broker = new PermissionBroker(
      vi.fn(),
      () => `r${++counter}`,
      () => ({ tag: counter }) as unknown as NodeJS.Timeout,
      cancel,
      30_000,
    );
    broker.request("media", "https://a", vi.fn());
    broker.request("notifications", "https://b", vi.fn());
    broker.cancelAll();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
