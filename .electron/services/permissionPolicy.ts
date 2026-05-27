// Permission policy for renderer-initiated requests. Pure — no Electron deps —
// so the policy is the single source of truth and easy to test/audit.
//
// The Electron handlers wired up in SessionManager are intentionally thin
// adapters: they receive (permission, webContents) and consult this module.

export type PermissionName =
  | "geolocation"
  | "notifications"
  | "media"
  | "mediaKeySystem"
  | "midi"
  | "midiSysex"
  | "pointerLock"
  | "fullscreen"
  | "openExternal"
  | "display-capture"
  | "clipboard-read"
  | "clipboard-sanitized-write"
  | "idle-detection"
  | "window-management";

// Result for a setPermissionRequestHandler call (renderer prompt).
// Electron's callback receives a string broader than our union (extensions,
// future Chromium additions). Accepting `string` keeps the boundary safe
// while the union documents the set we actually reason about.
//
// We default-deny everything; the renderer surfaces a UI prompt and the
// user explicitly approves via a separate flow.
//
// TODO(per-origin): Electron also passes the webContents; once per-origin
// policy lands, thread `wc.getURL()`'s origin through to consult settings.
export function defaultRequestResponse(
  _permission: PermissionName | string,
): boolean {
  return false;
}

// Result for a setPermissionCheckHandler call (Chromium asks "is this
// already permitted without prompting?"). We auto-allow only the
// permissions whose UX would be broken by a prompt, and where the
// renderer already controls when the call happens.
const AUTO_ALLOW = new Set<PermissionName>(["fullscreen"]);

export function shouldAutoAllow(permission: PermissionName | string): boolean {
  return AUTO_ALLOW.has(permission as PermissionName);
}
