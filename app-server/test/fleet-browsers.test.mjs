import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';
import { detectFleetBrowsers, fleetBrowserExecutable } from '../dist/fleetBrowsers.js';
import { FleetBrowserSessionManager } from '../dist/fleetBrowserSessions.js';

test('Fleet places the In-Agent Browser first and detects installed CDP browsers on Windows', () => {
  const installed = new Set([
    join('C:\\Example\\Programs', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join('C:\\Example\\Programs', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
  const environment = { PROGRAMFILES: 'C:\\Example\\Programs' };
  const browsers = detectFleetBrowsers('win32', 'C:\\Example\\Home', environment, (path) => installed.has(path));
  assert.deepEqual(browsers.map(({ id }) => id), ['in-agent', 'chrome', 'edge']);
  assert.equal(fleetBrowserExecutable('chrome', 'win32', 'C:\\Example\\Home', environment, (path) => installed.has(path)),
    join('C:\\Example\\Programs', 'Google', 'Chrome', 'Application', 'chrome.exe'));
});

test('Fleet detects installed CDP browsers in the macOS Applications directory', () => {
  const browsers = detectFleetBrowsers('darwin', '/Users/example', {},
    (path) => path.replaceAll('\\', '/').endsWith('/Google Chrome.app/Contents/MacOS/Google Chrome'));
  assert.deepEqual(browsers.map(({ id }) => id), ['in-agent', 'chrome']);
});

test('external Fleet browser uses a separate profile and removes it after the session', async () => {
  let profilePath = '';
  let stopped = false;
  const manager = new FleetBrowserSessionManager(() => 'example-browser', (_executable, args) => {
    profilePath = args.find((arg) => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length) ?? '';
    assert.ok(profilePath);
    assert.ok(args.includes('--remote-debugging-port=0'));
    assert.equal(args.at(-1), 'https://example.test/start');
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => { stopped = true; child.exitCode = 0; child.emit('exit', 0); return true; };
    setTimeout(() => writeFileSync(join(profilePath, 'DevToolsActivePort'), '54321\n/devtools/browser/example\n'), 10);
    return child;
  });
  assert.equal(await manager.launch('session-example', 'chrome', 'https://example.test/start'), 'http://127.0.0.1:54321');
  assert.equal(existsSync(profilePath), true);
  await manager.close('session-example');
  assert.equal(stopped, true);
  assert.equal(existsSync(profilePath), false);
});
