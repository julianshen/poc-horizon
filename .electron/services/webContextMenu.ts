import { Menu, MenuItemConstructorOptions, WebContents, clipboard, shell } from 'electron';

interface BuildArgs {
  wc: WebContents;
  openInNewTab: (url: string) => void;
}

/**
 * Build a Chrome-parity context menu from Electron's ContextMenuParams.
 * Items are filtered by the click context (link / image / editable /
 * selection) so the user sees only relevant entries — matches Chrome's
 * default web-content menu behavior.
 */
export function buildWebContextMenu(
  params: Electron.ContextMenuParams,
  { wc, openInNewTab }: BuildArgs
): Menu {
  const template: MenuItemConstructorOptions[] = [];
  const sep = (): void => { template.push({ type: 'separator' }); };

  // Link context.
  if (params.linkURL) {
    template.push(
      { label: 'Open Link in New Tab', click: () => openInNewTab(params.linkURL) },
      { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
      { label: 'Open Link in Default Browser', click: () => { void shell.openExternal(params.linkURL); } },
    );
    sep();
  }

  // Image context.
  if (params.hasImageContents && params.srcURL) {
    template.push(
      { label: 'Open Image in New Tab', click: () => openInNewTab(params.srcURL) },
      { label: 'Copy Image', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
    );
    sep();
  }

  // Editable field — full edit actions even when no selection (for paste).
  if (params.isEditable) {
    template.push(
      { label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo },
      { label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
      { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll },
    );
    sep();
  } else if (params.selectionText) {
    // Non-editable but has selection — copy only.
    template.push(
      { label: 'Copy', role: 'copy' },
      {
        label: `Search the web for "${trim(params.selectionText, 28)}"`,
        click: () => openInNewTab(`https://duckduckgo.com/?q=${encodeURIComponent(params.selectionText)}`),
      },
    );
    sep();
  }

  // Page navigation — always available.
  template.push(
    { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: 'Reload', click: () => wc.reload() },
    { type: 'separator' },
    { label: 'View Page Source', click: () => openInNewTab(`view-source:${wc.getURL()}`) },
    { label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) },
  );

  // Drop trailing separator if any.
  while (template.length > 0 && template[template.length - 1].type === 'separator') template.pop();

  return Menu.buildFromTemplate(template);
}

function trim(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
