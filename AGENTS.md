# Horizon Browser — Agent Coding Rules

> **For AI assistants (Claude, Cursor, Copilot, etc.) working on this codebase.**
>
> These rules are mandatory. Violations must be fixed before any PR is merged.

---

## 1. Test-Driven Development (TDD)

### 1.1 Red-Green-Refactor Cycle

Every feature, bugfix, and refactor MUST follow the TDD cycle:

1. **Red** — Write a failing test that describes the desired behavior.
2. **Green** — Write the minimal code to make the test pass.
3. **Refactor** — Clean up the code while keeping all tests green.

### 1.2 Test First

- **Never** write implementation code without a corresponding test.
- **Exception:** Pure UI layout/styling changes (CSS, Tailwind classes) where visual inspection is the test.
- **Exception:** Boilerplate configuration files (vite.config, tsconfig, etc.).

### 1.3 Test Granularity

| Code Type | Test Type | Example |
|-----------|-----------|---------|
| Pure functions | Unit test | `url.ts`, `format.ts` |
| React hooks | Unit + integration | `useTabs.ts`, `useNavigation.ts` |
| React components | Unit (RTL) | `Omnibox.tsx`, `Tab.tsx` |
| IPC handlers | Integration test | `main-handlers.ts` |
| Service managers | Integration test | `TabManager.ts`, `BookmarkManager.ts` |
| Full user flows | E2E test | Tab creation → navigation → bookmarking |

### 1.4 Test File Placement

```
tests/
├── unit/          # Mirror src/ structure
│   ├── utils/
│   │   └── url.test.ts
│   └── hooks/
│       └── useTabs.test.ts
├── integration/   # IPC, service integration
│   └── ipc/
│       └── channels.test.ts
└── e2e/           # Playwright E2E
    └── smoke.spec.ts
```

### 1.5 Test Naming

```typescript
// Good
describe('normalizeUrl', () => {
  it('adds https:// to bare domain', () => { ... });
  it('searches plain text via default engine', () => { ... });
  it('preserves existing scheme', () => { ... });
});

// Bad
describe('url utils', () => {
  it('works', () => { ... });
  it('handles stuff', () => { ... });
});
```

---

## 2. Coverage Rate

### 2.1 Minimum Coverage Thresholds

| Metric | Minimum | Target |
|--------|---------|--------|
| Lines | 80% | 90% |
| Functions | 85% | 95% |
| Branches | 75% | 85% |
| Statements | 80% | 90% |

### 2.2 Critical Path Coverage

The following areas MUST have 95%+ coverage:

- **IPC channels** — Every channel must have at least one round-trip test.
- **Data persistence** — Settings, bookmarks, history, downloads, passwords.
- **Security boundaries** — Preload script, contextBridge, permission handlers.
- **Error handling** — Load failures, crashes, corrupted files, disk-full.

### 2.3 Coverage Exemptions

The following are EXEMPT from coverage requirements:

- UI components that are purely presentational (no logic).
- CSS/Tailwind style files.
- Type definitions (`.d.ts`, interfaces).
- Third-party type declarations.
- Build configuration files.

### 2.4 Coverage Enforcement

```bash
# Run with coverage
npm run test -- --coverage

# Coverage report is generated in coverage/
# CI will fail if thresholds are not met
```

---

## 3. Code Style

### 3.1 TypeScript

- **Strict mode** is enabled. No `any` without explicit `@ts-expect-error` + justification comment.
- **Explicit return types** on all exported functions and public methods.
- **No implicit returns** — every code path must return a value.
- **Prefer `interface` over `type`** for object shapes.
- **No `enum`** — use const objects with `as const` instead.

```typescript
// Good
interface Tab {
  id: string;
  url: string;
}

const TabState = {
  LOADING: 'loading',
  COMPLETE: 'complete',
} as const;

// Bad
enum TabState { LOADING, COMPLETE }
```

### 3.2 React

- **Functional components only** — No class components.
- **Props interface** — Every component must declare its props interface.
- **No `useEffect` without cleanup** — If you subscribe, you must unsubscribe.
- **No inline handlers in JSX** — Define handlers with `useCallback`.
- **Zustand for state** — No Context API, no Redux, no Prop Drilling.

```tsx
// Good
interface TabProps {
  tab: Tab;
  isActive: boolean;
}

export const Tab: React.FC<TabProps> = React.memo(({ tab, isActive }) => {
  const activate = useCallback(() => {
    window.horizonAPI.invoke('tab:activate', { tabId: tab.id });
  }, [tab.id]);

  return <div onClick={activate}>{tab.title}</div>;
});
```

### 3.3 Naming Conventions

| Category | Convention | Example |
|----------|-----------|---------|
| Files (components) | PascalCase | `TabBar.tsx`, `Omnibox.tsx` |
| Files (hooks) | camelCase, `use` prefix | `useTabs.ts`, `useNavigation.ts` |
| Files (services) | PascalCase | `TabManager.ts`, `HistoryManager.ts` |
| Files (utils) | camelCase | `url.ts`, `format.ts` |
| Constants | SCREAMING_SNAKE_CASE | `DEFAULT_SETTINGS`, `APP_NAME` |
| Types/Interfaces | PascalCase | `Tab`, `HistoryEntry` |
| IPC Channels | SCREAMING_SNAKE_CASE | `TAB_CREATE`, `NAVIGATION_GO` |
| Boolean props | `is`/`has`/`can` prefix | `isLoading`, `canGoBack` |

### 3.4 File Size Limits

| File Type | Max Lines | Action if Exceeded |
|-----------|-----------|-------------------|
| Component | 200 | Split into sub-components |
| Hook | 150 | Extract helper functions |
| Service | 300 | Extract into smaller services |
| Test | 200 | Split by behavior/scenario |

---

## 4. Git Commit Conventions

### 4.1 Conventional Commits

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### 4.2 Types

| Type | Use When |
|------|----------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `docs` | Documentation changes only |
| `chore` | Build, tooling, dependency updates |
| `perf` | Performance improvement |
| `security` | Security-related fix |

### 4.3 Scopes

| Scope | Description |
|-------|-------------|
| `main` | Electron main process |
| `renderer` | React renderer process |
| `ipc` | IPC channels/handlers |
| `tab` | Tab management |
| `nav` | Navigation |
| `bookmark` | Bookmarks |
| `history` | History |
| `download` | Downloads |
| `settings` | Settings |
| `password` | Password manager |
| `autofill` | Autofill |
| `ui` | UI components |
| `test` | Tests |
| `build` | Build/packaging |

### 4.4 Examples

```
feat(tab): add tab pinning with visual indicator
fix(nav): prevent double navigation on rapid clicks
refactor(ipc): split main-handlers into per-domain modules
test(bookmark): add import/export round-trip tests
docs(api): document IPC channel contracts
chore(deps): upgrade Electron to v34
perf(renderer): memoize Tab component to reduce re-renders
```

### 4.5 Commit Frequency

- **Commit after every TDD cycle** (red → green → refactor).
- **Never** commit broken code.
- **Atomic commits** — one logical change per commit.

---

## 5. Security Rules

### 5.1 Electron Security

- **`nodeIntegration: false`** — Always. No exceptions.
- **`contextIsolation: true`** — Always. No exceptions.
- **`sandbox: true`** — For all BrowserViews.
- **No `eval()`** — Banned. Use JSON.parse or structured data.
- **No `innerHTML`** — Use React rendering or `textContent`.

### 5.2 IPC Security

- **Whitelist channels only** — Preload script exposes only defined channels.
- **Validate all payloads** — Every IPC handler must validate input shape.
- **No direct Node API exposure** — Renderer never calls `fs`, `path`, `os` directly.

```typescript
// Good — validated, typed IPC
ipcMain.handle(IPC_CHANNELS.TAB_CREATE, (_event, { url }: { url?: string }) => {
  if (url && typeof url !== 'string') throw new Error('Invalid URL');
  return tabManager.createTab(url);
});

// Bad — no validation, untyped
ipcMain.handle('tab:create', (event, data) => {
  return tabManager.createTab(data.url);
});
```

### 5.3 Data Security

- **Passwords** — Encrypt with `safeStorage` (OS keychain). Never plaintext.
- **Sensitive data** — Store in `app.getPath('userData')`, never in repo.
- **Certificate errors** — Show interstitial, never auto-bypass.

---

## 6. Performance Rules

### 6.1 Rendering Performance

- **Memoize components** with `React.memo` if props are stable.
- **Memoize callbacks** with `useCallback` if passed to children.
- **Memoize values** with `useMemo` for expensive computations.
- **Virtualize lists** with 50+ items.
- **Debounce user input** — Omnibox suggestions, search queries.

### 6.2 Memory Management

- **Destroy BrowserViews** when tabs close — `webContents.destroy()`.
- **Clean up IPC listeners** in `useEffect` cleanup.
- **Limit history** — Auto-prune beyond 5000 entries.
- **Limit favicon cache** — LRU eviction beyond 500 entries / 100MB.

### 6.3 Bundle Size

- **Tree-shake dependencies** — Use ES modules, avoid default imports.
- **Lazy load overlays** — Settings, bookmarks, history panels via `React.lazy`.
- **No unnecessary polyfills** — Target modern Electron/Chromium.

---

## 7. Documentation Rules

### 7.1 Code Documentation

- **JSDoc on all exported functions** — At minimum: description, params, returns.
- **Complex logic gets inline comments** — Explain the "why", not the "what".
- **No commented-out code** — Delete it. Git history preserves it.

```typescript
/**
 * Normalize a user input into a valid URL or search query.
 * @param input - Raw user input from the omnibox
 * @returns Fully qualified URL or search engine query URL
 */
export function normalizeUrl(input: string): string {
  // If input contains no dots and no scheme, treat as search query
  if (!input.includes('.') && !input.includes('://')) {
    return buildSearchUrl(input);
  }
  // ...
}
```

### 7.2 Architecture Decisions

- **Document in `.rpiv/artifacts/`** — Design specs, research, decisions.
- **Update AGENTS.md** when rules change.
- **Update README.md** when setup steps change.

---

## 8. Error Handling

### 8.1 Error Propagation

- **Never swallow errors** — Log or display them.
- **Use typed errors** — Custom error classes with error codes.
- **IPC errors** — Serialize as `{ message, code }` and reject the Promise.

### 8.2 User-Facing Errors

- **Friendly messages** — "This site can't be reached" not `ERR_NAME_NOT_RESOLVED`.
- **Actionable** — Always offer a retry button or alternative.
- **Non-blocking** — Don't freeze the UI for recoverable errors.

### 8.3 Crash Recovery

- **Session restore** — Save tab state before quit, restore on launch.
- **Corrupted files** — Reset to defaults with user notification.
- **Graceful degradation** — If a feature fails, the browser still works.

---

## 9. Review Checklist

Before marking any task complete, verify:

- [ ] Tests written and passing (`npm test`)
- [ ] Coverage meets thresholds (`npm test -- --coverage`)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] No lint errors (`npm run lint`)
- [ ] No security violations (no `nodeIntegration`, no `eval`, no `innerHTML`)
- [ ] Commit follows conventional format
- [ ] Documentation updated if needed
- [ ] Self-review completed (read the diff, would you approve this?)

---

## 10. AI Assistant Instructions

### 10.1 When Starting Work

1. Read `AGENTS.md` (this file).
2. Read relevant sections of the design spec in `docs/superpowers/specs/`.
3. Check `git log` for recent commits to understand patterns.
4. Run existing tests to establish baseline.

### 10.2 When Writing Code

1. Write the test first.
2. Run the test to confirm it fails.
3. Write minimal implementation.
4. Run the test to confirm it passes.
5. Refactor if needed.
6. Run full test suite to check for regressions.
7. Commit with conventional message.

### 10.3 When Uncertain

- **Ask the user** — Do not guess on architectural decisions.
- **Check the spec** — The design spec is the source of truth.
- **Follow existing patterns** — Match the style of nearby code.

### 10.4 Forbidden Patterns

The following will be rejected in code review:

- `any` type without `@ts-expect-error` justification
- `console.log` in production code (use proper logging)
- Magic numbers without named constants
- Functions longer than 50 lines without clear decomposition
- Nested callbacks (use async/await)
- Mutating props or state directly
- Race conditions in async code (no unawaited Promises)

---

*Last updated: 2026-05-23*
*Version: 1.0*
