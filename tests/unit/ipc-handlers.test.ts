import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture ipcMain.handle calls in a Map keyed by channel name. The
// `registerIpcHandlers` module imports `electron`, so we mock the
// module before importing the SUT.
const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
// vi.mock() factories run hoisted before module init. vi.hoisted()
// lifts these spy declarations to the same phase so the factory sees
// initialized names instead of TDZ.
const {
  defaultSetProxy, defaultResolveProxy,
  incognitoSetProxy, incognitoResolveProxy,
} = vi.hoisted(() => ({
  defaultSetProxy: vi.fn().mockResolvedValue(undefined),
  defaultResolveProxy: vi.fn().mockResolvedValue('DIRECT'),
  incognitoSetProxy: vi.fn().mockResolvedValue(undefined),
  incognitoResolveProxy: vi.fn().mockResolvedValue('DIRECT'),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  BrowserWindow: class {},
  session: {
    defaultSession: {
      setProxy: defaultSetProxy,
      resolveProxy: defaultResolveProxy,
    },
    fromPartition: vi.fn().mockReturnValue({
      setProxy: incognitoSetProxy,
      resolveProxy: incognitoResolveProxy,
    }),
  },
}));

vi.mock('../../.electron/services/pageTranslator', () => ({
  translatePage: vi.fn(),
  restorePage: vi.fn(),
}));

vi.mock('../../.electron/services/LlmTranslator', () => ({
  translateText: vi.fn(),
}));

import { translatePage, restorePage } from '../../.electron/services/pageTranslator';
import { translateText } from '../../.electron/services/LlmTranslator';

const { registerIpcHandlers } = await import('../../.electron/ipc/main-handlers');
const { IPC_CHANNELS } = await import('../../.electron/ipc/channels');

// Build fake managers: each method is a vi.fn so we can assert it
// was called with the right arguments. BrowserView return from
// getBrowserView is a fake webContents with the methods FIND uses.
function makeFakeServices() {
  const findInPage = vi.fn();
  const stopFindInPage = vi.fn();
  const view = { webContents: { findInPage, stopFindInPage } };

  const tabManager = {
    createTab: vi.fn().mockReturnValue({ id: 't1' }),
    getActiveTabId: vi.fn().mockReturnValue('t1'),
    closeTab: vi.fn(),
    activateTab: vi.fn(),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    setZoom: vi.fn(),
    toggleDevTools: vi.fn(),
    openDevTools: vi.fn(),
    print: vi.fn(),
    printToPDF: vi.fn().mockResolvedValue('/tmp/out.pdf'),
    getBrowserView: vi.fn().mockReturnValue(view),
    setPinned: vi.fn(),
    setMuted: vi.fn(),
    duplicate: vi.fn().mockReturnValue({ id: 't2' }),
    reorder: vi.fn(),
  };

  const wcSend = vi.fn();
  const window = {
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    isMaximized: vi.fn().mockReturnValue(false),
    isDestroyed: vi.fn().mockReturnValue(false),
    close: vi.fn(),
    webContents: { send: wcSend },
  };

  const settingsManager = {
    get: vi.fn().mockReturnValue('value'),
    getAll: vi.fn().mockReturnValue({ k: 'v' }),
    set: vi.fn(),
    reset: vi.fn(),
  };

  const bookmarkManager = {
    getTree: vi.fn().mockReturnValue([]),
    add: vi.fn().mockReturnValue({ id: 'b1' }),
    remove: vi.fn(),
    move: vi.fn().mockReturnValue({ id: 'b1' }),
    update: vi.fn().mockReturnValue({ id: 'b1' }),
    import: vi.fn().mockReturnValue([]),
    export: vi.fn().mockReturnValue('<html/>'),
  };

  const historyManager = {
    search: vi.fn().mockReturnValue([]),
    getRecent: vi.fn().mockReturnValue([]),
    clear: vi.fn().mockReturnValue(0),
  };

  const downloadManager = {
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    clearCompleted: vi.fn(),
  };

  const passwordManager = {
    getAll: vi.fn().mockReturnValue([]),
    saveEntry: vi.fn(),
    remove: vi.fn(),
    getForOrigin: vi.fn().mockReturnValue([]),
  };

  const autofillManager = {
    getAddresses: vi.fn().mockReturnValue([]),
    saveAddress: vi.fn().mockReturnValue({ id: 'a1' }),
    removeAddress: vi.fn(),
  };

  return {
    tabManager,
    window,
    wcSend,
    view,
    findInPage,
    stopFindInPage,
    settingsManager,
    bookmarkManager,
    historyManager,
    downloadManager,
    passwordManager,
    autofillManager,
  };
}

type Services = ReturnType<typeof makeFakeServices>;
let s: Services;

beforeEach(() => {
  handlers.clear();
  defaultSetProxy.mockClear();
  incognitoSetProxy.mockClear();
  s = makeFakeServices();
  registerIpcHandlers(
    {
      settingsManager: s.settingsManager as never,
      bookmarkManager: s.bookmarkManager as never,
      historyManager: s.historyManager as never,
      downloadManager: s.downloadManager as never,
      passwordManager: s.passwordManager as never,
      autofillManager: s.autofillManager as never,
    },
    () => ({ tabManager: s.tabManager as never, window: s.window as never })
  );
});

const invoke = (channel: string, payload?: unknown) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`);
  return fn({}, payload);
};

describe('IPC handlers', () => {
  describe('tabs', () => {
    it('tab:create dispatches createTab(url)', () => {
      invoke(IPC_CHANNELS.TAB_CREATE, { url: 'https://example.com' });
      expect(s.tabManager.createTab).toHaveBeenCalledWith('https://example.com');
    });

    it('tab:close dispatches closeTab(tabId)', () => {
      invoke(IPC_CHANNELS.TAB_CLOSE, { tabId: 't1' });
      expect(s.tabManager.closeTab).toHaveBeenCalledWith('t1');
    });

    it('tab:activate dispatches activateTab(tabId)', () => {
      invoke(IPC_CHANNELS.TAB_ACTIVATE, { tabId: 't1' });
      expect(s.tabManager.activateTab).toHaveBeenCalledWith('t1');
    });

    it('tab:pin dispatches setPinned(tabId, pinned)', () => {
      invoke(IPC_CHANNELS.TAB_PIN, { tabId: 't1', pinned: true });
      expect(s.tabManager.setPinned).toHaveBeenCalledWith('t1', true);
    });

    it('tab:mute / tab:unmute dispatch setMuted with the correct flag', () => {
      invoke(IPC_CHANNELS.TAB_MUTE, { tabId: 't1' });
      expect(s.tabManager.setMuted).toHaveBeenCalledWith('t1', true);
      invoke(IPC_CHANNELS.TAB_UNMUTE, { tabId: 't1' });
      expect(s.tabManager.setMuted).toHaveBeenCalledWith('t1', false);
    });

    it('tab:duplicate dispatches duplicate(tabId)', () => {
      invoke(IPC_CHANNELS.TAB_DUPLICATE, { tabId: 't1' });
      expect(s.tabManager.duplicate).toHaveBeenCalledWith('t1');
    });

    it('tab:reorder dispatches reorder(tabId, index)', () => {
      invoke(IPC_CHANNELS.TAB_REORDER, { tabId: 't1', index: 2 });
      expect(s.tabManager.reorder).toHaveBeenCalledWith('t1', 2);
    });
  });

  describe('navigation', () => {
    it('navigation:go dispatches navigate(tabId, url)', () => {
      invoke(IPC_CHANNELS.NAVIGATION_GO, { tabId: 't1', url: 'https://x.example' });
      expect(s.tabManager.navigate).toHaveBeenCalledWith('t1', 'https://x.example');
    });

    it('navigation:back dispatches goBack(tabId)', () => {
      invoke(IPC_CHANNELS.NAVIGATION_BACK, { tabId: 't1' });
      expect(s.tabManager.goBack).toHaveBeenCalledWith('t1');
    });

    it('navigation:forward dispatches goForward(tabId)', () => {
      invoke(IPC_CHANNELS.NAVIGATION_FORWARD, { tabId: 't1' });
      expect(s.tabManager.goForward).toHaveBeenCalledWith('t1');
    });

    it('navigation:reload dispatches reload(tabId, hard)', () => {
      invoke(IPC_CHANNELS.NAVIGATION_RELOAD, { tabId: 't1', hard: true });
      expect(s.tabManager.reload).toHaveBeenCalledWith('t1', true);
    });

    it('navigation:stop dispatches stop(tabId)', () => {
      invoke(IPC_CHANNELS.NAVIGATION_STOP, { tabId: 't1' });
      expect(s.tabManager.stop).toHaveBeenCalledWith('t1');
    });
  });

  describe('window', () => {
    it('window:minimize dispatches window.minimize()', () => {
      invoke(IPC_CHANNELS.WINDOW_MINIMIZE);
      expect(s.window.minimize).toHaveBeenCalledOnce();
    });

    it('window:maximize toggles based on isMaximized()', () => {
      s.window.isMaximized.mockReturnValue(false);
      invoke(IPC_CHANNELS.WINDOW_MAXIMIZE);
      expect(s.window.maximize).toHaveBeenCalledOnce();
      expect(s.window.unmaximize).not.toHaveBeenCalled();

      s.window.isMaximized.mockReturnValue(true);
      invoke(IPC_CHANNELS.WINDOW_MAXIMIZE);
      expect(s.window.unmaximize).toHaveBeenCalledOnce();
    });

    it('window:close dispatches window.close()', () => {
      invoke(IPC_CHANNELS.WINDOW_CLOSE);
      expect(s.window.close).toHaveBeenCalledOnce();
    });
  });

  describe('app', () => {
    it('app:getVersion returns 1.0.0', () => {
      expect(invoke(IPC_CHANNELS.APP_GET_VERSION)).toBe('1.0.0');
    });
    // app:quit calls process.exit — covered in a dedicated test below.
  });

  describe('settings', () => {
    it('settings:get returns settingsManager.get(key)', () => {
      const result = invoke(IPC_CHANNELS.SETTINGS_GET, { key: 'accentColor' });
      expect(s.settingsManager.get).toHaveBeenCalledWith('accentColor');
      expect(result).toBe('value');
    });

    it('settings:getAll returns settingsManager.getAll()', () => {
      expect(invoke(IPC_CHANNELS.SETTINGS_GET_ALL)).toEqual({ k: 'v' });
    });

    it('settings:set writes and emits SETTINGS_CHANGED to the renderer', () => {
      invoke(IPC_CHANNELS.SETTINGS_SET, { key: 'accentColor', value: '#abc' });
      expect(s.settingsManager.set).toHaveBeenCalledWith('accentColor', '#abc');
      expect(s.wcSend).toHaveBeenCalledWith(IPC_CHANNELS.SETTINGS_CHANGED, {
        key: 'accentColor',
        value: '#abc',
      });
    });

    it('settings:reset dispatches reset(key)', () => {
      invoke(IPC_CHANNELS.SETTINGS_RESET, { key: 'accentColor' });
      expect(s.settingsManager.reset).toHaveBeenCalledWith('accentColor');
    });
  });

  describe('bookmarks', () => {
    it('bookmark:getTree returns bookmarkManager.getTree()', () => {
      expect(invoke(IPC_CHANNELS.BOOKMARK_GET_TREE)).toEqual([]);
    });

    it('bookmark:add forwards url+title+parentId', () => {
      invoke(IPC_CHANNELS.BOOKMARK_ADD, { url: 'https://x', title: 'X', parentId: 'p' });
      expect(s.bookmarkManager.add).toHaveBeenCalledWith('https://x', 'X', 'p');
    });

    it('bookmark:remove forwards bookmarkId', () => {
      invoke(IPC_CHANNELS.BOOKMARK_REMOVE, { bookmarkId: 'b1' });
      expect(s.bookmarkManager.remove).toHaveBeenCalledWith('b1');
    });

    it('bookmark:move forwards bookmarkId+parentId+index', () => {
      invoke(IPC_CHANNELS.BOOKMARK_MOVE, { bookmarkId: 'b1', parentId: 'p', index: 3 });
      expect(s.bookmarkManager.move).toHaveBeenCalledWith('b1', 'p', 3);
    });

    it('bookmark:update forwards bookmarkId+changes', () => {
      invoke(IPC_CHANNELS.BOOKMARK_UPDATE, { bookmarkId: 'b1', changes: { title: 'New' } });
      expect(s.bookmarkManager.update).toHaveBeenCalledWith('b1', { title: 'New' });
    });

    it('bookmark:import forwards data', () => {
      invoke(IPC_CHANNELS.BOOKMARK_IMPORT, { data: '<html/>' });
      expect(s.bookmarkManager.import).toHaveBeenCalledWith('<html/>');
    });

    it('bookmark:export returns the export string', () => {
      expect(invoke(IPC_CHANNELS.BOOKMARK_EXPORT)).toBe('<html/>');
    });
  });

  describe('history', () => {
    it('history:search forwards query+limit', () => {
      invoke(IPC_CHANNELS.HISTORY_SEARCH, { query: 'q', limit: 10 });
      expect(s.historyManager.search).toHaveBeenCalledWith('q', 10);
    });

    it('history:getRecent forwards limit', () => {
      invoke(IPC_CHANNELS.HISTORY_GET_RECENT, { limit: 5 });
      expect(s.historyManager.getRecent).toHaveBeenCalledWith(5);
    });

    it('history:clear forwards range', () => {
      invoke(IPC_CHANNELS.HISTORY_CLEAR, { range: 'hour' });
      expect(s.historyManager.clear).toHaveBeenCalledWith('hour');
    });
  });

  describe('downloads', () => {
    it.each([
      ['DOWNLOAD_PAUSE', 'pause'],
      ['DOWNLOAD_RESUME', 'resume'],
      ['DOWNLOAD_CANCEL', 'cancel'],
    ] as const)('%s forwards downloadId to downloadManager.%s', (channel, method) => {
      invoke(IPC_CHANNELS[channel], { downloadId: 'd1' });
      expect(s.downloadManager[method]).toHaveBeenCalledWith('d1');
    });

    it('download:clearCompleted dispatches clearCompleted()', () => {
      invoke(IPC_CHANNELS.DOWNLOAD_CLEAR_COMPLETED);
      expect(s.downloadManager.clearCompleted).toHaveBeenCalledOnce();
    });
  });

  describe('find in page', () => {
    it('find:start calls view.webContents.findInPage(text, opts)', () => {
      invoke(IPC_CHANNELS.FIND_START, { tabId: 't1', text: 'foo', caseSensitive: true });
      expect(s.findInPage).toHaveBeenCalledWith('foo', { caseSensitive: true });
    });

    it('find:start returns undefined when the tab has no view', () => {
      s.tabManager.getBrowserView.mockReturnValueOnce(undefined);
      expect(invoke(IPC_CHANNELS.FIND_START, { tabId: 't1', text: 'foo' })).toBeUndefined();
      expect(s.findInPage).not.toHaveBeenCalled();
    });

    it('find:next calls findInPage with forward direction', () => {
      invoke(IPC_CHANNELS.FIND_NEXT, { tabId: 't1', forward: false });
      expect(s.findInPage).toHaveBeenCalledWith('', { forward: false });
    });

    it('find:next is a no-op when tab has no view', () => {
      s.tabManager.getBrowserView.mockReturnValueOnce(undefined);
      invoke(IPC_CHANNELS.FIND_NEXT, { tabId: 't1' });
      expect(s.findInPage).not.toHaveBeenCalled();
    });

    it('find:stop clears the selection', () => {
      invoke(IPC_CHANNELS.FIND_STOP, { tabId: 't1' });
      expect(s.stopFindInPage).toHaveBeenCalledWith('clearSelection');
    });

    it('find:stop is a no-op when tab has no view', () => {
      s.tabManager.getBrowserView.mockReturnValueOnce(undefined);
      invoke(IPC_CHANNELS.FIND_STOP, { tabId: 't1' });
      expect(s.stopFindInPage).not.toHaveBeenCalled();
    });
  });

  describe('passwords', () => {
    it('password:getAll returns getAll()', () => {
      expect(invoke(IPC_CHANNELS.PASSWORD_GET_ALL)).toEqual([]);
    });

    it('password:save forwards entry', () => {
      const entry = { origin: 'https://x', username: 'u', password: 'p' };
      invoke(IPC_CHANNELS.PASSWORD_SAVE, { entry });
      expect(s.passwordManager.saveEntry).toHaveBeenCalledWith(entry);
    });

    it('password:remove forwards origin+username', () => {
      invoke(IPC_CHANNELS.PASSWORD_REMOVE, { origin: 'https://x', username: 'u' });
      expect(s.passwordManager.remove).toHaveBeenCalledWith('https://x', 'u');
    });

    it('password:getForOrigin forwards origin', () => {
      invoke(IPC_CHANNELS.PASSWORD_GET_FOR_ORIGIN, { origin: 'https://x' });
      expect(s.passwordManager.getForOrigin).toHaveBeenCalledWith('https://x');
    });
  });

  describe('autofill', () => {
    it('autofill:getAddresses returns getAddresses()', () => {
      expect(invoke(IPC_CHANNELS.AUTOFILL_GET_ADDRESSES)).toEqual([]);
    });

    it('autofill:saveAddress forwards address', () => {
      const address = { id: '', label: 'L', name: 'N', street: ['s'], city: 'c', postalCode: 'p', country: 'US' };
      invoke(IPC_CHANNELS.AUTOFILL_SAVE_ADDRESS, { address });
      expect(s.autofillManager.saveAddress).toHaveBeenCalledWith(address);
    });

    it('autofill:removeAddress forwards addressId', () => {
      invoke(IPC_CHANNELS.AUTOFILL_REMOVE_ADDRESS, { addressId: 'a1' });
      expect(s.autofillManager.removeAddress).toHaveBeenCalledWith('a1');
    });
  });

  describe('zoom + devtools + print', () => {
    it('zoom:set forwards tabId+level', () => {
      invoke(IPC_CHANNELS.ZOOM_SET, { tabId: 't1', level: 1.5 });
      expect(s.tabManager.setZoom).toHaveBeenCalledWith('t1', 1.5);
    });

    it('zoom:reset sets level to 1.0', () => {
      invoke(IPC_CHANNELS.ZOOM_RESET, { tabId: 't1' });
      expect(s.tabManager.setZoom).toHaveBeenCalledWith('t1', 1.0);
    });

    it('devtools:toggle forwards tabId', () => {
      invoke(IPC_CHANNELS.DEVTOOLS_TOGGLE, { tabId: 't1' });
      expect(s.tabManager.toggleDevTools).toHaveBeenCalledWith('t1');
    });

    it('devtools:open forwards tabId+mode', () => {
      invoke(IPC_CHANNELS.DEVTOOLS_OPEN, { tabId: 't1', mode: 'bottom' });
      expect(s.tabManager.openDevTools).toHaveBeenCalledWith('t1', 'bottom');
    });

    it('print:start forwards tabId', () => {
      invoke(IPC_CHANNELS.PRINT_START, { tabId: 't1' });
      expect(s.tabManager.print).toHaveBeenCalledWith('t1');
    });

    it('print:toPDF forwards tabId+outputPath', async () => {
      await invoke(IPC_CHANNELS.PRINT_TO_PDF, { tabId: 't1', outputPath: '/tmp/out.pdf' });
      expect(s.tabManager.printToPDF).toHaveBeenCalledWith('t1', '/tmp/out.pdf');
    });
  });

  describe('app:quit', () => {
    it('calls process.exit(0)', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => undefined) as never);
      invoke(IPC_CHANNELS.APP_QUIT);
      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });
  });

  describe('translation', () => {
    it('translate:page calls translatePage and returns result', async () => {
      vi.mocked(translatePage).mockResolvedValueOnce({ ok: true, translated: 3, total: 3 });
      const res = await invoke(IPC_CHANNELS.TRANSLATE_PAGE, { targetLang: 'Spanish' });
      expect(translatePage).toHaveBeenCalled();
      expect(res).toEqual({ ok: true, translated: 3, total: 3 });
    });

    it('translate:restore calls restorePage and returns result', async () => {
      vi.mocked(restorePage).mockResolvedValueOnce({ restored: 3 });
      const res = await invoke(IPC_CHANNELS.TRANSLATE_RESTORE);
      expect(restorePage).toHaveBeenCalled();
      expect(res).toEqual({ restored: 3 });
    });

    it('translate:selection calls translateText and returns result', async () => {
      vi.mocked(translateText).mockResolvedValueOnce('Hola');
      const res = await invoke(IPC_CHANNELS.TRANSLATE_SELECTION, { text: 'Hello', targetLang: 'Spanish' });
      expect(translateText).toHaveBeenCalledWith('Hello', 'Spanish');
      expect(res).toBe('Hola');
    });

    it('translate:page stamps every progress event with the source tabId', async () => {
      vi.mocked(translatePage).mockImplementationOnce(async (_wc, _lang, onProgress) => {
        onProgress?.(5, 10);
        return { ok: true, translated: 10, total: 10 };
      });
      s.wcSend.mockClear();
      await invoke(IPC_CHANNELS.TRANSLATE_PAGE, { targetLang: 'Spanish' });
      const sends = s.wcSend.mock.calls.filter((c) => c[0] === 'translate:progress');
      expect(sends.length).toBeGreaterThan(0);
      for (const [, payload] of sends) {
        expect(payload).toHaveProperty('tabId');
        expect(typeof (payload as { tabId: string }).tabId).toBe('string');
      }
    });

    it('translate:cancel aborts the in-flight controller for the active tab', async () => {
      let observedSignal: AbortSignal | undefined;
      vi.mocked(translatePage).mockImplementationOnce(async (_wc, _lang, _p, signal) => {
        observedSignal = signal;
        // Pretend to do work for a tick so cancel can fire in parallel.
        await new Promise((r) => setTimeout(r, 5));
        return { ok: false, error: 'aborted' };
      });
      const inFlight = invoke(IPC_CHANNELS.TRANSLATE_PAGE, { targetLang: 'Spanish' });
      // Give the page handler a tick to set up its controller before cancelling.
      await new Promise((r) => setTimeout(r, 1));
      await invoke('translate:cancel' as never);
      await inFlight;
      expect(observedSignal?.aborted).toBe(true);
    });

    it('translate:restore aborts the in-flight controller for the same tab before restoring', async () => {
      // Start a translation we never let resolve, so the controller is live.
      let observedSignal: AbortSignal | undefined;
      vi.mocked(translatePage).mockImplementationOnce(async (_wc, _lang, _p, signal) => {
        observedSignal = signal;
        await new Promise((r) => setTimeout(r, 30));
        return { ok: false, error: 'aborted' };
      });
      vi.mocked(restorePage).mockResolvedValueOnce({ restored: 5 });
      const inFlight = invoke(IPC_CHANNELS.TRANSLATE_PAGE, { targetLang: 'Spanish' });
      await new Promise((r) => setTimeout(r, 1));
      const res = await invoke(IPC_CHANNELS.TRANSLATE_RESTORE);
      await inFlight;
      expect(observedSignal?.aborted).toBe(true);
      expect(res).toEqual({ restored: 5 });
    });
  });

  describe('settings', () => {
    /**
     * Real integration: tie set + get to a shared state object so the
     * handler's "set FIRST, get to read final values" ordering is
     * actually exercised. The previous version mocked get
     * independently of set, which made the test pass even if set
     * never ran or read the wrong value.
     */
    function wireStatefulSettings(initial: Record<string, unknown>): void {
      const store: Record<string, unknown> = { ...initial };
      s.settingsManager.get.mockImplementation((key: string) => store[key]);
      s.settingsManager.set.mockImplementation((key: string, value: unknown) => {
        store[key] = value;
      });
    }

    it('settings:set for proxyType reads back the just-set value and applies to both sessions', async () => {
      wireStatefulSettings({
        proxyType: 'manual',
        proxyRules: 'http=127.0.0.1:8080',
        proxyBypassRules: '<local>',
      });
      // The handler awaits applyProxySettingsToCoreSessions before
      // emitting SETTINGS_CHANGED — so awaiting invoke() awaits the
      // proxy apply too.
      await invoke(IPC_CHANNELS.SETTINGS_SET, { key: 'proxyType', value: 'manual' });
      const expected = {
        mode: 'fixed_servers',
        proxyRules: 'http=127.0.0.1:8080',
        proxyBypassRules: '<local>',
      };
      expect(defaultSetProxy).toHaveBeenCalledWith(expected);
      expect(incognitoSetProxy).toHaveBeenCalledWith(expected);
    });

    it('settings:set for proxyRules with a newly-set value flows through to setProxy', async () => {
      // Start from a clean store and only set the rules — exercises the
      // get-after-set path: the handler must observe the new rules.
      wireStatefulSettings({ proxyType: 'manual', proxyRules: undefined, proxyBypassRules: undefined });
      await invoke(IPC_CHANNELS.SETTINGS_SET, { key: 'proxyRules', value: 'http=10.0.0.1:3128' });
      expect(defaultSetProxy).toHaveBeenCalledWith({
        mode: 'fixed_servers',
        proxyRules: 'http=10.0.0.1:3128',
        proxyBypassRules: undefined,
      });
    });

    it('settings:set for proxyBypassRules re-applies updated bypass rules to both sessions', async () => {
      // Start with a manual config that's missing bypass rules; setting
      // them must trigger a re-apply with the new value flowing through.
      wireStatefulSettings({
        proxyType: 'manual',
        proxyRules: 'http=127.0.0.1:8080',
        proxyBypassRules: undefined,
      });
      await invoke(IPC_CHANNELS.SETTINGS_SET, { key: 'proxyBypassRules', value: '<local>' });
      const expected = {
        mode: 'fixed_servers',
        proxyRules: 'http=127.0.0.1:8080',
        proxyBypassRules: '<local>',
      };
      expect(defaultSetProxy).toHaveBeenCalledWith(expected);
      expect(incognitoSetProxy).toHaveBeenCalledWith(expected);
    });

    it('settings:set for an unrelated key does NOT reapply the proxy', async () => {
      wireStatefulSettings({ proxyType: 'system' });
      await invoke(IPC_CHANNELS.SETTINGS_SET, { key: 'theme', value: 'dark' });
      expect(defaultSetProxy).not.toHaveBeenCalled();
      expect(incognitoSetProxy).not.toHaveBeenCalled();
    });

    it('settings:set survives a setProxy rejection without throwing or leaking unhandled', async () => {
      wireStatefulSettings({ proxyType: 'manual', proxyRules: 'malformed', proxyBypassRules: undefined });
      defaultSetProxy.mockRejectedValueOnce(new Error('CHROMIUM_INVALID_PROXY_CONFIG'));
      // Handler catches internally — awaiting the invocation should
      // resolve without throwing.
      await expect(invoke(IPC_CHANNELS.SETTINGS_SET, { key: 'proxyType', value: 'manual' }))
        .resolves.toBeUndefined();
    });
  });
});
