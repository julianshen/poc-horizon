// Policy: deny all renderer-initiated window.open (v1).

export function denyAllWindowOpens(): { action: 'deny' } {
  return { action: 'deny' };
}
