import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { FleetBrowserSessionManager } from '../dist/fleetBrowserSessions.js';

test('closing a session releases every selected browser profile', async () => {
  const processes = [];
  const manager = new FleetBrowserSessionManager(() => '/synthetic/browser', (_executable, args) => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => { child.exitCode = 0; child.emit('exit', 0); return true; };
    const profilePath = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    writeFileSync(join(profilePath, 'DevToolsActivePort'), String(9200 + processes.length));
    processes.push(child);
    return child;
  });
  const sessionId = 'session-example';
  try {
    await manager.launch(sessionId, 'browser-one');
    await manager.launch(`${sessionId}::browser:two`, 'browser-two');
    await manager.launch('session-unrelated', 'browser-three');
    await manager.closeSessionTargets(sessionId);
    assert.equal(manager.endpoint(sessionId), null);
    assert.equal(manager.endpoint(`${sessionId}::browser:two`), null);
    assert.ok(manager.endpoint('session-unrelated'));
    assert.equal(processes[0].exitCode, 0);
    assert.equal(processes[1].exitCode, 0);
    assert.equal(processes[2].exitCode, null);
  } finally { await manager.closeAll(); }
});
