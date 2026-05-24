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

  // Verify Back/Forward buttons via the REAL user path: type into the
  // omnibox, press Enter (full chain — omnibox → navigation:go IPC →
  // TabManager.navigate → loadURL → did-navigate → navigation:state IPC
  // → useTabs updates store → useNavigation re-derives enabled state).
  // Use about:blank-style real URLs — the omnibox treats data: as a search
  // query and the test would route through DuckDuckGo. We use horizon://
  // internal URLs which are registered protocols and bypass network.
  const URL_A = 'horizon://newtab?diag=a';
  const URL_B = 'horizon://newtab?diag=b';
  const omnibox = win.getByPlaceholder(/Search or enter address/);
  await omnibox.click();
  await omnibox.fill(URL_A);
  await omnibox.press('Enter');
  await win.waitForTimeout(400);
  await omnibox.click();
  await omnibox.fill(URL_B);
  await omnibox.press('Enter');
  await win.waitForTimeout(500);

  const urlAfterB = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    return w.getBrowserViews()[0]!.webContents.getURL();
  });
  log(`After loading A then B, current URL = ${urlAfterB}`);

  const backDisabled = await win.getByRole('button', { name: 'Back' }).isDisabled();
  const fwdDisabled = await win.getByRole('button', { name: 'Forward' }).isDisabled();
  log(`Back disabled = ${backDisabled} (expect false), Forward disabled = ${fwdDisabled} (expect true)`);
  expect(backDisabled, 'Back should be enabled after two loads').toBe(false);
  expect(fwdDisabled, 'Forward should be disabled at history tip').toBe(true);

  // Click Back and verify the BrowserView's URL is now A.
  await win.getByRole('button', { name: 'Back' }).click();
  await win.waitForTimeout(400);
  const urlAfterBack = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getBrowserViews()[0]!.webContents.getURL()
  );
  log(`After Back click, URL = ${urlAfterBack}`);
  expect(urlAfterBack, 'Back click should land on URL_A').toBe(URL_A);

  // After Back, Forward should now be enabled.
  const fwdEnabledAfterBack = !(await win.getByRole('button', { name: 'Forward' }).isDisabled());
  log(`Forward enabled after Back = ${fwdEnabledAfterBack} (expect true)`);
  expect(fwdEnabledAfterBack, 'Forward should be enabled after going Back').toBe(true);

  // Click Forward and verify we return to B.
  await win.getByRole('button', { name: 'Forward' }).click();
  await win.waitForTimeout(400);
  const urlAfterForward = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getBrowserViews()[0]!.webContents.getURL()
  );
  log(`After Forward click, URL = ${urlAfterForward}`);
  expect(urlAfterForward, 'Forward click should return to URL_B').toBe(URL_B);

  // ── SPA scenario: pushState navigation must trigger chrome state
  // update. Many real apps (Gmail, GitHub) use history.pushState for
  // client-side routing — Electron fires 'did-navigate-in-page', not
  // 'did-navigate'. Without the handler, Back/Forward buttons stay
  // disabled even though the page URL changed.
  const navStateEvents: Array<{ url: string }> = [];
  await win.evaluate(() => {
    (window as unknown as { __navStateEvents: Array<{ url: string }> }).__navStateEvents = [];
    window.horizonAPI.on('navigation:state', (s: unknown) => {
      (window as unknown as { __navStateEvents: Array<{ url: string }> }).__navStateEvents.push(s as { url: string });
    });
  });
  await app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0]!.getBrowserViews()[0]!;
    await v.webContents.loadURL('horizon://newtab');
    await new Promise((r) => setTimeout(r, 300));
    // Hash navigation also fires did-navigate-in-page (and is same-origin).
    await v.webContents.executeJavaScript(`location.hash = '#spa-route-1'`);
    await new Promise((r) => setTimeout(r, 200));
  });
  await win.waitForTimeout(400);
  const sawSpaNavState = await win.evaluate(() =>
    (window as unknown as { __navStateEvents: Array<{ url: string }> }).__navStateEvents
      .some((e) => e.url.includes('spa-route-1'))
  );
  log(`navigation:state fired for pushState URL: ${sawSpaNavState} (expect true)`);
  expect(sawSpaNavState, 'pushState navigation should produce a navigation:state IPC').toBe(true);
  void navStateEvents;

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
