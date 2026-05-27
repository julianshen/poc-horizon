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
  theme: "system" | "dia" | "midnight" | "ocean" | "forest";
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
  theme: "system" as const,
  accentColor: "", // empty = use preset default
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
  --chrome-bg: #08090c;
  --chrome-bg-top: rgba(8, 9, 12, 0.9);
  --chrome-bg-chrome: rgba(13, 15, 20, 0.8);
  --chrome-fg: #f3f3f5;
  --chrome-fg-muted: #9a9ca8;
  --chrome-fg-subtle: #5d5f6b;
  --chrome-border: rgba(255, 255, 255, 0.06);
  --chrome-border-strong: rgba(255, 255, 255, 0.14);
  --surface-1: #13151b;
  --surface-2: #191b22;
  --surface-hover: #22242d;
  --surface-overlay: rgba(19, 21, 27, 0.85);
  --tab-bg-active: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.06),
    rgba(255, 255, 255, 0.02)
  );
  --tab-bg-hover: rgba(255, 255, 255, 0.04);
  --tab-shadow-active:
    0 1px 0 rgba(255, 255, 255, 0.06) inset,
    0 0 0 0.5px rgba(255, 255, 255, 0.14);
  --omnibox-bg: #13151b;
  --omnibox-bg-focus: #191b22;
  --omnibox-ring: rgba(232, 163, 104, 0.2);
  --accent-primary: #e8a368;
  --accent-soft: rgba(232, 163, 104, 0.14);
  --accent-light: rgba(232, 163, 104, 0.14);
  --accent-text: #1a1612;
  --accent-gradient: linear-gradient(135deg, #e8a368 0%, #c44a7e 100%);
  --ai-accent: #e8a368;
  --ai-tint: rgba(232, 163, 104, 0.08);
}

[data-theme="ocean"] {
  --chrome-bg: #f4f7fa;
  --chrome-bg-top: rgba(237, 243, 248, 0.92);
  --chrome-bg-chrome: rgba(244, 247, 250, 0.85);
  --chrome-fg: #0f1a26;
  --chrome-fg-muted: #4a6070;
  --chrome-fg-subtle: #7a94a8;
  --chrome-border: rgba(10, 25, 40, 0.06);
  --chrome-border-strong: rgba(10, 25, 40, 0.14);
  --surface-1: #ffffff;
  --surface-2: #ebf1f7;
  --surface-hover: rgba(0, 30, 60, 0.04);
  --surface-overlay: rgba(235, 241, 247, 0.92);
  --tab-bg-active: rgba(255, 255, 255, 0.9);
  --tab-bg-hover: rgba(0, 30, 60, 0.04);
  --tab-shadow-active:
    0 1px 3px rgba(10, 25, 40, 0.06), 0 0 0 0.5px rgba(10, 25, 40, 0.06);
  --omnibox-bg: #ffffff;
  --omnibox-bg-focus: #ffffff;
  --omnibox-ring: rgba(42, 130, 200, 0.18);
  --accent-primary: #2a82c8;
  --accent-soft: rgba(42, 130, 200, 0.1);
  --accent-light: rgba(42, 130, 200, 0.1);
  --accent-text: #ffffff;
  --accent-gradient: linear-gradient(135deg, #2a82c8 0%, #5eb8e8 100%);
  --ai-accent: #2a82c8;
  --ai-tint: rgba(42, 130, 200, 0.07);
}

[data-theme="forest"] {
  --chrome-bg: #f5f7f2;
  --chrome-bg-top: rgba(238, 244, 234, 0.92);
  --chrome-bg-chrome: rgba(245, 247, 242, 0.85);
  --chrome-fg: #162014;
  --chrome-fg-muted: #4f5e48;
  --chrome-fg-subtle: #7e8e74;
  --chrome-border: rgba(15, 30, 12, 0.06);
  --chrome-border-strong: rgba(15, 30, 12, 0.14);
  --surface-1: #ffffff;
  --surface-2: #ecf0e8;
  --surface-hover: rgba(20, 50, 15, 0.04);
  --surface-overlay: rgba(236, 240, 232, 0.92);
  --tab-bg-active: rgba(255, 255, 255, 0.9);
  --tab-bg-hover: rgba(20, 50, 15, 0.04);
  --tab-shadow-active:
    0 1px 3px rgba(15, 30, 12, 0.06), 0 0 0 0.5px rgba(15, 30, 12, 0.06);
  --omnibox-bg: #ffffff;
  --omnibox-bg-focus: #ffffff;
  --omnibox-ring: rgba(70, 150, 80, 0.18);
  --accent-primary: #469650;
  --accent-soft: rgba(70, 150, 80, 0.1);
  --accent-light: rgba(70, 150, 80, 0.1);
  --accent-text: #ffffff;
  --accent-gradient: linear-gradient(135deg, #469650 0%, #82c860 100%);
  --ai-accent: #469650;
  --ai-tint: rgba(70, 150, 80, 0.07);
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
  --accent-gradient: linear-gradient(135deg, <hex> 0%, <hex-lightened> 100%);
  --omnibox-ring: <hex-20%>;
}
```

**Notes:**

- `--accent-soft` and `--accent-light` both resolve to the same 10% opacity value. They are separate variables for semantic clarity (`--accent-soft` is used for button/tab hover backgrounds; `--accent-light` is used for pills and badges).
- The override style is appended to `<head>` after the main CSS so it wins in the cascade.
- If `accentColor` is empty, invalid, or not a 3/6-digit hex string, the `accent-override` tag is removed and the preset's default accent is used.
- `<hex-lightened>` is derived by shifting the accent color's HSL lightness by +15% (clamped to 100%). A `lightenColor(hex: string, amount: number): string` helper in `src/utils/theme.ts` performs this via RGB → HSL → adjust L → RGB → hex.

---

## 5. `useTheme` Hook

### 5.1 Responsibilities

1. **Read settings on mount** via `window.horizonAPI.invoke('settings:getAll', {})`. Extract `theme` and `accentColor`.
   - If the invoke rejects or returns `null`, fall back to `DEFAULT_SETTINGS.theme` and `DEFAULT_SETTINGS.accentColor`.
2. **Resolve `system`** to `dia` (light OS) or `midnight` (dark OS) using `resolveTheme(theme, isDarkOS)`.
3. **Set `document.documentElement.dataset.theme = resolvedPreset`**.
4. **Inject / update / remove** the `accent-override` `<style>` tag based on `accentColor`.
5. **Listen for `settings:changed`** events via `window.horizonAPI.on('settings:changed', callback)`. The callback receives `{ key: string; value: unknown }`. On event:
   - If `key === 'theme'`, re-resolve and update `dataset.theme`.
   - If `key === 'accentColor'`, re-apply the accent override.
6. **In `system` mode**, attach a `matchMedia('prefers-color-scheme: dark')` listener. When the OS switches, re-resolve and update `dataset.theme`.
7. **Cleanup** all listeners on unmount: unsubscribe from `settings:changed` via the returned unsubscribe function, and remove the `matchMedia` listener. Also remove `matchMedia` listener when the user switches from `system` to a named preset (to avoid listener leaks during live theme changes).

### 5.2 File and signature

```typescript
// src/hooks/useTheme.ts
export function useTheme(): void;
```

### 5.3 Accent color computation helpers

```typescript
// src/utils/theme.ts

/** Convert hex #RRGGBB to rgba(r, g, b, a) string. Returns '' for invalid input. */
export function hexToRgba(hex: string, alpha: number): string;

/** Compute a contrasting text color (white or near-black) for a given accent. */
export function getContrastTextColor(hex: string): string;

/** Lighten a hex color by shifting HSL lightness +amount% (0–100). Returns '' for invalid input. */
export function lightenColor(hex: string, amount: number): string;

/** Build the CSS text for the accent override style tag. Returns '' for invalid accentColor. */
export function buildAccentStyle(accentColor: string): string;

/** Resolve a theme setting to a concrete preset name. */
export function resolveTheme(
  theme: Settings["theme"],
  isDarkOS: boolean,
): "dia" | "midnight" | "ocean" | "forest";
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
      value={settings?.accentColor || "#d44d7a"}
      onChange={(e) => update("accentColor", e.target.value)}
      className="w-8 h-8 rounded cursor-pointer"
    />
    {settings?.accentColor ? (
      <button
        className="text-xs underline"
        onClick={() => update("accentColor", "")}
      >
        Reset to default
      </button>
    ) : (
      <span className="text-xs" style={{ color: "var(--chrome-fg-subtle)" }}>
        Using preset default
      </span>
    )}
  </div>
</Field>
```

**Behavior:**

- `input[type="color"]` always shows a valid hex value. When `accentColor` is empty, it falls back to the Dia default (`#d44d7a`) as a visual placeholder. The empty string in settings still means "use preset default."
- Clicking "Reset to default" sets `accentColor` to `''`, which removes the `accent-override` style tag and restores the preset's built-in accent.

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
4. Cleanup the listener on unmount **and** when the user switches from `system` to a named preset (to prevent memory leaks and unnecessary updates).

**FOUC trade-off:** The `@media (prefers-color-scheme: dark)` block is removed, so for a brief window before React mounts, a dark-OS user may see Dia (light) colors. The `:root` fallback is intentionally Dia light because it is the most common default. The hook runs at `App` mount, which typically occurs before first paint.

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
    const validThemes: string[] = ['system', 'dia', 'midnight', 'ocean', 'forest'];
    if (parsed.theme && !validThemes.includes(parsed.theme)) {
      parsed.theme = DEFAULT_SETTINGS.theme;
    }
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
- Detaches `matchMedia` listener when user switches from `system` to a named preset.
- Unsubscribes from `settings:changed` on unmount.
- Falls back to `DEFAULT_SETTINGS` values when `settings:getAll` rejects.

### 10.2 Unit: theme utilities

File: `tests/unit/utils/theme.test.ts`

- `hexToRgba('#d44d7a', 0.1)` → `'rgba(212, 77, 122, 0.1)'`
- `hexToRgba('invalid', 0.1)` → `''`
- `getContrastTextColor('#ffffff')` → `'#1a1612'` (dark)
- `getContrastTextColor('#1a1612')` → `'#ffffff'` (light)
- `lightenColor('#2a82c8', 15)` → a lighter blue hex (≈ `#5eb8e8`)
- `lightenColor('invalid', 15)` → `''`
- `buildAccentStyle('')` → `''`
- `buildAccentStyle('invalid')` → `''`
- `buildAccentStyle('#2a82c8')` contains the lightened secondary gradient stop.
- `resolveTheme('system', false)` → `'dia'`
- `resolveTheme('system', true)` → `'midnight'`
- `resolveTheme('midnight', false)` → `'midnight'`
- `resolveTheme('ocean', true)` → `'ocean'`

### 10.3 Unit: SettingsManager migration

File: `tests/unit/services/SettingsManager.test.ts` (new or existing)

- Loading a file with `theme: 'light'` migrates to `'dia'`.
- Loading a file with `theme: 'dark'` migrates to `'midnight'`.
- Loading a file with `theme: 'system'` stays `'system'`.

### 10.4 Coverage targets

All new code must hit 90%+ lines/functions/branches/statements. The `useTheme` hook and utility functions are on the critical path (settings → UI), so target 95%+.

---

## 11. Files Modified / Created

| File                                          | Action | Description                                                                                          |
| --------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `src/index.css`                               | Edit   | Add `[data-theme="ocean"]` and `[data-theme="forest"]`, remove `@media (prefers-color-scheme: dark)` |
| `src/types/browser.ts`                        | Edit   | Update `Settings.theme` type                                                                         |
| `shared/constants.ts`                         | Edit   | Update `DEFAULT_SETTINGS.theme` default, bump `schemaVersion`                                        |
| `.electron/services/SettingsManager.ts`       | Edit   | Add theme migration in `load()`                                                                      |
| `src/utils/theme.ts`                          | Create | `hexToRgba`, `getContrastTextColor`, `lightenColor`, `buildAccentStyle`, `resolveTheme`              |
| `src/hooks/useTheme.ts`                       | Create | Theme application hook                                                                               |
| `src/App.tsx`                                 | Edit   | Call `useTheme()`                                                                                    |
| `src/components/overlays/SettingsPanel.tsx`   | Edit   | Update theme options, add accent color picker                                                        |
| `tests/unit/hooks/useTheme.test.ts`           | Create | Unit tests for `useTheme`                                                                            |
| `tests/unit/utils/theme.test.ts`              | Create | Unit tests for theme utilities                                                                       |
| `tests/unit/services/SettingsManager.test.ts` | Create | Unit tests for SettingsManager migration                                                             |

---

## 12. Risks & Mitigations

| Risk                                                | Mitigation                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| FOUC on startup (wrong colors flash before JS runs) | `:root` fallback is Dia light (the most common case); hook runs at `App` mount before paint     |
| Accent color override conflicts with preset CSS     | Injected style uses `:root, [data-theme]` selector and is appended to `<head>` after preset CSS |
| `matchMedia` listener memory leak                   | Cleanup in `useEffect` return                                                                   |
| Existing users with `'light'`/`'dark'` values break | Migration in `SettingsManager.load()` maps them automatically; schemaVersion bump ensures merge |
| Color contrast failures with arbitrary accentColor  | `getContrastTextColor` computes a safe text color based on luminance                            |

---

## 13. Out of Scope

- Theme import/export (user-defined JSON themes).
- Per-site theming.
- Animated theme transitions.
- Web page content theming (only the browser chrome is affected).

---

_Approved by user on 2026-05-27._
