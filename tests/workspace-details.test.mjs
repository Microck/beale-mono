import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeBealeAppServerWorkspaceDetails } from '../packages/app-server-runtime/dist/protocol.js';
import { projectWorkspaceDetails } from '../app-server/dist/workspaceDetails.js';

test('workspace details expose typed context without host storage paths', () => {
  const workspace = { id: 'registry-example', workspaceId: 'workspace-example', name: 'ExampleCo Research', researchProfileId: 'security-research', researchKitId: 'general', runCount: 1, lastRunAt: null, updatedAt: '2026-01-01T00:00:00.000Z' };
  const memory = { schemaVersion: 4, workspaceId: 'workspace-example', status: 'empty', nodeCount: 0, nodeTypeCounts: {}, nodes: [], leads: [], findings: [] };
  const details = projectWorkspaceDetails(workspace, {
    activeScope: {
      id: 'scope-example', workspaceName: 'ExampleCo Research', scopeOwner: 'ExampleCo', descriptionMarkdown: 'Research example.test.', expiresAt: null,
      assets: [
        { id: 'resource-domain', kind: 'domain', direction: 'in_scope', value: 'example.test', sensitivity: 'public' },
        { id: 'resource-local', kind: 'repo', direction: 'in_scope', value: '/example/repository', sensitivity: 'internal' },
        { id: 'resource-credential', kind: 'other', direction: 'in_scope', value: 'secret://example-credential', sensitivity: 'secret', attributes: { legacyKind: 'credential_ref' } }
      ]
    },
    researchSubject: { name: 'ExampleCo' },
    workspaceRules: [{ id: 'rule-example', text: 'Stay within example.test.' }]
  }, memory, {
    runbooks: [{ id: 'runbook-example', title: 'Example runbook', purpose: 'Verify example.test.', updatedAt: '2026-01-01T00:00:00.000Z', artifactId: '/example/private-artifact' }],
    reports: [{ id: 'report-example', title: 'Example report', summary: 'Synthetic report.', status: 'complete', updatedAt: '2026-01-01T00:00:00.000Z', artifactId: '/example/private-report' }]
  }, [{ id: 'local', name: 'Local', ready: true }],
  { schemaVersion: 1, workspaceId: 'workspace-example', surfaces: [], agents: [] });
  assert.equal(decodeBealeAppServerWorkspaceDetails(details), details);
  assert.equal(details.scope.resources[0].value, 'example.test');
  assert.equal(details.scope.resources[1].value, null);
  assert.equal(details.scope.resources[2].value, null);
  assert.equal(details.rules[0].text, 'Stay within example.test.');
  assert.equal(details.runbooks[0].title, 'Example runbook');
  assert.equal(details.reports[0].status, 'complete');
  assert.equal(JSON.stringify(details).includes('/example/private-artifact'), false);
  assert.equal(JSON.stringify(details).includes('/example/private-report'), false);
  assert.equal(JSON.stringify(details).includes('/example/repository'), false);
  assert.equal(JSON.stringify(details).includes('secret://example-credential'), false);
  assert.throws(() => decodeBealeAppServerWorkspaceDetails({ schemaVersion: 1, workspace }), /invalid workspace details/);
});
