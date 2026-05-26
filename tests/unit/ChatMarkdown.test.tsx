// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatMarkdown } from '@/components/overlays/ChatMarkdown';

describe('ChatMarkdown CopyableCodeBlock', () => {
  it('renders a Copy button on fenced code blocks', () => {
    render(<ChatMarkdown text={'Here is code:\n\n```ts\nconst x = 1;\nconsole.log(x);\n```\n'} />);
    expect(screen.getByLabelText('Copy code')).toBeTruthy();
  });

  it('clicking Copy writes the snippet to the clipboard and flashes Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ChatMarkdown text={'```js\nlet x = 42;\n```'} />);
    fireEvent.click(screen.getByLabelText('Copy code'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/let x = 42/);
    await waitFor(() => expect(screen.getByLabelText('Copied')).toBeTruthy());
  });

  it('does not put a Copy button on inline code', () => {
    render(<ChatMarkdown text={'Inline `code` should not have a button.'} />);
    expect(screen.queryByLabelText('Copy code')).toBeNull();
  });
});
