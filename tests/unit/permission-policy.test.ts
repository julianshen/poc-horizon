import { describe, it, expect } from 'vitest';
import { defaultRequestResponse, shouldAutoAllow } from '@electron/services/permissionPolicy';

describe('permissionPolicy', () => {
  describe('defaultRequestResponse', () => {
    it.each([
      'geolocation',
      'notifications',
      'media',
      'midi',
      'midiSysex',
      'pointerLock',
      'openExternal',
      'display-capture',
      'fullscreen',
      // Unknown permission strings must also default-deny.
      'unknown-permission',
    ])('denies %s by default', (p) => {
      expect(defaultRequestResponse(p)).toBe(false);
    });
  });

  describe('shouldAutoAllow', () => {
    it('auto-allows fullscreen', () => {
      expect(shouldAutoAllow('fullscreen')).toBe(true);
    });

    it.each([
      'geolocation',
      'notifications',
      'media',
      'midi',
      'midiSysex',
      'pointerLock',
      'openExternal',
      'display-capture',
      'unknown-permission',
    ])('does not auto-allow %s', (p) => {
      expect(shouldAutoAllow(p)).toBe(false);
    });
  });
});
