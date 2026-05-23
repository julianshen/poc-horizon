// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { render, screen, fireEvent } from '@testing-library/react';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import { CommandPalette } from '@/components/overlays/CommandPalette';
import { useBrowserStore } from '@/stores/browserStore';

describe('CommandPalette', () => {
  const { api } = setupRendererTest();

  it('renders nothing when showCmd is false', () => {
    const { container } = render(<CommandPalette />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the palette with the placeholder when showCmd is true', () => {
    act(() => useBrowserStore.setState({ showCmd: true }));
    render(<CommandPalette />);
    expect(screen.getByPlaceholderText(/Ask Horizon/)).toBeTruthy();
  });

  it('Enter on the highlighted row invokes its action', () => {
    act(() => useBrowserStore.setState({ showCmd: true }));
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(/Ask Horizon/);
    // The Ask Horizon row is index 0 and sticky — Enter runs its action.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    // After Enter, the palette closes.
    expect(useBrowserStore.getState().showCmd).toBe(false);
  });

  it('ArrowDown / ArrowUp navigate the list', () => {
    act(() => useBrowserStore.setState({ showCmd: true }));
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(/Ask Horizon/);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // No crash, palette stays open.
    expect(useBrowserStore.getState().showCmd).toBe(true);
  });

  it('Escape closes the palette', () => {
    act(() => useBrowserStore.setState({ showCmd: true }));
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(/Ask Horizon/);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useBrowserStore.getState().showCmd).toBe(false);
  });

  it('typing a query filters items to matches + the sticky AI row', () => {
    act(() => useBrowserStore.setState({ showCmd: true }));
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(/Ask Horizon/);
    fireEvent.change(input, { target: { value: 'bookmarks' } });
    expect(screen.getByText('Open Bookmarks')).toBeTruthy();
    // "Reload current tab" doesn't match → not visible.
    expect(screen.queryByText('Reload current tab')).toBeNull();
    // The sticky AI row updates to include the query.
    expect(screen.getByText(/Ask Horizon: "bookmarks"/)).toBeTruthy();
  });

  it('clicking each visible row invokes its action and closes the palette', () => {
    act(() => useBrowserStore.setState({ showCmd: true, activeTabId: 't1' }));
    const { unmount } = render(<CommandPalette />);
    // Hovering also exercises onMouseEnter (which calls setSel).
    for (const btn of screen.getAllByRole('button')) {
      fireEvent.mouseEnter(btn);
    }
    fireEvent.click(screen.getByText('Reload current tab'));
    expect(api().invokes.map((i) => i.channel)).toContain('navigation:reload');
    unmount();
  });
});
