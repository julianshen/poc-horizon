// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

  it('Enter (no shift) submits and dispatches ai:start IPC with the prompt', async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: 'hello' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    // The "you" bubble renders immediately.
    expect(screen.getByText('hello')).toBeTruthy();
    // ai:start IPC fires with the prompt for the agent to take over.
    await waitFor(() => {
      expect(api().invokes).toContainEqual({ channel: 'ai:start', payload: { prompt: 'hello' } });
    });
  });

  it('streams ai:event text_delta into the AI bubble', async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: 'hi' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    act(() => api().emit('ai:event', { type: 'text_delta', text: 'Hello back!' }));
    await waitFor(() => expect(screen.getByText('Hello back!')).toBeTruthy());
    act(() => api().emit('ai:event', { type: 'turn_end', reason: 'stop' }));
  });

  it('renders tool_use chips in the AI bubble while the agent runs', async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: 'go' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    act(() => api().emit('ai:event', { type: 'tool_use', id: 't1', name: 'navigate', input: { url: 'https://x' } }));
    await waitFor(() => expect(screen.getByText(/navigate/)).toBeTruthy());
    act(() => api().emit('ai:event', { type: 'tool_result', id: 't1', output: { ok: true } }));
    act(() => api().emit('ai:event', { type: 'turn_end', reason: 'stop' }));
  });

  it('Stop button cancels the in-flight turn', () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: 'go' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    const stop = screen.getByText('Stop');
    fireEvent.click(stop);
    expect(api().invokes).toContainEqual({ channel: 'ai:cancel', payload: {} });
  });

  it('New chat button fires ai:newChat and resets the message list', async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: 'first prompt' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(screen.getByText('first prompt')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('New chat'));
    expect(api().invokes).toContainEqual({ channel: 'ai:newChat', payload: {} });
    // After New chat, the prior user message is gone and we're back at INITIAL.
    expect(screen.queryByText('first prompt')).toBeNull();
    expect(screen.getByText(/I can see the page you're reading/)).toBeTruthy();
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
