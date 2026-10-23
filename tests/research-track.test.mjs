import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ResearchTrackStore } from '../packages/research-agent/dist/index.js';

const workspaceId = 'workspace-example-track';
const covered = { covered: true, unmetRequirements: [] };
const open = { covered: false, unmetRequirements: ['surface_map', 'sinks'] };
const surfaces = [
  { id: 'resource-example-a', parentId: null, name: 'Example service', coverageState: open, progressBlocker: null },
  { id: 'resource-example-b', parentId: null, name: 'Example library', coverageState: open, progressBlocker: null },
];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'beale-track-example-'));
  const databasePath = join(directory, 'memory.sqlite');
  const store = new ResearchTrackStore({ databasePath, workspaceId });
  const database = new DatabaseSync(databasePath);
  database.exec('CREATE TABLE memory_nodes (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, updated_at TEXT NOT NULL)');
  database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?)').run('memory-example-a', workspaceId, '2000-01-01T00:00:00.000Z');
  database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?)').run('memory-other-workspace', 'workspace-other', '2000-01-01T00:00:00.000Z');
  return { store, database, databasePath, close() { database.close(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('track reserves bounded surface epochs and requires canonical evidence for completion', () => {
  const state = fixture();
  try {
    const started = state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex', model: 'example-model' },
      targetIds: ['local'], surfaces });
    assert.equal(started.status, 'running');
    assert.equal(started.pass, 1);
    const first = state.store.reserveNext('session-example-one', surfaces);
    assert.equal(first.surface.id, 'resource-example-a');
    const worker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId, sessionId: 'session-example-one' });
    try {
      assert.throws(() => worker.checkpoint({ surfaceId: first.surface.id, outcome: 'complete', impact: 'high',
        theory: 'Untrusted input reaches privileged parsing.', nextAction: 'Revisit after source changes.',
        evidenceRefs: ['memory-example-a'] }, { ...first.surface, coverageState: covered }), /canonical/);
      assert.throws(() => worker.checkpoint({ surfaceId: first.surface.id, outcome: 'complete', impact: 'high',
        theory: 'Untrusted input reaches privileged parsing.', nextAction: 'Revisit after source changes.',
        evidenceRefs: ['memory:memory-other-workspace'] }, { ...first.surface, coverageState: covered }), /canonical/);
      assert.throws(() => worker.checkpoint({ surfaceId: first.surface.id, outcome: 'complete', impact: 'high',
        theory: 'Untrusted input reaches privileged parsing.', nextAction: 'Revisit after source changes.',
        evidenceRefs: ['memory:memory-example-a'] }, first.surface), /coverage/);
      assert.throws(() => worker.checkpoint({ surfaceId: first.surface.id, outcome: 'complete', impact: 'high',
        theory: 'Untrusted input reaches privileged parsing.', nextAction: 'Revisit after source changes.',
        evidenceRefs: ['memory:memory-example-a'] }, { ...first.surface, coverageState: covered }), /updated during/);
      state.database.prepare('UPDATE memory_nodes SET updated_at=? WHERE id=?')
        .run(new Date().toISOString(), 'memory-example-a');
      worker.checkpoint({ surfaceId: first.surface.id, outcome: 'complete', impact: 'high',
        theory: 'Untrusted input reaches privileged parsing.', nextAction: 'Revisit after source changes.',
        evidenceRefs: ['memory:memory-example-a'] }, { ...first.surface, coverageState: covered });
    } finally { worker.close(); }
    state.store.finishEpoch('session-example-one', true);
    assert.equal(state.store.get().surfaces.find((work) => work.surfaceId === first.surface.id).status, 'deferred');
    assert.ok(state.store.get().surfaces.find((work) => work.surfaceId === first.surface.id).revisitAfter);
    const map = [{ ...surfaces[0], coverageState: covered }, surfaces[1]];
    assert.equal(state.store.reserveNext('session-example-two', map).surface.id, 'resource-example-b');
    state.store.finishEpoch('session-example-two', false, 'Example provider error');
    assert.equal(state.store.get().surfaces.find((work) => work.surfaceId === 'resource-example-b').noProgressEpochs, 1);
    assert.equal(state.store.get().activeSessionId, null);
  } finally { state.close(); }
});

test('a high-impact surface receives a later second look before track completion', () => {
  const state = fixture();
  try {
    const map = [{ ...surfaces[0], coverageState: covered }];
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' }, targetIds: ['local'], surfaces: map });
    const first = state.store.reserveNext('session-example-first', map);
    state.database.prepare('UPDATE memory_nodes SET updated_at=? WHERE id=?').run(new Date().toISOString(), 'memory-example-a');
    const worker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId, sessionId: 'session-example-first' });
    try { worker.checkpoint({ surfaceId: first.surface.id, outcome: 'complete', impact: 'critical',
      theory: 'Reviewed a privileged boundary.', nextAction: 'Check another attacker path.',
      evidenceRefs: ['memory:memory-example-a'] }, map[0]); }
    finally { worker.close(); }
    state.store.finishEpoch('session-example-first', true);
    assert.equal(state.store.reserveNext('session-example-too-early', map), null);
    assert.equal(state.store.get().status, 'running');
    state.database.prepare('UPDATE app_server_research_track_surfaces SET revisit_after=? WHERE workspace_id=? AND surface_id=?')
      .run('2000-01-01T00:00:00.000Z', workspaceId, first.surface.id);
    const second = state.store.reserveNext('session-example-second', map);
    assert.equal(second.surface.id, first.surface.id);
    state.database.prepare('UPDATE memory_nodes SET updated_at=? WHERE id=?').run(new Date().toISOString(), 'memory-example-a');
    const secondWorker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId, sessionId: 'session-example-second' });
    try { secondWorker.checkpoint({ surfaceId: first.surface.id, outcome: 'complete', impact: 'critical',
      theory: 'Second path did not reach the privileged sink.', nextAction: 'Revisit after a source change.',
      evidenceRefs: ['memory:memory-example-a'] }, map[0]); }
    finally { secondWorker.close(); }
    state.store.finishEpoch('session-example-second', true);
    assert.equal(state.store.reserveNext('session-example-final', map), null);
    assert.equal(state.store.get().status, 'complete');
  } finally { state.close(); }
});

test('track respects blockers, changes in coverage, and a new audit pass', () => {
  const state = fixture();
  try {
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' }, targetIds: ['local'], surfaces });
    const blocked = [{ ...surfaces[0], progressBlocker: { reason: 'An authorized account is unavailable.' } }, surfaces[1]];
    assert.equal(state.store.syncSurfaces(blocked).surfaces.find((work) => work.surfaceId === surfaces[0].id).status, 'blocked');
    assert.equal(state.store.reserveNext('session-example-two', blocked).surface.id, surfaces[1].id);
    state.store.finishEpoch('session-example-two', true);
    const worker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId, sessionId: 'session-example-three' });
    try {
      const assigned = state.store.reserveNext('session-example-three', blocked);
      assert.equal(assigned.surface.id, surfaces[1].id);
      state.database.prepare('UPDATE memory_nodes SET updated_at=? WHERE id=?')
        .run(new Date().toISOString(), 'memory-example-a');
      worker.checkpoint({ surfaceId: surfaces[1].id, outcome: 'complete', impact: 'medium',
        theory: 'Reviewed the library trust boundary.', nextAction: 'Revisit after source changes.',
        evidenceRefs: ['memory:memory-example-a'] }, { ...surfaces[1], coverageState: covered });
    } finally { worker.close(); }
    state.store.finishEpoch('session-example-three', true);
    const map = [blocked[0], { ...surfaces[1], coverageState: covered }];
    assert.equal(state.store.reserveNext('session-example-four', map), null);
    assert.equal(state.store.get().status, 'waiting');
    assert.equal(state.store.control('resume').status, 'running');
    assert.equal(state.store.syncSurfaces([surfaces[0], map[1]]).surfaces.find((work) => work.surfaceId === surfaces[0].id).status, 'deferred');
    assert.equal(state.store.reserveNext('session-example-five', [surfaces[0], map[1]]).surface.id, surfaces[0].id);
    state.store.finishEpoch('session-example-five', false);
    state.store.control('stop');
    assert.equal(state.store.start({ scopeId: 'scope-example-new', provider: { id: 'openai-codex' },
      targetIds: ['local'], surfaces }).pass, 2);
  } finally { state.close(); }
});

test('a structural parent waits for child coverage and is selected after its children', () => {
  const state = fixture();
  try {
    const map = [
      { ...surfaces[0], coverageState: { covered: false, unmetRequirements: ['child_surfaces'] } },
      { ...surfaces[1], parentId: surfaces[0].id },
    ];
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' }, targetIds: ['local'], surfaces: map });
    assert.equal(state.store.reserveNext('session-example-child', map).surface.id, surfaces[1].id);
    const worker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId, sessionId: 'session-example-child' });
    try {
      state.database.prepare('UPDATE memory_nodes SET updated_at=? WHERE id=?').run(new Date().toISOString(), 'memory-example-a');
      worker.checkpoint({ surfaceId: surfaces[1].id, outcome: 'complete', impact: 'medium',
        theory: 'A child trust boundary was investigated.', nextAction: 'Revisit after the source changes.',
        evidenceRefs: ['memory:memory-example-a'] }, { ...map[1], coverageState: covered });
    } finally { worker.close(); }
    state.store.finishEpoch('session-example-child', true);
    const progressedMap = [map[0], { ...map[1], coverageState: covered }];
    assert.equal(state.store.reserveNext('session-example-parent', progressedMap).surface.id, surfaces[0].id);
  } finally { state.close(); }
});

test('three epochs without durable progress pause the track', () => {
  const state = fixture();
  try {
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' }, targetIds: ['local'], surfaces: [surfaces[0]] });
    for (let index = 0; index < 3; index += 1) {
      const sessionId = `session-example-no-progress-${index}`;
      assert.ok(state.store.reserveNext(sessionId, [surfaces[0]]));
      state.store.finishEpoch(sessionId, true);
    }
    assert.equal(state.store.get().status, 'paused');
    assert.match(state.store.get().lastError, /no durable progress/);
  } finally { state.close(); }
});

test('report-ready findings do not reopen completed surface work', () => {
  const state = fixture();
  try {
    const map = [{ ...surfaces[0], coverageState: { covered: false,
      unmetRequirements: ['unblocked_findings'], unblockedFindingIds: ['finding-example'] } }];
    state.database.exec('CREATE TABLE app_server_research_claims (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)');
    state.database.prepare('INSERT INTO app_server_research_claims VALUES (?, ?, ?, ?)')
      .run('finding-example', workspaceId, 'report_ready', new Date().toISOString());
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' }, targetIds: ['local'], surfaces: map });
    state.store.reserveNext('session-example-report-ready', map);
    state.database.prepare('UPDATE memory_nodes SET updated_at=? WHERE id=?').run(new Date().toISOString(), 'memory-example-a');
    const worker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId, sessionId: 'session-example-report-ready' });
    try { worker.checkpoint({ surfaceId: map[0].id, outcome: 'complete', impact: 'medium',
      theory: 'The finding is ready for reporting.', nextAction: 'Revisit after a source change.',
      evidenceRefs: ['memory:memory-example-a'] }, map[0]); }
    finally { worker.close(); }
    state.store.finishEpoch('session-example-report-ready', true);
    assert.equal(state.store.reserveNext('session-example-next', map), null);
    assert.equal(state.store.get().surfaces[0].status, 'complete');
    assert.equal(state.store.get().status, 'complete');
  } finally { state.close(); }
});
