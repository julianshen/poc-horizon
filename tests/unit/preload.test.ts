import { describe, it, expect, beforeEach, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const ipcInvoke = vi.fn().mockResolvedValue('result');
const ipcOn = vi.fn();
const ipcRemoveListener = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: {
    invoke: ipcInvoke,
    on: ipcOn,
    removeListener: ipcRemoveListener,
  },
}));

// Re-import the preload module fresh for each test so the module-level
// contextBridge.exposeInMainWorld call fires under our spies.
async function loadPreload() {
  vi.resetModules();
  await import('../../.electron/preload');
  // Pull the api shape that the module exposed.
  const lastCall = exposeInMainWorld.mock.calls.at(-1);
  return lastCall?.[1] as {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  };
}

beforeEach(() => {
  exposeInMainWorld.mockClear();
  ipcInvoke.mockClear();
  ipcOn.mockClear();
  ipcRemoveListener.mockClear();
});

describe('preload', () => {
  it('exposes only the horizonAPI key on the renderer window', async () => {
    await loadPreload();
    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    const [worldKey] = exposeInMainWorld.mock.calls[0];
    expect(worldKey).toBe('horizonAPI');
  });

  it('exposes only `invoke` and `on` — no direct ipcRenderer access', async () => {
    const api = await loadPreload();
    expect(Object.keys(api).sort()).toEqual(['invoke', 'on']);
  });

  it('invoke() forwards channel + args to ipcRenderer.invoke', async () => {
    const api = await loadPreload();
    const result = await api.invoke('tab:create', { url: 'https://example.com' });
    expect(ipcInvoke).toHaveBeenCalledWith('tab:create', { url: 'https://example.com' });
    expect(result).toBe('result');
  });

  it('on() registers an ipcRenderer.on wrapper that strips the event arg', async () => {
    const api = await loadPreload();
    const callback = vi.fn();
    api.on('tab:created', callback);
    expect(ipcOn).toHaveBeenCalledWith('tab:created', expect.any(Function));

    // Simulate ipcRenderer firing the wrapped handler with an IpcRendererEvent.
    const wrappedHandler = ipcOn.mock.calls[0][1] as (event: unknown, ...args: unknown[]) => void;
    wrappedHandler({ sender: 'fake-event' }, { id: 'tab-1' }, 'extra');
    expect(callback).toHaveBeenCalledWith({ id: 'tab-1' }, 'extra');
  });

  it('on() returns an unsubscribe that removes the same wrapped listener', async () => {
    const api = await loadPreload();
    const callback = vi.fn();
    const unsubscribe = api.on('tab:created', callback);

    const registeredWrapper = ipcOn.mock.calls[0][1];
    unsubscribe();
    expect(ipcRemoveListener).toHaveBeenCalledWith('tab:created', registeredWrapper);
  });
});
