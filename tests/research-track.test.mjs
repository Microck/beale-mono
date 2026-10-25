import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ResearchTrackStore, createResearchTrackTool, researchTrackProgress } from '../packages/research-agent/dist/index.js';
import { AppServerHostService } from '../app-server/dist/hostService.js';

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
  database.exec(`CREATE TABLE memory_nodes (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL);
    CREATE TABLE memory_node_workspaces (node_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      workspace_name TEXT NOT NULL, PRIMARY KEY(node_id, workspace_id))`);
  database.prepare('INSERT INTO memory_nodes VALUES (?, ?)').run('memory-example-a', '2000-01-01T00:00:00.000Z');
  database.prepare('INSERT INTO memory_nodes VALUES (?, ?)').run('memory-other-workspace', '2000-01-01T00:00:00.000Z');
  database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)')
    .run('memory-example-a', workspaceId, 'Example workspace');
  database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)')
    .run('memory-other-workspace', 'workspace-other', 'Other workspace');
  return { store, database, databasePath, close() { database.close(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('existing track tables gain optional launch configuration columns', () => {
  const directory = mkdtempSync(join(tmpdir(), 'beale-track-migration-example-'));
  const databasePath = join(directory, 'memory.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`CREATE TABLE app_server_research_tracks (
      workspace_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
      pass INTEGER NOT NULL, scope_id TEXT NOT NULL, provider_json TEXT NOT NULL,
      target_ids_json TEXT NOT NULL, active_session_id TEXT, active_surface_id TEXT,
      epoch_count INTEGER NOT NULL, last_surface_id TEXT, consecutive_surface_epochs INTEGER NOT NULL,
      last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE app_server_research_track_surfaces (
      workspace_id TEXT NOT NULL, surface_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
      impact TEXT NOT NULL, theory TEXT NOT NULL, next_action TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL, epochs INTEGER NOT NULL, no_progress_epochs INTEGER NOT NULL,
      revisits INTEGER NOT NULL, revisit_after TEXT, last_worked_at TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, surface_id)
    );
    CREATE TABLE app_server_surfaces (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_id TEXT)`);
    database.exec(`INSERT INTO app_server_surfaces VALUES
      ('resource-example-old', '${workspaceId}', NULL),
      ('surface-example-old', '${workspaceId}', 'resource-example-old'),
      ('surface-example-other', 'workspace-example-other', 'resource-example-other');
    INSERT INTO app_server_research_track_surfaces VALUES
      ('${workspaceId}', 'resource-example-old', 'Example root', 'unexamined', 'unknown', '', '', '[]', 0, 0, 0, NULL, NULL, '2000-01-01T00:00:00.000Z'),
      ('${workspaceId}', 'surface-example-old', 'Example child', 'unexamined', 'unknown', '', '', '[]', 0, 0, 0, NULL, NULL, '2000-01-01T00:00:00.000Z'),
      ('workspace-example-other', 'surface-example-other', 'Other example child', 'unexamined', 'unknown', '', '', '[]', 0, 0, 0, NULL, NULL, '2000-01-01T00:00:00.000Z')`);
    const store = new ResearchTrackStore({ databasePath, workspaceId });
    try {
      const columns = database.prepare('PRAGMA table_info(app_server_research_tracks)').all().map((row) => row.name);
      assert.ok(columns.includes('collaboration_json'));
      const surfaceColumns = database.prepare('PRAGMA table_info(app_server_research_track_surfaces)').all().map((row) => row.name);
      assert.ok(surfaceColumns.includes('actionability_score'));
      assert.ok(surfaceColumns.includes('score_updated_at'));
      assert.ok(surfaceColumns.includes('validation_json'));
      const migrated = database.prepare(`SELECT surface_id, actionability_score, score_updated_at
        FROM app_server_research_track_surfaces ORDER BY surface_id`).all();
      assert.deepEqual(migrated.map((row) => [row.surface_id, row.actionability_score]),
        [['resource-example-old', 35], ['surface-example-old', 55], ['surface-example-other', 55]]);
      assert.ok(migrated.every((row) => row.score_updated_at > '2000-01-01T00:00:00.000Z'));
    } finally { store.close(); }
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

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

test('actionability promotes child proof work, decays without evidence, and returns to breadth', () => {
  const state = fixture();
  try {
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' },
      targetIds: ['local'], surfaces });
    const root = state.store.reserveNext('session-example-root', surfaces);
    assert.equal(root.surface.id, surfaces[0].id);
    const rootWorker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId,
      sessionId: 'session-example-root' });
    try { rootWorker.checkpoint({ surfaceId: root.surface.id, outcome: 'defer', impact: 'unknown',
      theory: 'A synthetic entry path remains untested.', nextAction: 'Test the child trust boundary.',
      evidenceRefs: [] }, root.surface); }
    finally { rootWorker.close(); }
    state.store.finishEpoch('session-example-root', true);
    const children = [
      { id: 'surface-example-a-one', parentId: surfaces[0].id, name: 'Example input path',
        coverageState: open, progressBlocker: null },
      { id: 'surface-example-a-two', parentId: surfaces[0].id, name: 'Example privilege path',
        coverageState: open, progressBlocker: null },
    ];
    const map = [...surfaces, ...children];
    const firstChild = state.store.reserveNext('session-example-child-one', map);
    assert.equal(firstChild.surface.id, children[0].id);
    state.database.prepare('UPDATE memory_nodes SET updated_at=? WHERE id=?')
      .run(new Date().toISOString(), 'memory-example-a');
    const firstWorker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId,
      sessionId: 'session-example-child-one' });
    try { firstWorker.checkpoint({ surfaceId: firstChild.surface.id, outcome: 'continue', impact: 'high',
      theory: 'The synthetic input reached a privileged boundary.', nextAction: 'Test its effect.',
      evidenceRefs: ['memory:memory-example-a'] }, firstChild.surface); }
    finally { firstWorker.close(); }
    state.store.finishEpoch('session-example-child-one', true);
    assert.ok(state.store.get().surfaces.find((work) => work.surfaceId === children[0].id).actionabilityScore >= 80);
    state.database.prepare('UPDATE memory_nodes SET updated_at=? WHERE id=?')
      .run('2000-01-01T00:00:00.000Z', 'memory-example-a');

    const secondLook = state.store.reserveNext('session-example-child-two', map);
    assert.equal(secondLook.surface.id, children[0].id);
    const secondWorker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId,
      sessionId: 'session-example-child-two' });
    try { secondWorker.checkpoint({ surfaceId: secondLook.surface.id, outcome: 'defer', impact: 'high',
      theory: 'The effect still needs a discriminating test.', nextAction: 'Test another route.',
      evidenceRefs: ['memory:memory-example-a'] }, secondLook.surface); }
    finally { secondWorker.close(); }
    state.store.finishEpoch('session-example-child-two', true);
    assert.ok(state.store.get().surfaces.find((work) => work.surfaceId === children[0].id).actionabilityScore < 80);

    const nextChild = state.store.reserveNext('session-example-child-three', map);
    assert.equal(nextChild.surface.id, children[1].id);
    assert.deepEqual(researchTrackProgress(state.store.get()), { investigated: 3, complete: 0, total: 4 });
    state.store.finishEpoch('session-example-child-three', true);
    assert.equal(state.store.reserveNext('session-example-next-root', map).surface.id, surfaces[1].id);

    state.database.prepare('UPDATE app_server_research_track_surfaces SET score_updated_at=? WHERE workspace_id=? AND surface_id=?')
      .run('2000-01-01T00:00:00.000Z', workspaceId, children[0].id);
    assert.equal(state.store.get().surfaces.find((work) => work.surfaceId === children[0].id).actionabilityScore, 0);
  } finally { state.close(); }
});

test('track scheduling favors a testable higher-impact surface over a stalled low-impact path', () => {
  const state = fixture();
  try {
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' },
      targetIds: ['local'], surfaces });
    const update = state.database.prepare(`UPDATE app_server_research_track_surfaces
      SET actionability_score=?, impact=?, validation_json=?, no_progress_epochs=?
      WHERE workspace_id=? AND surface_id=?`);
    update.run(82, 'low', JSON.stringify({ targetDependent: true, environment: 'none',
      reason: 'The example hardware is unavailable for the required test.' }), 1,
    workspaceId, surfaces[0].id);
    update.run(55, 'high', JSON.stringify({ targetDependent: false, environment: 'localhost',
      reason: 'The example parser can be checked from source.' }), 0,
    workspaceId, surfaces[1].id);
    assert.equal(state.store.reserveNext('session-example-prioritized', surfaces).surface.id, surfaces[1].id);
  } finally { state.close(); }
});

test('track scheduling rotates away from hardware-dependent work without target validation', () => {
  const state = fixture();
  try {
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' },
      targetIds: ['local'], surfaces });
    state.database.prepare(`UPDATE app_server_research_track_surfaces
      SET actionability_score=70, impact='high', validation_json=?
      WHERE workspace_id=? AND surface_id=?`).run(JSON.stringify({ targetDependent: true,
      environment: 'none', reason: 'The example device is unavailable for target validation.' }),
    workspaceId, surfaces[0].id);
    state.database.prepare(`UPDATE app_server_research_track_surfaces SET actionability_score=55
      WHERE workspace_id=? AND surface_id=?`).run(workspaceId, surfaces[1].id);
    assert.equal(state.store.reserveNext('session-example-hardware-rotation', surfaces).surface.id, surfaces[1].id);
  } finally { state.close(); }
});

test('track scheduling does not favor low-impact work solely because it yields easy evidence', () => {
  const state = fixture();
  try {
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' },
      targetIds: ['local'], surfaces });
    state.database.prepare(`UPDATE app_server_research_track_surfaces
      SET actionability_score=80, impact='low' WHERE workspace_id=? AND surface_id=?`)
      .run(workspaceId, surfaces[0].id);
    state.database.prepare(`UPDATE app_server_research_track_surfaces
      SET actionability_score=65, impact='medium' WHERE workspace_id=? AND surface_id=?`)
      .run(workspaceId, surfaces[1].id);
    assert.equal(state.store.reserveNext('session-example-impact-rotation', surfaces).surface.id, surfaces[1].id);
  } finally { state.close(); }
});

test('target-dependent localhost evidence records a gap and raises actionability less than device evidence', async () => {
  const state = fixture();
  try {
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' },
      targetIds: ['local'], surfaces: [surfaces[0]] });
    state.store.reserveNext('session-example-host-proof', [surfaces[0]]);
    state.database.prepare('UPDATE memory_nodes SET updated_at=? WHERE id=?')
      .run(new Date(Date.now() + 1000).toISOString(), 'memory-example-a');
    const hostWorker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId,
      sessionId: 'session-example-host-proof' });
    try {
      const tool = createResearchTrackTool(hostWorker, () => surfaces[0]);
      const base = { surfaceId: surfaces[0].id, outcome: 'defer', impact: 'medium',
        theory: 'Synthetic input may cross the example trust boundary.', nextAction: 'Test on an example device.',
        evidenceRefs: ['memory:memory-example-a'] };
      assert.equal((await tool.execute({ input: base })).status, 'error');
      assert.equal((await tool.execute({ input: { ...base,
        validation: { targetDependent: true, environment: 'localhost', reason: 'Unavailable.' } } })).status, 'error');
      assert.throws(() => hostWorker.checkpoint({ ...base, outcome: 'complete',
        validation: { targetDependent: true, environment: 'localhost',
          reason: 'The synthetic device was not connected during this epoch.' } },
      { ...surfaces[0], coverageState: covered }), /Target-dependent work cannot complete/);
      assert.equal((await tool.execute({ input: { ...base,
        validation: { targetDependent: true, environment: 'localhost',
          reason: 'The synthetic device was not connected during this epoch.' } } })).status, 'complete');
    } finally { hostWorker.close(); }
    const afterHost = state.store.get().surfaces[0];
    assert.equal(afterHost.actionabilityScore, 40);
    assert.equal(afterHost.validation.environment, 'localhost');
    state.store.finishEpoch('session-example-host-proof', true);
    state.store.reserveNext('session-example-device-proof', [surfaces[0]]);
    const deviceWorker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId,
      sessionId: 'session-example-device-proof' });
    try {
      deviceWorker.checkpoint({ surfaceId: surfaces[0].id, outcome: 'defer', impact: 'medium',
        theory: 'Synthetic device behavior was observed.', nextAction: 'Check another example path.',
        evidenceRefs: ['memory:memory-example-a'], validation: { targetDependent: true,
          environment: 'device', reason: 'Observed the behavior on the example device.' } }, surfaces[0]);
    } finally { deviceWorker.close(); }
    assert.equal(state.store.get().surfaces[0].actionabilityScore, 65);
    assert.equal(state.store.get().surfaces[0].validation.environment, 'device');
  } finally { state.close(); }
});

test('worker and launch failures pause a track with an actionable diagnostic', async () => {
  const state = fixture();
  const service = new AppServerHostService({ registry: {
    registryDirectory: join(dirname(state.databasePath), 'registry'),
    resolveWorkspace: (id) => id === workspaceId ? {
      workspaceId, researchProfileId: 'security-research', memoryBackend: 'app-server'
    } : null,
    storageForProfile: () => ({ databasePath: state.databasePath, artifactDirectoryPath: join(dirname(state.databasePath), 'artifacts') })
  }, invokeProtocol: async (operation) => operation === 'session.get' ? { status: 'failed' } : {} });
  try {
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' }, targetIds: ['local'], surfaces });
    state.store.reserveNext('session-example-failed-worker', surfaces);
    await service.recordSessionTerminalState({ request: { launch: { workspaceId, mode: 'research-track' } },
      sessionId: 'session-example-failed-worker', attemptId: 'attempt-example', state: 'failed',
      diagnostic: 'Synthetic worker tool registration failed.' });
    assert.equal(state.store.get().status, 'paused');
    assert.equal(state.store.get().lastError, 'Synthetic worker tool registration failed.');
    assert.equal(state.store.reserveNext('session-example-unwanted-retry', surfaces), null);

    state.store.control('resume');
    assert.equal(state.store.get().lastError, null);
    state.store.reserveNext('session-example-launch-failure', surfaces);
    service.recordResearchTrackEpochLaunchFailure(workspaceId, 'session-example-launch-failure',
      'Synthetic launch preparation failed.');
    assert.equal(state.store.get().status, 'paused');
    assert.equal(state.store.get().lastError, 'Synthetic launch preparation failed.');
    assert.equal(state.store.reserveNext('session-example-second-unwanted-retry', surfaces), null);
    assert.equal(state.store.control('stop').lastError, null);
    assert.equal(state.store.control('stop').status, 'stopped');
  } finally { state.close(); }
});

test('expected epoch rotation preserves checkpoints and identifies missing checkpoints', async () => {
  const state = fixture();
  const service = new AppServerHostService({ registry: {
    registryDirectory: join(dirname(state.databasePath), 'registry'),
    resolveWorkspace: (id) => id === workspaceId ? {
      workspaceId, researchProfileId: 'security-research', memoryBackend: 'app-server'
    } : null,
    storageForProfile: () => ({ databasePath: state.databasePath, artifactDirectoryPath: join(dirname(state.databasePath), 'artifacts') })
  }, invokeProtocol: async (operation) => operation === 'session.get' ? { status: 'stopped' } : {} });
  const request = { launch: { workspaceId, mode: 'research-track' } };
  try {
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' },
      targetIds: ['local'], surfaces: [surfaces[0]] });
    const first = state.store.reserveNext('session-example-rotation-one', [surfaces[0]]);
    const worker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId,
      sessionId: 'session-example-rotation-one' });
    try {
      worker.checkpoint({ surfaceId: first.surface.id, outcome: 'defer', impact: 'medium',
        theory: 'A synthetic trust boundary requires another proof.', nextAction: 'Check another entry path.',
        evidenceRefs: ['memory:memory-example-a'] }, first.surface);
    } finally { worker.close(); }
    await service.recordSessionTerminalState({ request, sessionId: 'session-example-rotation-one',
      attemptId: 'attempt-example-rotation-one', state: 'stopped', trackRotation: true });
    assert.equal(state.store.get().status, 'running');
    assert.equal(state.store.get().lastError, null);
    assert.equal(state.store.get().surfaces[0].noProgressEpochs, 1);

    state.store.reserveNext('session-example-rotation-two', [surfaces[0]]);
    await service.recordSessionTerminalState({ request, sessionId: 'session-example-rotation-two',
      attemptId: 'attempt-example-rotation-two', state: 'stopped', trackRotation: true });
    assert.equal(state.store.get().status, 'running');
    assert.match(state.store.get().lastError, /time limit without a track checkpoint/);
    assert.equal(state.store.get().surfaces[0].noProgressEpochs, 2);

    state.store.reserveNext('session-example-manual-stop', [surfaces[0]]);
    await service.recordSessionTerminalState({ request, sessionId: 'session-example-manual-stop',
      attemptId: 'attempt-example-manual-stop', state: 'stopped' });
    assert.equal(state.store.get().status, 'paused');
    assert.match(state.store.get().lastError, /no durable progress/);
  } finally { state.close(); }
});

test('checkpoint storage errors pause a track instead of consuming more epochs', async () => {
  const state = fixture();
  try {
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' },
      targetIds: ['local'], surfaces: [surfaces[0]] });
    state.store.reserveNext('session-example-storage-error', [surfaces[0]]);
    state.database.exec(`CREATE TABLE app_server_research_claims (
      id TEXT PRIMARY KEY, updated_at TEXT NOT NULL)`);
    state.database.prepare('INSERT INTO app_server_research_claims VALUES (?, ?)')
      .run('claim-example', new Date().toISOString());
    const worker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId,
      sessionId: 'session-example-storage-error' });
    try {
      const tool = createResearchTrackTool(worker, () => surfaces[0]);
      const result = await tool.execute({ input: { surfaceId: surfaces[0].id,
        outcome: 'defer', impact: 'medium', theory: 'A synthetic trust boundary needs another proof.',
        nextAction: 'Check another path.', evidenceRefs: ['finding:claim-example'],
        validation: { targetDependent: true, environment: 'localhost', reason: 'The example target was unavailable during this epoch.' } } });
      assert.equal(result.status, 'error');
      assert.match(result.error.message, /no such column: workspace_id/);
      assert.equal(state.store.get().status, 'paused');
      assert.match(state.store.get().lastError, /checkpoint storage failed: no such column: workspace_id/i);
    } finally { worker.close(); }
  } finally { state.close(); }
});

test('track start stores the selected model, targets, and collaboration on the owning app-server', async () => {
  const state = fixture();
  const service = new AppServerHostService({ registry: {
    registryDirectory: join(dirname(state.databasePath), 'registry'),
    resolveWorkspace: (id) => id === workspaceId ? {
      workspaceId, researchProfileId: 'security-research', memoryBackend: 'app-server'
    } : null,
    storageForProfile: () => ({ databasePath: state.databasePath, artifactDirectoryPath: join(dirname(state.databasePath), 'artifacts') }),
    providerSettings: () => ({ defaultProviderId: 'openai-codex', modelDefaults: {} })
  }, invokeProtocol: async () => ({}) });
  service.workspaceResearchTrackContext = async () => ({ scope: { id: 'scope-example' },
    targets: [{ id: 'local', ready: true }, { id: 'browser:example', ready: true }],
    surfaceMap: { surfaces } });
  try {
    const collaboration = { mode: 'adaptive', subagentMode: 'advanced', providers: [] };
    const track = await service.workspaceResearchTrack(workspaceId, 'start', {
      provider: { id: 'openai-codex', model: 'example-model', reasoningEffort: 'high' },
      targetIds: ['browser:example'], collaboration
    });
    assert.deepEqual(track.provider, { id: 'openai-codex', model: 'example-model', reasoningEffort: 'high' });
    assert.deepEqual(track.targetIds, ['local', 'browser:example']);
    assert.deepEqual(track.collaboration, collaboration);
  } finally { state.close(); }
});

test('track epochs share a session, wait for worker exit, and ignore an obsolete stop', async () => {
  const state = fixture();
  let stopTransition = null;
  let titleEvent = null;
  const titleEvents = [];
  let canonicalTitle = 'Continuous Track';
  const service = new AppServerHostService({ registry: {
    registryDirectory: join(dirname(state.databasePath), 'registry'),
    listWorkspaces: () => [{ workspaceId }],
    resolveWorkspace: (id) => id === workspaceId ? {
      workspaceId, researchProfileId: 'security-research', researchKitId: 'apple-security-bounty',
      memoryBackend: 'app-server'
    } : null,
    storageForProfile: () => ({ databasePath: state.databasePath, artifactDirectoryPath: join(dirname(state.databasePath), 'artifacts') })
  }, invokeProtocol: async (operation, options) => {
    if (operation === 'session.transition') stopTransition = options.input;
    if (operation === 'session.append_event') {
      titleEvent = options.input;
      titleEvents.push(titleEvent);
      canonicalTitle = titleEvent.payload.title;
    }
    return operation === 'session.get' ? { status: 'completed', title: canonicalTitle } : {};
  } });
  service.workspaceResearchTrackContext = async () => ({ scope: { id: 'scope-example' },
    targets: [{ id: 'local', ready: true }], surfaceMap: { surfaces } });
  try {
    const collaboration = { mode: 'adaptive', subagentMode: 'advanced', providers: [] };
    const started = state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex', model: 'example-model' },
      targetIds: ['local'], collaboration, surfaces });
    assert.deepEqual(state.store.get().collaboration, collaboration);
    const [first] = await service.dueResearchTracks();
    assert.equal(first.request.sessionId, started.id);
    assert.deepEqual(first.request.launch.collaboration, collaboration);
    assert.match(first.request.launch.promptMarkdown, /Selected execution targets: local/);
    assert.match(first.request.launch.promptMarkdown, /briefly compare the eligible roots in surface.list before deep work/);
    assert.match(first.request.launch.promptMarkdown, /listed resources are an inventory/);
    assert.match(first.request.launch.promptMarkdown, /authorized physical iPhone/);
    assert.match(first.request.launch.promptMarkdown, /localhost run alone does not validate target behavior/);
    assert.match(first.request.launch.promptMarkdown, /Official vendor APIs and SDKs may be covered/);
    assert.match(first.request.launch.promptMarkdown, /Third-party applications, customers, and accounts are not authorized/);
    assert.match(first.request.launch.promptMarkdown, /Checkpoint earlier when a root maps only low-impact paths/);
    await service.updateResearchTrackSessionTitle(workspaceId, started.id);
    assert.match(titleEvent.id, /^track_title_1_1_/u);
    assert.equal(titleEvent.payload.title, 'Researching Example service');
    await service.updateResearchTrackSessionTitle(workspaceId, started.id);
    assert.equal(titleEvents.length, 1);
    assert.equal(first.request.launch.continuation, undefined);
    assert.deepEqual(await service.dueResearchTracks(new Date(), new Set([started.id])), []);
    await service.recordSessionTerminalState({ request: first.request, sessionId: started.id,
      attemptId: 'attempt-example-first', state: 'completed' });
    const [second] = await service.dueResearchTracks();
    assert.equal(second.request.sessionId, started.id);
    assert.equal(second.request.launch.continuation.fallbackPrompt, second.request.launch.promptMarkdown);
    assert.equal(second.request.launch.continuation.resumeAttemptId, undefined);
    await service.updateResearchTrackSessionTitle(workspaceId, started.id);
    assert.match(titleEvent.id, /^track_title_1_2_/u);
    assert.equal(titleEvent.payload.title, 'Researching Example library');
    assert.equal(titleEvents.length, 2);
    await service.recordSessionTerminalState({ request: first.request, sessionId: 'session-example-obsolete',
      attemptId: 'attempt-example-obsolete', state: 'stopped' });
    assert.equal(state.store.get().status, 'running');
    assert.equal(state.store.get().activeSessionId, started.id);
    await service.recordSessionControlState({ request: first.request, sessionId: started.id,
      attemptId: 'attempt-example-first', state: 'stopped', stopCause: 'track_state' });
    assert.equal(stopTransition.metadata.appServerStopCause, 'track_state');
    assert.equal(stopTransition.metadata.manualControlState, undefined);
  } finally { state.close(); }
});

test('an orphaned track epoch pauses instead of showing indefinite research progress', async () => {
  const state = fixture();
  const service = new AppServerHostService({ registry: {
    registryDirectory: join(dirname(state.databasePath), 'registry'),
    listWorkspaces: () => [{ workspaceId }],
    resolveWorkspace: (id) => id === workspaceId ? {
      workspaceId, researchProfileId: 'security-research', memoryBackend: 'app-server'
    } : null,
    storageForProfile: () => ({ databasePath: state.databasePath, artifactDirectoryPath: join(dirname(state.databasePath), 'artifacts') })
  }, invokeProtocol: async (operation) => operation === 'session.get' ? { status: 'active' } : {} });
  service.workspaceResearchTrackContext = async () => ({ scope: { id: 'scope-example' },
    targets: [{ id: 'local', ready: true }], surfaceMap: { surfaces } });
  try {
    state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' }, targetIds: ['local'], surfaces });
    state.store.reserveNext('session-example-orphaned', surfaces);
    state.database.prepare('UPDATE app_server_research_tracks SET updated_at=? WHERE workspace_id=?')
      .run('2000-01-01T00:00:00.000Z', workspaceId);
    assert.deepEqual(await service.dueResearchTracks(new Date(), new Set()), []);
    assert.equal(state.store.get().status, 'paused');
    assert.equal(state.store.get().activeSessionId, null);
    assert.match(state.store.get().lastError, /without a terminal session record/);
  } finally { state.close(); }
});

test('startup recovery advances a checkpointed track epoch without replaying it', async () => {
  const state = fixture();
  let terminalTransition = null;
  let started = null;
  const service = new AppServerHostService({ registry: {
    registryDirectory: join(dirname(state.databasePath), 'registry'),
    listWorkspaces: () => [{ workspaceId }],
    resolveWorkspace: (id) => id === workspaceId ? {
      workspaceId, researchProfileId: 'security-research', memoryBackend: 'app-server'
    } : null,
    storageForProfile: () => ({ databasePath: state.databasePath, artifactDirectoryPath: join(dirname(state.databasePath), 'artifacts') })
  }, invokeProtocol: async (operation, options) => {
    if (operation === 'session.recover_interrupted') return { sessionIds: [started.id], interruptedSessions: 1 };
    if (operation === 'session.get') return { workspaceId, status: 'paused',
      metadata: { appServerRestartLaunch: { schemaVersion: 1, eligible: true,
        launch: { workspaceId, mode: 'research-track', promptMarkdown: 'Synthetic surface investigation.',
          machineId: 'local', targetIds: ['local'], provider: { id: 'openai-codex', model: 'example-model' } } } },
      attempts: [{ id: 'attempt-example-interrupted', parentAttemptId: null,
        status: 'paused', metadata: { interruptedByRecovery: true } }] };
    if (operation === 'session.transition') { terminalTransition = options.input; return {}; }
    throw new Error(`Unexpected operation: ${operation}`);
  } });
  service.workspaceResearchTrackContext = async () => ({ scope: { id: 'scope-example' },
    targets: [{ id: 'local', ready: true }], surfaceMap: { surfaces } });
  try {
    started = state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' },
      targetIds: ['local'], surfaces });
    const first = state.store.reserveNext(started.id, surfaces);
    const worker = new ResearchTrackStore({ databasePath: state.databasePath, workspaceId, sessionId: started.id });
    try { worker.checkpoint({ surfaceId: first.surface.id, outcome: 'defer', impact: 'medium',
      theory: 'A synthetic trust boundary needs another proof.', nextAction: 'Inspect a different entry path.',
      evidenceRefs: [] }, first.surface); }
    finally { worker.close(); }
    const recovery = await service.recoverInterruptedSessions();
    assert.equal(recovery.recovered.length, 0);
    assert.equal(recovery.skippedSessions, 1);
    assert.equal(terminalTransition.status, 'completed');
    assert.equal(state.store.get().activeSessionId, null);
    assert.equal((await service.dueResearchTracks())[0].request.sessionId, started.id);
    assert.equal(state.store.get().activeSurfaceId, surfaces[1].id);
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

test('stopping an active track permits an immediate new pass with a distinct session', () => {
  const state = fixture();
  try {
    const first = state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' },
      targetIds: ['local'], surfaces });
    state.store.reserveNext(first.id, surfaces);
    const stopped = state.store.control('stop');
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.activeSessionId, null);
    assert.equal(stopped.activeSurfaceId, null);
    assert.equal(stopped.surfaces.find((surface) => surface.surfaceId === surfaces[0].id).status, 'deferred');
    state.database.prepare('UPDATE app_server_research_tracks SET active_session_id=? WHERE workspace_id=?')
      .run(first.id, workspaceId);
    const second = state.store.start({ scopeId: 'scope-example', provider: { id: 'openai-codex' },
      targetIds: ['local'], surfaces });
    assert.equal(second.pass, 2);
    assert.notEqual(second.id, first.id);
    assert.equal(second.createdAt, second.updatedAt);
    assert.equal(state.store.finishEpoch(first.id, true).id, second.id);
    assert.equal(state.store.get().status, 'running');
    const history = state.database.prepare('SELECT snapshot_json FROM app_server_research_track_history WHERE workspace_id=?')
      .get(workspaceId);
    assert.equal(JSON.parse(history.snapshot_json).status, 'stopped');
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
