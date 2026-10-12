import { useEffect, useMemo, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { FleetRemoteCatalog } from '@beale/app-server-runtime/protocol';
import { WorkspaceSidebar } from '../workspaces/WorkspaceSidebar';
import { CommentaryView } from '../commentary/CommentaryView';
import { FleetBrowserSideView } from '../research/FleetBrowserSideView';
import { buildTraceDisplayEventsForAgentPath } from '../../view-models/traceDisplay';
import { mergeRemoteSessionHistory, remoteRunDetail, remoteRunStatus, remoteSessionHistoryPage, remoteWorkspaceRegistry } from './remoteFleetProjection';
import type { RemoteSessionHistoryPage } from './remoteFleetProjection';

export function RemoteFleetSidebar({ catalog, serverName, selectedWorkspaceId, selectedSessionId, automations, collapsed, serverSelector, onSelect, onResizePointerDown }: {
  catalog: FleetRemoteCatalog | null;
  serverName: string;
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  automations: boolean;
  collapsed: boolean;
  serverSelector: ReactNode;
  onSelect: (workspaceId: string, sessionId: string | null) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}): JSX.Element {
  const registry = remoteWorkspaceRegistry(catalog && automations
    ? { ...catalog, sessions: catalog.sessions.filter((session) => session.automation) }
    : catalog, catalog?.serverId ?? serverName);
  return <WorkspaceSidebar
    serverSelector={serverSelector}
    busy={false}
    collapsed={collapsed}
    error={null}
    workspaceRegistry={registry}
    workspaceRegistryLoading={!catalog}
    selectedRunId={selectedSessionId}
    selectedWorkspaceId={selectedWorkspaceId}
    snapshot={null}
    automationsActive={automations}
    remote
    onAddWorkspace={() => undefined}
    onImportWorkspace={() => undefined}
    onOpenWorkspace={(workspace) => onSelect(workspace.workspaceId, null)}
    onOpenResearchSession={(workspace, session) => onSelect(workspace.workspaceId, session.runId)}
    onResizePointerDown={onResizePointerDown}
    onStartNewResearch={() => selectedWorkspaceId && onSelect(selectedWorkspaceId, null)}
    onStartNewResearchForWorkspace={(workspace) => onSelect(workspace.workspaceId, null)}
  />;
}

export function RemoteFleetWorkspace({ serverId, serverName, catalog, workspaceId, sessionId, automations, error, onLaunched }: {
  serverId: string;
  serverName: string;
  catalog: FleetRemoteCatalog | null;
  workspaceId: string | null;
  sessionId: string | null;
  automations: boolean;
  error: string | null;
  onLaunched: (workspaceId: string, sessionId: string) => void;
}): JSX.Element {
  const [detail, setDetail] = useState<unknown>(null);
  const [olderPages, setOlderPages] = useState<RemoteSessionHistoryPage[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [machineId, setMachineId] = useState('local');
  const [starting, setStarting] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [browserSelection, setBrowserSelection] = useState<string | null>(null);
  const browserOpen = browserSelection === `${serverId}:${sessionId ?? ''}`;
  useEffect(() => { setBrowserSelection(null); }, [serverId, sessionId]);
  useEffect(() => {
    setDetail(null);
    setOlderPages([]);
    if (!workspaceId || !sessionId) return;
    let active = true;
    const refresh = (): void => {
      void window.beale.getFleetRemoteSession(serverId, workspaceId, sessionId)
        .then((value) => { if (active) { setDetail(value); setDetailError(null); } })
        .catch((caught: unknown) => { if (active) setDetailError(message(caught)); });
    };
    refresh();
    const interval = window.setInterval(refresh, 3_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [serverId, workspaceId, sessionId]);
  const workspace = catalog?.workspaces.find((item) => item.workspaceId === workspaceId);
  const session = catalog?.sessions.find((item) => item.id === sessionId && item.workspaceId === workspaceId);
  const browserAvailable = Boolean(session && !['completed', 'failed', 'stopped'].includes(session.status));
  const allowedTargets = new Set(workspaceId ? catalog?.workspaceTargets[workspaceId] ?? ['local', 'browser:in-agent'] : []);
  const targets = [
    { id: 'local', name: 'Local', ready: true },
    ...(catalog?.browsers.filter((browser) => browser.enabled).map((browser) => ({
      id: `browser:${browser.id}`, name: browser.name, ready: true,
    })) ?? []),
    ...(catalog?.machines.flatMap((machine) => [
      ...(machine.canRun ? [{ id: `vm:run:${machine.id}`, name: `${machine.name} · Run`, ready: machine.sshConfigured && machine.state !== 'unknown' && !machine.owner }] : []),
      ...(machine.canClone ? [{ id: `vm:clone:${machine.id}`, name: `${machine.name} · Clone`, ready: machine.sshConfigured && machine.state === 'stopped' && !machine.owner }] : []),
    ]) ?? []),
  ].filter((target) => allowedTargets.has(target.id));
  const targetKey = targets.map((target) => `${target.id}:${target.ready}`).join('|');
  useEffect(() => { setMachineId(targets.find((target) => target.ready)?.id ?? targets[0]?.id ?? ''); }, [serverId, workspaceId, targetKey]);
  const mergedDetail = useMemo(() => mergeRemoteSessionHistory(detail, olderPages), [detail, olderPages]);
  const runDetail = useMemo(() => remoteRunDetail(mergedDetail), [mergedDetail]);
  const events = useMemo(() => runDetail ? buildTraceDisplayEventsForAgentPath(runDetail, null) : [], [runDetail]);
  const runStatus = runDetail?.run.status ?? remoteRunStatus(session?.status ?? '');
  const start = async (): Promise<void> => {
    if (!workspaceId || !prompt.trim() || starting) return;
    setStarting(true);
    setLaunchError(null);
    try {
      const result = await window.beale.startFleetRemoteSession(serverId, workspaceId, prompt, machineId);
      setPrompt('');
      onLaunched(workspaceId, result.sessionId);
    } catch (caught) { setLaunchError(message(caught)); }
    finally { setStarting(false); }
  };
  const control = async (type: 'pause' | 'resume' | 'stop' | 'steer', instruction?: string): Promise<void> => {
    if (!sessionId || controlBusy) return;
    setControlBusy(true);
    setControlError(null);
    try {
      if (type === 'resume' && instruction?.trim()) {
        await window.beale.controlFleetRemoteSession(serverId, sessionId, 'steer', instruction);
      }
      await window.beale.controlFleetRemoteSession(serverId, sessionId, type, type === 'steer' ? instruction : undefined);
    } catch (caught) { setControlError(message(caught)); }
    finally { setControlBusy(false); }
  };
  return <section className={`remote-fleet-workspace${session ? ' remote-fleet-session' : ''}`} aria-label={`${serverName} research`}>
    <div className="remote-fleet-content">
      {!session ? <><p className="remote-fleet-eyebrow">{serverName}</p>
        <h1>{workspace?.name ?? (automations ? 'Automations' : 'Research')}</h1></> : null}
      {error ? <p className="settings-form-error" role="alert">{error}</p> : null}
      {session ? <>{detailError ? <p className="settings-form-error" role="alert">{detailError}</p> : null}
        {controlError ? <p className="settings-form-error" role="alert">{controlError}</p> : null}
        {browserAvailable ? <div className="remote-fleet-view-switch" aria-label="Remote session view">
          <button type="button" className="secondary-button" aria-pressed={!browserOpen} onClick={() => setBrowserSelection(null)}>Commentary</button>
          <button type="button" className="secondary-button" aria-pressed={browserOpen} onClick={() => setBrowserSelection(`${serverId}:${sessionId ?? ''}`)}>Browser</button>
          {runStatus === 'active' ? <button type="button" className="secondary-button" disabled={controlBusy} onClick={() => void control('pause')}>Pause</button> : null}
          {runStatus === 'paused' ? <button type="button" className="secondary-button" disabled={controlBusy} onClick={() => void control('resume')}>Resume</button> : null}
        </div> : null}
        {browserAvailable && browserOpen && sessionId ? <div className="remote-fleet-browser">
          <FleetBrowserSideView runId={sessionId} remoteServerId={serverId} visible />
        </div> : <div className="main-session-grid session-main-only" data-session-view-state="session">
          <CommentaryView
            busy={controlBusy}
            detail={runDetail}
            events={events}
            onLoadOlderHistory={async () => {
              const beforeEventId = runDetail?.historyCursor?.beforeEventId;
              if (!workspaceId || !sessionId || !beforeEventId) return false;
              try {
                const page = remoteSessionHistoryPage(await window.beale.getFleetRemoteSession(serverId, workspaceId, sessionId, beforeEventId));
                if (!page || page.events.length === 0) return false;
                setOlderPages((current) => [page, ...current]);
                return true;
              } catch (caught) {
                setDetailError(message(caught));
                return false;
              }
            }}
            providerModelCatalog={[]}
            selectedRunId={sessionId}
            showBackToMain={false}
            searchHighlightQuery=""
            responseSuggestionsEnabled={false}
            onBackToMain={() => undefined}
            onRequestToolCallDetail={async (toolCall) => toolCall}
            onSessionAction={(action) => {
              if (action.type === 'pause' || action.type === 'resume' || action.type === 'stop' || action.type === 'steer') {
                void control(action.type, action.type === 'steer' ? action.instruction : action.type === 'resume' ? action.instruction : undefined);
              } else setControlError('This session action is unavailable on the remote app server.');
            }}
            onSteerInstruction={(_runId, instruction) => void control(runStatus === 'paused' ? 'resume' : 'steer', instruction)}
          />
        </div>}
      </> : workspace && !automations ? <><p>{workspace.runCount} sessions on this app server.</p>
        <label className="fleet-vm-dialog-field"><span>New Research prompt</span><textarea value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} rows={7} placeholder="Describe the authorized research task." /></label>
        <label className="fleet-vm-dialog-field"><span>Target</span><select value={machineId} onChange={(event) => setMachineId(event.currentTarget.value)}>
          {targets.length === 0 ? <option value="">No workspace targets</option> : null}
          {targets.map((target) => <option key={target.id} value={target.id} disabled={!target.ready}>{target.name}{target.ready ? '' : ' (configure in Fleet)'}</option>)}
        </select></label>
        {launchError ? <p className="settings-form-error" role="alert">{launchError}</p> : null}
        <button type="button" className="primary-button" disabled={starting || !prompt.trim() || !targets.find((target) => target.id === machineId)?.ready} onClick={() => void start()}>{starting ? 'Starting…' : 'Start Research'}</button>
      </> : <p>{catalog ? (automations ? 'Choose an automation.' : 'Choose a workspace or session.') : 'Loading remote app server…'}</p>}
    </div>
  </section>;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
