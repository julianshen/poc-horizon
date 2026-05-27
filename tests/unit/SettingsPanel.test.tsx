// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import { SettingsPanel } from '@/components/overlays/SettingsPanel';
import { useBrowserStore } from '@/stores/browserStore';

describe('SettingsPanel', () => {
  const { api } = setupRendererTest();

  it('renders nothing when showSettings is false', () => {
    const { container } = render(<SettingsPanel />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('loads settings:getAll on open and renders known fields', async () => {
    api().invoke.mockResolvedValue({
      theme: 'dark',
      defaultSearchEngine: 'google',
      showBookmarksBar: false,
      blockThirdPartyCookies: true,
      doNotTrack: false,
      askWhereToSave: true,
    });
    act(() => useBrowserStore.setState({ showSettings: true }));
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText('Theme')).toBeTruthy());
    expect(screen.getByText('Default search engine')).toBeTruthy();
    expect(screen.getByText(/Block third-party cookies/)).toBeTruthy();
  });

  it('changing a select dispatches settings:set with the new value', async () => {
    api().invoke.mockResolvedValue({ theme: 'system' });
    act(() => useBrowserStore.setState({ showSettings: true }));
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText('Theme')).toBeTruthy());
    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'dark' } });
    expect(api().invoke.mock.calls).toContainEqual([
      'settings:set',
      { key: 'theme', value: 'dark' },
    ]);
  });

  it('toggling a switch dispatches settings:set with the boolean', async () => {
    api().invoke.mockResolvedValue({ blockThirdPartyCookies: false });
    act(() => useBrowserStore.setState({ showSettings: true }));
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText(/Block third-party cookies/)).toBeTruthy());
    const toggle = screen.getAllByRole('switch')[0];
    fireEvent.click(toggle);
    expect(api().invoke.mock.calls.some((c) => c[0] === 'settings:set')).toBe(true);
  });

  it('exposes the aiAdvertiseAgent toggle wired to settings:set', async () => {
    api().invoke.mockResolvedValue({ aiAdvertiseAgent: true, aiConfirmActions: 'never', proxyType: 'system' });
    act(() => useBrowserStore.setState({ showSettings: true }));
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText(/X-Horizon-Agent header/)).toBeTruthy());
    // Find the toggle next to the X-Horizon-Agent label.
    const label = screen.getByText(/X-Horizon-Agent header/).closest('label');
    const toggle = label?.querySelector('[role="switch"]') as HTMLElement;
    fireEvent.click(toggle);
    expect(api().invoke.mock.calls).toContainEqual([
      'settings:set', { key: 'aiAdvertiseAgent', value: false },
    ]);
  });

  it('renders the Proxy section with the type select', async () => {
    api().invoke.mockResolvedValue({ proxyType: 'system', proxyRules: '', proxyBypassRules: '' });
    act(() => useBrowserStore.setState({ showSettings: true }));
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText('Proxy type')).toBeTruthy());
    // Section header (h3) with exact text "Proxy"
    expect(screen.getByRole('heading', { name: 'Proxy' })).toBeTruthy();
  });

  it('reveals rules + bypass-rules inputs only when proxyType is manual', async () => {
    api().invoke.mockResolvedValue({
      proxyType: 'manual', proxyRules: 'http=127.0.0.1:8080', proxyBypassRules: '<local>',
    });
    act(() => useBrowserStore.setState({ showSettings: true }));
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText('Proxy rules')).toBeTruthy());
    expect(screen.getByText('Bypass rules')).toBeTruthy();
    // The rule input contains the seeded value.
    expect(screen.getByDisplayValue('http=127.0.0.1:8080')).toBeTruthy();
  });

  it('hides rules/bypass inputs when proxyType is system or direct', async () => {
    api().invoke.mockResolvedValue({ proxyType: 'direct', proxyRules: '', proxyBypassRules: '' });
    act(() => useBrowserStore.setState({ showSettings: true }));
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText('Proxy type')).toBeTruthy());
    expect(screen.queryByText('Proxy rules')).toBeNull();
    expect(screen.queryByText('Bypass rules')).toBeNull();
  });

  it('changing the proxy-rules input dispatches settings:set', async () => {
    api().invoke.mockResolvedValue({ proxyType: 'manual', proxyRules: '', proxyBypassRules: '' });
    act(() => useBrowserStore.setState({ showSettings: true }));
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText('Proxy rules')).toBeTruthy());
    const rulesInput = screen.getByPlaceholderText(/http=127/) as HTMLInputElement;
    fireEvent.change(rulesInput, { target: { value: 'http=10.0.0.1:3128' } });
    expect(api().invoke.mock.calls).toContainEqual([
      'settings:set', { key: 'proxyRules', value: 'http=10.0.0.1:3128' },
    ]);
  });
});
