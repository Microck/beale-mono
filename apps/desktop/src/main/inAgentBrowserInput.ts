import type { WebContents } from 'electron';

/** CDP keyboard editing commands follow the embedder's focused frame, even on a guest debugger. */
export async function focusInAgentBrowserInput(guest: WebContents): Promise<void> {
  if (guest.isDestroyed()) throw new Error('The embedded browser input target is unavailable.');
  const host = guest.hostWebContents;
  if (!host || host.isDestroyed()) {
    throw new Error('The embedded browser input target is unavailable.');
  }
  // Focus the actual webview element; WebContents.focus() alone does not select
  // its frame in the embedder. Only the trusted host document runs this script.
  const focused: unknown = await host.executeJavaScript(`(() => {
    const page = Array.from(document.querySelectorAll('webview')).find((candidate) => {
      try { return candidate.getWebContentsId() === ${guest.id}; } catch { return false; }
    });
    if (!page || !page.checkVisibility()) return false;
    page.focus();
    return document.activeElement === page;
  })()`);
  if (focused !== true) {
    throw new Error('Open the embedded browser context before sending browser input.');
  }
}
