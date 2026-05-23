import { vi, beforeEach, afterEach } from 'vitest';
import { useBrowserStore } from '@/stores/browserStore';

export interface FakeHorizonAPI {
  invoke: ReturnType<typeof vi.fn>;
  on: (channel: string, callback: (payload: unknown) => void) => () => void;
  emit: (channel: string, payload: unknown) => void;
  invokes: Array<{ channel: string; payload: unknown }>;
  listenerCount: (channel: string) => number;
}

function buildFakeApi(): FakeHorizonAPI {
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

  return {
    invoke,
    on,
    emit: (channel, payload) => listeners.get(channel)?.forEach((cb) => cb(payload)),
    invokes,
    listenerCount: (channel) => listeners.get(channel)?.size ?? 0,
  };
}

/**
 * Renderer-test fixture: install a fresh fake horizonAPI on `window`
 * and reset the Zustand store before each test; teardown afterEach.
 * Returns an `api` accessor function that yields the *current* fake
 * (i.e. the one installed for the in-flight test).
 *
 * Must be called at suite top-level (not inside `it`).
 */
export function setupRendererTest(): { api: () => FakeHorizonAPI } {
  let current: FakeHorizonAPI;
  const initialState = useBrowserStore.getState();

  beforeEach(() => {
    current = buildFakeApi();
    vi.stubGlobal('horizonAPI', current);
    // window.horizonAPI is what production code reads — mirror to it
    // for completeness (vi.stubGlobal sets globalThis).
    (window as unknown as { horizonAPI: FakeHorizonAPI }).horizonAPI = current;
    useBrowserStore.setState({ ...initialState, tabs: [], activeTabId: null }, true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { horizonAPI?: unknown }).horizonAPI;
  });

  return { api: () => current };
}
