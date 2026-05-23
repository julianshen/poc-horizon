// Permission policy for renderer-initiated requests. Pure — no Electron deps —
// so the policy is the single source of truth and easy to test/audit.
//
// The Electron handlers wired up in SessionManager are intentionally thin
// adapters: they receive (permission, webContents) and consult this module.

export type PermissionName =
  | 'geolocation'
  | 'notifications'
  | 'media'
  | 'mediaKeySystem'
  | 'midi'
  | 'midiSysex'
  | 'pointerLock'
  | 'fullscreen'
  | 'openExternal'
  | 'display-capture'
  | 'clipboard-read'
  | 'clipboard-sanitized-write'
  | 'idle-detection'
  | 'window-management';

// Result for a setPermissionRequestHandler call (renderer prompt).
// We default-deny everything; the renderer surfaces a UI prompt and the
// user explicitly approves via a separate flow.
export function defaultRequestResponse(_permission: string): boolean {
  return false;
}

// Result for a setPermissionCheckHandler call (Chromium asks "is this
// already permitted without prompting?"). We auto-allow only the
// permissions whose UX would be broken by a prompt, and where the
// renderer already controls when the call happens.
const AUTO_ALLOW: ReadonlySet<string> = new Set<PermissionName>(['fullscreen']);

export function shouldAutoAllow(permission: string): boolean {
  return AUTO_ALLOW.has(permission);
}
