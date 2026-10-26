import { useEffect, useRef, useState } from 'react';
import type { FormEvent, JSX, PointerEvent as ReactPointerEvent } from 'react';
import { FolderPlus, GitBranch, Plus, Trash2 } from 'lucide-react';
import type { AgentPluginRecord, AgentPluginRegistryState, WorkspaceRegistryEntry } from '@shared/types';
import { isOptionalAgentFeaturePlugin } from '../../../shared/optionalAgentFeatures';
import { CenteredLoadingState } from '../../app/CenteredLoadingState';
import { CollectionSidebar } from '../../app/CollectionSidebar';
import { formatSessionDateTime } from '../../lib/formatting';
import { pluginAppliesToWorkspace, pluginEnabledForWorkspace, setPluginEnabledForScope } from './pluginScope';

export function PluginsSidebar({
  state,
  selectedWorkspace,
  selectedPluginId,
  collapsed,
  loading,
  busy,
  error,
  repositoryUrl,
  onRepositoryUrlChange,
  onAddFilesystem,
  onAddRepository,
  onInstall,
  onSetEnabled,
  onSelectPlugin,
  onResizePointerDown
}: {
  state: AgentPluginRegistryState | null;
  selectedWorkspace: WorkspaceRegistryEntry | null;
  selectedPluginId: string | null;
  collapsed: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  repositoryUrl: string;
  onRepositoryUrlChange: (value: string) => void;
  onAddFilesystem: () => void;
  onAddRepository: () => void;
  onInstall: (pluginId: string) => void;
  onSetEnabled: (pluginId: string, enabled: boolean, workspaceId: string | null) => void;
  onSelectPlugin: (pluginId: string) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}): JSX.Element {
  const plugins = state?.plugins.filter((plugin) => !isOptionalAgentFeaturePlugin(plugin) && pluginAppliesToWorkspace(plugin, selectedWorkspace)) ?? [];
  const installedPlugins = plugins.filter((plugin) => plugin.installed);
  const availablePlugins = plugins.filter((plugin) => !plugin.installed);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [repositoryFormOpen, setRepositoryFormOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (collapsed) setAddMenuOpen(false);
  }, [collapsed]);

  useEffect(() => {
    if (!addMenuOpen) return undefined;
    const dismissOnOutsidePointer = (event: PointerEvent): void => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setAddMenuOpen(false);
      addButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', dismissOnOutsidePointer);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePointer);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [addMenuOpen]);

  const submitRepository = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy || loading || !repositoryUrl.trim()) return;
    onAddRepository();
    setAddMenuOpen(false);
  };

  return (
    <CollectionSidebar
      title="Plugins"
      label="Plugins sidebar"
      collapsed={collapsed}
      error={error}
      updateKey={`${selectedWorkspace?.workspaceId ?? 'all'}:${plugins.map((plugin) => `${plugin.id}:${plugin.installed}:${pluginEnabledForWorkspace(plugin, selectedWorkspace)}:${plugin.status}`).join(',')}`}
      onResizePointerDown={onResizePointerDown}
      primaryAction={<div className="section-row workspace-list-header plugin-sidebar-heading">
        <div className="workspace-list-title"><span>Installed</span></div>
        <div className="workspace-list-add-menu-anchor" ref={addMenuRef}>
          <button
            ref={addButtonRef}
            type="button"
            className="workspace-list-add-button"
            title="Add plugin"
            aria-label="Add plugin"
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
            disabled={busy || loading}
            onClick={() => { setRepositoryFormOpen(false); setAddMenuOpen((open) => !open); }}
          ><Plus size={15} aria-hidden="true" /></button>
          {addMenuOpen ? <div className="workspace-list-add-menu plugin-add-menu" role={repositoryFormOpen ? 'dialog' : 'menu'} aria-label="Add plugin">
            {repositoryFormOpen ? <form className="plugin-add-repository-form" onSubmit={submitRepository}>
              <label htmlFor="plugin-repository-url">Git repository URL</label>
              <input id="plugin-repository-url" type="url" autoFocus required value={repositoryUrl} placeholder="https://github.com/example-org/example-plugin" disabled={busy || loading} onChange={(event) => onRepositoryUrlChange(event.currentTarget.value)} />
              <div className="plugin-add-menu-actions">
                <button type="button" disabled={busy || loading} onClick={() => setRepositoryFormOpen(false)}>Back</button>
                <button type="submit" disabled={busy || loading || !repositoryUrl.trim()}>Add Repository</button>
              </div>
            </form> : <>
              <button type="button" role="menuitem" disabled={busy || loading} onClick={() => { setAddMenuOpen(false); onAddFilesystem(); }}><FolderPlus size={15} aria-hidden="true" /><span>Add from Filesystem</span></button>
              <button type="button" role="menuitem" disabled={busy || loading} onClick={() => setRepositoryFormOpen(true)}><GitBranch size={15} aria-hidden="true" /><span>Add from Git Repository</span></button>
            </>}
          </div> : null}
        </div>
      </div>}
    >
      <nav className="workspace-session-list sidebar-list-scroll-content plugin-sidebar-list" aria-label="Installed plugins">
        {loading ? <span className="workspace-session-empty">Loading plugins…</span> : installedPlugins.length === 0 ? (
          <span className="workspace-session-empty">No plugins installed</span>
        ) : installedPlugins.map((plugin) => {
          const selected = selectedPluginId === plugin.id;
          const invalid = plugin.status === 'invalid';
          return <div className="workspace-session-row plugin-sidebar-row" key={plugin.id}>
            <button
              type="button"
              className={`workspace-session-item plugin-sidebar-item${selected ? ' active' : ''}`}
              title={plugin.name}
              aria-current={selected ? 'page' : undefined}
              onClick={() => onSelectPlugin(plugin.id)}
            ><span className="workspace-session-title">{plugin.name}</span></button>
            <input
              type="checkbox"
              className="plugin-sidebar-toggle"
              aria-label={`Enable ${plugin.name}${selectedWorkspace ? ` in ${selectedWorkspace.workspaceName}` : plugin.requiredByResearchKits?.length ? ' in all matching workspaces' : ' in all workspaces'}`}
              title={invalid ? 'Invalid plugins cannot be enabled' : pluginEnabledForWorkspace(plugin, selectedWorkspace) ? 'Disable plugin' : 'Enable plugin'}
              checked={pluginEnabledForWorkspace(plugin, selectedWorkspace)}
              disabled={busy || loading || invalid}
              onChange={(event) => setPluginEnabledForScope(onSetEnabled, plugin.id, event.currentTarget.checked, selectedWorkspace)}
            />
          </div>;
        })}
      </nav>
      <div className="section-row workspace-list-header plugin-sidebar-heading plugin-available-heading"><div className="workspace-list-title"><span>Available</span></div></div>
      <nav className="workspace-session-list sidebar-list-scroll-content plugin-sidebar-list" aria-label="Available plugins">
        {!loading && availablePlugins.length === 0 ? <span className="workspace-session-empty">No plugins available</span> : availablePlugins.map((plugin) => {
          const selected = selectedPluginId === plugin.id;
          return <div className="workspace-session-row plugin-sidebar-row" key={plugin.id}>
            <button type="button" className={`workspace-session-item plugin-sidebar-item${selected ? ' active' : ''}`}
              title={plugin.name} aria-current={selected ? 'page' : undefined} onClick={() => onSelectPlugin(plugin.id)}>
              <span className="workspace-session-title">{plugin.name}</span>
            </button>
            <button type="button" className="plugin-sidebar-install" aria-label={`Install ${plugin.name}`}
              title={`Install ${plugin.name}`} disabled={busy || loading || plugin.status === 'invalid'}
              onClick={() => onInstall(plugin.id)}><Plus size={15} aria-hidden="true" /></button>
          </div>;
        })}
      </nav>
    </CollectionSidebar>
  );
}

export function PluginManagerWorkspace({
  state,
  workspaces,
  selectedWorkspaceId,
  selectedPluginId = null,
  loading,
  busy,
  error,
  onRemove,
  onScopeChange,
  onSetEnabled
}: {
  state: AgentPluginRegistryState | null;
  workspaces: readonly WorkspaceRegistryEntry[];
  selectedWorkspaceId: string | null;
  selectedPluginId?: string | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onRemove: (pluginId: string) => void;
  onScopeChange: (workspaceId: string | null) => void;
  onSetEnabled: (pluginId: string, enabled: boolean, workspaceId: string | null) => void;
}): JSX.Element {
  const selectedWorkspace = workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId) ?? null;
  const plugins = state?.plugins.filter((plugin) => !isOptionalAgentFeaturePlugin(plugin) && pluginAppliesToWorkspace(plugin, selectedWorkspace)) ?? [];
  const selectedPlugin = plugins.find((plugin) => plugin.id === selectedPluginId);
  const scopeTabs = [
    { id: null, key: 'all', label: 'All Plugins' },
    ...workspaces.filter((workspace) => workspace.workspaceId.length > 0)
      .map((workspace) => ({ id: workspace.workspaceId, key: workspace.id, label: workspace.workspaceName }))
  ];

  return (
    <section className="plugin-manager-workspace" aria-label="Plugins" aria-busy={loading}>
      <div className="plugin-manager-body wide-content-container">
        <div className="research-side-view-tabs research-side-view-tabs-scrollable pill-view-tabs" role="tablist" aria-label="Plugin workspace scope">
          {scopeTabs.map((scope) => {
            const selected = selectedWorkspaceId === scope.id;
            return <div className={`research-side-view-tab provider-settings-tab ${selected ? 'active' : ''}`.trim()} key={scope.key}>
              <button type="button" className="research-side-view-tab-activate" role="tab" aria-selected={selected}
                aria-controls="plugin-manager-panel" onClick={() => onScopeChange(scope.id)}><span>{scope.label}</span></button>
            </div>;
          })}
        </div>
        <div className="plugin-manager-panel" id="plugin-manager-panel" role="tabpanel">
          <header className="resource-workspace-heading">
            <h1>{selectedPlugin?.name ?? (selectedWorkspace ? `${selectedWorkspace.workspaceName} Plugins` : 'All Plugins')}</h1>
            <p>{selectedPlugin ? selectedPlugin.description ?? 'No description provided.' : plugins.length ? 'Select a plugin in the sidebar to view its details.' : 'Add a plugin from the Installed menu in the sidebar.'}</p>
          </header>
          {error ? <div className="plugin-manager-error" role="alert">{error}</div> : null}
          {loading ? <CenteredLoadingState label="Loading plugins…" /> : selectedPlugin ? (
            <PluginDetails plugin={selectedPlugin} workspace={selectedWorkspace} busy={busy} onRemove={onRemove} onSetEnabled={onSetEnabled} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PluginDetails({ plugin, workspace, busy, onRemove, onSetEnabled }: {
  plugin: AgentPluginRecord;
  workspace: WorkspaceRegistryEntry | null;
  busy: boolean;
  onRemove: (pluginId: string) => void;
  onSetEnabled: (pluginId: string, enabled: boolean, workspaceId: string | null) => void;
}): JSX.Element {
  const invalid = plugin.status === 'invalid';
  const enabled = pluginEnabledForWorkspace(plugin, workspace);
  return <article className="plugin-manager-detail" aria-label={`Details for ${plugin.name}`}>
    {plugin.installed ? <label className="plugin-manager-enable">
      <input type="checkbox" checked={enabled} disabled={busy || invalid}
        onChange={(event) => setPluginEnabledForScope(onSetEnabled, plugin.id, event.currentTarget.checked, workspace)} />
      <span>{workspace ? `Enabled in ${workspace.workspaceName}` : plugin.requiredByResearchKits?.length ? 'Enabled in all matching workspaces' : 'Enabled in all workspaces'}</span>
    </label> : null}
    <dl className="plugin-detail-properties">
      <div><dt>Status</dt><dd>{!plugin.installed ? 'Available' : invalid ? 'Invalid' : enabled ? 'Enabled' : 'Disabled'}</dd></div>
      <div><dt>Version</dt><dd>{plugin.version ?? 'Not specified'}</dd></div>
      <div><dt>Source</dt><dd>{plugin.source.kind === 'builtin' ? 'Built in' : plugin.source.kind === 'repository' ? 'Git repository' : 'Filesystem'}</dd></div>
      {plugin.source.repositoryUrl ? <div><dt>Repository</dt><dd className="plugin-detail-path">{plugin.source.repositoryUrl}</dd></div> : null}
      <div><dt>Location</dt><dd className="plugin-detail-path">{plugin.source.path}</dd></div>
      {plugin.installed ? <div><dt>Installed</dt><dd>{formatSessionDateTime(plugin.installedAt)}</dd></div> : null}
      <div><dt>Updated</dt><dd>{formatSessionDateTime(plugin.updatedAt)}</dd></div>
    </dl>
    <section className="plugin-detail-section" aria-label="Skills">
      <h2>Skills</h2>
      {plugin.skills.length ? <ul>{plugin.skills.map((skill) => <li key={skill.id}>
        <strong>{skill.name}</strong>
        <span className="plugin-detail-path">{skill.relativePath}</span>
        {skill.description ? <span>{skill.description}</span> : null}
        <small>{skill.resourceCounts.scripts} scripts · {skill.resourceCounts.references} references · {skill.resourceCounts.assets} assets</small>
      </li>)}</ul> : <p>No skills</p>}
    </section>
    <section className="plugin-detail-section" aria-label="MCP servers">
      <h2>MCP Servers</h2>
      {plugin.mcpServers.length ? <ul>{plugin.mcpServers.map((server) => <li key={server.name}>
        <strong>{server.name}{server.valid ? '' : ' · Invalid'}</strong>
        <span>{server.transport}</span>
        {server.command ? <span className="plugin-detail-path">{server.command}</span> : null}
        {server.url ? <span className="plugin-detail-path">{server.url}</span> : null}
        {server.errors.map((message, index) => <span className="plugin-detail-error" key={index}>{message}</span>)}
      </li>)}</ul> : <p>No MCP servers</p>}
    </section>
    {plugin.warnings.length ? <section className="plugin-detail-section" aria-label="Warnings"><h2>Warnings</h2><ul>{plugin.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul></section> : null}
    {plugin.errors.length ? <section className="plugin-detail-section" aria-label="Errors"><h2>Errors</h2><ul>{plugin.errors.map((message, index) => <li className="plugin-detail-error" key={index}>{message}</li>)}</ul></section> : null}
    {plugin.installed && (plugin.removable || plugin.source.kind !== 'builtin') ? <div className="plugin-detail-actions">
      {plugin.removalBlockedReason ? <span className="plugin-removal-blocked" role="status">{plugin.removalBlockedReason}</span> : null}
      <button type="button" disabled={busy || Boolean(plugin.removalBlockedReason)} title={plugin.removalBlockedReason ?? 'Remove plugin'} onClick={() => onRemove(plugin.id)}><Trash2 size={14} aria-hidden="true" />Remove Plugin</button>
    </div> : null}
  </article>;
}
