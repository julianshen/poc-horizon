// Pop-up blocking policy for webContents.setWindowOpenHandler.
//
// Horizon's v1 behavior is to deny all renderer-initiated window.open
// requests — pop-ups, target=_blank without explicit user click handling,
// and any window.open invoked from page script. This matches Chrome's
// default with the pop-up blocker enabled.
//
// Future: thread `details.url` + a user-gesture flag here to permit
// trusted origins or click-initiated new windows; for now keep the
// policy pure and total so any new caller behaves the same.

export type WindowOpenResult = { action: 'deny' } | { action: 'allow' };

export function denyAllWindowOpens(): WindowOpenResult {
  return { action: 'deny' };
}
