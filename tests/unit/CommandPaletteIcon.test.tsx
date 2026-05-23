// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CommandPaletteIcon } from '@/components/overlays/CommandPaletteIcon';

describe('CommandPaletteIcon', () => {
  it('renders the sparkle for ai', () => {
    const { container } = render(<CommandPaletteIcon kind="ai" />);
    expect(container.querySelector('svg path')).toBeTruthy();
  });

  it('renders a rect for tab', () => {
    const { container } = render(<CommandPaletteIcon kind="tab" />);
    expect(container.querySelector('svg rect')).toBeTruthy();
  });

  it('renders the gear for cmd', () => {
    const { container } = render(<CommandPaletteIcon kind="cmd" />);
    expect(container.querySelector('svg circle')).toBeTruthy();
  });

  it('renders the gear for page', () => {
    const { container } = render(<CommandPaletteIcon kind="page" />);
    expect(container.querySelector('svg circle')).toBeTruthy();
  });
});
