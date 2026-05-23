// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import { HistoryPanel } from '@/components/overlays/HistoryPanel';
import { useBrowserStore } from '@/stores/browserStore';

const entry = (id: string, url: string, title = id) => ({
  id, url, title, visitTime: Date.now(), visitCount: 1, typedCount: 0,
});

describe('HistoryPanel', () => {
  const { api } = setupRendererTest();

  it('renders nothing when showHistory is false', () => {
    const { container } = render(<HistoryPanel />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('queries history:getRecent on open and renders rows', async () => {
    api().invoke.mockResolvedValue([entry('a', 'https://a', 'Alpha'), entry('b', 'https://b', 'Beta')]);
    act(() => useBrowserStore.setState({ showHistory: true }));
    render(<HistoryPanel />);
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy();
      expect(screen.getByText('Beta')).toBeTruthy();
    });
  });

  it('typing in the search box switches to history:search', async () => {
    api().invoke.mockResolvedValue([entry('a', 'https://a', 'Alpha')]);
    act(() => useBrowserStore.setState({ showHistory: true }));
    render(<HistoryPanel />);
    fireEvent.change(screen.getByPlaceholderText('Search history'), { target: { value: 'alpha' } });
    await waitFor(() =>
      expect(api().invoke.mock.calls.some((c) => c[0] === 'history:search')).toBe(true)
    );
  });

  it('shows the empty state when there is no history', async () => {
    api().invoke.mockResolvedValue([]);
    act(() => useBrowserStore.setState({ showHistory: true }));
    render(<HistoryPanel />);
    await waitFor(() => expect(screen.getByText(/No history yet/)).toBeTruthy());
  });
});
