// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import { TabContextMenu } from '@/components/chrome/TabContextMenu';
import type { Tab } from '@/types/browser';

const t = (overrides: Partial<Tab> = {}): Tab => ({
  id: 't1', schemaVersion: 1, url: 'https://x', title: 'X', isLoading: false, loadProgress: 0,
  canGoBack: false, canGoForward: false, isPinned: false, isMuted: false, isActive: false,
  isHibernated: false, zoomLevel: 1, createdAt: 0, lastAccessedAt: 0,
  ...overrides,
});

describe('TabContextMenu', () => {
  const { api } = setupRendererTest();

  it('renders the expected menuitems at the supplied coordinates', () => {
    render(<TabContextMenu tab={t()} x={50} y={60} onClose={() => {}} />);
    const menu = screen.getByRole('menu');
    expect((menu as HTMLElement).style.top).toBe('60px');
    expect((menu as HTMLElement).style.left).toBe('50px');
    expect(screen.getByRole('menuitem', { name: 'New Tab' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Pin tab/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Mute tab/ })).toBeTruthy();
  });

  it('Pin row uses Unpin label for already-pinned tabs', () => {
    render(<TabContextMenu tab={t({ isPinned: true })} x={0} y={0} onClose={() => {}} />);
    expect(screen.getByRole('menuitem', { name: 'Unpin tab' })).toBeTruthy();
  });

  it('clicking Duplicate dispatches tab:duplicate and closes', () => {
    const onClose = vi.fn();
    render(<TabContextMenu tab={t()} x={0} y={0} onClose={onClose} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(api().invokes).toContainEqual({ channel: 'tab:duplicate', payload: { tabId: 't1' } });
    expect(onClose).toHaveBeenCalled();
  });

  it('Pin dispatches tab:pin with the next pinned state', () => {
    const onClose = vi.fn();
    render(<TabContextMenu tab={t()} x={0} y={0} onClose={onClose} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Pin tab/ }));
    expect(api().invokes).toContainEqual({ channel: 'tab:pin', payload: { tabId: 't1', pinned: true } });
  });

  it('every remaining row dispatches the right IPC', () => {
    const cases: Array<{ name: RegExp | string; channel: string; tab?: Partial<Tab> }> = [
      { name: 'New Tab', channel: 'tab:create' },
      { name: 'Reload', channel: 'navigation:reload' },
      { name: /Mute tab/, channel: 'tab:mute' },
      { name: /Unmute tab/, channel: 'tab:unmute', tab: { isMuted: true } },
      { name: /Unpin tab/, channel: 'tab:pin', tab: { isPinned: true } },
      { name: 'Close tab', channel: 'tab:close' },
    ];
    for (const c of cases) {
      const { unmount } = render(<TabContextMenu tab={t(c.tab)} x={0} y={0} onClose={() => {}} />);
      fireEvent.click(screen.getByRole('menuitem', { name: c.name }));
      expect(api().invokes.map((i) => i.channel)).toContain(c.channel);
      unmount();
    }
  });

  it('Escape closes the menu', () => {
    const onClose = vi.fn();
    render(<TabContextMenu tab={t()} x={0} y={0} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
