// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OmniboxSuggestions } from '@/components/chrome/OmniboxSuggestions';

const entry = (id: string, title = id) => ({
  id, url: `https://${id}`, title, visitTime: 0, visitCount: 1, typedCount: 0,
});

describe('OmniboxSuggestions', () => {
  it('renders nothing when the list is empty', () => {
    const { container } = render(
      <OmniboxSuggestions suggestions={[]} highlightIndex={-1} onSelect={() => {}} onHover={() => {}} />
    );
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('renders one row per suggestion with its title + bare URL', () => {
    render(
      <OmniboxSuggestions
        suggestions={[entry('a', 'Alpha'), entry('b', 'Beta')]}
        highlightIndex={0}
        onSelect={() => {}}
        onHover={() => {}}
      />
    );
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('marks the highlighted row aria-selected', () => {
    render(
      <OmniboxSuggestions
        suggestions={[entry('a'), entry('b')]}
        highlightIndex={1}
        onSelect={() => {}}
        onHover={() => {}}
      />
    );
    const rows = screen.getAllByRole('option');
    expect(rows[0].getAttribute('aria-selected')).toBe('false');
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
  });

  it('mousedown calls onSelect with the row URL (and prevents blur)', () => {
    const onSelect = vi.fn();
    render(
      <OmniboxSuggestions
        suggestions={[entry('a')]}
        highlightIndex={0}
        onSelect={onSelect}
        onHover={() => {}}
      />
    );
    fireEvent.mouseDown(screen.getByRole('option'));
    expect(onSelect).toHaveBeenCalledWith('https://a');
  });

  it('mouseenter calls onHover with the index', () => {
    const onHover = vi.fn();
    render(
      <OmniboxSuggestions
        suggestions={[entry('a'), entry('b')]}
        highlightIndex={0}
        onSelect={() => {}}
        onHover={onHover}
      />
    );
    fireEvent.mouseEnter(screen.getAllByRole('option')[1]);
    expect(onHover).toHaveBeenCalledWith(1);
  });
});
