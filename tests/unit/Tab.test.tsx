// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import { Tab } from '@/components/chrome/Tab';
import type { Tab as TabType } from '@/types/browser';

const sample = (id: string, overrides: Partial<TabType> = {}): TabType => ({
  id,
  schemaVersion: 1,
  url: `https://${id}`,
  title: id,
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

describe('Tab drag handlers', () => {
  const { api } = setupRendererTest();

  it('writes the tab id to dataTransfer on dragstart', () => {
    const { container } = render(<Tab tab={sample('a')} isActive={false} index={0} />);
    const el = container.querySelector('[data-testid="tab"]') as HTMLElement;
    const dataTransfer = {
      setData: (() => {
        const store: Record<string, string> = {};
        const fn = (type: string, val: string) => {
          store[type] = val;
        };
        (fn as unknown as { store: Record<string, string> }).store = store;
        return fn;
      })(),
      effectAllowed: '',
    };
    fireEvent.dragStart(el, { dataTransfer });
    expect((dataTransfer.setData as unknown as { store: Record<string, string> }).store['text/x-horizon-tab']).toBe('a');
    expect(dataTransfer.effectAllowed).toBe('move');
  });

  it('drop dispatches tab:reorder with the dragged id and this tab\'s index', () => {
    const { container } = render(<Tab tab={sample('b')} isActive={false} index={3} />);
    const el = container.querySelector('[data-testid="tab"]') as HTMLElement;
    const dataTransfer = {
      types: ['text/x-horizon-tab'],
      getData: (type: string) => (type === 'text/x-horizon-tab' ? 'a' : ''),
      setData: () => {},
      dropEffect: '',
    };
    fireEvent.dragOver(el, { dataTransfer });
    fireEvent.drop(el, { dataTransfer });
    expect(api().invokes.filter((i) => i.channel === 'tab:reorder')).toEqual([
      { channel: 'tab:reorder', payload: { tabId: 'a', index: 3 } },
    ]);
  });

  it('drop on itself is a no-op', () => {
    const { container } = render(<Tab tab={sample('a')} isActive={false} index={0} />);
    const el = container.querySelector('[data-testid="tab"]') as HTMLElement;
    const dataTransfer = {
      types: ['text/x-horizon-tab'],
      getData: () => 'a',
      setData: () => {},
      dropEffect: '',
    };
    fireEvent.drop(el, { dataTransfer });
    expect(api().invokes.filter((i) => i.channel === 'tab:reorder')).toEqual([]);
  });
});
