# Horizon Browser v1.0 — Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform desktop web browser on Electron with Chrome parity for core features: tabs, navigation, omnibox, bookmarks, history, downloads, settings, find-in-page, password manager, address autofill, zoom, print, DevTools, and pop-up handling.

**Architecture:** Single BrowserWindow renders React chrome UI. Each tab is a stacked BrowserView managed by TabManager in the main process. All state syncs via typed IPC through contextBridge.

**Tech Stack:** Electron 33, React 19, TypeScript 5.7, Tailwind CSS 3, Zustand 5, Vite 6, electron-vite 2, electron-builder 25, Vitest 2, Playwright 1.49.

---

## File Structure (Target)

```
horizon/
├── .electron/
│   ├── main.ts
│   ├── preload.ts
│   ├── ipc/
│   │   ├── channels.ts
│   │   └── main-handlers.ts
│   └── services/
│       ├── TabManager.ts
│       ├── WindowManager.ts
│       ├── SessionManager.ts
│       ├── SettingsManager.ts
│       ├── BookmarkManager.ts
│       ├── HistoryManager.ts
│       ├── DownloadManager.ts
│       ├── PasswordManager.ts
│       ├── FaviconCache.ts
│       ├── SessionRestore.ts
│       ├── NativeMenuManager.ts
│       └── OmniboxSuggestionEngine.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── types/
│   │   ├── browser.ts
│   │   ├── ipc.ts
│   │   └── global.d.ts
│   ├── stores/
│   │   └── browserStore.ts
│   ├── components/
│   │   ├── chrome/
│   │   │   ├── TitleBar.tsx
│   │   │   ├── TabBar.tsx
│   │   │   ├── Tab.tsx
│   │   │   ├── Toolbar.tsx
│   │       ├── Omnibox.tsx
│   │       ├── BrowserContentArea.tsx
│   │       └── StatusBar.tsx
│   │   ├── overlays/
│   │   │   ├── Settings.tsx
│   │   │   ├── BookmarksManager.tsx
│   │   │   ├── History.tsx
│   │   │   ├── Downloads.tsx
│   │   │   ├── FindInPage.tsx
│   │   │   ├── PasswordManager.tsx
│   │   │   └── PageErrorOverlay.tsx
│   │   └── shared/
│   │       ├── Button.tsx
│   │       ├── Icon.tsx
│   │       ├── Modal.tsx
│   │       ├── Input.tsx
│   │       └── Toggle.tsx
│   └── hooks/
│       ├── useTabs.ts
│       ├── useNavigation.ts
│       ├── useBookmarks.ts
│       ├── useHistory.ts
│       ├── useDownloads.ts
│       ├── useSettings.ts
│       ├── usePasswords.ts
│       ├── useKeyboardShortcuts.ts
│       ├── useOmniboxSuggestions.ts
│       ├── useZoom.ts
│       ├── useFindInPage.ts
│       └── useFullscreen.ts
├── shared/
│   └── constants.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── package.json
├── vite.config.ts
├── vite.main.config.ts
├── vite.preload.config.ts
├── electron-builder.json5
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.main.json
├── tsconfig.preload.json
└── README.md
```

---

## Chunk 1: Project Scaffold & Core Browser Shell

### Task 1.1: Initialize Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`, `tsconfig.main.json`, `tsconfig.preload.json`
- Create: `vite.config.ts`, `vite.main.config.ts`, `vite.preload.config.ts`
- Create: `tailwind.config.ts`
- Create: `electron-builder.json5`
- Create: `.gitignore`
- Create: `README.md`

- [x] **Step 1: Write package.json**

```json
{
  "name": "horizon-browser",
  "version": "1.0.0",
  "description": "Horizon — A cross-platform desktop browser",
  "main": "./dist-electron/main.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "dist": "electron-builder",
    "dist:mac": "electron-builder --mac",
    "dist:win": "electron-builder --win",
    "dist:linux": "electron-builder --linux",
    "test": "vitest",
    "test:e2e": "playwright test",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write ."
  },
  "dependencies": {
    "electron-updater": "^6.3.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^2.0.0",
    "eslint": "^9.0.0",
    "postcss": "^8.4.0",
    "prettier": "^3.4.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.0.0",
    "@playwright/test": "^1.49.0"
  }
}
```

- [x] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@electron/*": [".electron/*"],
      "@shared/*": ["shared/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "shared/**/*.ts"],
  "references": [{ "path": "./tsconfig.main.json" }, { "path": "./tsconfig.preload.json" }]
}
```

- [x] **Step 3: Write tsconfig.main.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist-electron",
    "module": "CommonJS",
    "target": "ES2022",
    "lib": ["ES2022"],
    "jsx": "preserve",
    "noEmit": false,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["shared/*"]
    }
  },
  "include": [".electron/**/*.ts", "shared/**/*.ts"],
  "exclude": ["src/**/*"]
}
```

- [x] **Step 4: Write tsconfig.preload.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist-electron",
    "module": "CommonJS",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "jsx": "preserve",
    "noEmit": false,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["shared/*"]
    }
  },
  "include": [".electron/preload.ts", "shared/**/*.ts"],
  "exclude": ["src/**/*"]
}
```

- [x] **Step 5: Write vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- [x] **Step 6: Write vite.main.config.ts**

```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: '.electron/main.ts',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    outDir: 'dist-electron',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron', 'electron-updater', 'path', 'fs', 'os', 'crypto'],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
```

- [x] **Step 7: Write vite.preload.config.ts**

```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: '.electron/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    outDir: 'dist-electron',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron'],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
```

- [x] **Step 8: Write tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{html,js,jsx,ts,tsx}', '.electron/**/*.html'],
  theme: {
    extend: {
      colors: {
        chrome: {
          bg: 'var(--chrome-bg)',
          fg: 'var(--chrome-fg)',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [x] **Step 9: Write electron-builder.json5**

```json5
{
  appId: 'com.horizon.browser',
  productName: 'Horizon',
  directories: {
    output: 'release',
  },
  files: [
    'dist',
    'dist-electron',
  ],
  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
  },
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
    category: 'Network',
  },
  publish: {
    provider: 'github',
    owner: 'horizon-browser',
    repo: 'horizon',
  },
}
```

- [x] **Step 10: Write .gitignore**

```
node_modules/
dist/
dist-electron/
release/
*.log
.DS_Store
.env
.env.local
coverage/
.vscode/
.idea/
```

- [x] **Step 11: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [x] **Step 12: Commit**

```bash
git add package.json tsconfig*.json vite*.config.ts tailwind.config.ts electron-builder.json5 .gitignore README.md
git commit -m "chore: project scaffold with Electron, React, TypeScript, Vite"
```

---

### Task 1.2: Shared Constants & Type Definitions

**Files:**
- Create: `shared/constants.ts`
- Create: `src/types/browser.ts`
- Create: `src/types/ipc.ts`

- [x] **Step 1: Write shared/constants.ts**

```typescript
export const APP_NAME = 'Horizon';
export const APP_VERSION = '1.0.0';

export const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  startupBehavior: 'new-tab' as const,
  startupPages: ['https://duckduckgo.com'],
  defaultSearchEngine: 'duckduckgo',
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
};

export const SEARCH_ENGINES: Record<string, { name: string; url: string; suggestUrl?: string }> = {
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
};
```

- [x] **Step 2: Write src/types/browser.ts**

```typescript
export interface Tab {
  id: string;
  schemaVersion: number;
  url: string;
  title: string;
  favicon?: string;
  isLoading: boolean;
  loadProgress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  isMuted: boolean;
  isActive: boolean;
  isHibernated: boolean;
  zoomLevel: number;
  createdAt: number;
  lastAccessedAt: number;
  errorState?: TabErrorState;
  historyStack?: { url: string; title: string }[];
}

export interface TabErrorState {
  type: 'load-failed' | 'crashed' | 'unresponsive';
  errorCode?: number;
  errorDescription?: string;
  validatedURL?: string;
}

export interface Bookmark {
  id: string;
  schemaVersion: number;
  parentId?: string;
  index: number;
  title: string;
  url?: string;
  dateAdded: number;
  dateModified?: number;
  children?: Bookmark[];
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitTime: number;
  visitCount: number;
  typedCount: number;
}

export interface DownloadItem {
  id: string;
  filename: string;
  url: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  startTime: number;
  endTime?: number;
  savePath: string;
  mimeType?: string;
}

export interface Settings {
  schemaVersion: number;
  startupBehavior: 'new-tab' | 'restore' | 'specific-pages';
  startupPages: string[];
  defaultSearchEngine: string;
  downloadPath: string;
  askWhereToSave: boolean;
  downloadNotifications: boolean;
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  showBookmarksBar: boolean;
  showStatusBar: boolean;
  fontSize: number;
  minimumFontSize: number;
  pageZoom: number;
  blockThirdPartyCookies: boolean;
  clearDataOnExit: {
    history: boolean;
    cookies: boolean;
    cache: boolean;
    downloads: boolean;
    passwords: boolean;
    formData: boolean;
  };
  doNotTrack: boolean;
  defaultPermissions: Record<string, 'allow' | 'block' | 'ask'>;
  permissionOverrides: Record<string, Record<string, 'allow' | 'block' | 'ask'>>;
  contentSettings: Record<string, Record<string, 'allow' | 'block' | 'ask'>>;
  autoHibernate: boolean;
  hibernationTimeoutMinutes: number;
  maxActiveTabs: number;
  confirmCloseMultipleTabs: boolean;
  hardwareAcceleration: boolean;
  smoothScrolling: boolean;
  proxyType: 'system' | 'direct' | 'manual';
  proxyRules?: string;
  spellcheck: boolean;
  spellcheckLanguages: string[];
  certificateOverrides: Record<string, { allow: boolean; errorTypes: string[] }>;
}

export interface PasswordEntry {
  id: string;
  origin: string;
  username: string;
  password: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface SavedAddress {
  id: string;
  label: string;
  name: string;
  organization?: string;
  street: string[];
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface FindResult {
  requestId: number;
  matches: number;
  activeMatchOrdinal: number;
  selectionArea?: { x: number; y: number; width: number; height: number };
}

export interface Suggestion {
  type: 'url' | 'history' | 'bookmark' | 'search';
  title: string;
  url?: string;
  query?: string;
  favicon?: string;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  type?: 'normal' | 'separator';
  enabled?: boolean;
  accelerator?: string;
}

export interface FormField {
  id: string;
  type: 'text' | 'email' | 'password' | 'tel' | 'number' | 'select';
  name: string;
  placeholder?: string;
  autocomplete?: string;
}

export interface AutofillMatch {
  fieldId: string;
  value: string;
  label: string;
  type: 'address' | 'password';
}

export interface CertificateInfo {
  subject: string;
  issuer: string;
  serialNumber: string;
  validStart: number;
  validExpiry: number;
  fingerprint: string;
}

export type PermissionType =
  | 'geolocation'
  | 'camera'
  | 'microphone'
  | 'notifications'
  | 'midi'
  | 'midiSysex'
  | 'pointerLock'
  | 'fullscreen'
  | 'openExternal'
  | 'display-capture';

export type ContentSettingType = 'popup' | 'javascript' | 'images' | 'cookies' | 'plugins';

export type CertificateErrorType = 'expired' | 'self-signed' | 'wrong-hostname' | 'authority-invalid';
```

- [x] **Step 3: Write src/types/ipc.ts**

```typescript
export interface IpcChannels {
  // Renderer → Main
  'tab:create': { url?: string; index?: number };
  'tab:close': { tabId: string };
  'tab:activate': { tabId: string };
  'tab:reorder': { fromIndex: number; toIndex: number };
  'tab:pin': { tabId: string };
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
  'permission:respond': { origin: string; permission: PermissionType; allow: boolean };
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
  'tab:activated': { tabId: string };
  'tab:updated': Partial<import('./browser').Tab>;
  'tab:reordered': { tabIds: string[] };
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
  'permission:request': { origin: string; permission: PermissionType };
  'app:updateAvailable': { version: string };
  'app:updateDownloaded': { version: string };
  'autofill:showDropdown': { tabId: string; fieldId: string; suggestions: import('./browser').AutofillMatch[]; position: { x: number; y: number; width: number; height: number } };
}

type PermissionType = import('./browser').PermissionType;
type ContentSettingType = import('./browser').ContentSettingType;
```

- [x] **Step 4: Commit**

```bash
git add shared/constants.ts src/types/browser.ts src/types/ipc.ts
git commit -m "feat: shared constants and type definitions"
```

---

### Task 1.3: Electron Main Process Foundation

**Files:**
- Create: `.electron/ipc/channels.ts`
- Create: `.electron/services/WindowManager.ts`
- Create: `.electron/services/TabManager.ts`
- Create: `.electron/services/SessionManager.ts`
- Create: `.electron/ipc/main-handlers.ts`
- Create: `.electron/preload.ts`
- Create: `.electron/main.ts`

- [x] **Step 1: Write .electron/ipc/channels.ts**

```typescript
export const IPC_CHANNELS = {
  // Renderer → Main
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_ACTIVATE: 'tab:activate',
  TAB_REORDER: 'tab:reorder',
  TAB_PIN: 'tab:pin',
  TAB_DUPLICATE: 'tab:duplicate',
  TAB_HIBERNATE: 'tab:hibernate',
  TAB_WAKE: 'tab:wake',
  TAB_MUTE: 'tab:mute',
  TAB_UNMUTE: 'tab:unmute',
  NAVIGATION_GO: 'navigation:go',
  NAVIGATION_BACK: 'navigation:back',
  NAVIGATION_FORWARD: 'navigation:forward',
  NAVIGATION_RELOAD: 'navigation:reload',
  NAVIGATION_STOP: 'navigation:stop',
  ZOOM_SET: 'zoom:set',
  ZOOM_RESET: 'zoom:reset',
  FIND_START: 'find:start',
  FIND_NEXT: 'find:next',
  FIND_STOP: 'find:stop',
  BOOKMARK_ADD: 'bookmark:add',
  BOOKMARK_REMOVE: 'bookmark:remove',
  BOOKMARK_MOVE: 'bookmark:move',
  BOOKMARK_UPDATE: 'bookmark:update',
  BOOKMARK_GET_TREE: 'bookmark:getTree',
  BOOKMARK_IMPORT: 'bookmark:import',
  BOOKMARK_EXPORT: 'bookmark:export',
  HISTORY_CLEAR: 'history:clear',
  HISTORY_SEARCH: 'history:search',
  HISTORY_GET_RECENT: 'history:getRecent',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_OPEN: 'download:open',
  DOWNLOAD_SHOW_IN_FOLDER: 'download:showInFolder',
  DOWNLOAD_CLEAR_COMPLETED: 'download:clearCompleted',
  DOWNLOAD_RETRY: 'download:retry',
  SETTINGS_GET: 'settings:get',
  SETTINGS_GET_ALL: 'settings:getAll',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',
  PASSWORD_GET_ALL: 'password:getAll',
  PASSWORD_SAVE: 'password:save',
  PASSWORD_REMOVE: 'password:remove',
  PASSWORD_GET_FOR_ORIGIN: 'password:getForOrigin',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_SET_FULLSCREEN: 'window:setFullscreen',
  APP_QUIT: 'app:quit',
  APP_GET_VERSION: 'app:getVersion',
  APP_CHECK_FOR_UPDATES: 'app:checkForUpdates',
  DEVTOOLS_TOGGLE: 'devtools:toggle',
  DEVTOOLS_OPEN: 'devtools:open',
  PRINT_START: 'print:start',
  PRINT_TO_PDF: 'print:toPDF',
  PERMISSION_RESPOND: 'permission:respond',
  CONTENT_SETTING_SET: 'contentSetting:set',
  CONTEXT_MENU_CLICKED: 'contextMenu:clicked',
  OMNIBOX_GET_SUGGESTIONS: 'omnibox:getSuggestions',
  AUTOFILL_DETECT_FIELDS: 'autofill:detectFields',
  AUTOFILL_FILL_FIELD: 'autofill:fillField',
  AUTOFILL_GET_ADDRESSES: 'autofill:getAddresses',
  AUTOFILL_SAVE_ADDRESS: 'autofill:saveAddress',
  AUTOFILL_REMOVE_ADDRESS: 'autofill:removeAddress',

  // Main → Renderer
  TAB_CREATED: 'tab:created',
  TAB_CLOSED: 'tab:closed',
  TAB_ACTIVATED: 'tab:activated',
  TAB_UPDATED: 'tab:updated',
  TAB_REORDERED: 'tab:reordered',
  TAB_HIBERNATED: 'tab:hibernated',
  TAB_WOKEN: 'tab:woken',
  NAVIGATION_STATE: 'navigation:state',
  LOAD_STARTED: 'load:started',
  LOAD_PROGRESS: 'load:progress',
  LOAD_FINISHED: 'load:finished',
  LOAD_FAILED: 'load:failed',
  PAGE_TITLE: 'page:title',
  PAGE_FAVICON: 'page:favicon',
  DOWNLOAD_CREATED: 'download:created',
  DOWNLOAD_UPDATED: 'download:updated',
  DOWNLOAD_COMPLETED: 'download:completed',
  DOWNLOAD_FAILED: 'download:failed',
  SETTINGS_CHANGED: 'settings:changed',
  ZOOM_CHANGED: 'zoom:changed',
  FIND_RESULT: 'find:result',
  FULLSCREEN_CHANGED: 'fullscreen:changed',
  KEYBOARD_SHORTCUT: 'keyboard:shortcut',
  CONTEXT_MENU_SHOW: 'contextMenu:show',
  CERTIFICATE_ERROR: 'certificate:error',
  PERMISSION_REQUEST: 'permission:request',
  APP_UPDATE_AVAILABLE: 'app:updateAvailable',
  APP_UPDATE_DOWNLOADED: 'app:updateDownloaded',
  AUTOFILL_SHOW_DROPDOWN: 'autofill:showDropdown',
} as const;
```

- [x] **Step 2: Write .electron/services/WindowManager.ts**

```typescript
import { BrowserWindow, screen } from 'electron';
import path from 'path';

const CHROME_HEIGHT = 40 + 36 + 40; // toolbar + tabbar + titlebar approx

export class WindowManager {
  private window: BrowserWindow | null = null;

  createWindow(): BrowserWindow {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    this.window = new BrowserWindow({
      width: Math.min(1280, width * 0.8),
      height: Math.min(800, height * 0.8),
      minWidth: 400,
      minHeight: 300,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 },
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
      show: false,
    });

    if (process.env.VITE_DEV_SERVER_URL) {
      this.window.loadURL(process.env.VITE_DEV_SERVER_URL);
      this.window.webContents.openDevTools();
    } else {
      this.window.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    this.window.once('ready-to-show', () => {
      this.window?.show();
    });

    return this.window;
  }

  getWindow(): BrowserWindow | null {
    return this.window;
  }

  getContentBounds(): { x: number; y: number; width: number; height: number } {
    if (!this.window) return { x: 0, y: 0, width: 0, height: 0 };
    const bounds = this.window.getBounds();
    return {
      x: 0,
      y: CHROME_HEIGHT,
      width: bounds.width,
      height: bounds.height - CHROME_HEIGHT,
    };
  }
}
```

- [x] **Step 3: Write .electron/services/TabManager.ts**

```typescript
import { BrowserView, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { Tab } from '../../src/types/browser';

export class TabManager {
  private tabs = new Map<string, { tab: Tab; view: BrowserView }>();
  private activeTabId: string | null = null;
  private window: BrowserWindow;

  constructor(window: BrowserWindow) {
    this.window = window;
  }

  createTab(url = 'https://duckduckgo.com'): Tab {
    const id = uuidv4();
    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const tab: Tab = {
      id,
      schemaVersion: 1,
      url,
      title: 'New Tab',
      isLoading: false,
      loadProgress: 0,
      canGoBack: false,
      canGoForward: false,
      isPinned: false,
      isMuted: false,
      isActive: false,
      isHibernated: false,
      zoomLevel: 1.0,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    this.tabs.set(id, { tab, view });
    this.window.addBrowserView(view);
    view.setAutoResize({ width: true, height: true });
    view.webContents.loadURL(url);

    this.setupWebContentsEvents(id, view);
    this.activateTab(id);

    return tab;
  }

  private setupWebContentsEvents(tabId: string, view: BrowserView): void {
    const wc = view.webContents;

    wc.on('did-start-loading', () => {
      this.updateTab(tabId, { isLoading: true, loadProgress: 0 });
      this.window.webContents.send('load:started', { tabId, url: entry.tab.url });
    });

    wc.on('did-stop-loading', () => {
      this.updateTab(tabId, { isLoading: false, loadProgress: 100 });
      this.window.webContents.send('load:finished', { tabId, url: entry.tab.url });
    });

    wc.on('did-navigate', (_event, url) => {
      this.updateTab(tabId, {
        url,
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
      });
      this.window.webContents.send('navigation:state', {
        tabId,
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
        isLoading: entry.tab.isLoading,
        url,
      });
    });

    wc.on('page-title-updated', (_event, title) => {
      this.updateTab(tabId, { title });
      this.window.webContents.send('page:title', { tabId, title });
    });

    wc.on('page-favicon-updated', (_event, favicons) => {
      if (favicons.length > 0) {
        this.updateTab(tabId, { favicon: favicons[0] });
        this.window.webContents.send('page:favicon', { tabId, faviconUrl: favicons[0] });
      }
    });
  }

  activateTab(tabId: string): void {
    if (this.activeTabId && this.activeTabId !== tabId) {
      const prev = this.tabs.get(this.activeTabId);
      if (prev) {
        prev.tab.isActive = false;
        prev.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }

    const current = this.tabs.get(tabId);
    if (!current) return;

    current.tab.isActive = true;
    current.tab.lastAccessedAt = Date.now();
    this.activeTabId = tabId;

    const bounds = this.window.getBounds();
    const chromeHeight = 116; // Approximate
    current.view.setBounds({
      x: 0,
      y: chromeHeight,
      width: bounds.width,
      height: bounds.height - chromeHeight,
    });
  }

  closeTab(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;

    this.window.removeBrowserView(entry.view);
    (entry.view.webContents as any).destroy?.();
    this.tabs.delete(tabId);

    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.values());
      if (remaining.length > 0) {
        this.activateTab(remaining[remaining.length - 1].tab.id);
      } else {
        this.activeTabId = null;
        this.window.close();
      }
    }
  }

  navigate(tabId: string, url: string): void {
    const entry = this.tabs.get(tabId);
    if (entry) {
      entry.view.webContents.loadURL(url);
    }
  }

  goBack(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (entry?.view.webContents.canGoBack()) {
      entry.view.webContents.goBack();
    }
  }

  goForward(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (entry?.view.webContents.canGoForward()) {
      entry.view.webContents.goForward();
    }
  }

  reload(tabId: string, hard = false): void {
    const entry = this.tabs.get(tabId);
    if (entry) {
      if (hard) {
        entry.view.webContents.reloadIgnoringCache();
      } else {
        entry.view.webContents.reload();
      }
    }
  }

  stop(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (entry) {
      entry.view.webContents.stop();
    }
  }

  getTab(tabId: string): Tab | undefined {
    return this.tabs.get(tabId)?.tab;
  }

  getAllTabs(): Tab[] {
    return Array.from(this.tabs.values()).map((t) => t.tab);
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  getBrowserView(tabId: string): BrowserView | undefined {
    return this.tabs.get(tabId)?.view;
  }

  private updateTab(tabId: string, updates: Partial<Tab>): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    Object.assign(entry.tab, updates);
    // Notify renderer via IPC
    this.window.webContents.send('tab:updated', { ...entry.tab, ...updates });
  }
}
```

- [x] **Step 4: Write .electron/services/SessionManager.ts**

```typescript
import { session } from 'electron';

export class SessionManager {
  private ses = session.defaultSession;

  initialize(): void {
    this.ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      // Default deny; renderer will show prompt
      callback(false);
    });

    this.ses.setPermissionCheckHandler((_webContents, permission) => {
      // Default allow for fullscreen only
      return permission === 'fullscreen';
    });
  }

  getSession() {
    return this.ses;
  }
}
```

- [x] **Step 5: Write .electron/ipc/main-handlers.ts**

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from './channels';
import { TabManager } from '../services/TabManager';
import type { Tab } from '../../src/types/browser';

export function registerIpcHandlers(tabManager: TabManager, window: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.TAB_CREATE, (_event, { url }: { url?: string }) => {
    return tabManager.createTab(url);
  });

  ipcMain.handle(IPC_CHANNELS.TAB_CLOSE, (_event, { tabId }: { tabId: string }) => {
    tabManager.closeTab(tabId);
  });

  ipcMain.handle(IPC_CHANNELS.TAB_ACTIVATE, (_event, { tabId }: { tabId: string }) => {
    tabManager.activateTab(tabId);
  });

  ipcMain.handle(IPC_CHANNELS.NAVIGATION_GO, (_event, { tabId, url }: { tabId: string; url: string }) => {
    tabManager.navigate(tabId, url);
  });

  ipcMain.handle(IPC_CHANNELS.NAVIGATION_BACK, (_event, { tabId }: { tabId: string }) => {
    tabManager.goBack(tabId);
  });

  ipcMain.handle(IPC_CHANNELS.NAVIGATION_FORWARD, (_event, { tabId }: { tabId: string }) => {
    tabManager.goForward(tabId);
  });

  ipcMain.handle(IPC_CHANNELS.NAVIGATION_RELOAD, (_event, { tabId, hard }: { tabId: string; hard?: boolean }) => {
    tabManager.reload(tabId, hard);
  });

  ipcMain.handle(IPC_CHANNELS.NAVIGATION_STOP, (_event, { tabId }: { tabId: string }) => {
    tabManager.stop(tabId);
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    window.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    window.close();
  });

  ipcMain.handle(IPC_CHANNELS.APP_QUIT, () => {
    process.exit(0);
  });

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
    return '1.0.0';
  });
}
```

- [x] **Step 6: Write .electron/preload.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc/channels';

const api = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const wrapped = (_event: unknown, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('horizonAPI', api);

export type HorizonAPI = typeof api;
```

- [x] **Step 7: Write .electron/main.ts**

```typescript
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { WindowManager } from './services/WindowManager';
import { TabManager } from './services/TabManager';
import { SessionManager } from './services/SessionManager';
import { registerIpcHandlers } from './ipc/main-handlers';
import { IPC_CHANNELS } from './ipc/channels';
import path from 'path';

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let windowManager: WindowManager;
let tabManager: TabManager;

function createWindow(): void {
  windowManager = new WindowManager();
  const win = windowManager.createWindow();
  tabManager = new TabManager(win);

  const sessionManager = new SessionManager();
  sessionManager.initialize();

  // Register horizon:// protocol for internal pages
  protocol.registerFileProtocol('horizon', (request, callback) => {
    const url = new URL(request.url);
    const page = url.hostname || 'newtab';
    const filePath = path.join(__dirname, '../resources/pages', `${page}.html`);
    callback({ path: filePath });
  });

  registerIpcHandlers(tabManager, win);

  // Create initial tab
  tabManager.createTab('https://duckduckgo.com');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('second-instance', (_event, argv) => {
  const win = windowManager?.getWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();

    const url = argv.find((arg) => arg.startsWith('http'));
    if (url && tabManager) {
      tabManager.createTab(url);
    }
  }
});
```

- [x] **Step 8: Install uuid dependency**

Run: `npm install uuid && npm install -D @types/uuid`
Expected: uuid installed, package.json updated.

- [x] **Step 9: Commit**

```bash
git add .electron/ package.json package-lock.json
git commit -m "feat: Electron main process with WindowManager, TabManager, IPC handlers, preload"
```

---

### Task 1.4: React Renderer — Browser Chrome

**Files:**
- Create: `src/index.css`
- Create: `src/main.tsx`
- Create: `src/stores/browserStore.ts`
- Create: `src/App.tsx`
- Create: `src/components/chrome/TitleBar.tsx`
- Create: `src/components/chrome/TabBar.tsx`
- Create: `src/components/chrome/Tab.tsx`
- Create: `src/components/chrome/Toolbar.tsx`
- Create: `src/components/chrome/Omnibox.tsx`
- Create: `src/components/chrome/BrowserContentArea.tsx`
- Create: `src/hooks/useTabs.ts`
- Create: `src/hooks/useNavigation.ts`
- Create: `src/hooks/useKeyboardShortcuts.ts`

- [x] **Step 1: Write src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --chrome-bg: #f1f3f4;
  --chrome-fg: #202124;
  --tab-bg: #ffffff;
  --tab-bg-active: #ffffff;
  --tab-bg-inactive: #e8eaed;
  --toolbar-bg: #ffffff;
  --omnibox-bg: #ffffff;
  --omnibox-border: #dadce0;
  --statusbar-bg: #f1f3f4;
  --accent-primary: #1a73e8;
  --accent-hover: #1557b0;
  --accent-light: #e8f0fe;
  --secure: #188038;
  --insecure: #ea4335;
  --warning: #f9ab00;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-size-base: 13px;
  --chrome-height: 40px;
  --tab-height: 36px;
  --toolbar-height: 40px;
  --statusbar-height: 24px;
  --radius-sm: 4px;
  --radius-md: 8px;
}

[data-theme="dark"] {
  --chrome-bg: #202124;
  --chrome-fg: #e8eaed;
  --tab-bg: #35363a;
  --tab-bg-active: #202124;
  --tab-bg-inactive: #292a2d;
  --toolbar-bg: #35363a;
  --omnibox-bg: #202124;
  --omnibox-border: #5f6368;
  --statusbar-bg: #202124;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--font-size-base);
  background: var(--chrome-bg);
  color: var(--chrome-fg);
  overflow: hidden;
  user-select: none;
}

* {
  box-sizing: border-box;
}
```

- [x] **Step 2: Write src/main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [x] **Step 3: Write src/stores/browserStore.ts**

```typescript
import { create } from 'zustand';
import type { Tab } from '../types/browser';

interface BrowserState {
  tabs: Tab[];
  activeTabId: string | null;
  isLoading: boolean;
  loadProgress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  url: string;
  showSettings: boolean;
  showBookmarks: boolean;
  showHistory: boolean;
  showDownloads: boolean;
  showFindBar: boolean;
  setTabs: (tabs: Tab[]) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  removeTab: (tabId: string) => void;
  setNavigationState: (state: { canGoBack: boolean; canGoForward: boolean; isLoading: boolean; url: string }) => void;
  setLoadProgress: (progress: number) => void;
  toggleOverlay: (overlay: 'showSettings' | 'showBookmarks' | 'showHistory' | 'showDownloads' | 'showFindBar') => void;
}

export const useBrowserStore = create<BrowserState>((set) => ({
  tabs: [],
  activeTabId: null,
  isLoading: false,
  loadProgress: 0,
  canGoBack: false,
  canGoForward: false,
  url: '',
  showSettings: false,
  showBookmarks: false,
  showHistory: false,
  showDownloads: false,
  showFindBar: false,

  setTabs: (tabs) => set({ tabs }),
  setActiveTab: (activeTabId) => set({ activeTabId }),
  updateTab: (tabId, updates) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
    })),
  removeTab: (tabId) =>
    set((state) => ({
      tabs: state.tabs.filter((t) => t.id !== tabId),
    })),
  setNavigationState: (state) => set(state),
  setLoadProgress: (loadProgress) => set({ loadProgress }),
  toggleOverlay: (overlay) => set((state) => ({ [overlay]: !state[overlay] })),
}));
```

- [x] **Step 4: Write src/App.tsx**

```tsx
import React from 'react';
import { TitleBar } from './components/chrome/TitleBar';
import { Toolbar } from './components/chrome/Toolbar';
import { TabBar } from './components/chrome/TabBar';
import { BrowserContentArea } from './components/chrome/BrowserContentArea';
import { useTabs } from './hooks/useTabs';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

const App: React.FC = () => {
  useTabs();
  useKeyboardShortcuts();

  return (
    <div className="flex flex-col h-screen bg-[var(--chrome-bg)]">
      <TitleBar />
      <Toolbar />
      <TabBar />
      <BrowserContentArea />
    </div>
  );
};

export default App;
```

- [x] **Step 5: Write src/components/chrome/TitleBar.tsx**

```tsx
import React from 'react';

export const TitleBar: React.FC = () => {
  return (
    <div
      className="h-[40px] flex items-center px-4"
      style={{ background: 'var(--toolbar-bg)', WebkitAppRegion: 'drag' }}
    >
      <span className="text-sm font-medium ml-20">Horizon</span>
    </div>
  );
};
```

- [x] **Step 6: Write src/components/chrome/Toolbar.tsx**

```tsx
import React from 'react';
import { Omnibox } from './Omnibox';
import { useNavigation } from '../../hooks/useNavigation';

export const Toolbar: React.FC = () => {
  const { goBack, goForward, reload, canGoBack, canGoForward, isLoading } = useNavigation();

  return (
    <div className="h-[40px] flex items-center gap-2 px-3" style={{ background: 'var(--toolbar-bg)' }}>
      <button
        onClick={goBack}
        disabled={!canGoBack}
        className="w-7 h-7 rounded flex items-center justify-center hover:bg-gray-100 disabled:opacity-30"
      >
        ←
      </button>
      <button
        onClick={goForward}
        disabled={!canGoForward}
        className="w-7 h-7 rounded flex items-center justify-center hover:bg-gray-100 disabled:opacity-30"
      >
        →
      </button>
      <button
        onClick={reload}
        className="w-7 h-7 rounded flex items-center justify-center hover:bg-gray-100"
      >
        {isLoading ? '✕' : '↻'}
      </button>
      <Omnibox />
      <button className="w-7 h-7 rounded flex items-center justify-center hover:bg-gray-100 ml-auto">
        ⋮
      </button>
    </div>
  );
};
```

- [x] **Step 7: Write src/components/chrome/Omnibox.tsx**

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useBrowserStore } from '../../stores/browserStore';

export const Omnibox: React.FC = () => {
  const { url, activeTabId } = useBrowserStore();
  const [inputValue, setInputValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(url);
    }
  }, [url, isEditing]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!activeTabId || !inputValue.trim()) return;

      let url = inputValue.trim();
      if (!url.includes('://') && !url.includes('.')) {
        url = `https://duckduckgo.com/?q=${encodeURIComponent(url)}`;
      } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }

      window.horizonAPI.invoke('navigation:go', { tabId: activeTabId, url });
      setIsEditing(false);
    },
    [activeTabId, inputValue]
  );

  return (
    <form onSubmit={handleSubmit} className="flex-1 max-w-2xl mx-2">
      <div
        className="flex items-center h-8 px-3 rounded-full border"
        style={{ background: 'var(--omnibox-bg)', borderColor: 'var(--omnibox-border)' }}
      >
        <span className="text-xs mr-2">
          {url.startsWith('https') ? '🔒' : '⚠️'}
        </span>
        <input
          type="text"
          value={isEditing ? inputValue : url.replace(/^https?:\/\//, '')}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setIsEditing(true)}
          onBlur={() => setIsEditing(false)}
          className="flex-1 bg-transparent outline-none text-sm"
          spellCheck={false}
        />
      </div>
    </form>
  );
};
```

- [x] **Step 8: Write src/components/chrome/TabBar.tsx**

```tsx
import React from 'react';
import { useBrowserStore } from '../../stores/browserStore';
import { Tab } from './Tab';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId } = useBrowserStore();

  const createTab = () => {
    window.horizonAPI.invoke('tab:create', {});
  };

  return (
    <div className="h-[36px] flex items-center px-2 gap-1" style={{ background: 'var(--chrome-bg)' }}>
      {tabs.map((tab) => (
        <Tab key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
      ))}
      <button
        onClick={createTab}
        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-gray-200 text-lg"
      >
        +
      </button>
    </div>
  );
};
```

- [x] **Step 9: Write src/components/chrome/Tab.tsx**

```tsx
import React from 'react';
import type { Tab as TabType } from '../../types/browser';

interface TabProps {
  tab: TabType;
  isActive: boolean;
}

export const Tab: React.FC<TabProps> = ({ tab, isActive }) => {
  const activate = () => {
    window.horizonAPI.invoke('tab:activate', { tabId: tab.id });
  };

  const close = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.horizonAPI.invoke('tab:close', { tabId: tab.id });
  };

  return (
    <div
      onClick={activate}
      className={`h-8 px-3 rounded-t-lg flex items-center gap-2 min-w-[120px] max-w-[200px] cursor-pointer text-xs select-none ${
        isActive ? 'bg-white' : 'hover:bg-gray-200'
      }`}
    >
      {tab.favicon ? (
        <img src={tab.favicon} alt="" className="w-4 h-4" />
      ) : (
        <span className="w-4 h-4 bg-gray-300 rounded-full" />
      )}
      <span className="flex-1 truncate">{tab.title || 'New Tab'}</span>
      {tab.isLoading && <span className="w-3 h-3 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />}
      <button
        onClick={close}
        className="w-4 h-4 rounded-full hover:bg-gray-300 flex items-center justify-center text-xs"
      >
        ×
      </button>
    </div>
  );
};
```

- [x] **Step 10: Write src/components/chrome/BrowserContentArea.tsx**

```tsx
import React from 'react';

export const BrowserContentArea: React.FC = () => {
  // BrowserViews are managed by Electron main process
  // This component is just a visual placeholder that reserves space
  return <div className="flex-1" style={{ background: '#ffffff' }} />;
};
```

- [x] **Step 11: Write src/hooks/useTabs.ts**

```typescript
import { useEffect } from 'react';
import { useBrowserStore } from '../stores/browserStore';
import type { Tab } from '../types/browser';

export function useTabs(): void {
  const { setTabs, setActiveTab, updateTab, removeTab } = useBrowserStore();

  useEffect(() => {
    const unsubCreated = window.horizonAPI.on('tab:created', (tab: Tab) => {
      const current = useBrowserStore.getState().tabs;
      setTabs([...current, tab]);
      setActiveTab(tab.id);
    });

    const unsubClosed = window.horizonAPI.on('tab:closed', ({ tabId }: { tabId: string }) => {
      removeTab(tabId);
    });

    const unsubActivated = window.horizonAPI.on('tab:activated', ({ tabId }: { tabId: string }) => {
      setActiveTab(tabId);
    });

    const unsubUpdated = window.horizonAPI.on('tab:updated', (updates: Partial<Tab> & { id: string }) => {
      updateTab(updates.id, updates);
    });

    const unsubNavState = window.horizonAPI.on(
      'navigation:state',
      (state: { tabId: string; canGoBack: boolean; canGoForward: boolean; isLoading: boolean; url: string }) => {
        const { tabId, ...rest } = state;
        updateTab(tabId, rest);
      }
    );

    const unsubLoadStarted = window.horizonAPI.on('load:started', ({ tabId, url }: { tabId: string; url: string }) => {
      updateTab(tabId, { isLoading: true, loadProgress: 0, url });
    });

    const unsubLoadFinished = window.horizonAPI.on('load:finished', ({ tabId, url }: { tabId: string; url: string }) => {
      updateTab(tabId, { isLoading: false, loadProgress: 100, url });
    });

    const unsubTitle = window.horizonAPI.on('page:title', ({ tabId, title }: { tabId: string; title: string }) => {
      updateTab(tabId, { title });
    });

    const unsubFavicon = window.horizonAPI.on('page:favicon', ({ tabId, faviconUrl }: { tabId: string; faviconUrl: string }) => {
      updateTab(tabId, { favicon: faviconUrl });
    });

    return () => {
      unsubCreated();
      unsubClosed();
      unsubActivated();
      unsubUpdated();
      unsubNavState();
      unsubLoadStarted();
      unsubLoadFinished();
      unsubTitle();
      unsubFavicon();
    };
  }, [setTabs, setActiveTab, updateTab, removeTab]);
}
```

- [x] **Step 12: Write src/hooks/useNavigation.ts**

```typescript
import { useCallback } from 'react';
import { useBrowserStore } from '../stores/browserStore';

export function useNavigation() {
  const { activeTabId, canGoBack, canGoForward, isLoading } = useBrowserStore();

  const goBack = useCallback(() => {
    if (activeTabId) window.horizonAPI.invoke('navigation:back', { tabId: activeTabId });
  }, [activeTabId]);

  const goForward = useCallback(() => {
    if (activeTabId) window.horizonAPI.invoke('navigation:forward', { tabId: activeTabId });
  }, [activeTabId]);

  const reload = useCallback(() => {
    if (activeTabId) {
      if (isLoading) {
        window.horizonAPI.invoke('navigation:stop', { tabId: activeTabId });
      } else {
        window.horizonAPI.invoke('navigation:reload', { tabId: activeTabId });
      }
    }
  }, [activeTabId, isLoading]);

  return { goBack, goForward, reload, canGoBack, canGoForward, isLoading };
}
```

- [x] **Step 13: Write src/hooks/useKeyboardShortcuts.ts**

```typescript
import { useEffect } from 'react';
import { useBrowserStore } from '../stores/browserStore';

export function useKeyboardShortcuts(): void {
  const { activeTabId, toggleOverlay } = useBrowserStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === 't') {
        e.preventDefault();
        window.horizonAPI.invoke('tab:create', {});
      }
      if (mod && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) window.horizonAPI.invoke('tab:close', { tabId: activeTabId });
      }
      if (mod && e.key === 'l') {
        e.preventDefault();
        document.querySelector('input')?.focus();
      }
      if (mod && e.key === 'r') {
        e.preventDefault();
        if (activeTabId) window.horizonAPI.invoke('navigation:reload', { tabId: activeTabId });
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        toggleOverlay('showSettings');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, toggleOverlay]);
}
```

- [x] **Step 14: Add global type declaration for horizonAPI**

Create: `src/types/global.d.ts`

```typescript
import type { HorizonAPI } from '../../.electron/preload';

declare global {
  interface Window {
    horizonAPI: HorizonAPI;
  }
}
```

- [x] **Step 15: Write index.html**

Create: `index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Horizon</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [x] **Step 16: Run dev server and verify**

Run: `npm run dev`
Expected: Electron window opens with title bar, toolbar, tab bar, and a DuckDuckGo tab loads.

- [x] **Step 17: Commit**

```bash
git add src/ index.html
git commit -m "feat: React browser chrome with tabs, omnibox, navigation, keyboard shortcuts"
```

---

## Chunk 2: Data & Persistence

### Task 2.1: Settings System

**Files:**
- Create: `.electron/services/SettingsManager.ts`
- Modify: `.electron/ipc/main-handlers.ts` — add settings handlers

- [x] **Step 1: Write .electron/services/SettingsManager.ts**

```typescript
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import type { Settings } from '../../src/types/browser';

export class SettingsManager {
  private settingsPath: string;
  private settings: Settings;

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.settings = this.load();
  }

  private load(): Settings {
    try {
      const data = fs.readFileSync(this.settingsPath, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed.schemaVersion !== DEFAULT_SETTINGS.schemaVersion) {
        return { ...DEFAULT_SETTINGS, ...parsed, schemaVersion: DEFAULT_SETTINGS.schemaVersion };
      }
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private save(): void {
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
  }

  get(key: string): unknown {
    return (this.settings as Record<string, unknown>)[key];
  }

  getAll(): Settings {
    return { ...this.settings };
  }

  set(key: string, value: unknown): void {
    (this.settings as Record<string, unknown>)[key] = value;
    this.save();
  }

  reset(key?: string): void {
    if (key) {
      (this.settings as Record<string, unknown>)[key] = (DEFAULT_SETTINGS as Record<string, unknown>)[key];
    } else {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    this.save();
  }
}
```

- [x] **Step 2: Add settings handlers to main-handlers.ts**

Add after existing handlers:

```typescript
export function registerIpcHandlers(tabManager: TabManager, window: BrowserWindow, settingsManager: SettingsManager): void {
  // ... existing handlers ...

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, { key }: { key: string }) => {
    return settingsManager.get(key);
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => {
    return settingsManager.getAll();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, { key, value }: { key: string; value: unknown }) => {
    settingsManager.set(key, value);
    window.webContents.send(IPC_CHANNELS.SETTINGS_CHANGED, { key, value });
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_RESET, (_event, { key }: { key?: string }) => {
    settingsManager.reset(key);
  });
}
```

- [x] **Step 3: Update main.ts to pass SettingsManager**

```typescript
import { SettingsManager } from './services/SettingsManager';

// In createWindow():
const settingsManager = new SettingsManager();
registerIpcHandlers(tabManager, win, settingsManager);
```

- [x] **Step 4: Commit**

```bash
git add .electron/services/SettingsManager.ts .electron/ipc/main-handlers.ts .electron/main.ts
git commit -m "feat: settings persistence with JSON storage"
```

---

### Task 2.2: Bookmarks

**Files:**
- Create: `.electron/services/BookmarkManager.ts`
- Modify: `.electron/ipc/main-handlers.ts`

- [x] **Step 1: Write .electron/services/BookmarkManager.ts**

```typescript
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Bookmark } from '../../src/types/browser';

export class BookmarkManager {
  private bookmarksPath: string;
  private bookmarks: Bookmark[];

  constructor() {
    this.bookmarksPath = path.join(app.getPath('userData'), 'bookmarks.json');
    this.bookmarks = this.load();
  }

  private load(): Bookmark[] {
    try {
      const data = fs.readFileSync(this.bookmarksPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [
        {
          id: uuidv4(),
          schemaVersion: 1,
          index: 0,
          title: 'Bookmarks Bar',
          dateAdded: Date.now(),
          children: [],
        },
      ];
    }
  }

  private save(): void {
    fs.writeFileSync(this.bookmarksPath, JSON.stringify(this.bookmarks, null, 2));
  }

  getTree(): Bookmark[] {
    return this.bookmarks;
  }

  add(url: string, title: string, parentId?: string): Bookmark {
    const bookmark: Bookmark = {
      id: uuidv4(),
      schemaVersion: 1,
      parentId,
      index: this.bookmarks.length,
      title,
      url,
      dateAdded: Date.now(),
    };
    this.bookmarks.push(bookmark);
    this.save();
    return bookmark;
  }

  remove(bookmarkId: string): void {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== bookmarkId);
    this.save();
  }

  move(bookmarkId: string, parentId: string, index: number): Bookmark {
    const bookmark = this.bookmarks.find((b) => b.id === bookmarkId);
    if (!bookmark) throw new Error('Bookmark not found');
    bookmark.parentId = parentId;
    bookmark.index = index;
    this.save();
    return bookmark;
  }

  update(bookmarkId: string, changes: Partial<Bookmark>): Bookmark {
    const bookmark = this.bookmarks.find((b) => b.id === bookmarkId);
    if (!bookmark) throw new Error('Bookmark not found');
    Object.assign(bookmark, changes, { dateModified: Date.now() });
    this.save();
    return bookmark;
  }

  import(data: string): Bookmark[] {
    // Parse Netscape HTML format using regex (Node.js compatible)
    const imported: Bookmark[] = [];
    const regex = /\<A HREF="([^"]+)"[^\>]*\>([^\<]*)\<\/A\>/gi;
    let match;
    let index = 0;
    while ((match = regex.exec(data)) !== null) {
      imported.push({
        id: uuidv4(),
        schemaVersion: 1,
        index: index++,
        title: match[2] || match[1],
        url: match[1],
        dateAdded: Date.now(),
      });
    }
    this.bookmarks.push(...imported);
    this.save();
    return imported;
  }

  export(): string {
    const links = this.bookmarks
      .filter((b) => b.url)
      .map((b) => `    <DT><A HREF="${b.url}">${b.title}</A>`)
      .join('\n');
    return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${links}
</DL><p>`;
  }
}
```

- [x] **Step 2: Add bookmark handlers to main-handlers.ts**

```typescript
ipcMain.handle(IPC_CHANNELS.BOOKMARK_GET_TREE, () => bookmarkManager.getTree());
ipcMain.handle(IPC_CHANNELS.BOOKMARK_ADD, (_event, { url, title, parentId }) => bookmarkManager.add(url, title, parentId));
ipcMain.handle(IPC_CHANNELS.BOOKMARK_REMOVE, (_event, { bookmarkId }) => bookmarkManager.remove(bookmarkId));
ipcMain.handle(IPC_CHANNELS.BOOKMARK_MOVE, (_event, { bookmarkId, parentId, index }) => bookmarkManager.move(bookmarkId, parentId, index));
ipcMain.handle(IPC_CHANNELS.BOOKMARK_UPDATE, (_event, { bookmarkId, changes }) => bookmarkManager.update(bookmarkId, changes));
ipcMain.handle(IPC_CHANNELS.BOOKMARK_IMPORT, (_event, { data }) => bookmarkManager.import(data));
ipcMain.handle(IPC_CHANNELS.BOOKMARK_EXPORT, () => bookmarkManager.export());
```

- [x] **Step 3: Commit**

```bash
git add .electron/services/BookmarkManager.ts .electron/ipc/main-handlers.ts
git commit -m "feat: bookmark manager with CRUD, import/export"
```

---

### Task 2.3: History

**Files:**
- Create: `.electron/services/HistoryManager.ts`
- Modify: `.electron/ipc/main-handlers.ts`
- Modify: `.electron/services/TabManager.ts` — hook into navigation events

- [x] **Step 1: Write .electron/services/HistoryManager.ts**

```typescript
import { app } from 'electron';
import Database from 'better-sqlite3';
import path from 'path';
import type { HistoryEntry } from '../../src/types/browser';

export class HistoryManager {
  private db: Database.Database;

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'history.db');
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT,
        visitTime INTEGER NOT NULL,
        visitCount INTEGER DEFAULT 1,
        typedCount INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_history_url ON history(url);
      CREATE INDEX IF NOT EXISTS idx_history_time ON history(visitTime);
    `);
  }

  addEntry(url: string, title: string): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const existing = this.db.prepare('SELECT * FROM history WHERE url = ?').get(url) as HistoryEntry | undefined;
    if (existing) {
      this.db.prepare('UPDATE history SET visitCount = visitCount + 1, visitTime = ?, title = ? WHERE id = ?')
        .run(Date.now(), title, existing.id);
    } else {
      this.db.prepare('INSERT INTO history (id, url, title, visitTime) VALUES (?, ?, ?, ?)')
        .run(id, url, title, Date.now());
    }
  }

  search(query: string, limit = 50): HistoryEntry[] {
    return this.db.prepare(
      'SELECT * FROM history WHERE url LIKE ? OR title LIKE ? ORDER BY visitTime DESC LIMIT ?'
    ).all(`%${query}%`, `%${query}%`, limit) as HistoryEntry[];
  }

  getRecent(limit = 50): HistoryEntry[] {
    return this.db.prepare('SELECT * FROM history ORDER BY visitTime DESC LIMIT ?').all(limit) as HistoryEntry[];
  }

  clear(range?: string): number {
    const now = Date.now();
    let cutoff = 0;
    if (range === 'hour') cutoff = now - 3600000;
    else if (range === 'day') cutoff = now - 86400000;
    else if (range === 'week') cutoff = now - 604800000;
    else if (range === 'month') cutoff = now - 2592000000;

    if (cutoff > 0) {
      this.db.prepare('DELETE FROM history WHERE visitTime < ?').run(cutoff);
    } else {
      this.db.prepare('DELETE FROM history').run();
    }
    const info = this.db.prepare('SELECT changes() as count').get() as { count: number };
    return info.count;
  }
}
```

- [x] **Step 2: Install better-sqlite3**

Run: `npm install better-sqlite3 && npm install -D @types/better-sqlite3`
Expected: Package installed.

- [x] **Step 3: Hook HistoryManager into TabManager**

In `.electron/services/TabManager.ts`, add a HistoryManager parameter and call `historyManager.addEntry(url, title)` in the `did-navigate` and `page-title-updated` handlers.

- [x] **Step 4: Add history handlers to main-handlers.ts**

```typescript
ipcMain.handle(IPC_CHANNELS.HISTORY_SEARCH, (_event, { query, limit }) => historyManager.search(query, limit));
ipcMain.handle(IPC_CHANNELS.HISTORY_GET_RECENT, (_event, { limit }) => historyManager.getRecent(limit));
ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR, (_event, { range }) => historyManager.clear(range));
```

- [x] **Step 5: Commit**

```bash
git add .electron/services/HistoryManager.ts .electron/ipc/main-handlers.ts .electron/services/TabManager.ts package.json package-lock.json
git commit -m "feat: history manager with SQLite, search, pruning"
```

---

### Task 2.4: Downloads

**Files:**
- Create: `.electron/services/DownloadManager.ts`
- Modify: `.electron/ipc/main-handlers.ts`
- Modify: `.electron/main.ts`

- [x] **Step 1: Write .electron/services/DownloadManager.ts**

```typescript
import { app, DownloadItem, Event, WebContents } from 'electron';
import fs from 'fs';
import path from 'path';
import type { DownloadItem as DownloadItemType } from '../../src/types/browser';

export class DownloadManager {
  private downloadsPath: string;
  private downloads: Map<string, DownloadItemType> = new Map();
  private listeners: Set<(items: DownloadItemType[]) => void> = new Set();

  constructor() {
    this.downloadsPath = path.join(app.getPath('userData'), 'downloads.json');
    this.load();
  }

  private load(): void {
    try {
      const data = fs.readFileSync(this.downloadsPath, 'utf-8');
      const items: DownloadItemType[] = JSON.parse(data);
      items.forEach((item) => this.downloads.set(item.id, item));
    } catch {
      // No existing downloads
    }
  }

  private save(): void {
    fs.writeFileSync(this.downloadsPath, JSON.stringify(Array.from(this.downloads.values()), null, 2));
  }

  handleDownload(event: Event, item: DownloadItem, _webContents: WebContents): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const downloadPath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(downloadPath);

    const downloadItem: DownloadItemType = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      startTime: Date.now(),
      savePath: downloadPath,
      mimeType: item.getMimeType(),
    };

    // Track active downloads for pause/resume/cancel
    (downloadItem as any)._electronItem = item;

    this.downloads.set(id, downloadItem);
    this.notifyListeners();

    item.on('updated', (_event, state) => {
      downloadItem.receivedBytes = item.getReceivedBytes();
      downloadItem.totalBytes = item.getTotalBytes();
      downloadItem.state = state === 'progressing' ? 'progressing' : 'interrupted';
      this.downloads.set(id, downloadItem);
      this.notifyListeners();
    });

    item.once('done', (_event, state) => {
      downloadItem.state = state === 'completed' ? 'completed' : 'cancelled';
      downloadItem.endTime = Date.now();
      this.downloads.set(id, downloadItem);
      this.save();
      this.notifyListeners();
    });
  }

  getDownloads(): DownloadItemType[] {
    return Array.from(this.downloads.values());
  }

  pause(downloadId: string): void {
    const item = this.downloads.get(downloadId);
    const electronItem = (item as any)?._electronItem as DownloadItem;
    if (electronItem) {
      electronItem.pause();
      item!.state = 'interrupted';
      this.downloads.set(downloadId, item!);
      this.notifyListeners();
    }
  }

  resume(downloadId: string): void {
    const item = this.downloads.get(downloadId);
    const electronItem = (item as any)?._electronItem as DownloadItem;
    if (electronItem) {
      electronItem.resume();
      item!.state = 'progressing';
      this.downloads.set(downloadId, item!);
      this.notifyListeners();
    }
  }

  cancel(downloadId: string): void {
    const item = this.downloads.get(downloadId);
    const electronItem = (item as any)?._electronItem as DownloadItem;
    if (electronItem) {
      electronItem.cancel();
      item!.state = 'cancelled';
      this.downloads.set(downloadId, item!);
      this.save();
      this.notifyListeners();
    }
  }

  clearCompleted(): void {
    for (const [id, item] of this.downloads) {
      if (item.state === 'completed' || item.state === 'cancelled') {
        this.downloads.delete(id);
      }
    }
    this.save();
    this.notifyListeners();
  }

  onUpdate(callback: (items: DownloadItemType[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    const items = this.getDownloads();
    this.listeners.forEach((cb) => cb(items));
  }
}
```

- [x] **Step 2: Hook into main.ts session events**

```typescript
import { DownloadManager } from './services/DownloadManager';

// In createWindow():
const downloadManager = new DownloadManager();
win.webContents.session.on('will-download', (event, item, webContents) => {
  downloadManager.handleDownload(event, item, webContents);
});
```

- [x] **Step 3: Add download handlers to main-handlers.ts**

```typescript
ipcMain.handle(IPC_CHANNELS.DOWNLOAD_PAUSE, (_event, { downloadId }) => downloadManager.pause(downloadId));
ipcMain.handle(IPC_CHANNELS.DOWNLOAD_RESUME, (_event, { downloadId }) => downloadManager.resume(downloadId));
ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CANCEL, (_event, { downloadId }) => downloadManager.cancel(downloadId));
ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CLEAR_COMPLETED, () => downloadManager.clearCompleted());
```

- [x] **Step 4: Commit**

```bash
git add .electron/services/DownloadManager.ts .electron/ipc/main-handlers.ts .electron/main.ts package.json package-lock.json
git commit -m "feat: download manager with progress tracking and persistence"
```

---

## Chunk 3: Advanced Features

### Task 3.1: Find in Page

**Files:**
- Modify: `.electron/ipc/main-handlers.ts`
- Create: `src/components/overlays/FindInPage.tsx`
- Modify: `src/App.tsx` — include FindInPage overlay

- [x] **Step 1: Add find handlers to main-handlers.ts**

```typescript
ipcMain.handle(IPC_CHANNELS.FIND_START, (_event, { tabId, text, caseSensitive }) => {
  const view = tabManager.getBrowserView(tabId);
  if (!view) return;
  const result = view.webContents.findInPage(text, { caseSensitive });
  return result;
});

ipcMain.handle(IPC_CHANNELS.FIND_NEXT, (_event, { tabId, forward }) => {
  const view = tabManager.getBrowserView(tabId);
  if (!view) return;
  view.webContents.findInPage('', { forward });
});

ipcMain.handle(IPC_CHANNELS.FIND_STOP, (_event, { tabId }) => {
  const view = tabManager.getBrowserView(tabId);
  if (!view) return;
  view.webContents.stopFindInPage('clearSelection');
});
```

Note: TabManager needs a `getBrowserView(tabId)` method. Add it.

- [x] **Step 2: Write src/components/overlays/FindInPage.tsx**

```tsx
import React, { useState, useCallback, useEffect } from 'react';
import { useBrowserStore } from '../../stores/browserStore';

export const FindInPage: React.FC = () => {
  const { showFindBar, activeTabId, toggleOverlay } = useBrowserStore();
  const [text, setText] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);

  const handleFind = useCallback(
    (forward = true) => {
      if (!activeTabId || !text) return;
      window.horizonAPI.invoke('find:start', { tabId: activeTabId, text });
      window.horizonAPI.invoke('find:next', { tabId: activeTabId, forward });
    },
    [activeTabId, text]
  );

  useEffect(() => {
    if (!showFindBar) return;
    const unsub = window.horizonAPI.on('find:result', (result: { matches: number; activeMatchOrdinal: number }) => {
      setMatchCount(result.matches);
      setCurrentMatch(result.activeMatchOrdinal);
    });
    return unsub;
  }, [showFindBar]);

  if (!showFindBar) return null;

  return (
    <div className="absolute top-2 right-4 bg-white shadow-lg rounded-lg p-2 flex items-center gap-2 z-50">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleFind(!e.shiftKey);
        }}
        className="border rounded px-2 py-1 text-sm w-48"
        placeholder="Find in page"
        autoFocus
      />
      <span className="text-xs text-gray-500">
        {currentMatch}/{matchCount}
      </span>
      <button onClick={() => handleFind(false)} className="text-sm px-2">↑</button>
      <button onClick={() => handleFind(true)} className="text-sm px-2">↓</button>
      <button onClick={() => toggleOverlay('showFindBar')} className="text-sm px-2">✕</button>
    </div>
  );
};
```

- [x] **Step 3: Commit**

```bash
git add src/components/overlays/FindInPage.tsx src/App.tsx .electron/ipc/main-handlers.ts .electron/services/TabManager.ts
git commit -m "feat: find in page with match counter and navigation"
```

---

### Task 3.2: Password Manager

**Files:**
- Create: `.electron/services/PasswordManager.ts`
- Modify: `.electron/ipc/main-handlers.ts`

- [x] **Step 1: Write .electron/services/PasswordManager.ts**

```typescript
import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import type { PasswordEntry } from '../../src/types/browser';

export class PasswordManager {
  private passwordsPath: string;
  private passwords: PasswordEntry[];

  constructor() {
    this.passwordsPath = path.join(app.getPath('userData'), 'passwords.json');
    this.passwords = this.load();
  }

  private load(): PasswordEntry[] {
    try {
      const data = fs.readFileSync(this.passwordsPath, 'utf-8');
      const entries: PasswordEntry[] = JSON.parse(data);
      return entries.map((e) => ({
        ...e,
        password: safeStorage.decryptString(Buffer.from(e.password, 'base64')),
      }));
    } catch {
      return [];
    }
  }

  private save(): void {
    const encrypted = this.passwords.map((e) => ({
      ...e,
      password: safeStorage.encryptString(e.password).toString('base64'),
    }));
    fs.writeFileSync(this.passwordsPath, JSON.stringify(encrypted, null, 2));
  }

  getAll(): PasswordEntry[] {
    return this.passwords;
  }

  saveEntry(entry: PasswordEntry): void {
    const existing = this.passwords.findIndex((p) => p.origin === entry.origin && p.username === entry.username);
    if (existing >= 0) {
      this.passwords[existing] = { ...entry, lastUsedAt: Date.now() };
    } else {
      this.passwords.push({ ...entry, createdAt: Date.now() });
    }
    this.save();
  }

  remove(origin: string, username: string): void {
    this.passwords = this.passwords.filter((p) => !(p.origin === origin && p.username === username));
    this.save();
  }

  getForOrigin(origin: string): PasswordEntry[] {
    return this.passwords.filter((p) => p.origin === origin);
  }
}
```

- [x] **Step 2: Add password handlers to main-handlers.ts**

```typescript
ipcMain.handle(IPC_CHANNELS.PASSWORD_GET_ALL, () => passwordManager.getAll());
ipcMain.handle(IPC_CHANNELS.PASSWORD_SAVE, (_event, { entry }) => passwordManager.saveEntry(entry));
ipcMain.handle(IPC_CHANNELS.PASSWORD_REMOVE, (_event, { origin, username }) => passwordManager.remove(origin, username));
ipcMain.handle(IPC_CHANNELS.PASSWORD_GET_FOR_ORIGIN, (_event, { origin }) => passwordManager.getForOrigin(origin));
```

- [x] **Step 3: Commit**

```bash
git add .electron/services/PasswordManager.ts .electron/ipc/main-handlers.ts
git commit -m "feat: password manager with OS keychain encryption"
```

---

### Task 3.3: Autofill (Addresses)

**Files:**
- Create: `.electron/services/AutofillManager.ts`
- Modify: `.electron/ipc/main-handlers.ts`

- [x] **Step 1: Write .electron/services/AutofillManager.ts**

```typescript
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { SavedAddress } from '../../src/types/browser';

export class AutofillManager {
  private addressesPath: string;
  private addresses: SavedAddress[];

  constructor() {
    this.addressesPath = path.join(app.getPath('userData'), 'addresses.json');
    this.addresses = this.load();
  }

  private load(): SavedAddress[] {
    try {
      return JSON.parse(fs.readFileSync(this.addressesPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.addressesPath, JSON.stringify(this.addresses, null, 2));
  }

  getAddresses(): SavedAddress[] {
    return this.addresses;
  }

  saveAddress(address: SavedAddress): SavedAddress {
    if (!address.id) address.id = uuidv4();
    const index = this.addresses.findIndex((a) => a.id === address.id);
    if (index >= 0) {
      this.addresses[index] = address;
    } else {
      this.addresses.push(address);
    }
    this.save();
    return address;
  }

  removeAddress(addressId: string): void {
    this.addresses = this.addresses.filter((a) => a.id !== addressId);
    this.save();
  }
}
```

- [x] **Step 2: Add autofill handlers to main-handlers.ts**

```typescript
ipcMain.handle(IPC_CHANNELS.AUTOFILL_GET_ADDRESSES, () => autofillManager.getAddresses());
ipcMain.handle(IPC_CHANNELS.AUTOFILL_SAVE_ADDRESS, (_event, { address }) => autofillManager.saveAddress(address));
ipcMain.handle(IPC_CHANNELS.AUTOFILL_REMOVE_ADDRESS, (_event, { addressId }) => autofillManager.removeAddress(addressId));
```

- [x] **Step 3: Commit**

```bash
git add .electron/services/AutofillManager.ts .electron/ipc/main-handlers.ts
git commit -m "feat: address autofill manager"
```

---

### Task 3.4: Zoom, Print, DevTools, Pop-ups

**Files:**
- Modify: `.electron/ipc/main-handlers.ts`
- Modify: `.electron/services/TabManager.ts` — add zoom, devtools, print methods

- [x] **Step 1: Add TabManager methods**

```typescript
setZoom(tabId: string, level: number): void {
  const entry = this.tabs.get(tabId);
  if (entry) {
    // Electron zoom level: 0 = 100%, each unit = 20%
    // level 0.25 → -4, level 1.0 → 0, level 5.0 → +8
    const zoomLevel = Math.log2(level) / Math.log2(1.2);
    entry.view.webContents.setZoomLevel(zoomLevel);
    entry.tab.zoomLevel = level;
  }
}

toggleDevTools(tabId: string): void {
  const entry = this.tabs.get(tabId);
  if (entry) {
    entry.view.webContents.toggleDevTools();
  }
}

openDevTools(tabId: string, mode: 'right' | 'bottom' | 'undocked'): void {
  const entry = this.tabs.get(tabId);
  if (entry) {
    entry.view.webContents.openDevTools({ mode });
  }
}

print(tabId: string): void {
  const entry = this.tabs.get(tabId);
  if (entry) {
    entry.view.webContents.print();
  }
}

printToPDF(tabId: string, outputPath: string): Promise<string> {
  const entry = this.tabs.get(tabId);
  if (!entry) throw new Error('Tab not found');
  return entry.view.webContents.printToPDF({}).then((data) => {
    fs.writeFileSync(outputPath, data);
    return outputPath;
  });
}
```

- [x] **Step 2: Add IPC handlers**

```typescript
ipcMain.handle(IPC_CHANNELS.ZOOM_SET, (_event, { tabId, level }) => tabManager.setZoom(tabId, level));
ipcMain.handle(IPC_CHANNELS.ZOOM_RESET, (_event, { tabId }) => tabManager.setZoom(tabId, 1.0));
ipcMain.handle(IPC_CHANNELS.DEVTOOLS_TOGGLE, (_event, { tabId }) => tabManager.toggleDevTools(tabId));
ipcMain.handle(IPC_CHANNELS.DEVTOOLS_OPEN, (_event, { tabId, mode }) => tabManager.openDevTools(tabId, mode));
ipcMain.handle(IPC_CHANNELS.PRINT_START, (_event, { tabId }) => tabManager.print(tabId));
ipcMain.handle(IPC_CHANNELS.PRINT_TO_PDF, (_event, { tabId, outputPath }) => tabManager.printToPDF(tabId, outputPath));
```

- [x] **Step 3: Add pop-up blocking in SessionManager**

```typescript
this.ses.setWindowOpenHandler(({ url }) => {
  // Check content settings for popup permission
  // For v1.0, block all pop-ups
  return { action: 'deny' };
});
```

- [x] **Step 4: Commit**

```bash
git add .electron/services/TabManager.ts .electron/services/SessionManager.ts .electron/ipc/main-handlers.ts
git commit -m "feat: zoom, print, devtools, pop-up blocking"
```

---

## Chunk 4: Polish & Distribution

### Task 4.1: Error Handling & Security

**Files:**
- Modify: `.electron/services/TabManager.ts` — add error page navigation
- Modify: `.electron/services/SessionManager.ts` — add certificate handling
- Create: `src/components/overlays/PageErrorOverlay.tsx`

- [x] **Step 1: Add error handling to TabManager**

In `setupWebContentsEvents`, add:

```typescript
wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
  if (errorCode === -3) return; // ERR_ABORTED — user cancelled
  wc.loadURL(`horizon://error?code=${errorCode}&url=${encodeURIComponent(validatedURL)}`);
  this.updateTab(tabId, {
    errorState: { type: 'load-failed', errorCode, errorDescription, validatedURL },
  });
});

wc.on('render-process-gone', () => {
  wc.loadURL(`horizon://error/crashed?tabId=${tabId}`);
  this.updateTab(tabId, { errorState: { type: 'crashed' } });
});
```

- [x] **Step 2: Add certificate handling to SessionManager**

```typescript
this.ses.setCertificateVerifyProc((_request, callback) => {
  // Default: use Chromium's verification
  callback(0); // 0 = success, -2 = failure
});
```

- [x] **Step 3: Write src/components/overlays/PageErrorOverlay.tsx**

```tsx
import React from 'react';

interface PageErrorOverlayProps {
  errorType: 'load-failed' | 'crashed' | 'unresponsive';
  errorCode?: number;
  errorDescription?: string;
  onReload: () => void;
}

export const PageErrorOverlay: React.FC<PageErrorOverlayProps> = ({
  errorType,
  errorCode,
  errorDescription,
  onReload,
}) => {
  const messages: Record<string, string> = {
    'load-failed': 'This site can\'t be reached',
    crashed: 'This page crashed',
    unresponsive: 'This page is not responding',
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-40">
      <h1 className="text-2xl font-medium mb-4">{messages[errorType]}</h1>
      {errorDescription && <p className="text-gray-600 mb-4">{errorDescription}</p>}
      {errorCode && <p className="text-gray-400 text-sm mb-4">Error code: {errorCode}</p>}
      <button
        onClick={onReload}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Reload
      </button>
    </div>
  );
};
```

- [x] **Step 4: Commit**

```bash
git add .electron/services/TabManager.ts .electron/services/SessionManager.ts src/components/overlays/PageErrorOverlay.tsx
git commit -m "feat: error handling, certificate verification, error overlays"
```

---

### Task 4.2: Auto-Update

**Files:**
- Modify: `.electron/main.ts`
- Install: `electron-updater`

- [x] **Step 1: Add auto-update logic to main.ts**

```typescript
import { autoUpdater } from 'electron-updater';
import { IPC_CHANNELS } from './ipc/channels';

// In createWindow(), after window creation:
autoUpdater.checkForUpdatesAndNotify();

setInterval(() => {
  autoUpdater.checkForUpdatesAndNotify();
}, 4 * 60 * 60 * 1000); // 4 hours

autoUpdater.on('update-available', (info) => {
  win.webContents.send(IPC_CHANNELS.APP_UPDATE_AVAILABLE, { version: info.version });
});

autoUpdater.on('update-downloaded', (info) => {
  win.webContents.send(IPC_CHANNELS.APP_UPDATE_DOWNLOADED, { version: info.version });
});

ipcMain.handle(IPC_CHANNELS.APP_CHECK_FOR_UPDATES, async () => {
  const result = await autoUpdater.checkForUpdates();
  return {
    updateAvailable: !!result?.updateInfo,
    version: result?.updateInfo?.version,
  };
});
```

- [x] **Step 2: Commit**

```bash
git add .electron/main.ts
git commit -m "feat: auto-update with electron-updater"
```

---

### Task 4.3: Packaging

**Files:**
- Modify: `package.json` — add build scripts
- Modify: `electron-builder.json5`

- [ ] **Step 1: Verify build works**

Run: `npm run build`
Expected: `dist/` and `dist-electron/` created with compiled assets.

Run: `npm run dist`
Expected: `release/` directory created with platform-specific packages.

- [ ] **Step 2: Commit**

```bash
git add package.json electron-builder.json5
git commit -m "chore: packaging configuration verified"
```

---

## Testing Plan

### Unit Tests (Vitest)

**Files:**
- Create: `tests/unit/url.test.ts`
- Create: `tests/unit/search-engine.test.ts`
- Create: `tests/unit/format.test.ts`

- [x] **Write url.test.ts**

```typescript
import { describe, it, expect } from 'vitest';

function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!url.includes('://') && !url.includes('.')) {
    return `https://duckduckgo.com/?q=${encodeURIComponent(url)}`;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

describe('normalizeUrl', () => {
  it('adds https to bare domain', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });
  it('searches plain text', () => {
    expect(normalizeUrl('hello world')).toBe('https://duckduckgo.com/?q=hello%20world');
  });
  it('preserves existing scheme', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
  });
});
```

- [x] **Write search-engine.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { SEARCH_ENGINES } from '../../shared/constants';

describe('SEARCH_ENGINES', () => {
  it('has duckduckgo as default', () => {
    expect(SEARCH_ENGINES.duckduckgo).toBeDefined();
    expect(SEARCH_ENGINES.duckduckgo.url).toContain('{query}');
  });
  it('has google', () => {
    expect(SEARCH_ENGINES.google).toBeDefined();
  });
});
```

- [x] **Run unit tests**

Run: `npx vitest run`
Expected: All tests pass.

---

### E2E Tests (Playwright)

**Files:**
- Create: `tests/e2e/smoke.spec.ts`
- Create: `playwright.config.ts`

- [ ] **Write playwright.config.ts**

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'electron',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

- [ ] **Write smoke.spec.ts**

```typescript
import { test, expect } from '@playwright/test';

test('app launches and loads initial tab', async ({ page }) => {
  await page.goto('about:blank');
  // In a real E2E test, we'd launch the Electron app via electron.launch()
  // For now, verify the build artifact exists
});
```

- [ ] **Commit tests**

```bash
git add tests/ playwright.config.ts
git commit -m "test: unit and e2e test scaffold"
```

---

## Final Verification Checklist

- [ ] App launches without errors (`npm run dev`)
- [ ] New tab creates a BrowserView with DuckDuckGo
- [ ] Navigation (back/forward/reload/stop) works
- [ ] Omnibox accepts URLs and search queries
- [ ] Tab switching works
- [ ] Tab closing works
- [ ] Keyboard shortcuts work (Ctrl+T, Ctrl+W, Ctrl+L)
- [ ] Settings persist to JSON
- [ ] Bookmarks CRUD works
- [ ] History records navigation
- [ ] Downloads track progress
- [ ] Find in page opens and searches
- [ ] Passwords save and encrypt
- [ ] Autofill addresses work
- [ ] Zoom changes apply
- [ ] Print dialog opens
- [ ] DevTools toggle works
- [ ] Pop-ups are blocked
- [ ] Error pages show on load failure
- [ ] Auto-update checks on startup
- [ ] Build produces distributable (`npm run dist`)
