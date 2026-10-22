import { useEffect, useRef, useState } from 'react';
import type { FormEvent, JSX, KeyboardEvent, PointerEvent } from 'react';
import { browserNavigationUrl } from './BrowserSideView';
import type { FleetBrowserInput } from '../../../shared/fleetBrowser';

export function FleetBrowserSideView({ runId, visible, remoteServerId, onUrlChange }: { runId: string; visible: boolean; remoteServerId?: string; onUrlChange?: (url: string) => void }): JSX.Element {
  const frameRef = useRef<HTMLImageElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const keyboardRef = useRef<HTMLTextAreaElement | null>(null);
  const viewportRef = useRef({ width: 1280, height: 800 });
  const lastMoveRef = useRef(0);
  const [address, setAddress] = useState('');
  const onUrlChangeRef = useRef(onUrlChange);
  onUrlChangeRef.current = onUrlChange;
  const [status, setStatus] = useState('Connecting to browser…');
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!visible) return undefined;
    setConnected(false);
    setStatus('Connecting to browser…');
    setAddress('');
    frameRef.current?.removeAttribute('src');
    const unsubscribe = window.beale.onFleetBrowserUpdate((update) => {
      if (update.runId !== runId) return;
      if (update.type === 'browser.frame') {
        viewportRef.current = { width: update.width, height: update.height };
        if (frameRef.current) frameRef.current.src = `data:${update.mime};base64,${update.data}`;
        setConnected(true);
        setStatus('');
      } else if (update.type === 'browser.ready') {
        viewportRef.current = { width: update.width, height: update.height };
        setAddress(update.url === 'about:blank' ? '' : update.url);
        onUrlChangeRef.current?.(update.url);
        setConnected(true);
        setStatus('');
      } else if (update.type === 'browser.location') {
        setAddress(update.url === 'about:blank' ? '' : update.url);
        onUrlChangeRef.current?.(update.url);
      } else if (update.type === 'browser.error') {
        setStatus(update.message);
      } else if (update.type === 'browser.disconnected') {
        setConnected(false);
        setStatus('Reconnecting to browser…');
      }
    });
    void window.beale.connectFleetBrowser(runId, remoteServerId).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : 'Could not connect to browser.');
    });
    return () => {
      unsubscribe();
      void window.beale.disconnectFleetBrowser(runId);
    };
  }, [runId, visible, remoteServerId]);

  useEffect(() => {
    if (!visible) return undefined;
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (!connected) return;
      event.preventDefault();
      const point = coordinates(surface, event.clientX, event.clientY, viewportRef.current);
      sendInput(runId, { type: 'browser.mouse', eventType: 'mouseWheel', ...point, deltaX: event.deltaX, deltaY: event.deltaY });
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, [runId, visible, connected]);

  const navigate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const url = browserNavigationUrl(address);
    if (!url) { setStatus('Enter an HTTP or HTTPS URL.'); return; }
    sendInput(runId, { type: 'browser.navigate', url });
    keyboardRef.current?.focus();
  };

  const pointer = (event: PointerEvent<HTMLDivElement>, eventType: 'mousePressed' | 'mouseReleased' | 'mouseMoved'): void => {
    if (eventType === 'mousePressed') keyboardRef.current?.focus();
    if (!connected) return;
    if (eventType === 'mouseMoved' && Date.now() - lastMoveRef.current < 33) return;
    lastMoveRef.current = Date.now();
    const point = coordinates(event.currentTarget, event.clientX, event.clientY, viewportRef.current);
    const button = event.button === 1 ? 'middle' : event.button === 2 ? 'right' : eventType === 'mouseMoved' ? 'none' : 'left';
    sendInput(runId, { type: 'browser.mouse', eventType, ...point, button, buttons: event.buttons, clickCount: eventType === 'mouseMoved' ? 0 : 1 });
    if (eventType === 'mousePressed') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const key = (event: KeyboardEvent<HTMLDivElement>, eventType: 'keyDown' | 'keyUp'): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
      event.stopPropagation();
      if (eventType === 'keyUp') event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!connected) return;
    sendInput(runId, { type: 'browser.key', eventType, key: event.key, code: event.code,
      text: eventType === 'keyDown' && event.key.length === 1 && !event.metaKey && !event.ctrlKey ? event.key : '',
      modifiers: (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0) });
  };

  return (
    <section className="research-browser" aria-label="Session browser">
      <form className="research-browser-address" onSubmit={navigate}>
        <input type="text" inputMode="url" aria-label="Browser URL" placeholder="Enter a URL"
          value={address} onChange={(event) => setAddress(event.target.value)} />
      </form>
      {status ? <p className="research-browser-error" role="status">{status}</p> : null}
      <div ref={surfaceRef} className="research-browser-page fleet-browser-page" tabIndex={0} role="application"
        aria-label="Interactive session browser page"
        onFocus={(event) => { if (event.target === event.currentTarget) keyboardRef.current?.focus(); }}
        onPointerDown={(event) => pointer(event, 'mousePressed')}
        onPointerUp={(event) => pointer(event, 'mouseReleased')}
        onPointerMove={(event) => pointer(event, 'mouseMoved')}
        onKeyDown={(event) => key(event, 'keyDown')}
        onKeyUp={(event) => key(event, 'keyUp')}
        onCompositionEnd={(event) => { event.stopPropagation(); if (connected) sendInput(runId, { type: 'browser.text', text: event.data }); if (keyboardRef.current) keyboardRef.current.value = ''; }}
        onPaste={(event) => { event.preventDefault(); event.stopPropagation(); if (connected) sendInput(runId, { type: 'browser.text', text: event.clipboardData.getData('text') }); }}
      >
        <img ref={frameRef} alt="Session browser display" draggable={false} />
        <textarea ref={keyboardRef} className="fleet-browser-keyboard" tabIndex={-1} aria-label="Browser keyboard input"
          autoComplete="off" autoCorrect="off" spellCheck={false} onChange={(event) => { event.currentTarget.value = ''; }} />
      </div>
    </section>
  );
}

function coordinates(element: HTMLElement, clientX: number, clientY: number, viewport: { width: number; height: number }): { x: number; y: number } {
  const bounds = element.getBoundingClientRect();
  const x = Math.max(0, Math.min(viewport.width, (clientX - bounds.left) * viewport.width / Math.max(1, bounds.width)));
  const y = Math.max(0, Math.min(viewport.height, (clientY - bounds.top) * viewport.height / Math.max(1, bounds.height)));
  return { x, y };
}

function sendInput(runId: string, input: FleetBrowserInput): void {
  void window.beale.fleetBrowserInput(runId, input).catch(() => undefined);
}
