// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import { PermissionPrompt } from '@/components/overlays/PermissionPrompt';

describe('PermissionPrompt', () => {
  const { api } = setupRendererTest();

  it('renders nothing until a permission:request event arrives', () => {
    render(<PermissionPrompt />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the origin and a human-readable permission label on request', () => {
    render(<PermissionPrompt />);
    act(() => {
      api().emit('permission:request', {
        id: 'r1',
        permission: 'media',
        origin: 'https://example.com',
      });
    });
    expect(screen.getByRole('dialog', { name: 'Permission request' })).toBeTruthy();
    expect(screen.getByText(/https:\/\/example\.com/)).toBeTruthy();
    expect(screen.getByText(/use your camera and microphone/i)).toBeTruthy();
  });

  it('Allow dispatches permission:respond { allow } and clears the prompt', () => {
    render(<PermissionPrompt />);
    act(() => api().emit('permission:request', { id: 'r2', permission: 'geolocation', origin: 'https://a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(api().invokes).toEqual([
      { channel: 'permission:respond', payload: { id: 'r2', decision: 'allow' } },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Block dispatches permission:respond { block } and clears the prompt', () => {
    render(<PermissionPrompt />);
    act(() => api().emit('permission:request', { id: 'r3', permission: 'notifications', origin: 'https://b' }));
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(api().invokes).toEqual([
      { channel: 'permission:respond', payload: { id: 'r3', decision: 'block' } },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('falls back to "use <permission>" when the permission key is unknown', () => {
    render(<PermissionPrompt />);
    act(() => api().emit('permission:request', { id: 'r4', permission: 'fancy-feature', origin: 'https://c' }));
    expect(screen.getByText(/use fancy-feature/i)).toBeTruthy();
  });

  it('queues a second request and shows "+N more" while the first is open', () => {
    render(<PermissionPrompt />);
    act(() => api().emit('permission:request', { id: 'q1', permission: 'media', origin: 'https://a' }));
    act(() => api().emit('permission:request', { id: 'q2', permission: 'geolocation', origin: 'https://b' }));
    // First prompt still rendered; counter shows the queued one.
    expect(screen.getByText(/use your camera and microphone/i)).toBeTruthy();
    expect(screen.getByText(/\+1 more/)).toBeTruthy();
  });

  it('advances to the next queued prompt after responding to the current one', () => {
    render(<PermissionPrompt />);
    act(() => api().emit('permission:request', { id: 'q1', permission: 'media', origin: 'https://a' }));
    act(() => api().emit('permission:request', { id: 'q2', permission: 'geolocation', origin: 'https://b' }));
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    // After Allow, q1 is dismissed and q2 is shown.
    expect(screen.getByText(/know your location/i)).toBeTruthy();
    expect(api().invokes).toEqual([
      { channel: 'permission:respond', payload: { id: 'q1', decision: 'allow' } },
    ]);
  });
});
