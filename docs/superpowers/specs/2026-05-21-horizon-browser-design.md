# Horizon Browser — Design Specification

> **Status:** Draft  
> **Date:** 2026-05-21  
> **Scope:** v1.0 — Cross-platform desktop browser with Chrome parity (no extensions, no sync)

---

## 1. Overview

**Horizon** is a cross-platform desktop web browser built on Electron, targeting true Chromium rendering parity with a custom-branded UI. It delivers core browser functionality—tabs, navigation, bookmarks, history, downloads, settings, find-in-page, password manager, autofill, and media controls—without the backend complexity of extensions or cloud sync.

**Target Platforms:** macOS, Windows, Linux  
**Target Timeline:** 3–6 months for v1.0  

---

## 2. Goals

1. **Chrome Parity (Rendering):** Use true Chromium via Electron's `BrowserView` for 100% web compatibility.
2. **Chrome-Inspired UX:** Familiar tab bar, omnibox, and navigation patterns with custom visual identity.
3. **Cross-Platform:** Native packaging (DMG, EXE, AppImage/Deb/RPM) from a single codebase.
4. **Privacy by Design:** Block third-party cookies by default, configurable permission model, no telemetry.
5. **Extensible Foundation:** Architecture that allows extensions (v2) and sync (v2+) without rewriting core.

---

## 3. Non-Goals (v1.0)

- WebExtension / Chrome extension support
- Cloud sync (bookmarks, history, passwords across devices)
- Built-in translation (can use web-based alternatives)
- PWA installation support
- Mobile platforms (iOS/Android)
- Custom rendering engine or off-screen compositing

---

## 4. Architecture

### 4.1 Process Model

```
┌─────────────────────────────────────────────────────────────┐
│  MAIN PROCESS (Node.js)                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ Window  │ │ Tab     │ │ Session │ │ Native  │          │
│  │ Manager │ │ Manager │ │ Manager │ │ Menu    │          │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘          │
│       └────────────┴───────────┴───────────┘                │
│                      ↑ IPC (preload.ts)                     │
├─────────────────────────────────────────────────────────────┤
│  RENDERER PROCESS (React + TypeScript)                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐  │
│  │ TabBar  │ │ Toolbar │ │ Omnibox │ │ Overlay Panels  │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ BrowserContentArea (placeholder for BrowserViews)   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ↓
              ┌───────────────────────┐
              │   BrowserView(s)      │
              │   (Chromium engine)   │
              └───────────────────────┘
```

### 4.2 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| BrowserView vs. webview tag | `BrowserView` | Better performance, true multi-tab isolation, closer to Chrome's model |
| Single window + stacked BrowserViews | Yes | Fastest dev velocity; used by Arc, Brave, and most Electron browsers |
| React for chrome UI | Yes | Largest ecosystem, best hiring pool, component model fits browser chrome |
| Zustand for state | Yes | Lightweight, no boilerplate, works well with IPC-synced state |
| Vite for build | Yes | Fast HMR, fast production builds, native ESM |
| electron-builder for packaging | Yes | Mature, supports all target platforms, auto-updater integration |
| No custom protocol handler for web content | Yes | Use `https://`, `http://`, `file://` natively; `horizon://` for internal pages only |

---

## 5. Project Structure

```
horizon/
├── .electron/                          # Electron main-process code
│   ├── main.ts                         # Entry point: app lifecycle, window creation
│   ├── preload.ts                      # contextBridge: typed IPC API surface
│   ├── ipc/
│   │   ├── channels.ts                 # IPC channel name constants + TypeScript types
│   │   ├── main-handlers.ts            # Main-process IPC handler registry
│   │   └── renderer-api.ts             # Renderer-side typed IPC wrapper
│   ├── services/
│   │   ├── TabManager.ts               # BrowserView lifecycle: create/destroy/switch/hibernate
│   │   ├── SessionManager.ts           # Cookies, cache, storage partitions, protocol handlers
│   │   ├── WindowManager.ts            # BrowserWindow lifecycle, bounds, fullscreen
│   │   ├── DownloadManager.ts          # Download tracking, progress, file operations
│   │   ├── HistoryManager.ts           # History recording, search, pruning
│   │   ├── BookmarkManager.ts          # Bookmark CRUD, tree structure
│   │   ├── SettingsManager.ts          # Settings persistence, defaults, validation
│   │   ├── PasswordManager.ts          # Saved passwords, auto-fill integration
│   │   ├── OmniboxSuggestionEngine.ts  # URL completion, search suggestions
│   │   ├── NativeMenuManager.ts        # OS-native menus, global shortcuts
│   │   ├── FaviconCache.ts             # Favicon fetching, caching, disk storage
│   │   ├── SessionRestore.ts           # Crash recovery, session save/restore
│   │   └── SecurityManager.ts          # Certificate handling, permission policies
│   └── utils/
│       ├── protocol-handlers.ts        # custom://, file:// restrictions
│       └── security-policies.ts        # CSP headers, permission defaults
│
├── src/                                # Renderer React app (browser chrome)
│   ├── main.tsx                        # React entry point
│   ├── App.tsx                         # Root component: layout, overlays, global listeners
│   ├── index.css                       # Tailwind base + CSS custom properties (themes)
│   ├── types/
│   │   ├── browser.ts                  # Tab, NavigationState, Bookmark, HistoryEntry, etc.
│   │   ├── settings.ts                 # Settings schema, categories
│   │   └── ipc.ts                      # IPC message payload types
│   ├── components/
│   │   ├── chrome/
│   │   │   ├── TitleBar.tsx            # macOS traffic lights / Windows title bar
│   │   │   ├── TabBar.tsx              # Tab strip container (scroll, overflow, new-tab)
│   │   │   ├── Tab.tsx                 # Single tab: favicon, title, close, pin, drag
│   │   │   ├── Toolbar.tsx             # Back/Forward/Reload/Home/Menu buttons
│   │   │   ├── Omnibox.tsx             # Address bar: URL display, editing, suggestions
│   │   │   ├── BrowserContentArea.tsx  # Bounds management for BrowserView embedding
│   │   │   └── StatusBar.tsx           # Bottom bar: loading, zoom, SSL, offline indicator
│   │   ├── overlays/
│   │   │   ├── Settings.tsx            # Settings panel (slide-in or modal)
│   │   │   ├── BookmarksManager.tsx    # Bookmark tree + search + editor
│   │   │   ├── History.tsx             # History list + date grouping + search + clear
│   │   │   ├── Downloads.tsx           # Download list + progress + actions
│   │   │   ├── FindInPage.tsx          # Find bar: input, prev/next, match count
│   │   │   ├── PasswordManager.tsx     # Saved passwords list + search + delete
│   │   │   ├── AutofillDropdown.tsx    # Omnibox dropdown for address/password fill
│   │   │   ├── PageErrorOverlay.tsx    # Error page: crash, unresponsive, load fail
│   │   │   ├── CertificateInfo.tsx     # SSL certificate details popup
│   │   │   └── About.tsx               # About Horizon: version, credits, updates
│   │   └── shared/
│   │       ├── Button.tsx              # Consistent button component
│   │       ├── Icon.tsx                # SVG icon wrapper with sizing/color props
│   │       ├── Modal.tsx               # Accessible modal dialog
│   │       ├── Dropdown.tsx            # Accessible dropdown menu
│   │       ├── Input.tsx               # Styled input with validation states
│   │       ├── Toggle.tsx              # Toggle switch for settings
│   │       ├── Slider.tsx              # Range slider for zoom, font size
│   │       └── Skeleton.tsx            # Loading skeleton placeholder
│   ├── hooks/
│   │   ├── useTabs.ts                  # Tab state, CRUD, activation
│   │   ├── useNavigation.ts            # Back/forward/refresh/canGo state
│   │   ├── useBookmarks.ts             # Bookmark CRUD, tree operations
│   │   ├── useHistory.ts               # History query, search, clear
│   │   ├── useDownloads.ts             # Download list, progress, actions
│   │   ├── useSettings.ts              # Settings read/write, change listeners
│   │   ├── usePasswords.ts             # Password list, auto-fill triggers
│   │   ├── useKeyboardShortcuts.ts     # Global shortcut registration (Ctrl+T, Ctrl+W, etc.)
│   │   ├── useOmniboxSuggestions.ts    # Suggestion engine: history + bookmarks + search
│   │   ├── useZoom.ts                  # Zoom level get/set
│   │   ├── useFindInPage.ts            # Find session management
│   │   ├── useFullscreen.ts            # Fullscreen state + toggle
│   │   └── useOnlineStatus.ts          # Online/offline detection
│   ├── stores/
│   │   └── browserStore.ts             # Zustand: global browser state (tabs, active, overlays)
│   └── utils/
│       ├── url.ts                      # URL parsing, normalization, validation
│       ├── favicon.ts                  # Favicon data URL caching helpers
│       ├── search-engine.ts            # Search engine config, query building
│       ├── theme.ts                    # Light/dark/system detection, accent colors
│       └── format.ts                   # File size, date, duration formatting
│
├── shared/                             # Shared between main and renderer
│   └── constants.ts                    # App name, version, default settings, search engines
│
├── resources/                          # Static app resources (not bundled by Vite)
│   ├── icons/                          # App icon (icns, ico, png sizes)
│   ├── locales/                        # i18n translation files (future)
│   └── themes/                         # Theme CSS overrides
│
├── build/                              # Build & packaging configuration
│   ├── entitlements.mac.plist          # macOS entitlements
│   ├── entitlements.mac.inherit.plist  # macOS child process entitlements
│   └── scripts/                        # Build helper scripts
│
├── tests/
│   ├── unit/                           # Vitest unit tests (no Electron)
│   ├── integration/                    # Vitest integration tests (mocked Electron)
│   └── e2e/                            # Playwright E2E tests (full Electron)
│
├── vite.config.ts                      # Vite renderer build config
├── vite.main.config.ts                 # Vite main-process build config
├── vite.preload.config.ts              # Vite preload build config
├── electron-builder.json5              # Packaging: targets, signing, auto-update
├── tailwind.config.ts                  # Tailwind theme extensions
├── tsconfig.json                       # TypeScript root config
├── tsconfig.main.json                  # TypeScript main-process config
├── tsconfig.preload.json               # TypeScript preload config
├── package.json
└── README.md
```

---

## 6. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Electron | Chromium runtime | ^33.0.0 |
| React | UI framework | ^19.0.0 |
| TypeScript | Language | ^5.7.0 |
| Tailwind CSS | Styling | ^3.4.0 |
| Zustand | State management | ^5.0.0 |
| Vite | Build tool | ^6.0.0 |
| electron-vite | Electron + Vite integration | ^2.0.0 |
| electron-builder | Packaging & distribution | ^25.0.0 |
| Vitest | Unit/integration testing | ^2.0.0 |
| Playwright | E2E testing | ^1.49.0 |
| ESLint | Linting | ^9.0.0 |
| Prettier | Code formatting | ^3.4.0 |

---

## 7. Data Flow & IPC Contract

### 7.1 IPC Architecture

All communication between main and renderer flows through `preload.ts` using `contextBridge.exposeInMainWorld`. No `nodeIntegration`, `contextIsolation: true`.

```
Renderer                              Main
─────────────────────────────────────────────────────────
window.horizonAPI.invoke(channel, data)
         │                                    │
         └──────────→ ipcMain.handle() ──────┘
                        process, return
         ←─────────── send() / return ───────┘
         │
window.horizonAPI.on(channel, callback)
```

### 7.2 Renderer → Main (invoke)

| Channel | Payload | Returns | Description |
|---------|---------|---------|-------------|
| `tab:create` | `{ url?: string, index?: number }` | `Tab` | Create new tab |
| `tab:close` | `{ tabId: string }` | `void` | Close tab |
| `tab:activate` | `{ tabId: string }` | `void` | Switch to tab |
| `tab:reorder` | `{ fromIndex: number, toIndex: number }` | `void` | Reorder tabs |
| `tab:pin` | `{ tabId: string }` | `Tab` | Toggle pin state |
| `tab:duplicate` | `{ tabId: string }` | `Tab` | Duplicate tab |
| `tab:hibernate` | `{ tabId: string }` | `void` | Free tab memory |
| `tab:wake` | `{ tabId: string }` | `void` | Restore hibernated tab |
| `tab:mute` | `{ tabId: string }` | `void` | Mute tab audio |
| `tab:unmute` | `{ tabId: string }` | `void` | Unmute tab audio |
| `navigation:go` | `{ tabId: string, url: string }` | `void` | Navigate to URL |
| `navigation:back` | `{ tabId: string }` | `void` | Go back |
| `navigation:forward` | `{ tabId: string }` | `void` | Go forward |
| `navigation:reload` | `{ tabId: string, hard?: boolean }` | `void` | Reload page |
| `navigation:stop` | `{ tabId: string }` | `void` | Stop loading |
| `zoom:set` | `{ tabId: string, level: number }` | `number` | Set zoom (0.25–5.0) |
| `zoom:reset` | `{ tabId: string }` | `number` | Reset zoom to 1.0 |
| `find:start` | `{ tabId: string, text: string }` | `FindResult` | Start find |
| `find:next` | `{ tabId: string, forward?: boolean }` | `FindResult` | Find next/prev |
| `find:stop` | `{ tabId: string }` | `void` | Stop find session |
| `bookmark:add` | `{ url: string, title: string, parentId?: string }` | `Bookmark` | Add bookmark |
| `bookmark:remove` | `{ bookmarkId: string }` | `void` | Remove bookmark |
| `bookmark:move` | `{ bookmarkId: string, parentId: string, index: number }` | `Bookmark` | Move bookmark |
| `bookmark:update` | `{ bookmarkId: string, changes: Partial<Bookmark> }` | `Bookmark` | Edit bookmark |
| `bookmark:getTree` | `{}` | `Bookmark[]` | Get full tree |
| `history:clear` | `{ range?: 'all' \| 'hour' \| 'day' \| 'week' \| 'month' }` | `number` | Clear history |
| `history:search` | `{ query: string, limit?: number }` | `HistoryEntry[]` | Search history |
| `history:getRecent` | `{ limit?: number }` | `HistoryEntry[]` | Recent history |
| `download:pause` | `{ downloadId: string }` | `void` | Pause download |
| `download:resume` | `{ downloadId: string }` | `void` | Resume download |
| `download:cancel` | `{ downloadId: string }` | `void` | Cancel download |
| `download:open` | `{ downloadId: string }` | `void` | Open downloaded file |
| `download:showInFolder` | `{ downloadId: string }` | `void` | Show in file manager |
| `download:clearCompleted` | `{}` | `void` | Clear completed from list |
| `download:retry` | `{ downloadId: string }` | `void` | Retry failed download |
| `settings:get` | `{ key: string }` | `any` | Get setting |
| `settings:getAll` | `{}` | `Settings` | Get all settings |
| `settings:set` | `{ key: string, value: any }` | `void` | Set setting |
| `settings:reset` | `{ key?: string }` | `void` | Reset to default |
| `password:getAll` | `{}` | `PasswordEntry[]` | List saved passwords |
| `password:save` | `{ entry: PasswordEntry }` | `void` | Save password |
| `password:remove` | `{ origin: string, username: string }` | `void` | Delete password |
| `password:getForOrigin` | `{ origin: string }` | `PasswordEntry[]` | Get for site |
| `window:minimize` | `{}` | `void` | Minimize window |
| `window:maximize` | `{}` | `void` | Maximize/restore |
| `window:close` | `{}` | `void` | Close window |
| `window:setFullscreen` | `{ fullscreen: boolean }` | `void` | Toggle fullscreen |
| `app:quit` | `{}` | `void` | Quit application |
| `app:getVersion` | `{}` | `string` | App version |
| `devtools:toggle` | `{ tabId: string }` | `void` | Toggle DevTools |
| `devtools:open` | `{ tabId: string, mode?: 'right' \| 'bottom' \| 'detach' }` | `void` | Open DevTools |
| `screenshot:capture` | `{ tabId: string }` | `string` (data URL) | Capture page |
| `print:start` | `{ tabId: string }` | `void` | Open print dialog |
| `print:toPDF` | `{ tabId: string, options?: PrintToPDFOptions }` | `string` (path) | Save page as PDF |
| `permission:respond` | `{ origin: string, permission: PermissionType, allow: boolean }` | `void` | Respond to permission prompt |
| `contextMenu:clicked` | `{ itemId: string }` | `void` | Context menu item selected |
| `print:toPDF` | `{ tabId: string, options?: PrintToPDFOptions }` | `string` (path) | Save page as PDF |

### 7.3 Main → Renderer (on/send)

| Channel | Payload | Description |
|---------|---------|-------------|
| `tab:created` | `Tab` | New tab created |
| `tab:closed` | `{ tabId: string }` | Tab closed |
| `tab:activated` | `{ tabId: string }` | Tab became active |
| `tab:updated` | `Partial<Tab>` | Tab property changed |
| `tab:reordered` | `{ tabIds: string[] }` | Tabs reordered |
| `navigation:state` | `{ tabId: string, canGoBack: boolean, canGoForward: boolean, isLoading: boolean, url: string }` | Navigation state change |
| `load:started` | `{ tabId: string, url: string }` | Page load started |
| `load:progress` | `{ tabId: string, percent: number }` | Load progress (0–100) |
| `load:finished` | `{ tabId: string, url: string }` | Page load complete |
| `load:failed` | `{ tabId: string, errorCode: number, errorDescription: string, validatedURL: string }` | Page load failed |
| `page:title` | `{ tabId: string, title: string }` | Page title changed |
| `page:favicon` | `{ tabId: string, faviconUrl: string }` | Favicon URL changed |
| `download:created` | `DownloadItem` | Download started |
| `download:updated` | `Partial<DownloadItem>` | Download progress update |
| `download:completed` | `{ downloadId: string }` | Download finished |
| `download:failed` | `{ downloadId: string, error: string }` | Download error |
| `settings:changed` | `{ key: string, value: any }` | Setting changed externally |
| `zoom:changed` | `{ tabId: string, level: number }` | Zoom level changed |
| `find:result` | `{ requestId: number, matches: number, activeMatchOrdinal: number, selectionArea?: Rectangle }` | Find result |
| `fullscreen:changed` | `{ isFullscreen: boolean }` | Fullscreen state changed |
| `keyboard:shortcut` | `{ accelerator: string }` | Global shortcut triggered |
| `contextMenu:show` | `{ x: number, y: number, items: ContextMenuItem[] }` | Show custom context menu |
| `certificate:error` | `{ url: string, error: string, certificate?: CertificateInfo }` | SSL certificate error |
| `permission:request` | `{ origin: string, permission: PermissionType }` | Permission prompt needed |
| `contextMenu:clicked` | `{ itemId: string }` | Context menu item selected |
| `app:updateAvailable` | `{ version: string }` | Auto-update available |
| `app:updateDownloaded` | `{ version: string }` | Update ready to install |
| `tab:hibernated` | `{ tabId: string }` | Tab was hibernated |
| `tab:woken` | `{ tabId: string }` | Tab was restored from hibernation |

### 7.4 State Flow Patterns

**Tab Creation:**
```
User clicks "+" → Renderer: tab:create → Main: create BrowserView
→ Main: tab:created → Renderer: add to store → Main: tab:activated
→ Renderer: render as active → Main: set BrowserView bounds
```

**Navigation:**
```
User types URL → Renderer: navigation:go → Main: webContents.loadURL()
→ BrowserView events → Main: load:started → Renderer: show spinner
→ Main: load:progress → Renderer: update progress bar
→ Main: load:finished + page:title + page:favicon → Renderer: update tab
```

**Settings Change:**
```
User toggles setting → Renderer: settings:set → Main: write to settings.json
→ Main: settings:changed (broadcast) → All renderers: update local state
```

---

## 8. Core Data Models

### 8.1 Tab

```typescript
interface Tab {
  id: string;                    // UUID v4
  url: string;                   // Current URL
  title: string;                 // Page title (or URL if empty)
  favicon?: string;              // Data URL of cached favicon
  isLoading: boolean;
  loadProgress: number;          // 0–100
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  isMuted: boolean;
  isActive: boolean;
  isHibernated: boolean;         // BrowserView destroyed, state preserved
  zoomLevel: number;             // 0.25–5.0, default 1.0
  createdAt: number;             // timestamp
  lastAccessedAt: number;        // timestamp
  errorState?: TabErrorState;    // If load/crash occurred
  historyStack?: string[];        // Back/forward URLs for session restore
}

interface TabErrorState {
  type: 'load-failed' | 'crashed' | 'unresponsive';
  errorCode?: number;
  errorDescription?: string;
  validatedURL?: string;
}
```

### 8.2 Bookmark

```typescript
interface Bookmark {
  id: string;                    // UUID
  parentId?: string;             // null = root
  index: number;                 // Position within parent
  title: string;
  url?: string;                  // undefined = folder
  dateAdded: number;
  dateModified?: number;
  children?: Bookmark[];         // Populated for folders
}
```

### 8.3 History Entry

```typescript
interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitTime: number;
  visitCount: number;
  typedCount: number;
}
```

### 8.4 Download Item

```typescript
interface DownloadItem {
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
```

### 8.5 Settings Schema

```typescript
interface Settings {
  // General
  startupBehavior: 'new-tab' | 'restore' | 'specific-pages';
  startupPages: string[];
  defaultSearchEngine: string;   // 'google', 'duckduckgo', 'bing', etc.
  downloadPath: string;
  askWhereToSave: boolean;
  downloadNotifications: boolean;

  // Appearance
  theme: 'light' | 'dark' | 'system';
  accentColor: string;           // hex color
  showBookmarksBar: boolean;
  fontSize: number;              // 12–24
  minimumFontSize: number;       // 6–24
  pageZoom: number;              // default zoom for new tabs

  // Privacy
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
  safeBrowsing: boolean;

  // Permissions (per-origin overrides stored separately)
  defaultPermissions: Record<PermissionType, 'allow' | 'block' | 'ask'>;

  // Advanced
  hardwareAcceleration: boolean;
  smoothScrolling: boolean;
  spellcheck: boolean;
  spellcheckLanguages: string[];

  // Security
  certificateOverrides: Record<string, 'allow' | 'block'>;  // hostname → decision
}

type PermissionType =
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
```

---

## 9. Key Components

### 9.1 Omnibox

The Omnibox combines URL display, editing, and a suggestion dropdown.

**States:**
- **Display mode:** Shows human-readable URL (hide scheme for https, show lock icon, highlight domain)
- **Edit mode:** Full URL editable, dropdown with suggestions

**Suggestion ranking:**
1. Direct URL match (typed URL completion from history)
2. History entries matching query (frecency-ranked)
3. Bookmark matches
4. Search suggestions from default engine (if query is not URL-like)

**Security indicators:**
- 🔒 Secure (HTTPS, valid cert)
- ⚠️ Not secure (HTTP)
- 🛡️ Dangerous (certificate error, malware warning)

**Keyboard navigation:**
- `Ctrl+L` / `Cmd+L` — Focus omnibox, select all
- `Esc` — Cancel editing, revert to display mode
- `↓/↑` — Navigate suggestion dropdown
- `Enter` — Navigate to selected suggestion or search

### 9.2 TabBar

**Features:**
- Horizontal scroll when tabs overflow viewport
- Drag-to-reorder (HTML5 DnD with visual indicators)
- Right-click context menu: reload, duplicate, pin, mute, close, close others, close to the right
- Pin behavior: shrinks to favicon-only, stays at left edge, not closable via middle-click
- Middle-click on tab → close
- Double-click on empty tab bar area → new tab
- Hover on tab shows full title as tooltip

**Hibernation:**
- Inactive tabs after N minutes (configurable, default 30) can be hibernated
- Hibernated tab: BrowserView destroyed, state serialized, favicon retained
- On activation: recreate BrowserView, restore state, reload URL

### 9.3 BrowserContentArea

Manages the DOM area where BrowserViews are visually embedded.

**Bounds calculation:**
```
contentX = 0
contentY = titleBarHeight + tabBarHeight + toolbarHeight
contentWidth = windowWidth
contentHeight = windowHeight - contentY - statusBarHeight
```

**BrowserView management:**
- Active tab: `browserView.setBounds(contentAreaBounds)`, `browserView.setAutoResize({ width: true, height: true })`
- Inactive tabs: `browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 })` or destroy
- On window resize: auto-resize handles active tab; recompute bounds for all hidden tabs

### 9.4 Settings Panel

Slide-in panel (right side, ~400px wide) with accordion sections:

1. **General** — startup, search engine, downloads, language
2. **Appearance** — theme, accent color, bookmarks bar, font settings
3. **Privacy** — cookie settings, clear data, Do Not Track, safe browsing
4. **Passwords** — saved passwords list, auto-save toggle, export/import
5. **Search** — default engine, manage search engines, keyword shortcuts
6. **Downloads** — default folder, ask where to save, notifications
7. **Advanced** — hardware acceleration, proxy, reset settings, about

---

## 10. Feature Specifications

### 10.1 Tabs

| Feature | Behavior |
|---------|----------|
| New tab | Opens with new-tab page (configurable: blank, homepage, recently closed) |
| Close tab | If last tab, close window (or create new tab, configurable) |
| Close window with multiple tabs | Prompt to confirm (configurable) |
| Restore closed tab | `Ctrl+Shift+T` / `Cmd+Shift+T`, restores full back/forward history |
| Duplicate tab | Clone current URL and history stack |
| Pin tab | Shrinks to favicon, moves to left, persists across sessions |
| Mute tab | Mutes all audio from tab's webContents |
| Tab drag | Reorder within window; future: drag to new window |
| Tab hibernation | Auto-hibernate after inactivity; manual hibernate option |

### 10.2 Navigation

| Feature | Behavior |
|---------|----------|
| Back/Forward | Standard web history per tab |
| Reload | Soft reload (F5); hard reload (`Ctrl+Shift+R`) bypasses cache |
| Stop | Immediately aborts loading |
| Home | Navigates to configured homepage |
| New-tab page | Shows frequently visited sites, bookmarks bar, search box |

### 10.3 Bookmarks

| Feature | Behavior |
|---------|----------|
| Add bookmark | `Ctrl+D` / `Cmd+D`, dialog with folder selection, edit title/URL |
| Bookmark bar | Toggle visibility, shows bookmarks from "Bookmarks Bar" folder |
| Bookmark manager | Full tree view, search, drag-and-drop organization |
| Import/Export | Netscape HTML format (Chrome/Firefox compatible) |
| Folders | Nested folders, rename, delete (with contents) |

### 10.4 History

| Feature | Behavior |
|---------|----------|
| Recording | Every navigation recorded with URL, title, timestamp |
| History page | Grouped by date, searchable, deletable by item or range |
| Clear history | By range: last hour, day, week, month, or all |
| Omnibox integration | Typed history contributes to URL suggestions |

### 10.5 Downloads

| Feature | Behavior |
|---------|----------|
| Start download | Auto-download or prompt for location (configurable) |
| Download bar | Bottom bar appears on active download, shows progress |
| Download page | Full list with status, speed, time remaining |
| Actions | Open, show in folder, pause, resume, cancel, retry |
| Safety | Block dangerous file types, scan with safe browsing |

### 10.6 Find in Page

| Feature | Behavior |
|---------|----------|
| Open | `Ctrl+F` / `Cmd+F` |
| Search | Real-time highlighting as user types |
| Navigation | `Enter` next, `Shift+Enter` previous |
| Counter | "3/12" match indicator |
| Case sensitive | Toggle option |
| Close | `Esc` or close button |

### 10.7 Password Manager

| Feature | Behavior |
|---------|----------|
| Auto-save | Prompt to save on form submission (configurable) |
| Auto-fill | Fill username/password on recognized login forms |
| Storage | System keychain when available (macOS Keychain, Windows Credential Manager / DPAPI, Linux libsecret/Secret Service). Fallback: AES-256-GCM encrypted JSON file secured with OS-specific entropy. |
| Management | View, search, edit, delete saved passwords |
| Master password | Optional additional encryption layer (encrypts the key used for JSON fallback) |

### 10.8 Autofill

| Feature | Behavior |
|---------|----------|
| Address autofill | Save addresses (name, street, city, postal code, country, phone, email). Detect form fields by heuristics (input type, name attribute, autocomplete attribute). Suggest matching addresses in dropdown. |
| Payment autofill | Save credit cards (number, expiry, CVV, name, billing address). CVV never stored persistently — prompt each time. Card numbers encrypted with same mechanism as passwords. |
| Password autofill | See Password Manager (Section 10.7) |
| Form detection | Heuristic-based field type detection; respect `autocomplete` HTML attributes |
| Trigger | Dropdown appears on focus of recognized field; arrow keys + Enter to select |

**Data Models:**
```typescript
interface SavedAddress {
  id: string;
  label: string;                 // e.g., "Home", "Work"
  name: string;
  organization?: string;
  street: string[];              // Line 1, Line 2, etc.
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
  email?: string;
}

interface SavedPaymentMethod {
  id: string;
  label: string;
  cardNumber: string;            // Last 4 digits only stored; full encrypted
  cardNumberEncrypted: string;   // AES-256-GCM encrypted full number
  expiryMonth: string;
  expiryYear: string;
  cardholderName: string;
  billingAddressId?: string;
}
```

**IPC Channels:**
- `autofill:getAddresses` → returns `SavedAddress[]`
- `autofill:saveAddress` → saves address
- `autofill:removeAddress` → removes address
- `autofill:getPaymentMethods` → returns `SavedPaymentMethod[]` (masked)
- `autofill:savePaymentMethod` → saves payment method
- `autofill:removePaymentMethod` → removes payment method

### 10.9 Zoom

| Feature | Behavior |
|---------|----------|
| Zoom in/out | `Ctrl++/Ctrl+-` or menu |
| Reset zoom | `Ctrl+0` |
| Per-tab | Each tab has independent zoom level |
| Default zoom | Configurable in settings |

### 10.10 Print

| Feature | Behavior |
|---------|----------|
| Print dialog | `Ctrl+P` opens system print dialog |
| Print to PDF | Available through system print dialog |
| Print preview | Via system dialog (OS-dependent) |

### 10.11 DevTools

| Feature | Behavior |
|---------|----------|
| Toggle | `Ctrl+Shift+I` / `Cmd+Option+I` or F12 |
| Mode | Dock right, bottom, or undocked |
| Per-tab | Each tab has its own DevTools instance |

---

## 11. Error Handling & Edge Cases

### 11.1 Page Load Failures

When `did-fail-load` fires:
1. Map error code to human message
2. Inject custom error page into BrowserView
3. Send `load:failed` to renderer
4. Renderer shows error UI with: message, retry button, details expander

**Error codes handled:**
- `ERR_NAME_NOT_RESOLVED` → DNS lookup failed
- `ERR_CONNECTION_REFUSED` → Server refused connection
- `ERR_CONNECTION_TIMED_OUT` → Connection timed out
- `ERR_SSL_PROTOCOL_ERROR` → SSL protocol error
- `ERR_CERT_DATE_INVALID` → Certificate expired
- `ERR_CERT_AUTHORITY_INVALID` → Untrusted certificate
- `ERR_INTERNET_DISCONNECTED` → No internet connection
- `ERR_ABORTED` → User cancelled (no error page)

### 11.2 Renderer Crashes

On `render-process-gone` or `crashed`:
1. Log crash reason and URL
2. Show "This page crashed" overlay in BrowserView
3. Offer "Reload page" button
4. On reload: recreate webContents, restore navigation state

### 11.3 Unresponsive Tabs

On `unresponsive` (after ~30s):
1. Show "Page unresponsive" dialog
2. Options: "Wait" (extend timeout) or "Kill page" (force reload)
3. If killed: show crashed state

### 11.4 Network State

- Listen to `online`/`offline` events
- Offline indicator in status bar
- If user attempts navigation while offline, show offline error page immediately; page auto-reloads when connection restored (if tab is still active and user hasn't navigated elsewhere)

### 11.5 Session Restore

On app quit/crash:
1. Serialize `{ tabs: [...], activeTabId, windowBounds }` to `session.json`
2. On next launch (if `startupBehavior: 'restore'`):
   - Read `session.json`
   - Recreate tabs with their URLs
   - Restore window position/size
   - Activate last active tab

### 11.6 Invalid URLs

- No scheme → prepend `https://`
- Unknown protocol (`mailto:`, `tel:`) → `shell.openExternal()`
- `file://` → validate path is within safe directories
- Malformed URL → show error or search with default engine

---

## 12. Security Model

### 12.1 Sandboxing

| Setting | Value |
|---------|-------|
| `nodeIntegration` | `false` (renderer has no Node access) |
| `contextIsolation` | `true` (preload is isolated from page JS) |
| `sandbox` | `true` (BrowserViews run in sandbox) |
| `webSecurity` | `true` (CORS enforced) |
| `allowRunningInsecureContent` | `false` |

### 12.2 Preload Script Security

- Whitelist-only IPC channels
- No direct Node.js API exposure
- All messages validated with TypeScript types
- `contextBridge` used exclusively (never `window.postMessage` to main)

### 12.3 Content Security Policy

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'none';
font-src 'self';
object-src 'none';
frame-ancestors 'none';
base-uri 'self';
form-action 'none';
```

### 12.4 Permission Model

| Permission | Default | Prompt Behavior |
|------------|---------|-----------------|
| Geolocation | Block | Prompt per-origin |
| Camera | Block | Prompt per-origin |
| Microphone | Block | Prompt per-origin |
| Notifications | Block | Prompt per-origin |
| MIDI | Block | Prompt per-origin |
| MIDI Sysex | Block | Prompt per-origin |
| Pointer Lock | Ask | Prompt per-origin |
| Fullscreen | Allow | Auto-allow (UI handles exit) |
| Open External | Ask | Prompt per-protocol |
| Display Capture | Block | Prompt per-origin |

User choices persisted in settings and honored across sessions.

### 12.5 Certificate Handling

| Scenario | Behavior |
|----------|----------|
| Valid HTTPS | Normal browsing, show lock icon |
| Expired cert | Warning interstitial, allow with explicit override |
| Self-signed | Warning interstitial, allow with explicit override |
| Wrong hostname | Warning interstitial |
| Revoked cert | Hard block (no override) |
| HSTS violation | Hard block |

Overrides stored per-origin in settings.

### 12.6 External Protocol Security

- `mailto:`, `tel:` → prompt user before opening external app
- Unknown protocols → block with option to allow once/always
- `javascript:` URLs → blocked entirely
- `data:` URLs in navigation → restricted

---

## 13. Testing Strategy

### 13.1 Unit Tests (Vitest)

**Coverage targets:**
- `url.ts` — normalize, extractDomain, isValidURL, etc.
- `search-engine.ts` — query parsing, engine selection
- `format.ts` — date, file size, duration formatting
- Pure React components (with React Testing Library)
- Zustand store logic (with mock state)

**No Electron required** — fast execution (< 1s per file).

### 13.2 Integration Tests (Vitest + Mocked Electron)

**Coverage targets:**
- IPC channel contracts (renderer sends → main receives correctly)
- Tab state machine transitions
- Settings persistence round-trip
- Bookmark tree operations

**Mocked Electron APIs** via `vitest.mock('electron')`.

### 13.3 E2E Tests (Playwright + Electron)

**Coverage targets:**
- App launch and basic smoke test
- Tab creation, switching, closing
- Navigation to real and test URLs
- Bookmark creation and retrieval
- Download flow (with local test server)
- Settings changes persist across restarts
- Keyboard shortcuts (Ctrl+T, Ctrl+W, Ctrl+L, etc.)
- Screenshot comparison for visual regression

**Test infrastructure:**
- Local Express server serving test pages with known content
- Test fixtures for bookmarks, history, settings
- Screenshot baselines per platform

### 13.4 Test Data

```
tests/
├── fixtures/
│   ├── pages/                          # Static HTML test pages
│   │   ├── simple.html                 # Basic page with title
│   │   ├── favicon.html                # Page with favicon
│   │   ├── slow.html                   # Slow-loading page (test progress)
│   │   ├── error-404.html              # 404 response
│   │   ├── form-login.html             # Login form (password manager test)
│   │   └── download-file.bin           # Binary file for download test
│   ├── bookmarks.json                  # Sample bookmarks tree
│   ├── history.json                    # Sample history entries
│   └── settings.json                   # Sample settings
└── server.ts                           # Express test server
```

---

## 14. UI Design Direction

### 14.1 Visual Identity

**Name:** Horizon  
**Tagline:** "Explore without limits"  

**Design principles:**
1. **Familiar yet fresh** — Chrome users feel at home, but distinct visual identity
2. **Content-first** — Chrome stays minimal; web content is the star
3. **Responsive chrome** — UI adapts to window size, fullscreen, and theme
4. **Accessible** — WCAG 2.1 AA compliance, keyboard-navigable, screen reader friendly

### 14.2 Color System (CSS Custom Properties)

```css
:root {
  /* Surface colors */
  --chrome-bg: #f1f3f4;
  --chrome-fg: #202124;
  --tab-bg: #ffffff;
  --tab-bg-active: #ffffff;
  --tab-bg-inactive: #e8eaed;
  --toolbar-bg: #ffffff;
  --omnibox-bg: #ffffff;
  --omnibox-border: #dadce0;
  --statusbar-bg: #f1f3f4;
  --overlay-bg: #ffffff;

  /* Accent colors */
  --accent-primary: #1a73e8;      /* Horizon blue */
  --accent-hover: #1557b0;
  --accent-light: #e8f0fe;

  /* Status colors */
  --secure: #188038;
  --insecure: #ea4335;
  --warning: #f9ab00;
  --info: #1a73e8;

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  --font-size-base: 13px;
  --font-size-sm: 11px;
  --font-size-lg: 15px;

  /* Spacing */
  --chrome-height: 40px;
  --tab-height: 36px;
  --toolbar-height: 40px;
  --statusbar-height: 24px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-tab: 8px 8px 0 0;
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
  --overlay-bg: #292a2d;
}
```

### 14.3 Layout

```
┌────────────────────────────────────────────────────────────┐
│ [●●●] Horizon                              ─ □ ✕          │  TitleBar (macOS)
├────────────────────────────────────────────────────────────┤
│ ← → ⟳ 🏠 │ https://github.com 🔒 │ ⋮                      │  Toolbar + Omnibox
├────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐              [+]   │  TabBar
│ │ 🐙 GitHub│ │ 📄 Docs  │ │ [+]      │                    │
│ └──────────┘ └──────────┘ └──────────┘                    │
├────────────────────────────────────────────────────────────┤
│                                                            │
│                    WEB CONTENT AREA                        │  BrowserContentArea
│                  (BrowserView embedded)                    │
│                                                            │
│                                                            │
├────────────────────────────────────────────────────────────┤
│ Done              100%    🔒 github.com           100%    │  StatusBar (optional)
└────────────────────────────────────────────────────────────┘
```

### 14.4 Responsive Behavior

| Window Width | Behavior |
|-------------|----------|
| < 600px | Compact mode: hide toolbar labels, show icons only |
| < 400px | Minimum size; tab titles truncate to favicon only |
| Fullscreen | Auto-hide chrome (toolbar + tab bar) on idle, show on mouse-move-top |
| Maximized | Use system title bar (Windows), traffic lights hidden (macOS) |

---

## 15. Packaging & Distribution

### 15.1 Target Formats

| Platform | Format | Notes |
|----------|--------|-------|
| macOS | DMG | Signed + notarized |
| macOS | ZIP | For direct distribution |
| Windows | NSIS (.exe) | Installer with auto-update |
| Windows | Portable (.exe) | No installer |
| Linux | AppImage | Universal, no dependencies |
| Linux | deb | Debian/Ubuntu |
| Linux | rpm | Fedora/openSUSE |

### 15.2 Auto-Update

- **macOS/Windows:** electron-updater (S3/GitHub Releases)
- **Linux:** Manual update notification (AppImage can self-update)
- Update check on startup + every 4 hours
- Silent download, prompt to install on next restart

### 15.3 Code Signing

| Platform | Certificate |
|----------|-------------|
| macOS | Apple Developer ID |
| Windows | EV Code Signing Certificate |
| Linux | GPG signing for packages |

---

## 16. Performance Targets

| Metric | Target |
|--------|--------|
| Cold start (first window) | < 2 seconds |
| New tab creation | < 100ms |
| Tab switch | < 50ms |
| Window resize | < 16ms (60fps) |
| Memory per tab | ~50-100MB reported (Chromium baseline; monitored, not guaranteed) |
| Hibernated tab memory | ~0MB (BrowserView destroyed) |
| Max tabs before hibernation | 20 active (configurable) |

---

## 17. Accessibility

- **Keyboard navigation:** All chrome elements reachable via Tab/Arrow keys
- **Shortcuts:** Full Chrome shortcut parity where applicable
- **Screen readers:** ARIA labels on all interactive elements
- **High contrast:** Support Windows high-contrast mode
- **Reduced motion:** Respect `prefers-reduced-motion`
- **Focus indicators:** Visible focus rings on all interactive elements
- **Color contrast:** WCAG 2.1 AA minimum (4.5:1 for text)

---

## 18. Internationalization (Future)

Architecture prepared for i18n:
- All user-facing strings externalized
- Locale files in `resources/locales/`
- `navigator.language` detection
- RTL layout support planned for v2

---

## 19. Future Roadmap (Post-v1)

| Version | Features |
|---------|----------|
| v1.1 | Tab groups, vertical tabs option, reader mode |
| v1.2 | Extension API (basic: toolbar icons, content scripts) |
| v1.3 | Full WebExtension API parity |
| v2.0 | Cloud sync (accounts, encrypted sync server) |
| v2.1 | Mobile companion (iOS/Android WebView-based) |
| v2.2 | Built-in VPN/proxy, advanced privacy tools |

---

## 20. Decisions

The following open questions have been resolved for v1.0:

1. **New-tab page content:** Simple, clean new-tab page with a search box (using default search engine), bookmarks bar, and a static "Getting Started" guide. No frequently-visited analytics. Future versions may add a customizable dashboard.
2. **Search engine partnerships:** Default to DuckDuckGo for privacy alignment. Google, Bing, and custom search engines available in settings. No revenue-sharing partnerships in v1.
3. **Update server infrastructure:** GitHub Releases for v1 (free, reliable, integrates with electron-updater). Self-hosted update server considered for v2 if custom sync backend is built.
4. **Crash reporting:** No crash reporting in v1.0. Goal #4 (Privacy by Design / no telemetry) takes precedence. Manual bug reports via GitHub issues. Crash reporting may be introduced in v2 as strictly opt-in.
5. **Telemetry:** Completely absent in v1.0. The only network requests made by the browser are: (a) web page loads, (b) search queries to the user's chosen engine, (c) update checks (sends app version + OS type only, no unique identifier), (d) safe browsing checks (if enabled). All of these are user-visible and configurable.

---

## Appendix A: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + T` | New tab |
| `Ctrl/Cmd + W` | Close tab |
| `Ctrl/Cmd + Shift + T` | Reopen closed tab |
| `Ctrl/Cmd + L` | Focus omnibox |
| `Ctrl/Cmd + R` | Reload |
| `Ctrl/Cmd + Shift + R` | Hard reload |
| `Alt + ←` / `Alt + →` | Back / Forward |
| `Ctrl/Cmd + D` | Bookmark page |
| `Ctrl/Cmd + Shift + B` | Toggle bookmarks bar |
| `Ctrl/Cmd + H` | Open history |
| `Ctrl/Cmd + J` | Open downloads |
| `Ctrl/Cmd + F` | Find in page |
| `Ctrl/Cmd + +` | Zoom in |
| `Ctrl/Cmd + -` | Zoom out |
| `Ctrl/Cmd + 0` | Reset zoom |
| `Ctrl/Cmd + P` | Print |
| `Ctrl/Cmd + S` | Save page |
| `F12` / `Ctrl/Cmd + Shift + I` | Toggle DevTools |
| `Ctrl/Cmd + Shift + N` | New window |
| `Ctrl/Cmd + Shift + W` | Close window |
| `Ctrl/Cmd + ,` | Open settings |
| `Ctrl/Cmd + 1..8` | Switch to tab N |
| `Ctrl/Cmd + 9` | Switch to last tab |
| `Ctrl/Cmd + Tab` | Next tab |
| `Ctrl/Cmd + Shift + Tab` | Previous tab |
| `Ctrl/Cmd + Shift + Delete` | Clear browsing data |
| `F11` | Toggle fullscreen |
| `Esc` | Stop loading / close find / exit fullscreen |

---

## Appendix B: File Permissions & Storage

| Data Type | Location | Format | Rationale |
|-----------|----------|--------|-----------|
| Settings | `userData/settings.json` | JSON | Small, flat structure; fast reads/writes |
| Bookmarks | `userData/bookmarks.json` | JSON | Tree structure; loaded once at startup; full-tree operations |
| History | `userData/history.db` | SQLite | Large dataset; requires fast range queries, full-text search, and efficient pruning |
| Passwords | `userData/passwords.json` (encrypted) | JSON + AES | Small dataset; sensitive; encrypted at rest with OS keychain or AES-256-GCM |
| Downloads DB | `userData/downloads.json` | JSON | Small dataset; list operations; simple append/update |
| Session | `userData/session.json` | JSON | Transient; simple read/write at startup/quit |
| Favicon cache | `userData/favicons/` | PNG files | Binary assets; filesystem-native storage |
| Cache | `userData/Cache/` | Chromium cache | Managed by Chromium; do not touch |
| Cookies | `userData/Cookies` | SQLite (Chromium) | Managed by Chromium; do not touch |

**Why SQLite only for History:** History is the only dataset that grows unbounded, requires complex queries (search by text, filter by date range, deduplication, frecency scoring), and needs efficient pruning. All other datasets are small enough for in-memory JSON with simple file I/O. IfBookmarks or Downloads grow unexpectedly, they can be migrated to SQLite without breaking changes.

---

*End of Design Specification*
