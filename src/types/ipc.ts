export interface IpcChannels {
  // Renderer → Main
  'tab:create': { url?: string; index?: number };
  'tab:close': { tabId: string };
  'tab:activate': { tabId: string };
  'tab:reorder': { tabId: string; index: number };
  'tab:pin': { tabId: string; pinned: boolean };
  // Tab Groups (Chrome parity v1).
  'tabGroup:create': { name: string; color: import('./browser').TabGroupColor; tabIds?: string[] };
  'tabGroup:update': { groupId: string; changes: Partial<{ name: string; color: import('./browser').TabGroupColor }> };
  'tabGroup:delete': { groupId: string };
  'tabGroup:addTab': { groupId: string; tabId: string };
  'tabGroup:removeTab': { tabId: string };
  'tab:duplicate': { tabId: string };
  'tab:hibernate': { tabId: string };
  'tab:wake': { tabId: string };
  'tab:mute': { tabId: string };
  'tab:unmute': { tabId: string };
  'navigation:go': { tabId: string; url: string };
  'navigation:back': { tabId: string };
  'navigation:forward': { tabId: string };
  'navigation:reload': { tabId: string; hard?: boolean };
  'navigation:stop': { tabId: string };
  'zoom:set': { tabId: string; level: number };
  'zoom:reset': { tabId: string };
  'find:start': { tabId: string; text: string; caseSensitive?: boolean };
  'find:next': { tabId: string; forward?: boolean };
  'find:stop': { tabId: string };
  'bookmark:add': { url: string; title: string; parentId?: string };
  'bookmark:remove': { bookmarkId: string };
  'bookmark:move': { bookmarkId: string; parentId: string; index: number };
  'bookmark:update': { bookmarkId: string; changes: Partial<import('./browser').Bookmark> };
  'bookmark:getTree': {};
  'bookmark:import': { format: 'netscape-html'; data: string };
  'bookmark:export': { format: 'netscape-html' };
  'history:clear': { range?: 'all' | 'hour' | 'day' | 'week' | 'month' };
  'history:search': { query: string; limit?: number };
  'history:getRecent': { limit?: number };
  'download:pause': { downloadId: string };
  'download:resume': { downloadId: string };
  'download:cancel': { downloadId: string };
  'download:open': { downloadId: string };
  'download:showInFolder': { downloadId: string };
  'download:clearCompleted': {};
  'download:retry': { downloadId: string };
  'settings:get': { key: string };
  'settings:getAll': {};
  'settings:set': { key: string; value: unknown };
  'settings:reset': { key?: string };
  'password:getAll': {};
  'password:save': { entry: import('./browser').PasswordEntry };
  'password:remove': { origin: string; username: string };
  'password:getForOrigin': { origin: string };
  'window:minimize': {};
  'window:maximize': {};
  'window:close': {};
  'window:setFullscreen': { fullscreen: boolean };
  'app:quit': {};
  'app:getVersion': {};
  'app:checkForUpdates': {};
  'devtools:toggle': { tabId: string };
  'devtools:open': { tabId: string; mode?: 'right' | 'bottom' | 'undocked' };
  'print:start': { tabId: string };
  'print:toPDF': { tabId: string; outputPath: string; options?: { marginsType?: number; pageSize?: string; printBackground?: boolean } };
  'permission:respond': { id: string; decision: 'allow' | 'block' };
  'window:newIncognito': Record<string, never>;
  'ui:contentBounds': { x: number; y: number; width: number; height: number };
  'contentSetting:set': { origin: string; setting: ContentSettingType; value: 'allow' | 'block' | 'ask' };
  'contextMenu:clicked': { itemId: string };
  'omnibox:getSuggestions': { query: string; maxResults?: number };
  'autofill:detectFields': { tabId: string; fields: import('./browser').FormField[] };
  'autofill:fillField': { tabId: string; fieldId: string; value: string };
  'autofill:getAddresses': {};
  'autofill:saveAddress': { address: import('./browser').SavedAddress };
  'autofill:removeAddress': { addressId: string };

  // Main → Renderer
  'tab:created': import('./browser').Tab;
  'tab:closed': { tabId: string };
  // Tab Group lifecycle events broadcast to the renderer.
  'tabGroup:created': import('./browser').TabGroup;
  'tabGroup:updated': import('./browser').TabGroup;
  'tabGroup:deleted': { groupId: string };
  'tab:activated': { tabId: string };
  'tab:updated': Partial<import('./browser').Tab>;
  'tab:reordered': { tabId: string; index: number };
  'tab:hibernated': { tabId: string };
  'tab:woken': { tabId: string };
  'navigation:state': { tabId: string; canGoBack: boolean; canGoForward: boolean; isLoading: boolean; url: string };
  'load:started': { tabId: string; url: string };
  'load:progress': { tabId: string; percent: number };
  'load:finished': { tabId: string; url: string };
  'load:failed': { tabId: string; errorCode: number; errorDescription: string; validatedURL: string };
  'page:title': { tabId: string; title: string };
  'page:favicon': { tabId: string; faviconUrl: string };
  'download:created': import('./browser').DownloadItem;
  'download:updated': Partial<import('./browser').DownloadItem>;
  'download:completed': { downloadId: string };
  'download:failed': { downloadId: string; error: string };
  'settings:changed': { key: string; value: unknown };
  'zoom:changed': { tabId: string; level: number };
  'find:result': import('./browser').FindResult;
  'fullscreen:changed': { isFullscreen: boolean };
  'keyboard:shortcut': { accelerator: string };
  'contextMenu:show': { x: number; y: number; items: import('./browser').ContextMenuItem[] };
  'certificate:error': { url: string; error: string; certificate?: import('./browser').CertificateInfo };
  'permission:request': { id: string; origin: string; permission: PermissionType | string };
  'app:updateAvailable': { version: string };
  'app:updateDownloaded': { version: string };
  'autofill:showDropdown': { tabId: string; fieldId: string; suggestions: import('./browser').AutofillMatch[]; position: { x: number; y: number; width: number; height: number } };
  /** Native application menu → renderer: ask the renderer to run a UI command. */
  'menu:command': { command: string };

  // ─── AI agent (Pi integration) ────────────────────────────────────
  /** Start a new agent turn with the user's prompt against the active tab.
   *  `mentionTabIds` is the IDs of additional tabs the user @-mentioned;
   *  main extracts each tab's title/url/text and prepends as context. */
  'ai:start': { prompt: string; tabId?: string; mentionTabIds?: string[] };
  /** Cancel the in-flight turn, if any. */
  'ai:cancel': Record<string, never>;
  /** Forget the current conversation: kill Pi, clear the saved session path. */
  'ai:newChat': Record<string, never>;
  /** Start spawning the Pi subprocess + bridge ahead of the first turn so
   *  the user doesn't wait 1-3 s on first prompt. Idempotent. */
  'ai:preWarm': Record<string, never>;
  /** Main → Renderer: streaming events from the agent loop. */
  'ai:event': import('./ai').AgentEvent;
  /** Main → Renderer: discovered an llms.txt for the active tab's
   *  origin. Renderer should open the AI panel (if not already open)
   *  and surface a one-shot navigation guide card. */
  'ai:llmsTxtFound': {
    origin: string;
    title?: string;
    summary?: string;
    sections: Array<{
      name: string;
      links: Array<{ title: string; url: string; description?: string }>;
    }>;
    hasFull: boolean;
    skillFile?: string;
  };
  /** User right-clicked a text selection and chose "Ask Horizon".
   *  Renderer opens AI panel and pre-populates the prompt. */
  'ai:askFromSelection': { selection: string; pageUrl: string; pageTitle: string };
  /** User interacted with an A2UI element. The agent receives a
   *  steering / prompt message describing the interaction so it can
   *  decide what to do next. */
  'ai:uiAction':
    | { kind: 'button'; surfaceId: string; label: string; action?: string }
    | { kind: 'input'; surfaceId: string; path?: string; placeholder?: string; value: string };
  /** Paste the given text into the active tab's currently-focused input,
   *  textarea, or contenteditable element. Returns whether a target was
   *  found and the text was applied. */
  'ai:pasteToPage': { text: string };
  /** Main → Renderer: the agent is about to run a tool that needs the
   *  user's nod (policy: 'risky' or 'all'). Renderer shows a prompt and
   *  replies via ai:actionDecide. */
  'ai:actionPrompt': { id: string; tool: string; args: Record<string, unknown>; summary: string };
  /** Renderer → Main: the user decided on a pending action prompt. */
  'ai:actionDecide': { id: string; allow: boolean };
  /** Translate the active tab's visible text into targetLang via headless Pi. */
  'translate:page': { targetLang: string };
  /** Roll back a previously-translated page to its original text. */
  'translate:restore': Record<string, never>;
  /** Cancel the current page translation in flight. */
  'translate:cancel': Record<string, never>;
  /** Translate a selected text snippet; returns the translation
   *  (used by the right-click "Translate selection" overlay). */
  'translate:selection': { text: string; targetLang: string };
  /** Main → Renderer: progress updates while a page translation runs. */
  'translate:progress': { translated: number; total: number; done: boolean };
  // Saved workflows.
  'workflow:list': Record<string, never>;
  'workflow:create': { name: string; prompt: string; attach: 'activeTab' | 'allTabs' | 'none' };
  'workflow:delete': { id: string };
}

type PermissionType = import('./browser').PermissionType;
type ContentSettingType = import('./browser').ContentSettingType;
