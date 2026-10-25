import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readBoreHostReceipt, saveBoreCheckpoint, saveBoreHostReceipt } from '../dist/boreCheckpoint.js';

const sessionId = '11111111-2222-4333-8444-555555555555';
const observationId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
function session() {
  return {
    schemaVersion: 1, id: sessionId, prompt: 'Test the synthetic app boundary.',
    startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:01:00Z',
    environment: {
      platform: 'iOS', osVersion: '19.0', osBuild: 'example', hardwareModel: 'iPhone-example',
      bundleID: 'org.example.bore', appVersion: '1', entitlementProfile: 'baseline', executionContext: 'foreground app',
    },
    status: 'candidate', planner: 'Beale: example/model', observations: [{
      id: observationId, probeID: 'foreign-container-canary-existence', verdict: 'unexpected',
      summary: 'Synthetic canary existence check succeeded.', timestamp: '2026-01-01T00:01:00Z',
    }],
  };
}

test('Bore checkpoints and host receipts are immutable workspace evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beale-bore-evidence-'));
  try {
    const first = await saveBoreCheckpoint(root, session());
    assert.equal(first.schemaVersion, 1);
    assert.equal(first.sessionId, sessionId);
    assert.match(first.contentHash, /^[0-9a-f]{64}$/u);
    assert.equal(JSON.parse(readFileSync(join(root, 'evidence', 'bore', sessionId, `${first.contentHash}.json`), 'utf8')).status, 'candidate');
    assert.deepEqual(await saveBoreCheckpoint(root, session()), first);
    await assert.rejects(saveBoreCheckpoint(root, {
      ...session(), observations: [{ ...session().observations[0], summary: '/example/private-file' }],
    }), /Invalid Bore session/u);
    const receipt = await saveBoreHostReceipt(root, {
      schemaVersion: 1, jobId: observationId, sessionId, kind: 'proof-cycle', status: 'completed',
      completedAt: '2026-01-01T00:02:00Z', steps: [{ name: 'build-proof', status: 'completed' }],
    });
    assert.equal(receipt.jobId, observationId);
    assert.deepEqual(await readBoreHostReceipt(root, sessionId, observationId), {
      schemaVersion: 1, jobId: observationId, sessionId, status: 'completed',
      steps: [{ name: 'build-proof', status: 'completed' }],
    });
    assert.deepEqual(await saveBoreHostReceipt(root, {
      schemaVersion: 1, jobId: observationId, sessionId, kind: 'proof-cycle', status: 'completed',
      completedAt: '2026-01-01T00:02:00Z', steps: [{ name: 'build-proof', status: 'completed' }],
    }), receipt);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Bore checkpoint storage rejects a linked evidence directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beale-bore-linked-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'beale-bore-elsewhere-'));
  try {
    symlinkSync(elsewhere, join(root, 'evidence'));
    await assert.rejects(saveBoreCheckpoint(root, session()), /real directory/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});
