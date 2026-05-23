// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import { AIPanel } from '@/components/overlays/AIPanel';

describe('AIPanel', () => {
  const { api } = setupRendererTest();

  it('renders the header and initial AI greeting', () => {
    render(<AIPanel />);
    expect(screen.getByRole('complementary', { name: 'Horizon AI' })).toBeTruthy();
    expect(screen.getByText(/I can see the page you're reading/)).toBeTruthy();
  });

  it('Send button is disabled until the textarea has content', () => {
    render(<AIPanel />);
    const send = screen.getByRole('button', { name: 'Send' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/), { target: { value: 'hi' } });
    expect((send as HTMLButtonElement).disabled).toBe(false);
  });

  it('Enter (no shift) submits and queues a stub AI reply', async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: 'hello' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    // The "you" bubble renders immediately.
    expect(screen.getByText('hello')).toBeTruthy();
    // The stub reply fires after 700ms — wait for it.
    await waitFor(
      () => expect(screen.getByText(/AI surface is wired up/)).toBeTruthy(),
      { timeout: 2000 }
    );
  });

  it('Shift+Enter does not submit (the draft stays in the textarea)', () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'one' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    // send() would have cleared the textarea on Enter; with shift held,
    // the draft must remain intact.
    expect(ta.value).toBe('one');
  });

  // Suppress unused import warning.
  void api;
});
