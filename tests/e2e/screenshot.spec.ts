import { test, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';

let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '../../dist-electron/main.js')],
    timeout: 20_000,
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // Wait for fonts + initial tab broadcast to settle.
  await win.waitForTimeout(1500);
});

test.afterAll(async () => {
  await app?.close();
});

test('capture default chrome', async () => {
  await win.screenshot({ path: './test-results/horizon-default.png', fullPage: false });
  const html = await win.content();
  // Print the document.body HTML length and any console errors collected.
  console.log('BODY_BYTES', html.length);
});

test('capture with AI panel open', async () => {
  // Click the sparkle (✦) button — aria-label="Toggle AI panel"
  await win.getByRole('button', { name: 'Toggle AI panel' }).click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: './test-results/horizon-ai.png', fullPage: false });
});

test('capture command palette', async () => {
  await win.keyboard.press('ControlOrMeta+k');
  await win.waitForTimeout(300);
  await win.screenshot({ path: './test-results/horizon-cmdk.png', fullPage: false });
  await win.keyboard.press('Escape');
});
