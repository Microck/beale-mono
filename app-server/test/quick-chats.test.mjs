import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  decodeBealeAppServerQuickChatList,
  decodeBealeAppServerQuickChatStartInput,
  decodeBealeAppServerQuickChatStartResult
} from '../../packages/app-server-runtime/dist/protocol.js';
import { AppServerHostRegistry } from '../dist/hostRegistry.js';
import { AppServerHostService } from '../dist/hostService.js';

test('Quick Chats use one hidden app-server workspace and path-free summaries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beale-quick-chat-example-'));
  try {
    const registry = new AppServerHostRegistry({ registryDirectory: root });
    const workspace = registry.ensureQuickChatWorkspace();
    assert.equal(registry.ensureQuickChatWorkspace().workspaceId, workspace.workspaceId);
    assert.deepEqual(registry.listWorkspaces(), []);
    const stateActions = [];
    const host = new AppServerHostService({ registry, invokeProtocol: async (operation, options) => {
      if (operation === 'session.list_summaries') return [{ id: 'session-example', title: 'Example chat', prompt: 'Explain example.test', status: 'completed', updatedAt: '2026-01-01T00:00:00.000Z', workspaceId: workspace.workspaceId, capturePath: join(root, 'private.capture.json') }];
      if (operation === 'workspace.state') {
        stateActions.push(options.input.action);
        return options.input.action === 'initialize' ? { activeScope: { workspaceName: 'Untitled' } } : null;
      }
      throw new Error(`Unexpected operation ${operation}`);
    } });
    const list = await host.quickChats();
    assert.equal(decodeBealeAppServerQuickChatList(list), list);
    assert.equal(list.chats[0].workspaceId, workspace.workspaceId);
    assert.equal(JSON.stringify(list).includes(root), false);
    const request = await host.quickChatLaunchRequest(decodeBealeAppServerQuickChatStartInput({ promptMarkdown: ' Explain example.test ' }));
    assert.equal(request.launch.workspaceId, workspace.workspaceId);
    assert.equal(request.launch.mode, 'quick-chat');
    assert.equal(request.launch.promptMarkdown, 'Explain example.test');
    assert.equal(request.launch.machineId, 'local');
    assert.deepEqual(stateActions, ['initialize', 'saveScope']);
    const realHost = new AppServerHostService({ registry });
    const freshRequest = await realHost.quickChatLaunchRequest({ promptMarkdown: 'Explain example.test' });
    assert.equal((await realHost.workspaceDetails(freshRequest.launch.workspaceId)).scope.name, 'Quick Chats');
    assert.deepEqual(decodeBealeAppServerQuickChatStartResult({ schemaVersion: 1, sessionId: 'session-example', workspaceId: workspace.workspaceId }),
      { schemaVersion: 1, sessionId: 'session-example', workspaceId: workspace.workspaceId });
    assert.throws(() => decodeBealeAppServerQuickChatStartInput({ promptMarkdown: '' }), /promptMarkdown/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
