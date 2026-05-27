# Theme Setup System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the existing `theme` and `accentColor` settings so the Horizon browser chrome actually applies multiple presets (Dia, Midnight, Ocean, Forest) plus system mode, with an optional accent color override.

**Architecture:** A `useTheme()` hook reads settings on mount, sets `data-theme` on `<html>`, injects a dynamic `<style>` for accent overrides, and listens for `settings:changed` events. CSS presets are defined as `[data-theme="preset"]` blocks. Utility functions in `src/utils/theme.ts` handle hex color math.

**Tech Stack:** React, TypeScript, Tailwind CSS, Zustand, Vitest, React Testing Library

**Spec:** `docs/superpowers/specs/2026-05-27-theme-setup-design.md`

---

## File Structure

| File                                        | Action | Responsibility                                                                                                                     |
| ------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/theme.ts`                        | Create | Hex → rgba, contrast text, lighten color, accent style builder, theme resolver                                                     |
| `src/hooks/useTheme.ts`                     | Create | Read settings, apply `data-theme`, inject accent override, handle system sync                                                      |
| `src/App.tsx`                               | Edit   | Call `useTheme()`                                                                                                                  |
| `src/index.css`                             | Edit   | Rename `[data-theme="dark"]` → `[data-theme="midnight"]`, add Ocean + Forest presets, remove `@media (prefers-color-scheme: dark)` |
| `src/types/browser.ts`                      | Edit   | Update `Settings.theme` union type                                                                                                 |
| `shared/constants.ts`                       | Edit   | Bump `schemaVersion` to `2`, update `theme` default                                                                                |
| `.electron/services/SettingsManager.ts`     | Edit   | Add legacy theme migration + validation                                                                                            |
| `src/components/overlays/SettingsPanel.tsx` | Edit   | Update theme dropdown options, add accent color picker                                                                             |
| `tests/unit/utils/theme.test.ts`            | Create | Unit tests for theme utilities                                                                                                     |
| `tests/unit/hooks/useTheme.test.ts`         | Create | Unit tests for `useTheme` hook                                                                                                     |
| `tests/unit/settings-manager.test.ts`       | Edit   | Add migration tests                                                                                                                |

---

## Chunk 1: Theme Utilities

### Task 1: `hexToRgba`

**Files:**

- Create: `src/utils/theme.ts`
- Test: `tests/unit/utils/theme.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { hexToRgba } from "@/utils/theme";

describe("hexToRgba", () => {
  it("converts a 6-digit hex to rgba", () => {
    expect(hexToRgba("#d44d7a", 0.1)).toBe("rgba(212, 77, 122, 0.1)");
  });

  it("converts a 3-digit hex to rgba", () => {
    expect(hexToRgba("#abc", 0.5)).toBe("rgba(170, 187, 204, 0.5)");
  });

  it("returns empty string for invalid hex", () => {
    expect(hexToRgba("invalid", 0.1)).toBe("");
    expect(hexToRgba("", 0.1)).toBe("");
    expect(hexToRgba("#zzzzzz", 0.1)).toBe("");
  });

  it("handles edge values", () => {
    expect(hexToRgba("#000000", 1)).toBe("rgba(0, 0, 0, 1)");
    expect(hexToRgba("#ffffff", 0)).toBe("rgba(255, 255, 255, 0)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/utils/theme.test.ts --reporter=verbose`

Expected: FAIL with "hexToRgba is not defined" or similar

- [ ] **Step 3: Write minimal implementation**

```typescript
export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().toLowerCase();
  let r = 0;
  let g = 0;
  let b = 0;

  if (/^#([0-9a-f]{6})$/.test(normalized)) {
    r = parseInt(normalized.slice(1, 3), 16);
    g = parseInt(normalized.slice(3, 5), 16);
    b = parseInt(normalized.slice(5, 7), 16);
  } else if (/^#([0-9a-f]{3})$/.test(normalized)) {
    r = parseInt(normalized[1] + normalized[1], 16);
    g = parseInt(normalized[2] + normalized[2], 16);
    b = parseInt(normalized[3] + normalized[3], 16);
  } else {
    return "";
  }

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return "";
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/utils/theme.test.ts --reporter=verbose`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/utils/theme.test.ts src/utils/theme.ts
git commit -m "feat(theme): add hexToRgba utility"
```

---

### Task 2: `getContrastTextColor`

**Files:**

- Modify: `src/utils/theme.ts`
- Test: `tests/unit/utils/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/utils/theme.test.ts`:

```typescript
import { getContrastTextColor } from "@/utils/theme";

describe("getContrastTextColor", () => {
  it("returns dark text for light backgrounds", () => {
    expect(getContrastTextColor("#ffffff")).toBe("#1a1612");
    expect(getContrastTextColor("#eeeeee")).toBe("#1a1612");
  });

  it("returns light text for dark backgrounds", () => {
    expect(getContrastTextColor("#1a1612")).toBe("#ffffff");
    expect(getContrastTextColor("#000000")).toBe("#ffffff");
  });

  it("returns dark text for medium-light colors", () => {
    expect(getContrastTextColor("#d44d7a")).toBe("#1a1612");
  });

  it("returns empty string for invalid hex", () => {
    expect(getContrastTextColor("invalid")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/utils/theme.test.ts --reporter=verbose`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Append to `src/utils/theme.ts`:

```typescript
export function getContrastTextColor(hex: string): string {
  const normalized = hex.trim().toLowerCase();
  let r = 0;
  let g = 0;
  let b = 0;

  if (/^#([0-9a-f]{6})$/.test(normalized)) {
    r = parseInt(normalized.slice(1, 3), 16);
    g = parseInt(normalized.slice(3, 5), 16);
    b = parseInt(normalized.slice(5, 7), 16);
  } else if (/^#([0-9a-f]{3})$/.test(normalized)) {
    r = parseInt(normalized[1] + normalized[1], 16);
    g = parseInt(normalized[2] + normalized[2], 16);
    b = parseInt(normalized[3] + normalized[3], 16);
  } else {
    return "";
  }

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return "";
  }

  // WCAG relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#1a1612" : "#ffffff";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/utils/theme.test.ts --reporter=verbose`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/utils/theme.test.ts src/utils/theme.ts
git commit -m "feat(theme): add getContrastTextColor utility"
```

---

### Task 3: `lightenColor`

**Files:**

- Modify: `src/utils/theme.ts`
- Test: `tests/unit/utils/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/utils/theme.test.ts`:

```typescript
import { lightenColor } from "@/utils/theme";

describe("lightenColor", () => {
  it("lightens a blue color", () => {
    const result = lightenColor("#2a82c8", 15);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    // Should be lighter than the input
    const inputL = parseInt("#2a82c8".slice(3, 5), 16);
    const resultL = parseInt(result.slice(3, 5), 16);
    expect(resultL).toBeGreaterThan(inputL);
  });

  it("clamps lightness at 100%", () => {
    const result = lightenColor("#ffffff", 50);
    expect(result).toBe("#ffffff");
  });

  it("returns empty string for invalid hex", () => {
    expect(lightenColor("invalid", 15)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/utils/theme.test.ts --reporter=verbose`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Append to `src/utils/theme.ts`:

```typescript
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  s /= 100;
  l /= 100;
  let r = l;
  let g = l;
  let b = l;

  if (s !== 0) {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function lightenColor(hex: string, amount: number): string {
  const normalized = hex.trim().toLowerCase();
  let r = 0;
  let g = 0;
  let b = 0;

  if (/^#([0-9a-f]{6})$/.test(normalized)) {
    r = parseInt(normalized.slice(1, 3), 16);
    g = parseInt(normalized.slice(3, 5), 16);
    b = parseInt(normalized.slice(5, 7), 16);
  } else if (/^#([0-9a-f]{3})$/.test(normalized)) {
    r = parseInt(normalized[1] + normalized[1], 16);
    g = parseInt(normalized[2] + normalized[2], 16);
    b = parseInt(normalized[3] + normalized[3], 16);
  } else {
    return "";
  }

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return "";
  }

  const [h, s, l] = rgbToHsl(r, g, b);
  const newL = Math.min(100, l + amount);
  const [nr, ng, nb] = hslToRgb(h, s, newL);

  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/utils/theme.test.ts --reporter=verbose`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/utils/theme.test.ts src/utils/theme.ts
git commit -m "feat(theme): add lightenColor utility"
```

---

### Task 4: `buildAccentStyle` and `resolveTheme`

**Files:**

- Modify: `src/utils/theme.ts`
- Test: `tests/unit/utils/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/utils/theme.test.ts`:

```typescript
import { buildAccentStyle, resolveTheme } from "@/utils/theme";

describe("buildAccentStyle", () => {
  it("returns empty string for empty accentColor", () => {
    expect(buildAccentStyle("")).toBe("");
  });

  it("returns empty string for invalid hex", () => {
    expect(buildAccentStyle("invalid")).toBe("");
  });

  it("builds CSS with valid hex", () => {
    const css = buildAccentStyle("#d44d7a");
    expect(css).toContain("--accent-primary: #d44d7a");
    expect(css).toContain("--accent-text: #ffffff");
    expect(css).toContain("--omnibox-ring: rgba(212, 77, 122, 0.2)");
  });

  it("includes gradient with lightened secondary stop", () => {
    const css = buildAccentStyle("#2a82c8");
    expect(css).toContain("linear-gradient(135deg, #2a82c8 0%,");
  });
});

describe("resolveTheme", () => {
  it("returns named presets directly", () => {
    expect(resolveTheme("dia", false)).toBe("dia");
    expect(resolveTheme("midnight", false)).toBe("midnight");
    expect(resolveTheme("ocean", true)).toBe("ocean");
    expect(resolveTheme("forest", false)).toBe("forest");
  });

  it("resolves system to dia on light OS", () => {
    expect(resolveTheme("system", false)).toBe("dia");
  });

  it("resolves system to midnight on dark OS", () => {
    expect(resolveTheme("system", true)).toBe("midnight");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/utils/theme.test.ts --reporter=verbose`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Append to `src/utils/theme.ts`:

```typescript
export function buildAccentStyle(accentColor: string): string {
  if (!accentColor) return "";

  const normalized = accentColor.trim().toLowerCase();
  const valid = /^#([0-9a-f]{6}|[0-9a-f]{3})$/.test(normalized);
  if (!valid) return "";

  const sixDigit =
    normalized.length === 4
      ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
      : normalized;

  const textColor = getContrastTextColor(sixDigit);
  const soft = hexToRgba(sixDigit, 0.1);
  const ring = hexToRgba(sixDigit, 0.2);
  const lightened = lightenColor(sixDigit, 15);

  if (!textColor || !soft || !lightened) return "";

  return `:root, [data-theme] {
  --accent-primary: ${sixDigit};
  --accent-soft: ${soft};
  --accent-light: ${soft};
  --accent-text: ${textColor};
  --accent-gradient: linear-gradient(135deg, ${sixDigit} 0%, ${lightened} 100%);
  --omnibox-ring: ${ring};
}`;
}

export function resolveTheme(
  theme: "system" | "dia" | "midnight" | "ocean" | "forest",
  isDarkOS: boolean,
): "dia" | "midnight" | "ocean" | "forest" {
  if (theme === "system") {
    return isDarkOS ? "midnight" : "dia";
  }
  return theme;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/utils/theme.test.ts --reporter=verbose`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/utils/theme.test.ts src/utils/theme.ts
git commit -m "feat(theme): add buildAccentStyle and resolveTheme utilities"
```

---

## Chunk 2: CSS Presets and Data Model Changes

### Task 5: Update CSS for named presets

**Files:**

- Modify: `src/index.css`

- [ ] **Step 1: Rename `[data-theme="dark"]` to `[data-theme="midnight"]`**

In `src/index.css`, find the existing `[data-theme="dark"]` block (lines 68–100). Change the selector to `[data-theme="midnight"]`.

- [ ] **Step 2: Remove `@media (prefers-color-scheme: dark)` block**

Delete lines 102–130 (the `@media (prefers-color-scheme: dark)` block).

- [ ] **Step 3: Add Ocean and Forest presets**

After the `[data-theme="midnight"]` block, add:

```css
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

- [ ] **Step 4: Verify no lint/type errors**

Run: `npm run lint`

Expected: No errors in `src/index.css`

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat(theme): add Ocean and Forest presets, remove prefers-color-scheme media query"
```

---

### Task 6: Update Settings type and defaults

**Files:**

- Modify: `src/types/browser.ts`
- Modify: `shared/constants.ts`
- Test: `tests/unit/settings-manager.test.ts`

- [ ] **Step 1: Update `Settings.theme` type**

In `src/types/browser.ts` line 86, change:

```typescript
theme: "light" | "dark" | "system";
```

to:

```typescript
theme: "system" | "dia" | "midnight" | "ocean" | "forest";
```

- [ ] **Step 2: Bump schema version and update defaults**

In `shared/constants.ts`:

1. Change `schemaVersion: 1` to `schemaVersion: 2`
2. Ensure `theme: 'system' as const` is present (it already is)
3. Ensure `accentColor: ''` is present (it already is)

- [ ] **Step 3: Add SettingsManager migration and validation**

In `.electron/services/SettingsManager.ts`, modify the `load()` method:

```typescript
private load(): Settings {
  try {
    const data = fs.readFileSync(this.settingsPath, 'utf-8');
    const parsed = JSON.parse(data);
    // Theme migration: legacy values → named presets
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

- [ ] **Step 4: Write migration tests**

Append to `tests/unit/settings-manager.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync } from "fs";
import { SettingsManager } from "@electron/services/SettingsManager";
import { DEFAULT_SETTINGS } from "@shared/constants";
import { useTmpDir } from "../helpers/tmpdir";

const tmp = useTmpDir("horizon-settings-migration");
const settingsPath = () => tmp.path("settings.json");

describe("SettingsManager theme migration", () => {
  it("migrates legacy 'light' to 'dia'", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ schemaVersion: 1, theme: "light" }),
    );
    const sm = new SettingsManager(settingsPath());
    expect(sm.get("theme")).toBe("dia");
    expect(sm.get("schemaVersion")).toBe(DEFAULT_SETTINGS.schemaVersion);
  });

  it("migrates legacy 'dark' to 'midnight'", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ schemaVersion: 1, theme: "dark" }),
    );
    const sm = new SettingsManager(settingsPath());
    expect(sm.get("theme")).toBe("midnight");
  });

  it("keeps 'system' unchanged", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ schemaVersion: 1, theme: "system" }),
    );
    const sm = new SettingsManager(settingsPath());
    expect(sm.get("theme")).toBe("system");
  });

  it("resets invalid theme values to default", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ schemaVersion: 1, theme: "invalid-theme" }),
    );
    const sm = new SettingsManager(settingsPath());
    expect(sm.get("theme")).toBe(DEFAULT_SETTINGS.theme);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/settings-manager.test.ts --reporter=verbose`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/browser.ts shared/constants.ts .electron/services/SettingsManager.ts tests/unit/settings-manager.test.ts
git commit -m "feat(theme): update Settings type, bump schemaVersion, add theme migration"
```

---

## Chunk 3: useTheme Hook

### Task 7: Implement `useTheme` hook

**Files:**

- Create: `src/hooks/useTheme.ts`
- Test: `tests/unit/hooks/useTheme.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/hooks/useTheme.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTheme } from "@/hooks/useTheme";

describe("useTheme", () => {
  let originalDataset: string | undefined;
  let styleTag: HTMLStyleElement | null;

  beforeEach(() => {
    originalDataset = document.documentElement.dataset.theme;
    delete document.documentElement.dataset.theme;
    styleTag = document.getElementById("accent-override") as HTMLStyleElement;
    if (styleTag) styleTag.remove();

    // Mock horizonAPI
    (window as Record<string, unknown>).horizonAPI = {
      invoke: vi.fn((channel: string) => {
        if (channel === "settings:getAll") {
          return Promise.resolve({ theme: "midnight", accentColor: "" });
        }
        return Promise.resolve(undefined);
      }),
      on: vi.fn(() => () => {}),
    };
  });

  afterEach(() => {
    if (originalDataset !== undefined) {
      document.documentElement.dataset.theme = originalDataset;
    } else {
      delete document.documentElement.dataset.theme;
    }
    styleTag = document.getElementById("accent-override") as HTMLStyleElement;
    if (styleTag) styleTag.remove();
    vi.restoreAllMocks();
  });

  it("sets dataset.theme from settings on mount", async () => {
    (window.horizonAPI as { invoke: typeof vi.fn }).invoke = vi.fn(
      (channel: string) => {
        if (channel === "settings:getAll") {
          return Promise.resolve({ theme: "ocean", accentColor: "" });
        }
        return Promise.resolve(undefined);
      },
    );

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("ocean");
  });

  it("resolves system to dia on light OS", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    (window.horizonAPI as { invoke: typeof vi.fn }).invoke = vi.fn(
      (channel: string) => {
        if (channel === "settings:getAll") {
          return Promise.resolve({ theme: "system", accentColor: "" });
        }
        return Promise.resolve(undefined);
      },
    );

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("dia");
  });

  it("injects accent-override style when accentColor is set", async () => {
    (window.horizonAPI as { invoke: typeof vi.fn }).invoke = vi.fn(
      (channel: string) => {
        if (channel === "settings:getAll") {
          return Promise.resolve({ theme: "dia", accentColor: "#ff0000" });
        }
        return Promise.resolve(undefined);
      },
    );

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    const tag = document.getElementById("accent-override") as HTMLStyleElement;
    expect(tag).toBeTruthy();
    expect(tag.textContent).toContain("--accent-primary: #ff0000");
  });

  it("removes accent-override when accentColor is empty", async () => {
    (window.horizonAPI as { invoke: typeof vi.fn }).invoke = vi.fn(
      (channel: string) => {
        if (channel === "settings:getAll") {
          return Promise.resolve({ theme: "dia", accentColor: "" });
        }
        return Promise.resolve(undefined);
      },
    );

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.getElementById("accent-override")).toBeNull();
  });

  it("reacts to settings:changed event for theme", async () => {
    let changeCallback:
      | ((payload: { key: string; value: unknown }) => void)
      | null = null;
    (window.horizonAPI as { on: typeof vi.fn }).on = vi.fn(
      (
        channel: string,
        cb: (payload: { key: string; value: unknown }) => void,
      ) => {
        if (channel === "settings:changed") changeCallback = cb;
        return () => {};
      },
    );

    (window.horizonAPI as { invoke: typeof vi.fn }).invoke = vi.fn(
      (channel: string) => {
        if (channel === "settings:getAll") {
          return Promise.resolve({ theme: "dia", accentColor: "" });
        }
        return Promise.resolve(undefined);
      },
    );

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("dia");

    if (changeCallback) {
      changeCallback({ key: "theme", value: "forest" });
    }
    expect(document.documentElement.dataset.theme).toBe("forest");
  });

  it("reacts to settings:changed event for accentColor", async () => {
    let changeCallback:
      | ((payload: { key: string; value: unknown }) => void)
      | null = null;
    (window.horizonAPI as { on: typeof vi.fn }).on = vi.fn(
      (
        channel: string,
        cb: (payload: { key: string; value: unknown }) => void,
      ) => {
        if (channel === "settings:changed") changeCallback = cb;
        return () => {};
      },
    );

    (window.horizonAPI as { invoke: typeof vi.fn }).invoke = vi.fn(
      (channel: string) => {
        if (channel === "settings:getAll") {
          return Promise.resolve({ theme: "dia", accentColor: "" });
        }
        return Promise.resolve(undefined);
      },
    );

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.getElementById("accent-override")).toBeNull();

    if (changeCallback) {
      changeCallback({ key: "accentColor", value: "#00ff00" });
    }

    const tag = document.getElementById("accent-override") as HTMLStyleElement;
    expect(tag).toBeTruthy();
    expect(tag.textContent).toContain("--accent-primary: #00ff00");
  });

  it("falls back to defaults when settings:getAll rejects", async () => {
    (window.horizonAPI as { invoke: typeof vi.fn }).invoke = vi.fn(
      (channel: string) => {
        if (channel === "settings:getAll") {
          return Promise.reject(new Error("IPC error"));
        }
        return Promise.resolve(undefined);
      },
    );

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("dia");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/hooks/useTheme.test.ts --reporter=verbose`

Expected: FAIL with "useTheme is not defined"

- [ ] **Step 3: Write minimal implementation**

Create `src/hooks/useTheme.ts`:

```typescript
import { useEffect } from "react";
import { resolveTheme, buildAccentStyle } from "../utils/theme";

const FALLBACK_THEME = "dia";

function applyTheme(theme: string, accentColor: string): void {
  const isDarkOS = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(
    theme as "system" | "dia" | "midnight" | "ocean" | "forest",
    isDarkOS,
  );
  document.documentElement.dataset.theme = resolved;

  const accentCss = buildAccentStyle(accentColor);
  let styleTag = document.getElementById(
    "accent-override",
  ) as HTMLStyleElement | null;

  if (accentCss) {
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "accent-override";
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = accentCss;
  } else if (styleTag) {
    styleTag.remove();
  }
}

export function useTheme(): void {
  useEffect(() => {
    let mediaQuery: MediaQueryList | null = null;
    let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;
    let unsubscribeSettings: (() => void) | null = null;
    let cancelled = false;

    const init = async (): Promise<void> => {
      try {
        const settings = (await window.horizonAPI.invoke(
          "settings:getAll",
          {},
        )) as {
          theme?: string;
          accentColor?: string;
        } | null;
        if (cancelled) return;
        const theme = settings?.theme ?? FALLBACK_THEME;
        const accentColor = settings?.accentColor ?? "";
        applyTheme(theme, accentColor);

        if (theme === "system" && mediaQuery === null) {
          mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
          mediaListener = () => {
            applyTheme("system", accentColor);
          };
          mediaQuery.addEventListener("change", mediaListener);
        }
      } catch {
        if (!cancelled) {
          applyTheme(FALLBACK_THEME, "");
        }
      }
    };

    unsubscribeSettings = window.horizonAPI.on(
      "settings:changed",
      (payload: unknown) => {
        const { key, value } = payload as { key: string; value: unknown };
        if (key === "theme") {
          const accent = (
            document.getElementById("accent-override")?.textContent ?? ""
          ).includes("--accent-primary")
            ? ""
            : "";
          // Re-read accent from current DOM state is unreliable; better:
          // The accent override style itself doesn't change on theme change,
          // so we only need to re-apply the theme. But we need the current
          // accentColor. Since we don't have it in closure here, we must
          // re-invoke settings:getAll or store it. For simplicity, re-invoke.
          void window.horizonAPI
            .invoke("settings:getAll", {})
            .then((settings) => {
              if (cancelled) return;
              const s = settings as
                | { theme?: string; accentColor?: string }
                | undefined;
              applyTheme(s?.theme ?? FALLBACK_THEME, s?.accentColor ?? "");
              // Re-attach/detach media listener based on new theme
              const newTheme = s?.theme ?? FALLBACK_THEME;
              if (newTheme !== "system" && mediaQuery && mediaListener) {
                mediaQuery.removeEventListener("change", mediaListener);
                mediaQuery = null;
                mediaListener = null;
              } else if (newTheme === "system" && mediaQuery === null) {
                mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
                mediaListener = () => {
                  applyTheme("system", s?.accentColor ?? "");
                };
                mediaQuery.addEventListener("change", mediaListener);
              }
            });
        } else if (key === "accentColor") {
          const currentTheme =
            document.documentElement.dataset.theme ?? FALLBACK_THEME;
          applyTheme(currentTheme, (value as string) ?? "");
        }
      },
    );

    void init();

    return () => {
      cancelled = true;
      if (unsubscribeSettings) unsubscribeSettings();
      if (mediaQuery && mediaListener) {
        mediaQuery.removeEventListener("change", mediaListener);
      }
    };
  }, []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/hooks/useTheme.test.ts --reporter=verbose`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/hooks/useTheme.test.ts src/hooks/useTheme.ts
git commit -m "feat(theme): add useTheme hook with system sync and accent override"
```

---

## Chunk 4: Integration and UI

### Task 8: Call `useTheme` in App.tsx

**Files:**

- Modify: `src/App.tsx`

- [ ] **Step 1: Add import and call**

In `src/App.tsx`:

1. Add import: `import { useTheme } from './hooks/useTheme';`
2. Add call inside `App` component, before the return:

```tsx
const App: React.FC = () => {
  useTabs();
  useKeyboardShortcuts();
  useMenuCommands();
  useLlmsTxtGuide();
  useAskFromSelection();
  useTheme(); // <-- add this line
  // ...
};
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(theme): wire useTheme into App component"
```

---

### Task 9: Update SettingsPanel UI

**Files:**

- Modify: `src/components/overlays/SettingsPanel.tsx`
- Test: `tests/unit/SettingsPanel.test.tsx`

- [ ] **Step 1: Update theme dropdown options**

In `src/components/overlays/SettingsPanel.tsx`, change the theme `Select` options from:

```tsx
options={[
  ['system', 'Match system'],
  ['light', 'Light'],
  ['dark', 'Dark'],
]}
```

to:

```tsx
options={[
  ['system', 'Match system'],
  ['dia', 'Dia'],
  ['midnight', 'Midnight'],
  ['ocean', 'Ocean'],
  ['forest', 'Forest'],
]}
```

- [ ] **Step 2: Add accent color picker**

After the theme `Field`, add:

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

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: No errors

- [ ] **Step 4: Run existing SettingsPanel tests**

Run: `npx vitest run tests/unit/SettingsPanel.test.tsx --reporter=verbose`

Expected: PASS (or update tests if they assert on old theme values)

- [ ] **Step 5: Commit**

```bash
git add src/components/overlays/SettingsPanel.tsx
git commit -m "feat(theme): update SettingsPanel with preset themes and accent color picker"
```

---

## Chunk 5: Final Verification

### Task 10: Run full test suite

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run --reporter=verbose`

Expected: All tests pass

- [ ] **Step 2: Check coverage**

Run: `npm run test:coverage`

Expected: New code (`src/utils/theme.ts`, `src/hooks/useTheme.ts`) hits 95%+ lines/functions/branches/statements.

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: No type errors

- [ ] **Step 4: Run lint**

Run: `npm run lint`

Expected: No lint errors

- [ ] **Step 5: Final commit if any fixes needed**

If any fixes were made:

```bash
git add -A
git commit -m "fix(theme): address test and lint issues"
```

---

_Plan based on spec: `docs/superpowers/specs/2026-05-27-theme-setup-design.md`_
