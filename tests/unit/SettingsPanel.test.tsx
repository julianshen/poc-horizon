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
      theme: 'midnight',
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
    fireEvent.change(select, { target: { value: 'midnight' } });
    expect(api().invoke.mock.calls).toContainEqual([
      'settings:set',
      { key: 'theme', value: 'midnight' },
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

  it.each(['direct', 'system'] as const)('hides rules/bypass inputs when proxyType is %s', async (type) => {
    api().invoke.mockResolvedValue({ proxyType: type, proxyRules: '', proxyBypassRules: '' });
    act(() => useBrowserStore.setState({ showSettings: true }));
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText('Proxy type')).toBeTruthy());
    expect(screen.queryByText('Proxy rules')).toBeNull();
    expect(screen.queryByText('Bypass rules')).toBeNull();
  });

  it('proxy-rules input commits on BLUR (not on every keystroke) to avoid IPC thrash', async () => {
    api().invoke.mockResolvedValue({ proxyType: 'manual', proxyRules: '', proxyBypassRules: '' });
    act(() => useBrowserStore.setState({ showSettings: true }));
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText('Proxy rules')).toBeTruthy());
    const rulesInput = screen.getByPlaceholderText(/http=127/) as HTMLInputElement;
    // Type 3 characters — must NOT fire settings:set yet.
    fireEvent.change(rulesInput, { target: { value: 'h' } });
    fireEvent.change(rulesInput, { target: { value: 'ht' } });
    fireEvent.change(rulesInput, { target: { value: 'http=10.0.0.1:3128' } });
    expect(api().invoke.mock.calls.some((c) => c[0] === 'settings:set' && (c[1] as { key: string }).key === 'proxyRules')).toBe(false);
    // Blur commits the final value with one IPC call.
    fireEvent.blur(rulesInput);
    expect(api().invoke.mock.calls).toContainEqual([
      'settings:set', { key: 'proxyRules', value: 'http=10.0.0.1:3128' },
    ]);
  });

  it('proxy-rules input commits on Enter and reverts on Escape', async () => {
    api().invoke.mockResolvedValue({ proxyType: 'manual', proxyRules: 'http=old:8080', proxyBypassRules: '' });
    act(() => useBrowserStore.setState({ showSettings: true }));
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByText('Proxy rules')).toBeTruthy());
    const rulesInput = screen.getByDisplayValue('http=old:8080') as HTMLInputElement;
    // Edit + Escape → no IPC, draft reverts.
    await act(async () => { fireEvent.change(rulesInput, { target: { value: 'http=garbage' } }); });
    await act(async () => { fireEvent.keyDown(rulesInput, { key: 'Escape' }); });
    expect(api().invoke.mock.calls.some((c) => c[0] === 'settings:set' && (c[1] as { key: string }).key === 'proxyRules')).toBe(false);
    // Wait for the Escape-driven revert to actually paint, then re-query.
    await waitFor(() => expect((screen.getByPlaceholderText(/http=127/) as HTMLInputElement).value).toBe('http=old:8080'));
    const rulesInput2 = screen.getByPlaceholderText(/http=127/) as HTMLInputElement;
    // Edit + Enter → one IPC commit.
    await act(async () => { fireEvent.change(rulesInput2, { target: { value: 'http=new:9090' } }); });
    await act(async () => { fireEvent.keyDown(rulesInput2, { key: 'Enter' }); });
    expect(api().invoke.mock.calls).toContainEqual([
      'settings:set', { key: 'proxyRules', value: 'http=new:9090' },
    ]);
  });
});
