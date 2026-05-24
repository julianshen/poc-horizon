import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

let app: ElectronApplication;
let win: Page;
const pageErrors: string[] = [];
const consoleMsgs: Array<{ type: string; text: string }> = [];

const REPORT = './test-results/diagnostic-report.txt';
const out: string[] = [];
const log = (s: string): void => { out.push(s); };

test.beforeAll(async () => {
  fs.mkdirSync('./test-results', { recursive: true });
  app = await electron.launch({
    args: [path.join(__dirname, '../../dist-electron/main.js')],
    env: { ...process.env, HORIZON_DISABLE_RESTORE: '1' },
    timeout: 20_000,
  });
  win = await app.firstWindow();
  win.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}\n${err.stack ?? ''}`));
  win.on('console', (msg) => consoleMsgs.push({ type: msg.type(), text: msg.text() }));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000);
  // Navigate the active tab to a brightly-coloured data URL so the
  // BrowserView is visually distinct from blank/white. This exposes z-order
  // overlap bugs that hide behind a blank newtab page.
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    const v = w.getBrowserViews()[0];
    if (v) {
      await v.webContents.loadURL('data:text/html,<html><body style="margin:0;background:%23d04545;color:white;font:48px sans-serif"><div style="padding:40px">PAGE CONTENT — should be hidden behind menus</div></body></html>');
    }
  });
  await win.waitForTimeout(500);
});

test.afterAll(async () => {
  fs.writeFileSync(REPORT, out.join('\n'));
  try {
    await app?.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.destroy();
    });
  } catch { /* */ }
  await app?.close().catch(() => undefined);
});

test('collect diagnostics', async () => {
  log('=== PAGE ERRORS ===');
  for (const e of pageErrors) log(e);
  log('=== CONSOLE (errors/warnings only) ===');
  for (const m of consoleMsgs) {
    if (m.type === 'error' || m.type === 'warning') log(`[${m.type}] ${m.text}`);
  }

  const viewInfo = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return { error: 'no window' };
    const views = w.getBrowserViews();
    return {
      count: views.length,
      windowBounds: w.getBounds(),
      viewBounds: views.map((v) => v.getBounds()),
    };
  });
  log('=== BROWSERVIEW INFO ===');
  log(JSON.stringify(viewInfo, null, 2));

  const placeholderRect = await win.evaluate(() => {
    const all = Array.from(document.querySelectorAll('div'));
    const el = all.find((d) => d.style.background === 'rgb(255, 255, 255)' && d.classList.contains('absolute')) as HTMLDivElement | undefined;
    if (!el) return { error: 'no placeholder div found', divs: all.length };
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  log('=== PLACEHOLDER RECT ===');
  log(JSON.stringify(placeholderRect, null, 2));

  await win.screenshot({ path: './test-results/diag-default.png', fullPage: false });
  log('Screenshot saved: test-results/diag-default.png');

  // Open AI panel, recheck bounds.
  await win.getByRole('button', { name: 'Toggle AI panel' }).click();
  await win.waitForTimeout(400);
  const aiViewInfo = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    const v = w.getBrowserViews()[0]!;
    return v.getBounds();
  });
  const aiPlaceholder = await win.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div')).find((d) => d.style.background === 'rgb(255, 255, 255)' && d.classList.contains('absolute')) as HTMLDivElement | undefined;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  log('=== AI OPEN — BROWSERVIEW BOUNDS ===');
  log(JSON.stringify(aiViewInfo));
  log('=== AI OPEN — PLACEHOLDER RECT ===');
  log(JSON.stringify(aiPlaceholder));
  await win.screenshot({ path: './test-results/diag-ai.png', fullPage: false });
  log('Screenshot saved: test-results/diag-ai.png');

  // Close AI panel first so the menus open over the chrome, not the sidebar.
  await win.getByRole('button', { name: 'Toggle AI panel' }).click();
  await win.waitForTimeout(200);

  // App menu (☰) — accessible by aria-label "Menu". Verifies that the
  // BrowserView is hidden (0×0) while the menu is open so menu rows that
  // overlap the view region aren't painted behind the page.
  const menuBtn = win.getByRole('button', { name: 'Menu' });
  if (await menuBtn.count() > 0) {
    await menuBtn.first().click();
    await win.waitForTimeout(300);
    const menuOpenBounds = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      return w.getBrowserViews()[0]!.getBounds();
    });
    log('=== APP MENU OPEN — BROWSERVIEW BOUNDS (should be 0×0) ===');
    log(JSON.stringify(menuOpenBounds));
    await win.screenshot({ path: './test-results/diag-appmenu.png', fullPage: false });
    log('Screenshot saved: test-results/diag-appmenu.png');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);
  } else {
    log('App menu button not found (aria-label "Menu")');
  }

  // Command palette (⌘K).
  await win.keyboard.press('ControlOrMeta+k');
  await win.waitForTimeout(300);
  const cmdBounds = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    return w.getBrowserViews()[0]!.getBounds();
  });
  log('=== CMD PALETTE OPEN — BROWSERVIEW BOUNDS (should be 0×0) ===');
  log(JSON.stringify(cmdBounds));
  await win.screenshot({ path: './test-results/diag-cmdk.png', fullPage: false });
  log('Screenshot saved: test-results/diag-cmdk.png');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);

  // Tab context menu — right-click the first tab.
  const tab = win.locator('[data-testid="tab"]').first();
  if (await tab.count() > 0) {
    await tab.click({ button: 'right' });
    await win.waitForTimeout(300);
    const ctxBounds = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      return w.getBrowserViews()[0]!.getBounds();
    });
    log('=== TAB CTX MENU OPEN — BROWSERVIEW BOUNDS (should be 0×0) ===');
    log(JSON.stringify(ctxBounds));
    await win.screenshot({ path: './test-results/diag-tabmenu.png', fullPage: false });
    log('Screenshot saved: test-results/diag-tabmenu.png');
    await win.keyboard.press('Escape');
  } else {
    log('Tab element not found');
  }

  // Fail iff there are page errors — they're the most useful signal.
  expect(pageErrors, `Page errors: ${pageErrors.join('\n---\n')}`).toHaveLength(0);
});
