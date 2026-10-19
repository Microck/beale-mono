import assert from 'node:assert/strict';
import test from 'node:test';

import { assertManagedToolOwnership, createHarnessFeedbackTool, createResearchSystemPrompt, createResearchToolRegistry } from '../packages/research-agent/dist/index.js';
import { decodeAppServerSessionLaunchRequest, APP_SERVER_SESSION_LAUNCH_VERSION } from '../packages/app-server-runtime/dist/protocol.js';

test('development harness feedback accepts concrete entries and rejects malformed entries', async () => {
  const tool = createHarnessFeedbackTool();
  const action = {
    id: 'feedback-example', actionClass: 'respond', toolName: 'harness.feedback',
    input: { kind: 'limitation', observation: 'The example item could not be renamed.', workaround: 'Created a replacement item.' }
  };
  assert.equal(tool.descriptor.transportName, 'harness_feedback');
  assert.equal(tool.descriptor.sideEffects, 'none');
  assert.doesNotThrow(() => assertManagedToolOwnership([tool]));
  const result = await tool.execute(action);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.output, action.input);
  const recorded = await createResearchToolRegistry([tool]).executeToolCall({
    id: 'feedback-call-example', name: 'harness_feedback', arguments: action.input
  });
  assert.equal(recorded.result.status, 'complete');
  assert.equal(recorded.events[1].kind, 'tool.observed');
  assert.deepEqual(recorded.events[1].payload.result, action.input);
  assert.equal((await tool.execute({ ...action, input: { kind: 'flaw', observation: ' ' } })).status, 'error');
  assert.match(createResearchSystemPrompt({ hasTools: true, hasHarnessFeedbackTool: true }), /call harness\.feedback/);
  assert.doesNotMatch(createResearchSystemPrompt({ hasTools: true }), /call harness\.feedback/);
});

test('session launch accepts the development flag only as a boolean', () => {
  const request = {
    launchVersion: APP_SERVER_SESSION_LAUNCH_VERSION,
    launch: { workspaceId: 'workspace-example', promptMarkdown: 'Inspect the example repository.', devHarnessFeedback: true }
  };
  assert.equal(decodeAppServerSessionLaunchRequest(request).launch.devHarnessFeedback, true);
  assert.throws(() => decodeAppServerSessionLaunchRequest({
    ...request, launch: { ...request.launch, devHarnessFeedback: 'true' }
  }), /devHarnessFeedback must be a boolean/);
});
