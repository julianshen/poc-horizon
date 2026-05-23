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
});
