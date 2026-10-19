import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { BealeAppServerWorkspaceDetails, FleetRemoteCatalog, FleetRemoteResearchInput } from '@beale/app-server-runtime/protocol';
import type { ResearchGoalSuggestionsByPhase, ResearchGoalSuggestionStateByPhase, ResearchModelEffortLevel, ResearchModelProviderId, ResearchProviderModelCatalog, ResearchProviderStatus, ProviderModelDefaults, StartRunInput } from '../../../shared/types';
import { ResearchSettingsForm } from '../sessions/StartRunForm';
import { WorkspaceSidebar } from '../workspaces/WorkspaceSidebar';
import { CommentaryView } from '../commentary/CommentaryView';
import { FleetBrowserSideView } from '../research/FleetBrowserSideView';
import { buildTraceDisplayEventsForAgentPath } from '../../view-models/traceDisplay';
import { mergeRemoteSessionHistory, remoteRunDetail, remoteRunStatus, remoteSessionHistoryPage, remoteWorkspaceRegistry } from './remoteFleetProjection';
import type { RemoteSessionHistoryPage } from './remoteFleetProjection';
import { RemoteWorkspaceDetails } from './RemoteWorkspaceDetails';

const NO_LOCAL_PROVIDER_STATUSES: ResearchProviderStatus[] = [];
interface RemoteGoalState {
  key: string;
  suggestions: ResearchGoalSuggestionsByPhase;
  loading: ResearchGoalSuggestionStateByPhase<boolean>;
  errors: ResearchGoalSuggestionStateByPhase<string | null>;
}

export function RemoteFleetSidebar({ catalog, serverName, selectedWorkspaceId, selectedSessionId, automations, collapsed, serverSelector, onSelect, onStartNewResearch, onOpenQuickChat, onResizePointerDown }: {
  catalog: FleetRemoteCatalog | null;
  serverName: string;
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  automations: boolean;
  collapsed: boolean;
  serverSelector: ReactNode;
  onSelect: (workspaceId: string, sessionId: string | null) => void;
  onStartNewResearch: (workspaceId: string) => void;
  onOpenQuickChat: () => void;
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
    onStartNewResearch={() => selectedWorkspaceId && onStartNewResearch(selectedWorkspaceId)}
    onStartNewResearchForWorkspace={(workspace) => onStartNewResearch(workspace.workspaceId)}
    onOpenQuickChat={onOpenQuickChat}
  />;
}

export function RemoteFleetWorkspace({ serverId, serverName, catalog, workspaceId, sessionId, newResearchOpen, automations, error, onLaunched }: {
  serverId: string;
  serverName: string;
  catalog: FleetRemoteCatalog | null;
  workspaceId: string | null;
  sessionId: string | null;
  newResearchOpen: boolean;
  automations: boolean;
  error: string | null;
  onLaunched: (workspaceId: string, sessionId: string) => void;
}): JSX.Element {
  const [detail, setDetail] = useState<unknown>(null);
  const [workspaceDetails, setWorkspaceDetails] = useState<BealeAppServerWorkspaceDetails | null>(null);
  const [workspaceDetailsError, setWorkspaceDetailsError] = useState<string | null>(null);
  const [olderPages, setOlderPages] = useState<RemoteSessionHistoryPage[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const suggestionKey = `${serverId}:${workspaceId ?? ''}`;
  const suggestionKeyRef = useRef(suggestionKey);
  suggestionKeyRef.current = suggestionKey;
  const suggestionRequestsRef = useRef(new Map<string, number>());
  const [goalState, setGoalState] = useState<RemoteGoalState>({ key: suggestionKey, suggestions: {}, loading: {}, errors: {} });
  const visibleGoalState = goalState.key === suggestionKey ? goalState : { key: suggestionKey, suggestions: {}, loading: {}, errors: {} };
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [browserSelection, setBrowserSelection] = useState<string | null>(null);
  const browserOpen = browserSelection === `${serverId}:${sessionId ?? ''}`;
  const showingWorkspaceDetails = Boolean(workspaceId && !sessionId && !newResearchOpen && !automations);
  useEffect(() => { setBrowserSelection(null); }, [serverId, sessionId]);
  useEffect(() => {
    setWorkspaceDetails(null);
    setWorkspaceDetailsError(null);
    if (!workspaceId || !showingWorkspaceDetails) return undefined;
    let active = true;
    const refresh = (): void => {
      void window.beale.getFleetRemoteWorkspaceDetails(serverId, workspaceId)
        .then((value) => { if (active) { setWorkspaceDetails(value); setWorkspaceDetailsError(null); } })
        .catch((caught: unknown) => { if (active) { setWorkspaceDetails(null); setWorkspaceDetailsError(message(caught)); } });
    };
    refresh();
    const interval = window.setInterval(refresh, 10_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [serverId, workspaceId, showingWorkspaceDetails]);
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
  const allowedTargets = new Set((workspaceId ? catalog?.workspaceTargets[workspaceId] ?? ['local'] : []).map((targetId) => (
    targetId === 'browser:in-agent' ? 'local' : targetId
  )));
  const targets = [
    { id: 'local', name: 'Local', ready: true, detail: 'Run on this app server' },
    ...(catalog?.browsers.filter((browser) => browser.enabled && browser.id !== 'in-agent').map((browser) => ({
      id: `browser:${browser.id}`, name: browser.name, ready: true, detail: 'Separate CDP profile',
    })) ?? []),
    ...(catalog?.machines.flatMap((machine) => [
      ...(machine.canRun ? [{ id: `vm:run:${machine.id}`, name: `${machine.name} · Run`, ready: machine.sshConfigured && machine.state !== 'unknown' && !machine.owner, detail: 'Run commands in this VM' }] : []),
      ...(machine.canClone ? [{ id: `vm:clone:${machine.id}`, name: `${machine.name} · Clone`, ready: machine.sshConfigured && machine.state === 'stopped' && !machine.owner, detail: 'Clone for this session' }] : []),
    ]) ?? []),
  ].filter((target) => allowedTargets.has(target.id));
  const providerCatalogKey = JSON.stringify(catalog?.providerCatalog ?? null);
  const providerEntries = useMemo(() => catalog?.providerCatalog.providers ?? [], [providerCatalogKey]);
  const providerCatalog: ResearchProviderModelCatalog[] = useMemo(() => providerEntries.filter((provider) => isResearchProviderId(provider.providerId)).map((provider) => ({
    providerId: provider.providerId as ResearchModelProviderId,
    providerName: provider.providerName,
    defaultSmallModel: provider.defaultSubagentModel ?? undefined,
    models: provider.models.map((model) => ({ id: model.id, name: model.name, reasoning: model.reasoning,
      effortLevels: model.effortLevels.filter(isResearchEffort), contextWindow: 0, maxTokens: 0 }))
  })), [providerEntries]);
  const providerIds = useMemo(() => providerEntries.filter((provider) => isResearchProviderId(provider.providerId))
    .map((provider) => provider.providerId as ResearchModelProviderId), [providerEntries]);
  const providerDefaults: Partial<Record<ResearchModelProviderId, ProviderModelDefaults>> = useMemo(() => Object.fromEntries(providerEntries.filter((provider) => isResearchProviderId(provider.providerId) && provider.defaultLeadModel).map((provider) => [provider.providerId, {
    largeModel: provider.defaultLeadModel, smallModel: provider.defaultSubagentModel ?? provider.defaultLeadModel,
    reasoningEffort: isResearchEffort(provider.defaultReasoningEffort) ? provider.defaultReasoningEffort : 'high'
  }])), [providerEntries]);
  const defaultProviderId = isResearchProviderId(catalog?.providerCatalog.defaultProviderId)
    && providerIds.includes(catalog!.providerCatalog.defaultProviderId as ResearchModelProviderId)
    ? catalog!.providerCatalog.defaultProviderId as ResearchModelProviderId : providerIds[0] ?? null;
  const providerRiskAcknowledgements = useMemo(() => Object.fromEntries(providerEntries.filter((provider) => provider.riskAcknowledged === true && isResearchProviderId(provider.providerId))
    .map((provider) => [provider.providerId, true])) as Partial<Record<ResearchModelProviderId, true>>, [providerEntries]);
  const mergedDetail = useMemo(() => mergeRemoteSessionHistory(detail, olderPages), [detail, olderPages]);
  const runDetail = useMemo(() => remoteRunDetail(mergedDetail), [mergedDetail]);
  const events = useMemo(() => runDetail ? buildTraceDisplayEventsForAgentPath(runDetail, null) : [], [runDetail]);
  const runStatus = runDetail?.run.status ?? remoteRunStatus(session?.status ?? '');
  const loadGoalSuggestions = (phase: string, refresh = false): void => {
    if (!workspaceId || !refresh && (visibleGoalState.loading[phase] || visibleGoalState.suggestions[phase] || visibleGoalState.errors[phase])) return;
    const key = suggestionKey;
    const requestId = (suggestionRequestsRef.current.get(phase) ?? 0) + 1;
    suggestionRequestsRef.current.set(phase, requestId);
    setGoalState((current) => {
      const base = current.key === key ? current : { key, suggestions: {}, loading: {}, errors: {} };
      return { ...base, loading: { ...base.loading, [phase]: true }, errors: { ...base.errors, [phase]: null } };
    });
    void window.beale.getFleetRemoteResearchGoalSuggestions(serverId, workspaceId, phase, refresh)
      .then((result) => {
        if (suggestionKeyRef.current !== key || suggestionRequestsRef.current.get(phase) !== requestId) return;
        setGoalState((current) => current.key !== key ? current : {
          ...current, suggestions: { ...current.suggestions, [phase]: result.suggestions },
          loading: { ...current.loading, [phase]: false }, errors: { ...current.errors, [phase]: null }
        });
      })
      .catch((caught: unknown) => {
        if (suggestionKeyRef.current !== key || suggestionRequestsRef.current.get(phase) !== requestId) return;
        setGoalState((current) => current.key !== key ? current : {
          ...current, loading: { ...current.loading, [phase]: false }, errors: { ...current.errors, [phase]: message(caught) }
        });
      });
  };
  const start = async (input: StartRunInput): Promise<void> => {
    if (!workspaceId || !input.promptMarkdown.trim() || starting || !input.targetIds?.length) return;
    setStarting(true);
    setLaunchError(null);
    try {
      const research: FleetRemoteResearchInput = {
        promptMarkdown: input.promptMarkdown, targetIds: input.targetIds,
        mode: input.mode, shellSafetyMode: input.shellSafetyMode,
        ...(input.goalEnabled ? { goal: { ...(input.goalObjective ? { objective: input.goalObjective } : {}) } } : {}),
        ...(input.provider ? { provider: { id: input.provider, model: input.model,
          reasoningEffort: input.reasoningEffort, fastMode: input.fastMode === true,
          ...(input.provider === 'openai-codex' ? { daybreakBlue: input.daybreakBlue === true } : {}) } } : {}),
        ...(input.workflowId ? { workflowId: input.workflowId } : {}),
        ...(input.collaboration ? { collaboration: { ...input.collaboration } } : {}),
        ...(input.budget.repeatSchedule ? { repeatSchedule: input.budget.repeatSchedule } : {})
      };
      const result = await window.beale.startFleetRemoteSession(serverId, workspaceId, research);
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
  return <section className={`remote-fleet-workspace${session ? ' remote-fleet-session' : ''}${showingWorkspaceDetails ? ' remote-fleet-details' : ''}${newResearchOpen ? ' remote-fleet-new-research' : ''}`} aria-label={`${serverName} research`}>
    <div className="remote-fleet-content">
      {!session && !showingWorkspaceDetails && !newResearchOpen ? <><p className="remote-fleet-eyebrow">{serverName}</p>
        <h1>{workspace?.name ?? (automations ? 'Automations' : 'Research')}</h1></> : null}
      {error ? <p className="settings-form-error" role="alert">{error}</p> : null}
      {showingWorkspaceDetails ? workspaceDetails?.workspace.workspaceId === workspaceId
        ? <RemoteWorkspaceDetails key={`${serverId}:${workspaceId}`} details={workspaceDetails} />
        : <p className="remote-fleet-details-status" role={workspaceDetailsError ? 'alert' : 'status'}>{workspaceDetailsError ?? 'Loading workspace details…'}</p>
      : null}
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
      </> : workspace && !automations && newResearchOpen ? <>
        {launchError ? <p className="settings-form-error remote-research-error" role="alert">{launchError}</p> : null}
        {providerIds.length === 0 ? <p className="settings-form-error remote-research-error" role="alert">Configure a research provider on this app server before starting research.</p> : null}
        <ResearchSettingsForm
          key={`${serverId}:${workspaceId}`} researchProfile={null} formIdentity={`${serverId}:${workspaceId}`}
          fleetWorkspaceId={workspaceId ?? undefined} remoteTargetChoices={targets} appServerName={serverName} workspaceName={workspace.name}
          openAiStatus={null} defaultProviderId={defaultProviderId} providerModelDefaults={providerDefaults}
          providerPolicyRiskAcknowledgements={providerRiskAcknowledgements} requireCyberPolicyAcknowledgement
          researchProviderStatuses={NO_LOCAL_PROVIDER_STATUSES} providerModelCatalog={providerCatalog} configuredProviderIds={providerIds}
          researchGoalSuggestions={visibleGoalState.suggestions} researchGoalSuggestionsLoading={visibleGoalState.loading}
          researchGoalSuggestionErrors={visibleGoalState.errors}
          onLoadResearchGoalSuggestions={(phase) => loadGoalSuggestions(phase)}
          onRetryResearchGoalSuggestions={(phase) => loadGoalSuggestions(phase, true)}
          onSelectResearchGoalSuggestion={(phase, suggestion) => setGoalState((current) => current.key !== suggestionKey ? current : {
            ...current, suggestions: { ...current.suggestions, [phase]: current.suggestions[phase]?.filter((candidate) => candidate !== suggestion) ?? [] }
          })}
          presentation="session" busy={starting} onSubmit={start}
          generatePrompt={async (input) => {
            if (!workspaceId) throw new Error('Choose a workspace.');
            const expanded = await window.beale.expandFleetRemoteResearchPrompt(serverId, workspaceId, {
              promptMarkdown: input.draftPromptMarkdown?.trim() || input.goalSentence?.trim() || '',
              ...(input.researchPhase ? { phase: input.researchPhase } : {}),
              ...(input.provider && input.model ? { provider: { id: input.provider, model: input.model } } : {})
            });
            return { requestId: input.requestId ?? '', promptMarkdown: expanded.promptMarkdown };
          }}
        />
      </> : !showingWorkspaceDetails ? <p>{catalog ? (automations ? 'Choose an automation.' : 'Choose a workspace or session.') : 'Loading remote app server…'}</p> : null}
    </div>
  </section>;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function isResearchProviderId(value: unknown): value is ResearchModelProviderId {
  return value === 'openai-codex' || value === 'anthropic' || value === 'xai' || value === 'zai' || value === 'openrouter';
}
function isResearchEffort(value: unknown): value is ResearchModelEffortLevel {
  return value === 'off' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max';
}
