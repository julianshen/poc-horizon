import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';

// E2E smoke against the built Electron app. Run with `npm run test:e2e`
// after `npm run build` — the spec launches dist-electron/main.js via
// Playwright's _electron API.

let app: ElectronApplication;
let firstWindow: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '../../dist-electron/main.js')],
    env: { ...process.env, HORIZON_DISABLE_RESTORE: '1' },
    timeout: 20_000,
  });
  firstWindow = await app.firstWindow();
  await firstWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  try {
    await app?.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.destroy();
    });
  } catch {
    /* app might already be closed */
  }
  await app?.close().catch(() => undefined);
});

test('app launches and shows the browser chrome', async () => {
  const input = firstWindow.getByRole('textbox');
  await expect(input).toBeVisible();
});

test('initial tab appears in TabBar after app launches', async () => {
  // main.ts calls tabManager.createTab('https://duckduckgo.com') on startup.
  // The IPC broadcast lands on useTabs which adds it to the store; TabBar renders it.
  await expect(firstWindow.getByTestId('tab').first()).toBeVisible({ timeout: 10_000 });
});

test('new-tab-button click creates an additional tab', async () => {
  const before = await firstWindow.getByTestId('tab').count();
  await firstWindow.getByTestId('new-tab-button').click();
  await expect.poll(() => firstWindow.getByTestId('tab').count()).toBeGreaterThan(before);
});

test('Cmd/Ctrl+T keyboard shortcut creates an additional tab', async () => {
  const before = await firstWindow.getByTestId('tab').count();
  await firstWindow.keyboard.press('ControlOrMeta+t');
  await expect.poll(() => firstWindow.getByTestId('tab').count()).toBeGreaterThan(before);
});
