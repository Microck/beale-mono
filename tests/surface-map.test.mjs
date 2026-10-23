import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AppServerSessionStore, ResearchResourceCatalog, ResearchTrackStore, SurfaceStore } from '../packages/research-agent/dist/index.js';
import { AppServerHostService } from '../app-server/dist/hostService.js';
import { readWorkspaceSurfaceMap } from '../app-server/dist/surfaceMap.js';
import { decodeBealeWorkspaceSurfaceMap } from '../packages/app-server-runtime/dist/protocol.js';

test('surface map projects eligible hierarchy, touch state, coverage, and active agent focus', () => {
  const directory = mkdtempSync(join(tmpdir(), 'beale-surface-map-example-'));
  const databasePath = join(directory, 'memory.sqlite');
  const workspaceId = 'workspace-example';
  const sessions = new AppServerSessionStore({ databasePath });
  const resources = new ResearchResourceCatalog({ databasePath, workspaceId, explicitResources: [
    { id: 'asset-example', direction: 'in_scope', kind: 'service', locator: 'service.example.test', name: 'Example service', source: 'explicit_scope' },
    { id: 'asset-excluded', direction: 'out_of_scope', kind: 'service', locator: 'excluded.example.test', name: 'Excluded service', source: 'explicit_scope' }
  ] });
  const surfaces = new SurfaceStore({ databasePath, workspaceId, sessionId: 'session-example-one', resources });
  try {
    const first = sessions.create({ id: 'session-example-one', workspaceId, attemptId: 'attempt-example-one',
      title: 'Map service', prompt: 'Map authorized service boundaries.', provider: 'openai-codex', model: 'gpt-example',
      reasoningEffort: 'high' });
    const root = resources.list().find((resource) => resource.direction === 'in_scope');
    const child = surfaces.create(root.id, 'Request parser', 'Untrusted request boundary.');
    assert.equal(readWorkspaceSurfaceMap(databasePath, workspaceId).surfaces.find((surface) => surface.id === child.id).firstTouchedAt, null);
    surfaces.focus('root', child.id);
    surfaces.focus('/root/scout', root.id);
    const foundation = {
      bugHistory: { summary: 'No known issue in searched sources.', limits: 'Search limited to public sources.' },
      coverage: { summary: 'Mapped input to sink.', gaps: 'No remaining gaps.', opportunities: 'Review future parser modes.', mappingComplete: true,
        sinksInvestigated: true, openQuestions: [], unexploredConnections: [] },
      threatModel: { attackerControl: 'Request bytes.', trustBoundaries: 'Network to parser.',
        assetsAtRisk: 'Example state.', plausibleImpacts: 'Unauthorized change.', assumptions: 'Service enabled.' }
    };
    surfaces.update(child.id, child.revision, foundation);
    surfaces.update(root.id, 1, foundation);
    const map = readWorkspaceSurfaceMap(databasePath, workspaceId);
    assert.equal(map.surfaces.length, 2);
    assert.equal(map.surfaces.find((surface) => surface.id === child.id).parentId, root.id);
    assert.ok(map.surfaces.every((surface) => surface.firstTouchedAt));
    assert.equal(map.surfaces.every((surface) => surface.coverageState.covered), true);
    assert.equal(map.surfaces.every((surface) => surface.progressBlocker === null), true);
    const reason = 'Public routes were tested without a session; an authorized account is required for authenticated requests. Provide a test account to resume.';
    surfaces.update(child.id, surfaces.get(child.id).revision, { ...foundation,
      coverage: { ...foundation.coverage, gaps: 'Authenticated request paths remain untested.' } },
    undefined, undefined, { reason }, '/root/scout');
    const blocked = decodeBealeWorkspaceSurfaceMap(readWorkspaceSurfaceMap(databasePath, workspaceId));
    assert.equal(blocked.surfaces.find((surface) => surface.id === child.id).progressBlocker.reason, reason);
    assert.deepEqual(blocked.surfaces.find((surface) => surface.id === child.id).coverageState.unmetRequirements, ['blocked']);
    assert.deepEqual(blocked.surfaces.find((surface) => surface.id === root.id).coverageState.unmetRequirements, ['child_surfaces']);
    assert.throws(() => decodeBealeWorkspaceSurfaceMap({ ...blocked, surfaces: blocked.surfaces.map((surface) =>
      surface.id === child.id ? { ...surface, progressBlocker: { reason } } : surface) }), /invalid workspace surface map/);
    assert.deepEqual(new Set(map.agents.map((agent) => agent.agentId)), new Set(['root', '/root/scout']));
    assert.equal(map.agents[0].sessionTitle, 'Map service');
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE 'app_server_session_activity_%'").get().count, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM app_server_session_activity_events').get().count, 0);
    } finally { database.close(); }
    sessions.transition(first.id, { status: 'completed', summary: 'Complete.', expectedRevision: first.revision });
    assert.deepEqual(readWorkspaceSurfaceMap(databasePath, workspaceId).agents, []);
    assert.deepEqual(readWorkspaceSurfaceMap(databasePath, 'workspace-other').surfaces, []);
  } finally {
    surfaces.close(); resources.close(); sessions.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('new workspace scope resources seed root surfaces before the first research session', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'beale-surface-scope-example-'));
  const databasePath = join(directory, 'memory.sqlite');
  const workspaceId = 'workspace-scope-example';
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, workspace_path TEXT NOT NULL);
      CREATE TABLE scope_versions (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, version INTEGER NOT NULL,
        status TEXT NOT NULL, workspace_name TEXT NOT NULL, scope_owner TEXT NOT NULL,
        description_markdown TEXT NOT NULL, active_from TEXT NOT NULL, expires_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE scope_assets (
        id TEXT PRIMARY KEY, scope_version_id TEXT NOT NULL, direction TEXT NOT NULL,
        kind TEXT NOT NULL, value TEXT NOT NULL, sensitivity TEXT NOT NULL,
        attributes_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
    database.prepare('INSERT INTO workspaces VALUES (?, ?)').run(workspaceId, directory);
    const insertScope = database.prepare('INSERT INTO scope_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertAsset = database.prepare('INSERT INTO scope_assets VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insertScope.run('scope-example-first', workspaceId, 1, 'active', 'Example workspace', 'ExampleCo',
      'Authorized example resources.', '2026-01-01T00:00:00Z', null, '2026-01-01T00:00:00Z');
    insertAsset.run('asset-example-service', 'scope-example-first', 'in_scope', 'service',
      'api.example.test', 'public', '{}', '2026-01-01T00:00:01Z');
    insertAsset.run('asset-example-excluded', 'scope-example-first', 'out_of_scope', 'domain',
      'excluded.example.test', 'public', '{}', '2026-01-01T00:00:02Z');
    insertAsset.run('asset-example-credential', 'scope-example-first', 'in_scope', 'other',
      'secret://example-credential', 'secret', '{"legacyKind":"credential_ref"}', '2026-01-01T00:00:03Z');
    const workspace = { workspaceId, workspacePath: directory, researchProfileId: 'security-research', memoryBackend: 'app-server' };
    const service = new AppServerHostService({ registry: {
      registryDirectory: join(directory, 'registry'),
      resolveWorkspace: (identifier) => identifier === workspaceId ? workspace : null,
      storageForProfile: () => ({ databasePath, artifactDirectoryPath: join(directory, 'artifacts') })
    } });

    assert.equal(readWorkspaceSurfaceMap(databasePath, workspaceId).surfaces.length, 0);
    const first = await service.workspaceSurfaceMap(workspaceId);
    assert.equal(first.surfaces.length, 1);
    assert.equal(first.surfaces[0].name, 'api.example.test');
    assert.equal(first.surfaces[0].parentId, null);
    const firstId = first.surfaces[0].id;
    assert.equal(database.prepare('SELECT scope_asset_id FROM app_server_research_resources WHERE id=?').get(firstId).scope_asset_id,
      'asset-example-service');
    const before = database.prepare('SELECT updated_at FROM app_server_research_resources WHERE id=?').get(firstId).updated_at;
    assert.equal((await service.workspaceSurfaceMap(workspaceId)).surfaces[0].id, firstId);
    assert.equal(database.prepare('SELECT updated_at FROM app_server_research_resources WHERE id=?').get(firstId).updated_at, before);
    const track = new ResearchTrackStore({ databasePath, workspaceId });
    try {
      assert.equal(track.start({ scopeId: 'scope-example-first', provider: { id: 'openai-codex' },
        targetIds: ['local'], surfaces: first.surfaces }).surfaces.length, 1);
    } finally { track.close(); }

    database.prepare("UPDATE scope_versions SET status='inactive' WHERE id='scope-example-first'").run();
    insertScope.run('scope-example-second', workspaceId, 2, 'active', 'Example workspace', 'ExampleCo',
      'Updated authorized example resources.', '2026-02-01T00:00:00Z', null, '2026-02-01T00:00:00Z');
    insertAsset.run('asset-example-repository', 'scope-example-second', 'in_scope', 'repo',
      'https://github.com/example-org/example-repository', 'public', '{}', '2026-02-01T00:00:01Z');
    const second = await service.workspaceSurfaceMap(workspaceId);
    assert.equal(second.surfaces.length, 1);
    assert.equal(second.surfaces[0].name, 'https://github.com/example-org/example-repository');
    assert.notEqual(second.surfaces[0].id, firstId);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
