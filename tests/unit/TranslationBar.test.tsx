// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TranslationBar } from '@/components/overlays/TranslationBar';
import { useBrowserStore } from '@/stores/browserStore';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';

describe('TranslationBar', () => {
  const { api } = setupRendererTest();
  const initialState = useBrowserStore.getState();

  it('renders nothing when showTranslationBar is false', () => {
    const { container } = render(<TranslationBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders and fetches initial target language setting when showTranslationBar is true', async () => {
    useBrowserStore.setState({ ...initialState, showTranslationBar: true, activeTabId: 'tab1' });
    
    api().invoke.mockImplementation((channel: string, payload: unknown) => {
      api().invokes.push({ channel, payload });
      if (channel === 'settings:get' && payload?.key === 'translateTargetLang') {
        return Promise.resolve('Spanish');
      }
      return Promise.resolve(undefined);
    });

    render(<TranslationBar />);

    // Wait for the settings:get promise to resolve and component to update
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getAllByText('Translate')).toBeTruthy();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('Spanish');
  });

  it('changing target language calls settings:set', async () => {
    useBrowserStore.setState({ ...initialState, showTranslationBar: true, activeTabId: 'tab1' });
    
    api().invoke.mockImplementation((channel: string, payload: unknown) => {
      api().invokes.push({ channel, payload });
      if (channel === 'settings:get' && payload?.key === 'translateTargetLang') {
        return Promise.resolve('English');
      }
      return Promise.resolve(undefined);
    });

    render(<TranslationBar />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Japanese' } });

    expect(select.value).toBe('Japanese');
    expect(api().invokes).toContainEqual({
      channel: 'settings:set',
      payload: { key: 'translateTargetLang', value: 'Japanese' },
    });
  });

  it('Translate button calls translate:page and shows progress bar', async () => {
    useBrowserStore.setState({ ...initialState, showTranslationBar: true, activeTabId: 'tab1' });
    
    api().invoke.mockImplementation((channel: string, payload: unknown) => {
      api().invokes.push({ channel, payload });
      if (channel === 'settings:get' && payload?.key === 'translateTargetLang') {
        return Promise.resolve('English');
      }
      if (channel === 'translate:page') {
        return Promise.resolve({ ok: true, translated: 10, total: 10 });
      }
      return Promise.resolve(undefined);
    });

    render(<TranslationBar />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const translateBtn = screen.getByRole('button', { name: 'Translate' });
    fireEvent.click(translateBtn);

    expect(api().invokes).toContainEqual({
      channel: 'translate:page',
      payload: { targetLang: 'English' },
    });

    // Simulate progress updates
    act(() => {
      api().emit('translate:progress', { tabId: 'tab1', translated: 5, total: 10, done: false });
    });

    expect(screen.getByText('50%')).toBeTruthy();

    // Done event
    act(() => {
      api().emit('translate:progress', { tabId: 'tab1', translated: 10, total: 10, done: true });
    });

    expect(screen.getByText('Show Original')).toBeTruthy();
  });

  it('Show Original button calls translate:restore', async () => {
    useBrowserStore.setState({ ...initialState, showTranslationBar: true, activeTabId: 'tab1' });
    
    api().invoke.mockImplementation((channel: string, payload: unknown) => {
      api().invokes.push({ channel, payload });
      if (channel === 'settings:get' && payload?.key === 'translateTargetLang') {
        return Promise.resolve('English');
      }
      if (channel === 'translate:page') {
        return Promise.resolve({ ok: true, translated: 10, total: 10 });
      }
      return Promise.resolve(undefined);
    });

    render(<TranslationBar />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const translateBtn = screen.getByRole('button', { name: 'Translate' });
    fireEvent.click(translateBtn);

    // Done event
    act(() => {
      api().emit('translate:progress', { tabId: 'tab1', translated: 10, total: 10, done: true });
    });

    const restoreBtn = screen.getByRole('button', { name: 'Show Original' });
    fireEvent.click(restoreBtn);

    expect(api().invokes).toContainEqual({
      channel: 'translate:restore',
      payload: undefined,
    });
  });

  it('Cancel button during translation calls translate:cancel', async () => {
    useBrowserStore.setState({ ...initialState, showTranslationBar: true, activeTabId: 'tab1' });
    
    api().invoke.mockImplementation((channel: string, payload: unknown) => {
      api().invokes.push({ channel, payload });
      if (channel === 'settings:get' && payload?.key === 'translateTargetLang') {
        return Promise.resolve('English');
      }
      return Promise.resolve(undefined);
    });

    render(<TranslationBar />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const translateBtn = screen.getByRole('button', { name: 'Translate' });
    fireEvent.click(translateBtn);

    // Done event is NOT simulated, status is 'translating'
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);

    expect(api().invokes).toContainEqual({
      channel: 'translate:cancel',
      payload: undefined,
    });
  });

  it('ignores progress events with a tabId other than the active one', async () => {
    useBrowserStore.setState({ ...initialState, showTranslationBar: true, activeTabId: 'tab1' });
    api().invoke.mockImplementation((channel: string, payload: unknown) => {
      api().invokes.push({ channel, payload });
      if (channel === 'settings:get' && payload?.key === 'translateTargetLang') return Promise.resolve('English');
      if (channel === 'translate:page') return Promise.resolve({ ok: true, translated: 10, total: 10 });
      return Promise.resolve(undefined);
    });
    render(<TranslationBar />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    // Background tab's progress should NOT affect our UI.
    act(() => api().emit('translate:progress', { tabId: 'other-tab', translated: 5, total: 10, done: false }));
    expect(screen.queryByText('50%')).toBeNull();
    // Our tab's progress should.
    act(() => api().emit('translate:progress', { tabId: 'tab1', translated: 5, total: 10, done: false }));
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('Escape key (window-level) closes the bar', async () => {
    useBrowserStore.setState({ ...initialState, showTranslationBar: true, activeTabId: 'tab1' });
    api().invoke.mockImplementation((channel: string, payload: unknown) => {
      api().invokes.push({ channel, payload });
      if (channel === 'settings:get' && payload?.key === 'translateTargetLang') return Promise.resolve('English');
      return Promise.resolve(undefined);
    });
    render(<TranslationBar />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useBrowserStore.getState().showTranslationBar).toBe(false);
  });

  it('preserves done status for a background translation when user switches tabs and back', async () => {
    useBrowserStore.setState({ ...initialState, showTranslationBar: true, activeTabId: 'tab1' });
    api().invoke.mockImplementation((channel: string, payload: unknown) => {
      api().invokes.push({ channel, payload });
      if (channel === 'settings:get' && payload?.key === 'translateTargetLang') return Promise.resolve('English');
      return Promise.resolve(undefined);
    });
    render(<TranslationBar />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // User switches to tab2 (no translation there)
    act(() => { useBrowserStore.setState({ activeTabId: 'tab2' }); });
    // Background: tab1's translation finishes
    act(() => api().emit('translate:progress', { tabId: 'tab1', translated: 10, total: 10, done: true }));
    // Tab2 stays idle — its bar still shows Translate
    expect(screen.getByRole('button', { name: 'Translate' })).toBeTruthy();
    // User returns to tab1
    act(() => { useBrowserStore.setState({ activeTabId: 'tab1' }); });
    // Now sees "Show Original" — completion survived the trip
    expect(screen.getByRole('button', { name: 'Show Original' })).toBeTruthy();
  });

  it('horizon:translate-restore event resets the bar status (menu-driven restore)', async () => {
    useBrowserStore.setState({
      ...initialState,
      showTranslationBar: true,
      activeTabId: 'tab1',
      translationStatesByTab: { tab1: { status: 'done' } },
    });
    api().invoke.mockImplementation((channel: string, payload: unknown) => {
      api().invokes.push({ channel, payload });
      if (channel === 'settings:get' && payload?.key === 'translateTargetLang') return Promise.resolve('English');
      return Promise.resolve(undefined);
    });
    render(<TranslationBar />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // Pre-condition: bar shows "Show Original" because of prior 'done' state.
    expect(screen.getByRole('button', { name: 'Show Original' })).toBeTruthy();
    // Menu fires the custom event (useMenuCommands path).
    act(() => { window.dispatchEvent(new Event('horizon:translate-restore')); });
    // Bar drops back to idle — "Translate" returns.
    expect(screen.getByRole('button', { name: 'Translate' })).toBeTruthy();
    expect(useBrowserStore.getState().translationStatesByTab.tab1).toBeUndefined();
  });

  it('Close button hides TranslationBar via toggleOverlay', async () => {
    useBrowserStore.setState({ ...initialState, showTranslationBar: true, activeTabId: 'tab1' });
    
    api().invoke.mockImplementation((channel: string, payload: unknown) => {
      api().invokes.push({ channel, payload });
      if (channel === 'settings:get' && payload?.key === 'translateTargetLang') {
        return Promise.resolve('English');
      }
      return Promise.resolve(undefined);
    });

    render(<TranslationBar />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const closeBtn = screen.getByRole('button', { name: 'Close translation bar' });
    fireEvent.click(closeBtn);

    expect(useBrowserStore.getState().showTranslationBar).toBe(false);
  });
});
