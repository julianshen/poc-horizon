# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Cmd/Ctrl+T keyboard shortcut creates a tab
- Location: tests/e2e/smoke.spec.ts:40:5

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]: Horizon
  - generic [ref=e5]:
    - button "←" [disabled] [ref=e6]
    - button "→" [disabled] [ref=e7]
    - button "↻" [ref=e8]
    - generic [ref=e10]:
      - text: ⚠️
      - textbox [ref=e11]
    - button "⋮" [ref=e12]
  - button "+" [ref=e14]
```

# Test source

```ts
  1  | import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
  2  | import path from 'path';
  3  | 
  4  | // E2E smoke against the built Electron app. Run with `npm run test:e2e`
  5  | // after `npm run build` — the spec launches dist-electron/main.js via
  6  | // Playwright's _electron API.
  7  | 
  8  | let app: ElectronApplication;
  9  | let firstWindow: Page;
  10 | 
  11 | test.beforeAll(async () => {
  12 |   app = await electron.launch({
  13 |     args: [path.join(__dirname, '../../dist-electron/main.js')],
  14 |     timeout: 20_000,
  15 |   });
  16 |   firstWindow = await app.firstWindow();
  17 |   await firstWindow.waitForLoadState('domcontentloaded');
  18 | });
  19 | 
  20 | test.afterAll(async () => {
  21 |   await app?.close();
  22 | });
  23 | 
  24 | test('app launches and shows the browser chrome', async () => {
  25 |   // The TitleBar / TabBar / Toolbar should render. Smoke check: the
  26 |   // Omnibox input is present (placeholder-less; identify via role).
  27 |   const input = firstWindow.getByRole('textbox');
  28 |   await expect(input).toBeVisible();
  29 | });
  30 | 
  31 | test('new-tab button creates a tab', async () => {
  32 |   // The "+" button in the TabBar.
  33 |   const plus = firstWindow.getByText('+', { exact: true }).first();
  34 |   await plus.click();
  35 |   // After clicking, the TabBar should have at least one tab whose
  36 |   // title resolves to "New Tab" (or the loading favicon-less placeholder).
  37 |   await expect(firstWindow.getByText('New Tab').first()).toBeVisible({ timeout: 5_000 });
  38 | });
  39 | 
  40 | test('Cmd/Ctrl+T keyboard shortcut creates a tab', async () => {
  41 |   const beforeCount = await firstWindow.locator('.cursor-pointer').count();
  42 |   await firstWindow.keyboard.press('ControlOrMeta+t');
  43 |   await firstWindow.waitForTimeout(500); // give IPC + tab:created broadcast a tick
  44 |   const afterCount = await firstWindow.locator('.cursor-pointer').count();
> 45 |   expect(afterCount).toBeGreaterThan(beforeCount);
     |                      ^ Error: expect(received).toBeGreaterThan(expected)
  46 | });
  47 | 
```