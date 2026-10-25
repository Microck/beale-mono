import assert from 'node:assert/strict';
import test from 'node:test';
import { createFleetTools } from '../dist/fleet-tools.js';

test('Fleet model tools expose VM status without SSH metadata', async () => {
  const calls = [];
  const tools = createFleetTools(async (operation, input) => {
    calls.push({ operation, input });
    return { machineId: 'machine-example', enabled: true, available: true, machines: [{
      id: 'tart:example-worker', name: 'example-worker', backend: 'tart', state: 'stopped', base: false,
      privilege: 'standard', sshConfigured: true, sshHost: '192.0.2.10', sshUser: 'example',
      owner: { machineId: 'machine-example', sessionId: 'session-example' },
    }] };
  }, 'session-example');
  const list = tools.find((tool) => tool.descriptor.name === 'fleet.list');
  const result = await list.execute({ id: 'action-example', toolName: 'fleet.list', input: {} });
  assert.equal(result.status, 'complete');
  assert.equal(result.output.machines[0].sshHost, undefined);
  assert.equal(result.output.machines[0].sshUser, undefined);
  assert.equal(result.output.machines[0].owner, undefined);
  assert.equal(result.output.machines[0].ownership, 'current_session');
  const clone = tools.find((tool) => tool.descriptor.name === 'fleet.clone');
  await clone.execute({ id: 'action-clone', toolName: 'fleet.clone', input: { baseId: 'tart:example-base', name: 'example-copy' } });
  assert.deepEqual(calls[1], { operation: 'fleet.clone', input: { baseId: 'tart:example-base', name: 'example-copy' } });
});

test('Fleet stop accepts only a VM reserved by the current research session', async () => {
  const calls = [];
  const state = { machineId: 'machine-example', enabled: true, available: true, machines: [
    { id: 'tart:example-owned', name: 'example-owned', backend: 'tart', state: 'running', base: false,
      privilege: 'standard', sshConfigured: true, owner: { machineId: 'machine-example', sessionId: 'session-example' } },
    { id: 'tart:example-other', name: 'example-other', backend: 'tart', state: 'running', base: false,
      privilege: 'standard', sshConfigured: true, owner: { machineId: 'machine-example', sessionId: 'session-other' } },
    { id: 'tart:example-remote-owner', name: 'example-remote-owner', backend: 'tart', state: 'running', base: false,
      privilege: 'standard', sshConfigured: true, owner: { machineId: 'machine-other', sessionId: 'session-example' } },
    { id: 'tart:example-unreserved', name: 'example-unreserved', backend: 'tart', state: 'running', base: false,
      privilege: 'standard', sshConfigured: true, owner: null },
  ] };
  const tools = createFleetTools(async (operation, input) => {
    calls.push({ operation, input });
    return state;
  }, 'session-example');
  const list = tools.find((tool) => tool.descriptor.name === 'fleet.list');
  const stop = tools.find((tool) => tool.descriptor.name === 'fleet.stop');
  const listed = await list.execute({ id: 'list-example', toolName: 'fleet.list', input: {} });
  assert.deepEqual(listed.output.machines.map((machine) => machine.ownership),
    ['current_session', 'other_session', 'other_session', 'unreserved']);
  assert.ok(listed.output.machines.every((machine) => machine.owner === undefined));
  for (const machineId of ['tart:example-other', 'tart:example-remote-owner', 'tart:example-unreserved']) {
    const denied = await stop.execute({ id: 'stop-denied', toolName: 'fleet.stop', input: { machineId } });
    assert.equal(denied.status, 'error');
    assert.match(denied.error.message, /reserved by this research session/);
  }
  assert.equal(calls.filter((call) => call.operation === 'fleet.stop').length, 0);
  const stopped = await stop.execute({ id: 'stop-owned', toolName: 'fleet.stop', input: { machineId: 'tart:example-owned' } });
  assert.equal(stopped.status, 'complete');
  assert.deepEqual(calls.at(-1), { operation: 'fleet.stop', input: { machineId: 'tart:example-owned' } });
});
