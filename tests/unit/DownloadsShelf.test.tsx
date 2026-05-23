// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { render, screen, fireEvent } from '@testing-library/react';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import { DownloadsShelf } from '@/components/overlays/DownloadsShelf';
import { useBrowserStore } from '@/stores/browserStore';

const item = (id: string, state: 'progressing' | 'completed' = 'progressing') => ({
  id, filename: `${id}.bin`, url: 'https://a', totalBytes: 1024, receivedBytes: 512,
  state, startTime: 0, savePath: `/tmp/${id}`,
});

describe('DownloadsShelf', () => {
  const { api } = setupRendererTest();

  it('renders nothing when there are no downloads', () => {
    const { container } = render(<DownloadsShelf />);
    expect(container.querySelector('div[role]')).toBeNull();
  });

  it('auto-shows when a download is in flight', () => {
    render(<DownloadsShelf />);
    act(() => api().emit('download:created', item('a')));
    expect(screen.getByText(/Downloads/)).toBeTruthy();
    expect(screen.getByText(/a\.bin/)).toBeTruthy();
  });

  it('shows Open + Show-in-folder for a completed download and invokes the right IPC', () => {
    // The shelf hides when nothing is in-flight unless showDownloads is set.
    act(() => useBrowserStore.setState({ showDownloads: true }));
    render(<DownloadsShelf />);
    act(() => api().emit('download:created', item('a', 'completed')));
    fireEvent.click(screen.getByText('Open'));
    expect(api().invoke.mock.calls).toContainEqual(['download:open', { downloadId: 'a' }]);
    fireEvent.click(screen.getByText('Show in folder'));
    expect(api().invoke.mock.calls).toContainEqual(['download:showInFolder', { downloadId: 'a' }]);
  });

  it('Cancel button invokes download:cancel for an in-flight item', () => {
    render(<DownloadsShelf />);
    act(() => api().emit('download:created', item('a', 'progressing')));
    fireEvent.click(screen.getByText('Cancel'));
    expect(api().invoke.mock.calls).toContainEqual(['download:cancel', { downloadId: 'a' }]);
  });

  it('Clear completed prunes finished items', () => {
    act(() => useBrowserStore.setState({ showDownloads: true }));
    render(<DownloadsShelf />);
    act(() => {
      api().emit('download:created', item('a', 'progressing'));
      api().emit('download:created', item('b', 'completed'));
    });
    fireEvent.click(screen.getByText('Clear completed'));
    // b should be removed; a stays.
    expect(screen.queryByText(/b\.bin/)).toBeNull();
    expect(screen.queryByText(/a\.bin/)).toBeTruthy();
  });
});
