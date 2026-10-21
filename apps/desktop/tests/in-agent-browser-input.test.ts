import { runInNewContext } from 'node:vm';
import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { focusInAgentBrowserInput } from '../src/main/inAgentBrowserInput';

function inputFixture() {
  const document = { activeElement: {} as unknown, querySelectorAll: () => [unready, other, page] };
  const unready = { getWebContentsId: () => { throw new Error('Not ready'); } };
  const other = { getWebContentsId: () => 8, focus: vi.fn() };
  const page = {
    getWebContentsId: () => 7,
    checkVisibility: () => true,
    focus: vi.fn(() => { document.activeElement = page; })
  };
  const host = {
    isDestroyed: () => false,
    executeJavaScript: vi.fn(async (script: string) => runInNewContext(script, { document }) as unknown)
  };
  const guest = { id: 7, isDestroyed: () => false, hostWebContents: host };
  return { document, other, page, host, guest: guest as unknown as WebContents };
}

describe('embedded browser input focus', () => {
  it('focuses only the matching guest element in the trusted host document', async () => {
    const fixture = inputFixture();
    await focusInAgentBrowserInput(fixture.guest);
    expect(fixture.document.activeElement).toBe(fixture.page);
    expect(fixture.other.focus).not.toHaveBeenCalled();
  });

  it('rejects hidden, missing, and unfocusable browser elements', async () => {
    const hidden = inputFixture();
    hidden.page.checkVisibility = () => false;
    await expect(focusInAgentBrowserInput(hidden.guest)).rejects.toThrow('Open the embedded browser');
    expect(hidden.page.focus).not.toHaveBeenCalled();

    const missing = inputFixture();
    missing.page.getWebContentsId = () => 9;
    await expect(focusInAgentBrowserInput(missing.guest)).rejects.toThrow('Open the embedded browser');

    const unfocusable = inputFixture();
    unfocusable.page.focus.mockImplementation(() => undefined);
    await expect(focusInAgentBrowserInput(unfocusable.guest)).rejects.toThrow('Open the embedded browser');
  });

  it('rejects destroyed guests and hosts without evaluating host code', async () => {
    const fixture = inputFixture();
    fixture.host.isDestroyed = () => true;
    await expect(focusInAgentBrowserInput(fixture.guest)).rejects.toThrow('unavailable');
    expect(fixture.host.executeJavaScript).not.toHaveBeenCalled();
    await expect(focusInAgentBrowserInput({
      isDestroyed: () => true,
      get hostWebContents() { throw new Error('Destroyed guest accessed'); }
    } as unknown as WebContents)).rejects.toThrow('unavailable');
  });
});
