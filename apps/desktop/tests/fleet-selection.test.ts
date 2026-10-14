import { describe, expect, it } from 'vitest';
import type { FleetState } from '@beale/app-server-runtime/protocol';
import { allowedFleetTargets, defaultFleetMachineId, isAllowedFleetMachine } from '../src/shared/fleet';

const state: FleetState = {
  machineId: 'machine-example', role: 'primary', enabled: true, available: true, error: null,
  appServers: [], remoteMachines: [],
  browsers: [
    { id: 'in-agent', name: 'In-Agent Browser', kind: 'embedded', enabled: true },
    { id: 'chrome', name: 'Google Chrome', kind: 'external', enabled: true },
  ],
  machines: [{ id: 'tart:example-base', name: 'example-base', backend: 'tart', state: 'stopped', base: true,
    canRun: true, canClone: true, guestPlatform: 'darwin', privilege: 'standard', sshConfigured: true,
    sshIdentityConfigured: false, sshKnownHostsConfigured: false, sshHost: null, sshUser: 'example', owner: null }],
  primary: null, requiredWorkspaceIds: [], optionalWorkspaceIds: [], lastMachineByWorkspace: {},
  workspaceTargets: { 'workspace-example': ['browser:chrome', 'vm:run:tart:example-base'] },
};

describe('Fleet workspace targets', () => {
  it('limits the picker to checked browser and VM modes', () => {
    expect(allowedFleetTargets(state, 'workspace-example').map((target) => target.id)).toEqual([
      'browser:chrome', 'vm:run:tart:example-base',
    ]);
    expect(isAllowedFleetMachine(state, 'workspace-example', 'vm:clone:tart:example-base')).toBe(false);
    expect(isAllowedFleetMachine(state, 'workspace-example', 'local')).toBe(false);
  });

  it('uses the previous allowed target and falls back to a ready target', () => {
    expect(defaultFleetMachineId(state, 'workspace-example')).toBe('browser:chrome');
    const previous = { ...state, lastMachineByWorkspace: { 'workspace-example': 'vm:run:tart:example-base' } };
    expect(defaultFleetMachineId(previous, 'workspace-example')).toBe('vm:run:tart:example-base');
  });

  it('starts unconfigured workspaces with Local and the In-Agent Browser', () => {
    expect(allowedFleetTargets(state, 'new-workspace').map((target) => target.id)).toEqual(['local', 'browser:in-agent']);
  });
});
