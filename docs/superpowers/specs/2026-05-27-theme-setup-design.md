# Theme Setup System — Design Spec

**Date:** 2026-05-27  
**Status:** Approved  
**Approach:** A — Extend CSS Custom Properties + `data-theme`

---

## 1. Summary

Wire up the existing `theme` and `accentColor` settings so the Horizon browser chrome actually applies them. The system supports multiple named presets (`dia`, `midnight`, `ocean`, `forest`) plus a `system` mode that follows the OS appearance. An optional `accentColor` override lets users personalize the primary accent and its derived tints.

---

## 2. Motivation

Currently `Settings.theme` exists in the data model and appears as a dropdown in `SettingsPanel`, but no JavaScript code actually applies the selected value to the DOM. The CSS already has `[data-theme="dark"]` and `prefers-color-scheme: dark` blocks ready — they just aren't wired to user selection. Similarly, `accentColor` is stored but never injected. This spec closes those gaps with minimal code change.

---

## 3. Data Model

### 3.1 `Settings.theme`

```typescript
// src/types/browser.ts
export interface Settings {
  theme: 'system' | 'dia' | 'midnight' | 'ocean' | 'forest';
  accentColor: string;
  // ... other fields unchanged
}
```

Legacy values `'light'` and `'dark'` are **deprecated**. `SettingsManager` migrates them on load:
- `'light'` → `'dia'`
- `'dark'` → `'midnight'`

### 3.2 Default values

```typescript
// shared/constants.ts
export const DEFAULT_SETTINGS = {
  theme: 'system' as const,
  accentColor: '', // empty = use preset default
  // ...
};
```

---

## 4. CSS Architecture

### 4.1 Preset blocks

Each preset is a full `[data-theme="<name>"]` block that redefines all relevant custom properties. The `:root` block remains the **Dia** (warm light) fallback.

```css
/* src/index.css — existing Dia block stays as :root */

[data-theme="midnight"] {
  /* moved from existing [data-theme="dark"] */
}

[data-theme="ocean"] {
  /* cool blue light */
}

[data-theme="forest"] {
  /* warm green-tinted */
}
```

### 4.2 Removal

The existing `@media (prefers-color-scheme: dark)` block is **removed**. System mode is handled by JavaScript so it can map to the correct named preset (`midnight` for dark, `dia` for light).

### 4.3 Accent override

Accent color is applied at runtime by injecting a `<style id="accent-override">` tag. This tag overrides only accent-related variables:

```css
:root,
[data-theme] {
  --accent-primary: <hex>;
  --accent-soft: <hex-10%>;
  --accent-light: <hex-10%>;
  --accent-text: <computed>;
  --accent-gradient: linear-gradient(135deg, <hex> 0%, <hex2> 100%);
  --omnibox-ring: <hex-20%>;
}
```

The override style is placed after preset styles in the cascade, so it wins.

---

## 5. `useTheme` Hook

### 5.1 Responsibilities

- Read `theme` and `accentColor` from settings on mount.
- Resolve `system` to `dia` (light OS) or `midnight` (dark OS).
- Set `document.documentElement.dataset.theme = resolvedPreset`.
- Inject / update / remove the `accent-override` `<style>` tag.
- Listen for `settings:changed` events for live updates.
- In `system` mode, attach a `matchMedia('prefers-color-scheme: dark')` listener to re-apply the theme when the OS switches.

### 5.2 File

`src/hooks/useTheme.ts`

### 5.3 Accent color computation helpers

```typescript
// src/utils/theme.ts

/** Convert hex #RRGGBB to rgba(r, g, b, a) string. */
export function hexToRgba(hex: string, alpha: number): string;

/** Compute a contrasting text color (white or near-black) for a given accent. */
export function getContrastTextColor(hex: string): string;

/** Build the CSS text for the accent override style tag. */
export function buildAccentStyle(accentColor: string): string;

/** Resolve a theme setting to a concrete preset name. */
export function resolveTheme(theme: Settings['theme']): 'dia' | 'midnight' | 'ocean' | 'forest';
```

---

## 6. Settings UI Updates

### 6.1 Theme dropdown

In `src/components/overlays/SettingsPanel.tsx`, replace the existing theme options:

```tsx
options={[
  ['system', 'Match system'],
  ['dia', 'Dia'],
  ['midnight', 'Midnight'],
  ['ocean', 'Ocean'],
  ['forest', 'Forest'],
]}
```

### 6.2 Accent color picker

Add below the theme selector:

```tsx
<Field label="Accent color">
  <div className="flex items-center gap-2">
    <input
      type="color"
      value={settings?.accentColor ?? ''}
      onChange={(e) => update('accentColor', e.target.value)}
      className="w-8 h-8 rounded cursor-pointer"
    />
    {settings?.accentColor && (
      <button
        className="text-xs underline"
        onClick={() => update('accentColor', '')}
      >
        Reset to default
      </button>
    )}
  </div>
</Field>
```

When `accentColor` is empty, the preset's built-in accent is used.

---

## 7. Integration Point

Call `useTheme()` once in `src/App.tsx`, before the return:

```tsx
const App: React.FC = () => {
  useTabs();
  useKeyboardShortcuts();
  useMenuCommands();
  useLlmsTxtGuide();
  useAskFromSelection();
  useTheme(); // <-- new
  // ...
};
```

---

## 8. System Sync

When `theme === 'system'`:

1. On mount, read `prefers-color-scheme` and resolve to `dia` (light) or `midnight` (dark).
2. Attach a `change` listener on the `matchMedia` query.
3. On OS switch, re-resolve and update `dataset.theme`.
4. Cleanup the listener on unmount.

No FOUC risk — the `:root` fallback is Dia light, and the hook runs immediately on React mount (before paint in most cases).

---

## 9. Migration

### 9.1 SettingsManager migration

In `.electron/services/SettingsManager.ts` `load()`:

```typescript
private load(): Settings {
  try {
    const data = fs.readFileSync(this.settingsPath, 'utf-8');
    const parsed = JSON.parse(data);
    // Theme migration
    if (parsed.theme === 'light') parsed.theme = 'dia';
    if (parsed.theme === 'dark') parsed.theme = 'midnight';
    if (parsed.schemaVersion !== DEFAULT_SETTINGS.schemaVersion) {
      return { ...DEFAULT_SETTINGS, ...parsed, schemaVersion: DEFAULT_SETTINGS.schemaVersion };
    }
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
```

### 9.2 Schema version bump

Bump `schemaVersion` from `1` to `2` in `shared/constants.ts` so existing users get the migration path.

---

## 10. Testing

### 10.1 Unit: `useTheme` hook

File: `tests/unit/hooks/useTheme.test.ts`

- Reads theme from `settings:getAll` and sets `dataset.theme`.
- Resolves `system` to `dia` when OS is light.
- Resolves `system` to `midnight` when OS is dark.
- Injects `accent-override` style when `accentColor` is set.
- Removes `accent-override` when `accentColor` is cleared.
- Reacts to `settings:changed` event.
- Attaches / cleans up `matchMedia` listener in system mode.

### 10.2 Unit: theme utilities

File: `tests/unit/utils/theme.test.ts`

- `hexToRgba('#d44d7a', 0.1)` → `'rgba(212, 77, 122, 0.1)'`
- `getContrastTextColor('#ffffff')` → `'#1a1612'` (dark)
- `getContrastTextColor('#1a1612')` → `'#ffffff'` (light)
- `resolveTheme('system')` with light OS → `'dia'`
- `resolveTheme('midnight')` → `'midnight'`

### 10.3 Unit: SettingsManager migration

File: `tests/unit/services/SettingsManager.test.ts` (new or existing)

- Loading a file with `theme: 'light'` migrates to `'dia'`.
- Loading a file with `theme: 'dark'` migrates to `'midnight'`.
- Loading a file with `theme: 'system'` stays `'system'`.

### 10.4 Coverage targets

All new code must hit 90%+ lines/functions/branches/statements. The `useTheme` hook and utility functions are on the critical path (settings → UI), so target 95%+.

---

## 11. Files Modified / Created

| File | Action | Description |
|------|--------|-------------|
| `src/index.css` | Edit | Add `[data-theme="ocean"]` and `[data-theme="forest"]`, remove `@media (prefers-color-scheme: dark)` |
| `src/types/browser.ts` | Edit | Update `Settings.theme` type |
| `shared/constants.ts` | Edit | Update `DEFAULT_SETTINGS.theme` default, bump `schemaVersion` |
| `.electron/services/SettingsManager.ts` | Edit | Add theme migration in `load()` |
| `src/utils/theme.ts` | Create | `hexToRgba`, `getContrastTextColor`, `buildAccentStyle`, `resolveTheme` |
| `src/hooks/useTheme.ts` | Create | Theme application hook |
| `src/App.tsx` | Edit | Call `useTheme()` |
| `src/components/overlays/SettingsPanel.tsx` | Edit | Update theme options, add accent color picker |
| `tests/unit/hooks/useTheme.test.ts` | Create | Unit tests for `useTheme` |
| `tests/unit/utils/theme.test.ts` | Create | Unit tests for theme utilities |
| `tests/unit/services/SettingsManager.test.ts` | Create | Unit tests for SettingsManager migration |

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| FOUC on startup (wrong colors flash before JS runs) | `:root` fallback is Dia light (the most common case); hook runs at `App` mount before paint |
| Accent color override conflicts with preset CSS | Injected style uses `:root, [data-theme]` selector and is appended to `<head>` after preset CSS |
| `matchMedia` listener memory leak | Cleanup in `useEffect` return |
| Existing users with `'light'`/`'dark'` values break | Migration in `SettingsManager.load()` maps them automatically; schemaVersion bump ensures merge |
| Color contrast failures with arbitrary accentColor | `getContrastTextColor` computes a safe text color based on luminance |

---

## 13. Out of Scope

- Theme import/export (user-defined JSON themes).
- Per-site theming.
- Animated theme transitions.
- Web page content theming (only the browser chrome is affected).

---

*Approved by user on 2026-05-27.*
