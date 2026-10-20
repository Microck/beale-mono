import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  generateStoredResearchGoalSuggestions,
  selectStoredResearchGoalSuggestion
} from '../packages/research-agent/dist/index.js';

test('app-server goal suggestions generate, persist, cache, and record selection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'app-server-goal-suggestions-'));
  const workspaceRoot = join(root, 'workspace');
  const artifactDirectoryPath = join(root, 'artifacts');
  const databasePath = join(root, 'memory.sqlite');
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(artifactDirectoryPath, { recursive: true });
  initializeSuggestionFixture(databasePath, workspaceRoot);
  const completions = [];
  const goals = [
    'Investigate attacker-controlled request boundaries across the Example service for reusable cross-tenant authorization failures.',
    'Bind Example service authorization subjects across reconnect transitions to assess unauthorized reuse of a newer session capability.',
    'Compare Example service cache identities around URL canonicalization for cross-tenant privileged response exposure.',
    'Trace Example service upload staging and privileged commit for attacker-controlled object replacement.',
    'Examine Example service webhook signature and dispatch interpretation for unauthorized command effects.'
  ];
  try {
    const input = {
      workspaceId: 'workspace-test',
      workspaceRoot,
      databasePath,
      artifactDirectoryPath,
      researchProfileId: 'security-research',
      memoryEnabled: false,
      phase: 'discovery',
      provider: {
        id: 'openai-codex',
        smallModel: 'gpt-test',
        reasoningEffort: 'low',
        authenticationPreferences: { 'openai-codex': 'subscription' },
        codexAuthFile: join(root, 'codex-auth.json')
      }
    };
    const dependencies = {
      completeText: async (options) => {
        completions.push(options);
        return { text: completions.length === 1 ? JSON.stringify({ goal: goals[0] }) : goals[completions.length - 1] };
      }
    };

    let generated;
    for (let index = 0; index < 4; index += 1) {
      generated = await generateStoredResearchGoalSuggestions({ ...input, incremental: true }, dependencies);
      assert.equal(generated.suggestions.length, index + 1);
    }
    assert.equal(generated.phase, 'discovery');
    assert.equal(generated.suggestions.length, 4);
    assert.equal(completions.length, 4);
    assert.equal(completions[0].provider, 'openai-codex');
    assert.equal(completions[0].model, 'gpt-test');
    assert.equal(completions[0].codexAuthFile, join(root, 'codex-auth.json'));
    assert.match(completions[0].systemPrompt, /attacker-controlled entry points, trust boundaries, security-relevant sinks/);
    assert.match(completions[0].systemPrompt, /A broadly reusable security direction is welcome/);
    assert.ok(generated.suggestions.every((suggestion) => !/Auto-Review/i.test(suggestion)));
    const prompt = JSON.parse(completions[0].prompt);
    assert.equal(prompt.workspace.name, 'Test Workspace');
    assert.ok(prompt.workspace.resources.some((item) => item.id === 'asset-test'));
    assert.ok(prompt.workspace.excludedResources.some((item) => item.includes('excluded.example.test')));
    assert.equal(prompt.surfaces[0].name, 'Request parser');
    assert.deepEqual(prompt.alreadyShown, []);
    assert.equal(prompt.previousResearch.length, 0);
    assert.equal(completions[0].maxTokens, 600);
    assert.equal(completions[1].prompt.includes(goals[0]), true);
    assert.equal('candidateCount' in prompt, false);
    assert.equal('priorSuggestions' in prompt, false);
    assert.equal('agentInstructions' in prompt.workspace, false);

    const legacyCache = new DatabaseSync(databasePath);
    legacyCache.prepare('UPDATE research_goal_suggestion_cache SET suggestions_json = ?')
      .run(JSON.stringify(generated.suggestions.map((suggestion) => `After Auto-Review, ${suggestion}`)));
    legacyCache.close();
    const cached = await generateStoredResearchGoalSuggestions(input, dependencies);
    assert.deepEqual(cached, generated);
    assert.equal(completions.length, 4);

    const database = new DatabaseSync(databasePath);
    const cache = database.prepare('SELECT profile_hash, scope_version_id FROM research_goal_suggestion_cache').get();
    const storedRevision = database.prepare('SELECT context_revision FROM research_goal_suggestion_cache').get();
    database.close();
    assert.match(storedRevision.context_revision, /^goal-suggestions-v3::/);
    selectStoredResearchGoalSuggestion({
      workspaceId: 'workspace-test',
      databasePath,
      scopeId: cache.scope_version_id,
      profileHash: cache.profile_hash,
      phase: 'discovery',
      suggestion: generated.suggestions[0]
    });

    const selectedDatabase = new DatabaseSync(databasePath, { readOnly: true });
    const selected = selectedDatabase.prepare(`SELECT selection_count FROM research_goal_suggestion_history
      WHERE workspace_id = ? AND scope_version_id = ? AND profile_hash = ? AND phase = ? AND suggestion_text = ?`)
      .get('workspace-test', cache.scope_version_id, cache.profile_hash, 'discovery', generated.suggestions[0]);
    const remaining = JSON.parse(selectedDatabase.prepare('SELECT suggestions_json FROM research_goal_suggestion_cache').get().suggestions_json);
    selectedDatabase.close();
    assert.equal(selected.selection_count, 1);
    assert.equal(remaining.length, 3);
    assert.ok(!remaining.includes(generated.suggestions[0]));

    const toppedUp = await generateStoredResearchGoalSuggestions({ ...input, incremental: true }, dependencies);
    assert.equal(toppedUp.suggestions.length, 4);
    assert.equal(completions.length, 5);
    assert.equal(toppedUp.suggestions.includes(goals[4]), true);

    let refreshPrompt;
    await assert.rejects(
      generateStoredResearchGoalSuggestions(
        { ...input, refresh: true },
        {
          completeText: async (options) => {
            refreshPrompt = JSON.parse(options.prompt);
            throw new Error('stop after prompt inspection');
          }
        }
      ),
      /stop after prompt inspection/
    );
    assert.deepEqual(refreshPrompt.alreadyShown, []);
    const changedSurface = new DatabaseSync(databasePath);
    changedSurface.prepare('UPDATE app_server_surfaces SET updated_at = ? WHERE id = ?')
      .run('2026-08-26T16:20:00.000Z', 'surface-parser');
    changedSurface.close();
    const staleAfterMapping = await generateStoredResearchGoalSuggestions({ ...input, incremental: true }, dependencies);
    assert.equal(staleAfterMapping.cacheStatus, 'stale');
    assert.equal(completions.length, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('single-goal generation retries malformed output and keeps earlier goals if a later slot fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'app-server-goal-suggestions-retry-'));
  const workspaceRoot = join(root, 'workspace');
  const artifactDirectoryPath = join(root, 'artifacts');
  const databasePath = join(root, 'memory.sqlite');
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(artifactDirectoryPath, { recursive: true });
  initializeSuggestionFixture(databasePath, workspaceRoot);
  const input = { workspaceId: 'workspace-test', workspaceRoot, databasePath, artifactDirectoryPath,
    researchProfileId: 'security-research', memoryEnabled: false, phase: 'discovery', incremental: true,
    provider: { id: 'openai-codex', smallModel: 'gpt-test' } };
  let calls = 0;
  try {
    const first = await generateStoredResearchGoalSuggestions(input, { completeText: async () => {
      calls += 1;
      return { text: calls === 1 ? '{"goal":' : 'Investigate Example service trust boundaries for reusable cross-tenant authorization failures.' };
    } });
    assert.equal(calls, 2);
    assert.equal(first.suggestions.length, 1);
    await assert.rejects(generateStoredResearchGoalSuggestions(input, { completeText: async () => ({ text: '{"goal":' }) }),
      /after three attempts/);
    const resumed = await generateStoredResearchGoalSuggestions(input, { completeText: async () => ({
      text: 'Map Example service webhook signatures against dispatch inputs for unauthorized command effects.'
    }) });
    assert.deepEqual(resumed.suggestions.slice(0, 1), first.suggestions);
    assert.equal(resumed.suggestions.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function initializeSuggestionFixture(databasePath, workspaceRoot) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE scope_versions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES workspaces(id),
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      workspace_name TEXT NOT NULL,
      scope_owner TEXT NOT NULL,
      description_markdown TEXT NOT NULL,
      rules_markdown TEXT NOT NULL,
      active_from TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE TABLE scope_assets (
      id TEXT PRIMARY KEY,
      scope_version_id TEXT NOT NULL REFERENCES scope_versions(id),
      direction TEXT NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      attributes_json TEXT NOT NULL,
      sensitivity TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE workspace_rules (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE TABLE workspace_research_subjects (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
      subject_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE research_goal_suggestion_cache (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      scope_version_id TEXT NOT NULL REFERENCES scope_versions(id),
      profile_hash TEXT NOT NULL,
      phase TEXT NOT NULL,
      context_revision TEXT NOT NULL,
      suggestions_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, scope_version_id, profile_hash, phase)
    );
    CREATE TABLE research_goal_suggestion_history (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      scope_version_id TEXT NOT NULL REFERENCES scope_versions(id),
      profile_hash TEXT NOT NULL,
      phase TEXT NOT NULL,
      suggestion_key TEXT NOT NULL,
      suggestion_text TEXT NOT NULL,
      first_generated_at TEXT NOT NULL,
      last_generated_at TEXT NOT NULL,
      selected_at TEXT,
      generation_count INTEGER NOT NULL DEFAULT 1,
      selection_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, scope_version_id, profile_hash, phase, suggestion_key)
    );
    CREATE TABLE app_server_surfaces (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      foundation_json TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  const now = '2026-08-25T16:20:00.000Z';
  database.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?)')
    .run('workspace-test', workspaceRoot, now, now);
  database.prepare('INSERT INTO scope_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('scope-test', 'workspace-test', 1, 'active', 'Test Workspace', 'Test Owner', 'Test scope', '', now, null, now, 'test');
  database.prepare('INSERT INTO scope_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('scope-old', 'workspace-test', 0, 'retired', 'Test Workspace', 'Test Owner', 'Old scope', '', now, null, now, 'test');
  database.prepare('INSERT INTO scope_assets VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('asset-test', 'scope-test', 'in_scope', 'service', 'https://example.test', '{}', 'public', now);
  database.prepare('INSERT INTO scope_assets VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('asset-excluded', 'scope-test', 'out_of_scope', 'service', 'https://excluded.example.test', '{}', 'public', now);
  database.prepare('INSERT INTO workspace_rules VALUES (?, ?, ?, ?, ?)')
    .run('rule-test', 'workspace-test', 'Stay within the recorded scope.', now, 'test');
  database.prepare('INSERT INTO workspace_research_subjects VALUES (?, ?, ?, ?, ?, ?)')
    .run('workspace-test', 'subject-test', 'Test Subject', 'explicit', now, now);
  database.prepare('INSERT INTO app_server_surfaces VALUES (?, ?, ?, ?, ?, ?)')
    .run('surface-parser', 'workspace-test', 'Request parser', 'Lower-trust request boundary.',
      JSON.stringify({ threatModel: { attackerControl: 'Request bytes.', trustBoundaries: 'Parser to dispatcher.',
        plausibleImpacts: 'Unauthorized state change.' }, coverage: { openQuestions: ['Can the fallback parser reach dispatch?'] } }), now);
  database.prepare(`INSERT INTO research_goal_suggestion_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'workspace-test',
      'scope-old',
      'old-profile-hash',
      'discovery',
      'legacy-key',
      'Map the legacy worker queue lease transition before ownership transfer.',
      now,
      now,
      null,
      1,
      0
    );
  database.close();
}
