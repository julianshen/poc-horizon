// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Omnibox } from '@/components/chrome/Omnibox';
import { useBrowserStore } from '@/stores/browserStore';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';

describe('Omnibox', () => {
  const { api } = setupRendererTest();
  const initialState = useBrowserStore.getState();

  it('shows the active URL with the scheme stripped when not editing', () => {
    useBrowserStore.setState({ ...initialState, url: 'https://example.com/path' });
    render(<Omnibox />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('example.com/path');
  });

  it('shows a lock for https and a warning for non-https', () => {
    useBrowserStore.setState({ ...initialState, url: 'https://example.com' });
    const { rerender } = render(<Omnibox />);
    expect(screen.getByText('🔒')).toBeTruthy();

    useBrowserStore.setState({ ...initialState, url: 'http://insecure.example' });
    rerender(<Omnibox />);
    expect(screen.getByText('⚠️')).toBeTruthy();
  });

  it('switches to the editing buffer on focus and back on blur', () => {
    useBrowserStore.setState({ ...initialState, url: 'https://example.com' });
    render(<Omnibox />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'something else' } });
    expect(input.value).toBe('something else');

    fireEvent.blur(input);
    expect(input.value).toBe('example.com');
  });

  it('submitting a URL dispatches navigation:go with normalized URL', () => {
    useBrowserStore.setState({ ...initialState, activeTabId: 't1', url: '' });
    render(<Omnibox />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.submit(input.closest('form')!);
    expect(api().invokes).toEqual([
      { channel: 'navigation:go', payload: { tabId: 't1', url: 'https://example.com' } },
    ]);
  });

  it('submitting plain text routes through the default search engine', () => {
    useBrowserStore.setState({ ...initialState, activeTabId: 't1', url: '' });
    render(<Omnibox />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'how to test electron' } });
    fireEvent.submit(input.closest('form')!);
    expect(api().invokes[0].payload).toMatchObject({
      tabId: 't1',
      url: expect.stringContaining('duckduckgo.com'),
    });
  });

  it('submitting is a no-op when there is no active tab', () => {
    useBrowserStore.setState({ ...initialState, activeTabId: null });
    render(<Omnibox />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.submit(input.closest('form')!);
    expect(api().invokes).toEqual([]);
  });

  it('submitting empty input is a no-op', () => {
    useBrowserStore.setState({ ...initialState, activeTabId: 't1' });
    render(<Omnibox />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(api().invokes).toEqual([]);
  });

  it('reflects external store URL changes while not editing', () => {
    useBrowserStore.setState({ ...initialState, url: 'https://before.example' });
    render(<Omnibox />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('before.example');

    act(() => {
      useBrowserStore.setState({ url: 'https://after.example' });
    });
    expect(input.value).toBe('after.example');
  });

  it('does not overwrite the editing buffer with external URL changes', () => {
    useBrowserStore.setState({ ...initialState, url: 'https://before.example' });
    render(<Omnibox />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'user typing' } });

    act(() => {
      useBrowserStore.setState({ url: 'https://surprise-nav.example' });
    });
    expect(input.value).toBe('user typing');
  });
});
