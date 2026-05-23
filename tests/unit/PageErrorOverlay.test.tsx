// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageErrorOverlay } from '@/components/overlays/PageErrorOverlay';

describe('PageErrorOverlay', () => {
  it.each([
    ['load-failed', "This site can't be reached"],
    ['crashed', 'This page crashed'],
    ['unresponsive', 'This page is not responding'],
  ] as const)('renders the right headline for errorType=%s', (errorType, headline) => {
    render(<PageErrorOverlay errorType={errorType} onReload={vi.fn()} />);
    expect(screen.getByText(headline)).toBeTruthy();
  });

  it('shows the error description when provided', () => {
    render(
      <PageErrorOverlay
        errorType="load-failed"
        errorDescription="DNS lookup failed"
        onReload={vi.fn()}
      />
    );
    expect(screen.getByText('DNS lookup failed')).toBeTruthy();
  });

  it('shows the error code when provided', () => {
    render(
      <PageErrorOverlay errorType="load-failed" errorCode={-105} onReload={vi.fn()} />
    );
    expect(screen.getByText('Error code: -105')).toBeTruthy();
  });

  it('does not render description/code when not provided', () => {
    render(<PageErrorOverlay errorType="load-failed" onReload={vi.fn()} />);
    expect(screen.queryByText(/Error code:/)).toBeNull();
  });

  it('Reload button invokes the onReload callback (single click)', () => {
    const onReload = vi.fn();
    render(<PageErrorOverlay errorType="load-failed" onReload={onReload} />);
    fireEvent.click(screen.getByText('Reload'));
    expect(onReload).toHaveBeenCalledOnce();
  });
});
