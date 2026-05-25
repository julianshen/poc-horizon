import { Menu, MenuItemConstructorOptions, WebContents, clipboard, shell } from 'electron';

interface BuildArgs {
  wc: WebContents;
  openInNewTab: (url: string) => void;
  /** Optional: surface "Ask Horizon about this" for selected text. */
  askAI?: (selection: string) => void;
}

/**
 * Build a Chrome-parity context menu from Electron's ContextMenuParams.
 * Items are filtered by the click context (link / image / editable /
 * selection) so the user sees only relevant entries — matches Chrome's
 * default web-content menu behavior.
 */
export function buildWebContextMenu(
  params: Electron.ContextMenuParams,
  { wc, openInNewTab, askAI }: BuildArgs
): Menu {
  const template: MenuItemConstructorOptions[] = [];
  const sep = (): void => { template.push({ type: 'separator' }); };

  // Spelling suggestions (only present when the click is on a misspelled
  // word inside an editable field; dictionarySuggestions is populated by
  // Chromium's spellchecker before the event fires).
  if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      template.push({
        label: suggestion,
        click: () => wc.replaceMisspelling(suggestion),
      });
    }
    template.push({
      label: `Add "${params.misspelledWord}" to dictionary`,
      click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    sep();
  }

  // Link context.
  if (params.linkURL) {
    template.push(
      { label: 'Open Link in New Tab', click: () => openInNewTab(params.linkURL) },
      { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
      { label: 'Open Link in Default Browser', click: () => { void shell.openExternal(params.linkURL); } },
      { label: 'Share Link', click: () => shareUrl(wc, params.linkURL) },
    );
    sep();
  }

  // Video context — Picture-in-Picture on the clicked video element.
  // Chromium exposes HTMLVideoElement.requestPictureInPicture() natively
  // in Electron; we just have to invoke it on the right element.
  if (params.mediaType === 'video') {
    template.push({
      label: 'Picture in Picture',
      click: () => {
        // Find the video at the click coordinates and call requestPictureInPicture.
        // elementFromPoint is fast and avoids needing a DOM-element token from main.
        void wc.executeJavaScript(`(function(){
          const el = document.elementFromPoint(${params.x}, ${params.y});
          const v = el && (el.tagName === 'VIDEO' ? el : el.closest && el.closest('video'));
          if (v && v.requestPictureInPicture) v.requestPictureInPicture().catch(() => {});
        })();`);
      },
    });
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
    // Non-editable but has selection — copy + AI affordances.
    template.push({ label: 'Copy', role: 'copy' });
    if (askAI) {
      template.push({
        label: `Ask Horizon about "${trim(params.selectionText, 28)}"`,
        click: () => askAI(params.selectionText),
      });
    }
    template.push({
      label: `Search the web for "${trim(params.selectionText, 28)}"`,
      click: () => openInNewTab(`https://duckduckgo.com/?q=${encodeURIComponent(params.selectionText)}`),
    });
    sep();
  }

  // Page navigation + sharing — always available.
  template.push(
    { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: 'Reload', click: () => wc.reload() },
    { label: 'Share Page', click: () => shareUrl(wc, wc.getURL()) },
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

/**
 * Try the Web Share API on the renderer side first (so the OS share
 * sheet shows up where available), then fall back to clipboard. Both
 * paths are wrapped so a rejected share Promise doesn't reach the user.
 */
function shareUrl(wc: WebContents, url: string): void {
  void wc.executeJavaScript(
    `(async () => {
       const url = ${JSON.stringify(url)};
       try {
         if (navigator.share) { await navigator.share({ url }); return; }
       } catch (_) {}
       try { await navigator.clipboard.writeText(url); } catch (_) {}
     })();`
  );
}
