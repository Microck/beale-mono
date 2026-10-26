import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentPluginRecord, AgentPluginRegistryState, WorkspaceRegistryEntry } from '../src/shared/types';
import { PluginManagerWorkspace, PluginsSidebar } from '../src/renderer/features/plugins/PluginManagerWorkspace';
import { pluginEnabledForWorkspace, setPluginEnabledForScope } from '../src/renderer/features/plugins/pluginScope';

const builtinPlugin: AgentPluginRecord = {
  id: 'example-builtin', name: 'Example Plugin', version: '0.1.0', description: 'Example guidance.',
  installed: true, enabled: true, status: 'ready', source: { kind: 'builtin', path: '/example/plugins/builtin' },
  installedAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
  skills: [], mcpServers: [], warnings: [], errors: []
};

const repositoryPlugin: AgentPluginRecord = {
  ...builtinPlugin,
  id: 'example-repository', name: 'Repository Plugin', enabled: false,
  source: { kind: 'repository', path: '/example/plugins/repository', repositoryUrl: 'https://example.test/plugin.git' },
  skills: [{
    id: 'skill-example', name: 'Example Skill', directoryName: 'example', relativePath: 'skills/example',
    description: 'Synthetic workflow.', resourceCounts: { scripts: 1, references: 2, assets: 0 }
  }],
  mcpServers: [{ name: 'example-server', transport: 'stdio', command: 'node', url: null, valid: true, errors: [] }],
  warnings: ['Example warning.'], errors: []
};

const state: AgentPluginRegistryState = {
  registryPath: '/example/plugins.json', pluginStorePath: '/example/plugins', specVersion: '1.0.0',
  plugins: [builtinPlugin, repositoryPlugin, { ...builtinPlugin, id: 'available-builtin', name: 'Available Plugin', installed: false, enabled: false, removable: true }, { ...builtinPlugin, id: 'beale-source-builtin', name: 'beale-source' }]
};

const workspace: WorkspaceRegistryEntry = {
  id: 'registry-example', workspaceId: 'workspace-example', workspacePath: '/example/workspace',
  workspaceName: 'Example Workspace', researchProfileId: 'security-research', researchKitId: 'general',
  scopeOwner: 'ExampleCo', descriptionMarkdown: '', rulesMarkdown: '', expiresAt: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: null, runCount: 0, lastRunAt: null
};

const managerScope = {
  workspaces: [], selectedWorkspaceId: null,
  onScopeChange: () => undefined,
  onSetEnabled: () => undefined
};

function renderSidebar(pluginState: AgentPluginRegistryState = state): string {
  return renderToStaticMarkup(createElement(PluginsSidebar, {
    state: pluginState,
    selectedWorkspace: null,
    selectedPluginId: builtinPlugin.id,
    collapsed: false,
    loading: false,
    busy: false,
    error: null,
    repositoryUrl: '',
    onRepositoryUrlChange: () => undefined,
    onAddFilesystem: () => undefined,
    onAddRepository: () => undefined,
    onInstall: () => undefined,
    onSetEnabled: () => undefined,
    onSelectPlugin: () => undefined,
    onResizePointerDown: () => undefined
  }));
}

describe('plugin manager workspace', () => {
  it('shows Installed and Available with one-click install and selectable checkbox rows', () => {
    const html = renderSidebar();

    expect(html).toContain('aria-label="Plugins sidebar"');
    expect(html).toContain('class="workspace-list-title"><span>Installed</span>');
    expect(html).toContain('aria-label="Add plugin" aria-haspopup="menu" aria-expanded="false"');
    expect(html).toContain('aria-label="Installed plugins"');
    expect(html).toContain('class="workspace-list-title"><span>Available</span>');
    expect(html).toContain('aria-label="Available plugins"');
    expect(html).toContain('aria-label="Install Available Plugin"');
    expect(html).toContain('aria-label="Enable Example Plugin in all workspaces"');
    expect(html).toContain('aria-label="Enable Repository Plugin in all workspaces"');
    expect(html.match(/class="plugin-sidebar-toggle"/gu)).toHaveLength(2);
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('beale-source');
    expect(html).toContain('aria-label="Resize sidebar"');
  });

  it('disables the checkbox for an invalid plugin while keeping its details selectable', () => {
    const html = renderSidebar({ ...state, plugins: [{ ...builtinPlugin, status: 'invalid', enabled: false }] });
    expect(html).toContain('title="Invalid plugins cannot be enabled"');
    expect(html).toContain('class="plugin-sidebar-toggle"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-current="page"');
  });

  it('uses the shared centered loading state in the main panel', () => {
    const html = renderToStaticMarkup(createElement(PluginManagerWorkspace, {
      ...managerScope, state: null, loading: true, busy: false, error: null, onRemove: () => undefined
    }));

    expect(html).toContain('class="centered-loading-state"');
    expect(html).toContain('class="centered-loading-state-spinner"');
    expect(html).toContain('<span>Loading plugins…</span>');
  });

  it('shows a selected plugin’s full details without a duplicate catalog or add controls', () => {
    const empty = renderToStaticMarkup(createElement(PluginManagerWorkspace, {
      ...managerScope, state, selectedPluginId: null, loading: false, busy: false, error: null, onRemove: () => undefined
    }));
    expect(empty).toContain('Select a plugin in the sidebar to view its details.');
    expect(empty).not.toContain('plugin-manager-detail');
    expect(empty).not.toContain('Add from Filesystem');

    const builtin = renderToStaticMarkup(createElement(PluginManagerWorkspace, {
      ...managerScope, state, selectedPluginId: builtinPlugin.id, loading: false, busy: false, error: null, onRemove: () => undefined
    }));
    expect(builtin).toContain('<h1>Example Plugin</h1>');
    expect(builtin).toContain('aria-label="Details for Example Plugin"');
    expect(builtin).toContain('Built in');
    expect(builtin).not.toContain('Remove Plugin');

    const available = renderToStaticMarkup(createElement(PluginManagerWorkspace, {
      ...managerScope, state, selectedPluginId: 'available-builtin', loading: false, busy: false, error: null, onRemove: () => undefined
    }));
    expect(available).toContain('<dd>Available</dd>');
    expect(available).not.toContain('Remove Plugin');

    const repository = renderToStaticMarkup(createElement(PluginManagerWorkspace, {
      ...managerScope, state, selectedPluginId: repositoryPlugin.id, loading: false, busy: false, error: null, onRemove: () => undefined
    }));
    expect(repository).toContain('https://example.test/plugin.git');
    expect(repository).toContain('Example Skill');
    expect(repository).toContain('example-server');
    expect(repository).toContain('Example warning.');
    expect(repository).toContain('Remove Plugin');
    expect(repository).not.toContain('plugin-manager-list');

    const required = renderToStaticMarkup(createElement(PluginManagerWorkspace, {
      ...managerScope,
      state: { ...state, plugins: [{ ...builtinPlugin, removable: true, removalBlockedReason: 'Required by an active research kit.' }] },
      selectedPluginId: builtinPlugin.id, loading: false, busy: false, error: null, onRemove: () => undefined
    }));
    expect(required).toContain('Required by an active research kit.');
    expect(required).toContain('disabled=""');
  });

  it('shows All Plugins first and uses workspace overrides only in matching workspace tabs', () => {
    const kitWorkspace: WorkspaceRegistryEntry = { ...workspace, id: 'registry-kit', workspaceId: 'workspace-kit',
      workspaceName: 'Kit Workspace', researchKitId: 'meta-bug-bounty' };
    const scopedState: AgentPluginRegistryState = { ...state, plugins: [
      { ...builtinPlugin, workspaceOverrides: { [workspace.workspaceId]: false } },
      { ...repositoryPlugin, enabled: true },
      { ...builtinPlugin, id: 'meta-skills-builtin', name: 'Kit Plugin',
        requiredByResearchKits: ['meta-bug-bounty'] }
    ] };
    const all = renderToStaticMarkup(createElement(PluginManagerWorkspace, {
      ...managerScope, state: scopedState, workspaces: [workspace, kitWorkspace],
      selectedPluginId: builtinPlugin.id, loading: false, busy: false, error: null, onRemove: () => undefined
    }));
    expect(all.indexOf('All Plugins')).toBeLessThan(all.indexOf('Example Workspace'));
    expect(all).toContain('role="tab" aria-selected="true"');
    expect(all).toContain('Enabled in all workspaces');

    const scoped = renderToStaticMarkup(createElement(PluginManagerWorkspace, {
      ...managerScope, state: scopedState, workspaces: [workspace, kitWorkspace],
      selectedWorkspaceId: workspace.workspaceId, selectedPluginId: builtinPlugin.id,
      loading: false, busy: false, error: null, onRemove: () => undefined
    }));
    expect(scoped).toContain('Enabled in Example Workspace');
    expect(scoped).toContain('<dd>Disabled</dd>');
    const sidebar = renderToStaticMarkup(createElement(PluginsSidebar, {
      state: scopedState, selectedWorkspace: workspace, selectedPluginId: null, collapsed: false,
      loading: false, busy: false, error: null, repositoryUrl: '',
      onRepositoryUrlChange: () => undefined, onAddFilesystem: () => undefined,
      onAddRepository: () => undefined, onInstall: () => undefined,
      onSetEnabled: () => undefined, onSelectPlugin: () => undefined,
      onResizePointerDown: () => undefined
    }));
    expect(sidebar).not.toContain('Kit Plugin');
    const kitSidebar = renderToStaticMarkup(createElement(PluginsSidebar, {
      state: scopedState, selectedWorkspace: kitWorkspace, selectedPluginId: null, collapsed: false,
      loading: false, busy: false, error: null, repositoryUrl: '',
      onRepositoryUrlChange: () => undefined, onAddFilesystem: () => undefined,
      onAddRepository: () => undefined, onInstall: () => undefined,
      onSetEnabled: () => undefined, onSelectPlugin: () => undefined,
      onResizePointerDown: () => undefined
    }));
    expect(kitSidebar).toContain('Kit Plugin');
  });

  it('routes each toggle to the workspace shown by that control', () => {
    const secondWorkspace: WorkspaceRegistryEntry = {
      ...workspace,
      id: 'registry-second',
      workspaceId: 'workspace-second',
      workspaceName: 'Second Workspace'
    };
    const calls: Array<[string, boolean, string | null]> = [];
    const onSetEnabled = (pluginId: string, enabled: boolean, workspaceId: string | null): void => {
      calls.push([pluginId, enabled, workspaceId]);
    };

    setPluginEnabledForScope(onSetEnabled, builtinPlugin.id, false, workspace);
    setPluginEnabledForScope(onSetEnabled, builtinPlugin.id, true, secondWorkspace);
    setPluginEnabledForScope(onSetEnabled, builtinPlugin.id, false, null);

    expect(calls).toEqual([
      [builtinPlugin.id, false, workspace.workspaceId],
      [builtinPlugin.id, true, secondWorkspace.workspaceId],
      [builtinPlugin.id, false, null]
    ]);
    const independentlyScoped = {
      ...builtinPlugin,
      workspaceOverrides: { [workspace.workspaceId]: false, [secondWorkspace.workspaceId]: true }
    };
    expect(pluginEnabledForWorkspace(independentlyScoped, workspace)).toBe(false);
    expect(pluginEnabledForWorkspace(independentlyScoped, secondWorkspace)).toBe(true);
  });

  it('keeps plugin navigation out of the modal layer', () => {
    const appSource = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    const modalSource = readFileSync(new URL('../src/renderer/app/AppModals.tsx', import.meta.url), 'utf8');
    const railSource = readFileSync(new URL('../src/renderer/app/AppNavigationRail.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('<PluginManagerWorkspace');
    expect(modalSource).not.toContain('PluginManager');
    expect(railSource).toContain("active === 'plugins' ? ' active' : ''");
    expect(existsSync(new URL('../src/renderer/features/plugins/PluginManagerModal.tsx', import.meta.url))).toBe(false);
  });
});
