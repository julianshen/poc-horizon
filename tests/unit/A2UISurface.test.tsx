// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import { A2UISurface } from '@/components/overlays/A2UISurface';
import type { SurfaceState } from '@/types/a2ui';

function surface(components: SurfaceState['components'], root = 'r'): SurfaceState {
  return { id: 's1', root, components, dataModel: {} };
}

describe('A2UISurface action wire-back', () => {
  const { api } = setupRendererTest();

  it('Button click dispatches ai:uiAction kind:button with label + action', () => {
    const components = new Map();
    components.set('r', { id: 'r', component: { Button: { label: { literalString: 'Confirm' }, action: 'submit' } } });
    render(<A2UISurface surface={surface(components)} />);
    fireEvent.click(screen.getByText('Confirm'));
    expect(api().invokes).toContainEqual({
      channel: 'ai:uiAction',
      payload: { kind: 'button', surfaceId: 's1', label: 'Confirm', action: 'submit' },
    });
  });

  it('TextInput blur dispatches ai:uiAction kind:input with new value', () => {
    const components = new Map();
    components.set('r', { id: 'r', component: { TextInput: { placeholder: { literalString: 'name' }, path: '/name' } } });
    render(<A2UISurface surface={surface(components)} />);
    const input = screen.getByPlaceholderText('name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Alice' } });
    fireEvent.blur(input);
    expect(api().invokes).toContainEqual({
      channel: 'ai:uiAction',
      payload: { kind: 'input', surfaceId: 's1', path: '/name', placeholder: 'name', value: 'Alice' },
    });
  });

  it('TextInput blur with no change does not dispatch', () => {
    const components = new Map();
    components.set('r', { id: 'r', component: { TextInput: { value: { literalString: 'unchanged' } } } });
    render(<A2UISurface surface={surface(components)} />);
    const input = screen.getByDisplayValue('unchanged') as HTMLInputElement;
    fireEvent.blur(input);
    expect(api().invokes.filter((i) => i.channel === 'ai:uiAction')).toEqual([]);
  });
});
