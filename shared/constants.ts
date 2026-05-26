export const APP_NAME = 'Horizon';
export const APP_VERSION = '1.0.0';

export const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  startupBehavior: 'restore' as const,
  startupPages: ['https://duckduckgo.com'],
  defaultSearchEngine: 'duckduckgo' as const,
  downloadPath: '', // resolved at runtime
  askWhereToSave: false,
  downloadNotifications: true,
  theme: 'system' as const,
  accentColor: '#1a73e8',
  showBookmarksBar: true,
  showStatusBar: true,
  fontSize: 16,
  minimumFontSize: 10,
  pageZoom: 1.0,
  blockThirdPartyCookies: true,
  clearDataOnExit: {
    history: false,
    cookies: false,
    cache: false,
    downloads: false,
    passwords: false,
    formData: false,
  },
  doNotTrack: false,
  defaultPermissions: {
    geolocation: 'block',
    camera: 'block',
    microphone: 'block',
    notifications: 'block',
    midi: 'block',
    midiSysex: 'block',
    pointerLock: 'ask',
    fullscreen: 'allow',
    openExternal: 'ask',
    'display-capture': 'block',
  } as const,
  permissionOverrides: {},
  contentSettings: {},
  autoHibernate: true,
  hibernationTimeoutMinutes: 30,
  maxActiveTabs: 20,
  confirmCloseMultipleTabs: true,
  hardwareAcceleration: true,
  smoothScrolling: true,
  proxyType: 'system' as const,
  proxyRules: undefined as string | undefined,
  spellcheck: true,
  spellcheckLanguages: ['en-US'],
  certificateOverrides: {},
  // ─── AI / Pi agent (POC) ─────────────────────────────────────────
  /** Master toggle for the Pi agent integration. */
  aiEnabled: false,
  /** Path or name of the `pi` binary; if not on $PATH, an absolute path. */
  aiPiBinary: 'pi',
  /** Extra flags passed to `pi`. Session persists across app restarts via aiSessionPath. */
  aiPiArgs: ['--mode', 'rpc'],
  /**
   * Pi session file paths captured automatically; used to resume the
   * conversation on the next app launch. Keyed by window kind so a
   * regular window doesn't accidentally resume an incognito chat.
   */
  aiSessions: {} as { default?: string; incognito?: string },
  /** When true, fetch /llms.txt of the active site and prepend as agent context. */
  aiUseLlmsTxt: true,
  /** Hard cap on tool-call iterations per agent turn (safety). */
  aiMaxIterations: 24,
  /** Spawn Pi at app startup (vs. lazily on first AI panel open). */
  aiSpawnOnStartup: true,
  /** Default target language for Translate Page / Translate Selection.
   *  Free-form so the user can write "Traditional Chinese", "Spanish", etc. */
  translateTargetLang: 'English',
  /** Max characters of page text per @-mention prepended to the prompt. */
  aiMentionMaxChars: 30_000,
};

export const SEARCH_ENGINES = {
  duckduckgo: {
    name: 'DuckDuckGo',
    url: 'https://duckduckgo.com/?q={query}',
    suggestUrl: 'https://duckduckgo.com/ac/?q={query}&type=list',
  },
  google: {
    name: 'Google',
    url: 'https://www.google.com/search?q={query}',
    suggestUrl: 'https://suggestqueries.google.com/complete/search?client=chrome&q={query}',
  },
  bing: {
    name: 'Bing',
    url: 'https://www.bing.com/search?q={query}',
  },
} as const satisfies Record<string, { name: string; url: string; suggestUrl?: string }>;

export type SearchEngineKey = keyof typeof SEARCH_ENGINES;
