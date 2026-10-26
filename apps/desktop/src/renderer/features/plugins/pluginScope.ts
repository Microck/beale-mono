import type { AgentPluginRecord, WorkspaceRegistryEntry } from '@shared/types';

export type SetPluginEnabled = (pluginId: string, enabled: boolean, workspaceId: string | null) => void;

export function setPluginEnabledForScope(
  onSetEnabled: SetPluginEnabled,
  pluginId: string,
  enabled: boolean,
  workspace: WorkspaceRegistryEntry | null
): void {
  onSetEnabled(pluginId, enabled, workspace?.workspaceId ?? null);
}

export function pluginAppliesToWorkspace(plugin: AgentPluginRecord, workspace: WorkspaceRegistryEntry | null): boolean {
  return !workspace || !plugin.requiredByResearchKits?.length
    || plugin.requiredByResearchKits.includes(workspace.researchKitId);
}

export function pluginEnabledForWorkspace(plugin: AgentPluginRecord, workspace: WorkspaceRegistryEntry | null): boolean {
  if (!plugin.installed || plugin.status !== 'ready' || !pluginAppliesToWorkspace(plugin, workspace)) return false;
  return workspace && plugin.workspaceOverrides && Object.hasOwn(plugin.workspaceOverrides, workspace.workspaceId)
    ? plugin.workspaceOverrides[workspace.workspaceId] : plugin.enabled;
}
