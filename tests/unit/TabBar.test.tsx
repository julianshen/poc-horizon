// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from '@/components/chrome/TabBar';
import { useBrowserStore } from '@/stores/browserStore';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import type { Tab } from '@/types/browser';

const sampleTab = (id: string, overrides: Partial<Tab> = {}): Tab => ({
  id,
  schemaVersion: 1,
  url: `https://${id}.example`,
  title: `Tab ${id}`,
  isLoading: false,
  loadProgress: 0,
  canGoBack: false,
  canGoForward: false,
  isPinned: false,
  isMuted: false,
  isActive: false,
  isHibernated: false,
  zoomLevel: 1,
  createdAt: 0,
  lastAccessedAt: 0,
  ...overrides,
});

describe('TabBar', () => {
  const { api } = setupRendererTest();
  const initialState = useBrowserStore.getState();

  it('renders one Tab per store entry', () => {
    useBrowserStore.setState({
      ...initialState,
      tabs: [sampleTab('a', { title: 'Alpha' }), sampleTab('b', { title: 'Beta' })],
    });
    render(<TabBar />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('"+" button dispatches tab:create', () => {
    render(<TabBar />);
    fireEvent.click(screen.getByText('+'));
    expect(api().invokes).toEqual([{ channel: 'tab:create', payload: {} }]);
  });

  it('clicking a tab dispatches tab:activate (Chrome parity: switch)', () => {
    useBrowserStore.setState({
      ...initialState,
      tabs: [sampleTab('a'), sampleTab('b')],
      activeTabId: 'a',
    });
    render(<TabBar />);
    fireEvent.click(screen.getByText('Tab b'));
    expect(api().invokes).toEqual([{ channel: 'tab:activate', payload: { tabId: 'b' } }]);
  });

  it('clicking the × button dispatches tab:close and not tab:activate', () => {
    useBrowserStore.setState({
      ...initialState,
      tabs: [sampleTab('a'), sampleTab('b')],
      activeTabId: 'a',
    });
    render(<TabBar />);
    // Find the × button inside Tab b
    const closeButtons = screen.getAllByText('×');
    fireEvent.click(closeButtons[1]);
    expect(api().invokes).toEqual([{ channel: 'tab:close', payload: { tabId: 'b' } }]);
  });

  it('shows "New Tab" as fallback title when the tab has no title', () => {
    useBrowserStore.setState({
      ...initialState,
      tabs: [sampleTab('a', { title: '' })],
    });
    render(<TabBar />);
    expect(screen.getByText('New Tab')).toBeTruthy();
  });

  it('shows the favicon image when a tab has a favicon URL', () => {
    useBrowserStore.setState({
      ...initialState,
      tabs: [sampleTab('a', { favicon: 'https://a.example/favicon.ico' })],
    });
    const { container } = render(<TabBar />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://a.example/favicon.ico');
  });

  it('shows a loading spinner element when tab.isLoading is true', () => {
    useBrowserStore.setState({
      ...initialState,
      tabs: [sampleTab('a', { isLoading: true })],
    });
    const { container } = render(<TabBar />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });
});
