// A minimal renderer-side stand-in for window.horizonAPI used by tests.
//
// The real preload exposes:
//   invoke(channel, payload): Promise<unknown>
//   on(channel, cb): () => void
//
// The fake records invoke calls and lets tests fire `on` callbacks by
// hand. Mounts itself on globalThis.window when installed, restores on
// dispose.

export interface FakeHorizonAPI {
  invoke: ReturnType<typeof vi.fn>;
  on: (channel: string, callback: (payload: unknown) => void) => () => void;
  emit: (channel: string, payload: unknown) => void;
  invokes: Array<{ channel: string; payload: unknown }>;
  listenerCount: (channel: string) => number;
}

import { vi } from 'vitest';

export function installFakeHorizonAPI(): { api: FakeHorizonAPI; dispose: () => void } {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const invokes: Array<{ channel: string; payload: unknown }> = [];

  const invoke = vi.fn((channel: string, payload: unknown) => {
    invokes.push({ channel, payload });
    return Promise.resolve(undefined);
  });

  const on = (channel: string, callback: (payload: unknown) => void) => {
    let set = listeners.get(channel);
    if (!set) {
      set = new Set();
      listeners.set(channel, set);
    }
    set.add(callback);
    return () => {
      set!.delete(callback);
    };
  };

  const emit = (channel: string, payload: unknown) => {
    listeners.get(channel)?.forEach((cb) => cb(payload));
  };

  const listenerCount = (channel: string) => listeners.get(channel)?.size ?? 0;

  const api: FakeHorizonAPI = { invoke, on, emit, invokes, listenerCount };

  const original = (globalThis as { window?: { horizonAPI?: unknown } }).window?.horizonAPI;
  // Mount on window (jsdom provides it). In node env without jsdom this throws.
  (window as unknown as { horizonAPI: FakeHorizonAPI }).horizonAPI = api;

  return {
    api,
    dispose: () => {
      if (original === undefined) {
        delete (window as unknown as { horizonAPI?: unknown }).horizonAPI;
      } else {
        (window as unknown as { horizonAPI: unknown }).horizonAPI = original;
      }
    },
  };
}
