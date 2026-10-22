import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { FleetState } from '@beale/app-server-runtime/protocol';
import { availableFleetTargets, configuredWorkspaceTargets } from '../../../shared/fleet';
import { WorkspaceTitleSearch, workspaceCatalogMatchesQuery } from './WorkspaceTitleSearch';

export function WorkspaceTargetsPanel({ workspaceId, workspaceName, disabled, remoteTargets }: { workspaceId: string; workspaceName: string; disabled: boolean; remoteTargets?: readonly { id: string; name: string; ready: boolean }[] }): JSX.Element {
  const [state, setState] = useState<FleetState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const refresh = useCallback(async (): Promise<void> => {
    try { setState(await window.beale.getFleetState()); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }, []);
  useEffect(() => { if (!remoteTargets) void refresh(); }, [refresh, remoteTargets]);

  const toggle = async (targetId: string, enabled: boolean): Promise<void> => {
    if (!state || saving) return;
    const available = new Set(availableFleetTargets(state).map((target) => target.id));
    const current = configuredWorkspaceTargets(state, workspaceId).filter((id) => available.has(id));
    const targetIds = enabled ? [...new Set([...current, targetId])] : current.filter((id) => id !== targetId);
    setSaving(true);
    try {
      setState(await window.beale.configureFleet({ action: 'set-workspace-targets', workspaceId, targetIds }));
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(false); }
  };
  const targets = remoteTargets?.map((target) => ({ ...target, detail: 'Selected on this app server' })) ?? (state ? availableFleetTargets(state) : []);
  const filteredTargets = targets.filter((target) => workspaceCatalogMatchesQuery(query, [target.id, target.name, target.detail]));
  const allowed = new Set(remoteTargets?.map((target) => target.id) ?? (state ? configuredWorkspaceTargets(state, workspaceId) : []));
  return <section aria-label="Workspace targets" className="workspace-dashboard-panel workspace-targets-panel settings-form" id="workspace-dashboard-targets-panel" role="tabpanel">
    <header className="settings-form-heading">
      <div className="workspace-catalog-title-row"><h2>{workspaceName} Targets</h2><WorkspaceTitleSearch label="targets" query={query} onChange={setQuery} /></div>
      <p>{remoteTargets ? 'Targets selected for New Research on this app server.' : 'Choose which machines and browsers appear in New Research for this workspace.'}</p>
    </header>
    <fieldset className="settings-form-squircle" disabled={disabled || saving || Boolean(remoteTargets) || !state}>
      <div className="settings-form-control-list">
        {filteredTargets.map((target) => <label className="settings-form-control-row" key={target.id}>
          <span className="settings-form-control-copy"><strong>{target.name}</strong><small>{target.detail}{target.ready ? '' : ' · Configure in Fleet before use'}</small></span>
          <input type="checkbox" checked={allowed.has(target.id)} onChange={(event) => void toggle(target.id, event.currentTarget.checked)} />
        </label>)}
        {query.trim() && filteredTargets.length === 0 ? <p className="workspace-targets-empty">No targets match this search.</p> : null}
      </div>
    </fieldset>
    {error ? <p className="settings-form-error" role="alert">{error}</p> : null}
  </section>;
}
