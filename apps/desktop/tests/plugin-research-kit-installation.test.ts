import { describe, expect, it } from 'vitest';
import { WorkspaceService } from '../src/main/workspaceService';
import type { AgentPluginRecord, AgentPluginRegistryState } from '../src/shared/types';

const availablePlugin = (name: string): AgentPluginRecord => ({
  id: `${name}-builtin`, name, version: null, description: null,
  installed: false, enabled: false, status: 'ready',
  source: { kind: 'builtin', path: `/example/managed-plugins/${name}` },
  installedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  skills: [], mcpServers: [], warnings: [], errors: []
});

describe('registered research kit plugin installation', () => {
  it('installs Apple dependencies even when its workspace is not open', () => {
    let state: AgentPluginRegistryState = {
      registryPath: '/example/agent-plugins.json', pluginStorePath: '/example/plugin-store', specVersion: '1.0.0',
      plugins: [availablePlugin('apple-security-devices'), availablePlugin('apple-target-flags'), availablePlugin('meta-skills')]
    };
    const installed: string[] = [];
    const service = Object.create(WorkspaceService.prototype) as WorkspaceService;
    Object.assign(service, {
      workspaceRegistry: {
        getState: () => ({ workspaces: [{ researchKitId: 'apple-security-bounty' }], researchSessions: [], registryPath: '/example/workspaces' })
      },
      backgroundRuntimes: new Map(),
      agentPluginRegistry: {
        getState: () => state,
        setEnabled: (pluginId: string, enabled: boolean) => {
          installed.push(pluginId);
          state = { ...state, plugins: state.plugins.map((plugin) => plugin.id === pluginId ? { ...plugin, installed: true, enabled } : plugin) };
          return state;
        }
      }
    });

    const result = service.getAgentPlugins();
    expect(installed).toEqual(['apple-security-devices-builtin', 'apple-target-flags-builtin']);
    expect(result.plugins.filter((plugin) => plugin.installed).map((plugin) => plugin.id)).toEqual(installed);
    expect(result.plugins.find((plugin) => plugin.id === 'meta-skills-builtin')?.installed).toBe(false);
  });

  it('routes workspace toggles through the registered kit and keeps All Plugins global', () => {
    const calls: string[] = [];
    const service = Object.create(WorkspaceService.prototype) as WorkspaceService;
    Object.assign(service, {
      workspaceRegistry: {
        getState: () => ({ workspaces: [
          { workspaceId: 'workspace-example', researchKitId: 'meta-bug-bounty' },
          { workspaceId: 'workspace-second', researchKitId: 'general' }
        ] })
      },
      agentPluginRegistry: {
        setEnabled: (pluginId: string, enabled: boolean) => { calls.push(`all:${pluginId}:${enabled}`); return {} as AgentPluginRegistryState; },
        setWorkspaceEnabled: (pluginId: string, workspaceId: string, researchKitId: string, enabled: boolean) => {
          calls.push(`${workspaceId}:${researchKitId}:${pluginId}:${enabled}`);
          return {} as AgentPluginRegistryState;
        }
      }
    });

    service.setAgentPluginEnabled('example-plugin', false, 'workspace-example');
    service.setAgentPluginEnabled('example-plugin', true, 'workspace-second');
    service.setAgentPluginEnabled('example-plugin', true);
    expect(calls).toEqual([
      'workspace-example:meta-bug-bounty:example-plugin:false',
      'workspace-second:general:example-plugin:true',
      'all:example-plugin:true'
    ]);
    expect(() => service.setAgentPluginEnabled('example-plugin', true, 'unknown-workspace')).toThrow('Workspace is not registered.');
  });
});
