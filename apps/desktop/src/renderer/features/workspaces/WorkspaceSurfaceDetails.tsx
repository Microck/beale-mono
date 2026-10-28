import { useId, useState, type JSX } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import type { BealeWorkspaceSurfaceMap } from '@beale/app-server-runtime/protocol';
import type { RepositoryCloneMode, ResearchProviderModelCatalog, ScopeAssetInput, WorkspaceScopeVersion } from '@shared/types';
import type { MapSurface } from '../../view-models/surfaceMap';
import { errorMessage } from '../../lib/errors';
import { researchModelDisplayName } from '../../lib/formatting';
import { Modal } from '../../app/Modal';
import { ProviderIcon } from '../../app/ProviderIcon';
import { ResourcePriorArtView } from './ResourcePriorArtView';
import { WorkspaceResourceEditor, workspaceResearchSurfaceItems } from './WorkspaceUnderstandingView';

const DETAIL_VIEWS = ['Breakdown', 'Recon', 'Threat Model', 'Resources'] as const;
type DetailView = typeof DETAIL_VIEWS[number];

function DetailText({ label, value }: { label: string; value: string | undefined }): JSX.Element | null {
  return value?.trim() ? <div className="workspace-surface-detail-text"><h4>{label}</h4><p>{value}</p></div> : null;
}

function SurfaceListSection({ title, values, emptyMessage }: {
  title: string;
  values: readonly string[];
  emptyMessage: string;
}): JSX.Element {
  return <section className="workspace-surface-details-section workspace-surface-details-list">
    <h3>{title}</h3>
    {values.length ? <ul>{values.map((value, index) => <li key={`${value}:${index}`}>{value}</li>)}</ul>
      : <p className="workspace-surface-details-muted">{emptyMessage}</p>}
  </section>;
}

export function WorkspaceSurfaceDetails({ surface, map, workspaceId = '', activeScope = null, repositoryCheckouts,
  providerModelCatalog = [],
  readOnly = false, initialView = 'Breakdown', onChangeResource, onCloneRepository, onClose }: {
  surface: MapSurface;
  map: BealeWorkspaceSurfaceMap;
  workspaceId?: string;
  activeScope?: WorkspaceScopeVersion | null;
  repositoryCheckouts?: Readonly<Record<string, string>>;
  providerModelCatalog?: readonly ResearchProviderModelCatalog[];
  readOnly?: boolean;
  initialView?: DetailView;
  onChangeResource?: (assetIds: string[], asset: ScopeAssetInput | null) => Promise<void>;
  onCloneRepository?: (assetId: string, mode: RepositoryCloneMode) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const coverage = surface.foundation?.coverage;
  const agents = map.agents.filter((agent) => agent.surfaceId === surface.id);
  const status = surface.resourceDirection === 'out_of_scope' ? 'Out of scope'
    : surface.progressBlocker ? 'Blocked' : surface.coverageState.covered ? 'Covered'
    : surface.firstTouchedAt ? 'In progress' : 'Untouched';
  const firstTouchedModel = surface.firstTouchedModel?.trim() || null;
  const firstTouchedModelName = firstTouchedModel
    ? researchModelDisplayName(surface.firstTouchedProvider ?? null, firstTouchedModel, providerModelCatalog) : 'Unknown';
  const resourceItem = surface.scopeAssetId ? workspaceResearchSurfaceItems(activeScope?.assets ?? [], repositoryCheckouts)
    .find((item) => item.assetIds.includes(surface.scopeAssetId!)) ?? null : null;
  const detailViews: readonly DetailView[] = surface.parentId === null && surface.resourceKind
    ? DETAIL_VIEWS : DETAIL_VIEWS.filter((view) => view !== 'Resources');
  const tabId = useId();
  const [selection, setSelection] = useState<{ surfaceId: string; view: DetailView }>({
    surfaceId: surface.id, view: detailViews.includes(initialView) ? initialView : 'Breakdown'
  });
  const activeView = selection.surfaceId === surface.id ? selection.view : 'Breakdown';
  const [resourceEditState, setResourceEditState] = useState({ dirty: false, pending: false });
  const [pendingNavigation, setPendingNavigation] = useState<DetailView | 'back' | null>(null);
  const [cloneMode, setCloneMode] = useState<RepositoryCloneMode | null>(null);
  const [clonePending, setClonePending] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const navigate = (view: DetailView | 'back'): void => {
    if (resourceEditState.pending) return;
    if (resourceEditState.dirty && activeView === 'Resources') { setPendingNavigation(view); return; }
    if (view === 'back') onClose();
    else setSelection({ surfaceId: surface.id, view });
  };

  return <aside className="workspace-surface-details main-session-side" aria-label="Surface details">
    <header className="workspace-surface-details-header research-side-nested-header is-campaign-item">
      <button className="is-icon-only" type="button" onClick={() => navigate('back')} aria-label="Back to Surfaces" title="Back to Surfaces">
        <ArrowLeft aria-hidden="true" size={17} />
      </button>
      <span className="research-side-nested-identity">
        <span className="research-side-nested-primary">
          <span className="research-side-nested-name" title={surface.name}>{surface.name}</span>
          <span className={`workspace-surface-details-status${surface.resourceDirection === 'out_of_scope' ? '' : surface.progressBlocker ? ' blocked' : surface.coverageState.covered ? ' covered' : ''}`}
            aria-label={`Surface status: ${status}`}>{status}</span>
        </span>
      </span>
    </header>
    <div className="workspace-surface-details-meta">
      <span className="workspace-surface-first-touch" title={surface.firstTouchedAt ? `First touched ${new Date(surface.firstTouchedAt).toLocaleString()}` : undefined}>
        {surface.firstTouchedAt ? <><span>First touched by</span><span className="memory-catalog-item-author">
          <span className="memory-catalog-item-author-provider">
            <ProviderIcon provider={surface.firstTouchedProvider || firstTouchedModel} size={15} aria-hidden="true" />
          </span>
          <span className="memory-catalog-item-author-model">{firstTouchedModelName}</span>
        </span></> : 'No first touch recorded'}
      </span>
      <span>{surface.updatedAt
        ? <>Updated <time dateTime={surface.updatedAt}>{new Date(surface.updatedAt).toLocaleString()}</time></>
        : 'Last update unknown'}</span>
    </div>
    <div className="workspace-surface-details-tabs" role="tablist" aria-label="Surface detail views">
      {detailViews.map((view, index) => <button key={view} id={`${tabId}-${view}`} type="button" role="tab"
        aria-selected={activeView === view} aria-controls={`${tabId}-panel`} tabIndex={activeView === view ? 0 : -1}
        onClick={() => navigate(view)}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % detailViews.length
            : event.key === 'ArrowLeft' ? (index - 1 + detailViews.length) % detailViews.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? detailViews.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          navigate(detailViews[next]!);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{view}</button>)}
    </div>
    <div className="workspace-surface-details-scroll" id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${activeView}`}>
      {activeView === 'Breakdown' ? <>
      <section className="workspace-surface-details-section">
        <h3>About</h3>
        <p className="workspace-surface-details-description">{surface.description.trim() || 'No description recorded.'}</p>
        {coverage ? <>
          <DetailText label="What we know" value={coverage.summary} />
          <DetailText label="Gaps" value={coverage.gaps} />
          <DetailText label="Possible leads" value={coverage.opportunities} />
        </> : null}
      </section>

      <SurfaceListSection title="Open Questions" values={coverage?.openQuestions ?? []}
        emptyMessage="No open questions recorded." />
      <SurfaceListSection title="Related Components" values={coverage?.unexploredConnections ?? []}
        emptyMessage="No related components recorded." />

      {surface.progressBlocker ? <section className="workspace-surface-details-section workspace-surface-details-blocker">
        <h3>Progress blocker</h3><p>{surface.progressBlocker.reason}</p>
        <small>Recorded by {surface.progressBlocker.actorId} on {new Date(surface.progressBlocker.setAt).toLocaleString()}</small>
      </section> : null}

      {surface.coverageState.unblockedFindingIds.length ? <section className="workspace-surface-details-section">
        <h3>Findings needing resolution</h3><p>{surface.coverageState.unblockedFindingIds.length} recorded</p>
      </section> : null}
      {agents.length ? <section className="workspace-surface-details-section">
        <h3>Active agents</h3>
        <ul className="workspace-surface-details-agents">{agents.map((agent) => <li key={`${agent.sessionId}:${agent.agentId}`}>
          <strong>{agent.agentId === 'root' ? 'Lead' : agent.agentId}</strong><span>{agent.sessionTitle}</span>
        </li>)}</ul>
      </section> : null}
      </> : activeView === 'Recon' ? <>
        <section className="workspace-surface-details-section">
          <h3>Discovery</h3>
          {surface.foundation?.discovery ? <p className="workspace-surface-details-description">{surface.foundation.discovery}</p>
            : <p className="workspace-surface-details-muted">No discovery note recorded.</p>}
        </section>
        <section className="workspace-surface-details-section workspace-surface-recon-list">
          <h3>Tech Stack</h3>
          {surface.foundation?.techStack?.length ? <ul>{surface.foundation.techStack.map((item, index) => <li key={`${item.technology}:${index}`}>
            <strong>{item.technology}</strong>
            {item.role ? <p>{item.role}</p> : null}
            <dl>
              {item.version ? <><dt>Version</dt><dd>{item.version}</dd></> : null}
              {item.environment ? <><dt>Environment</dt><dd>{item.environment}</dd></> : null}
              {item.evidence ? <><dt>Evidence</dt><dd>{item.evidence}</dd></> : null}
              {item.confidence !== 'unknown' ? <><dt>Basis</dt><dd>{item.confidence}</dd></> : null}
            </dl>
          </li>)}</ul> : <p className="workspace-surface-details-muted">No technologies mapped.</p>}
        </section>
        <section className="workspace-surface-details-section workspace-surface-recon-list">
          <h3>Bug History</h3>
          {surface.foundation?.bugHistory?.entries?.length ? <ul>{surface.foundation.bugHistory.entries.map((entry, index) => <li key={`${entry.identifier}:${index}`}>
            <strong>{entry.identifier}</strong>
            <p>{entry.impact}</p>
            <dl>
              {entry.affectedVersions ? <><dt>Affected versions</dt><dd>{entry.affectedVersions}</dd></> : null}
              {entry.reference ? <><dt>Reference</dt><dd>{entry.reference}</dd></> : null}
              {entry.notes ? <><dt>Notes</dt><dd>{entry.notes}</dd></> : null}
            </dl>
          </li>)}</ul> : <p className="workspace-surface-details-muted">No individual advisories recorded.</p>}
          <DetailText label="Earlier notes" value={surface.foundation?.bugHistory?.summary} />
          <DetailText label="Search limits" value={surface.foundation?.bugHistory?.limits} />
        </section>
      </> : activeView === 'Threat Model' ? <section className="workspace-surface-details-section">
        <h3>Threat Model</h3>
        {surface.foundation?.threatModel ? <>
          <DetailText label="Attacker control" value={surface.foundation.threatModel.attackerControl} />
          <DetailText label="Trust boundaries" value={surface.foundation.threatModel.trustBoundaries} />
          <DetailText label="Assets at risk" value={surface.foundation.threatModel.assetsAtRisk} />
          <DetailText label="Plausible impacts" value={surface.foundation.threatModel.plausibleImpacts} />
          <DetailText label="Assumptions" value={surface.foundation.threatModel.assumptions} />
        </> : <p className="workspace-surface-details-muted">No threat model recorded.</p>}
      </section> : <div className="workspace-surface-resource">
        {resourceItem && !readOnly && onChangeResource ? <WorkspaceResourceEditor
          key={resourceItem.asset.id}
          presentation="sidebar"
          initialAsset={resourceItem.asset}
          initialClonedDirectory={resourceItem.repositoryLocalPath}
          kind={resourceItem.asset.kind}
          onEditStateChange={setResourceEditState}
          onClose={onClose}
          onRemove={() => onChangeResource(resourceItem.assetIds, null)}
          onSubmit={(asset) => onChangeResource(resourceItem.assetIds, asset)}
        /> : <section className="workspace-surface-details-section">
          <h3>Resource details</h3>
          {surface.resourceKind ? <p><strong>Type</strong><span>{surface.resourceKind}</span></p> : null}
          {surface.resourceLocator ? <p><strong>Reference</strong><span>{surface.resourceLocator}</span></p> : null}
          {surface.resourceSource ? <p><strong>Source</strong><span>{surface.resourceSource.replaceAll('_', ' ')}</span></p> : null}
          {surface.resourceDirection ? <p><strong>Scope</strong><span>{surface.resourceDirection === 'in_scope' ? 'In scope' : surface.resourceDirection === 'out_of_scope' ? 'Out of scope' : 'Discovered'}</span></p> : null}
        </section>}
        {resourceItem?.repositoryCloned !== null && resourceItem?.repositoryCloned !== undefined ? <section className="workspace-surface-details-section">
          <h3>Repository checkout</h3>
          <p>{resourceItem.repositoryCloned ? 'Cloned' : 'Not cloned'}</p>
          {resourceItem.repositoryLocalPath ? <p className="workspace-surface-details-description">{resourceItem.repositoryLocalPath}</p> : null}
          {!readOnly && onCloneRepository && resourceItem.asset.direction === 'in_scope' && !resourceItem.repositoryCloned && resourceItem.repositoryCloneAssetId
            ? <button className="secondary-button workspace-surface-resource-clone" type="button" onClick={() => setCloneMode('deep')}>
              <Download aria-hidden="true" size={14} />Clone repository</button> : null}
          {cloneError ? <p className="form-error" role="alert">{cloneError}</p> : null}
        </section> : null}
        {resourceItem && workspaceId && !readOnly ? <ResourcePriorArtView key={resourceItem.asset.id}
          workspaceId={workspaceId} assetIds={resourceItem.assetIds} /> : null}
      </div>}
    </div>
    {pendingNavigation ? <Modal title="Discard resource changes?" onClose={() => setPendingNavigation(null)} footer={<>
      <button className="secondary-button" type="button" onClick={() => setPendingNavigation(null)}>Keep editing</button>
      <button className="primary-button" type="button" onClick={() => {
        const destination = pendingNavigation;
        setPendingNavigation(null);
        setResourceEditState({ dirty: false, pending: false });
        if (destination === 'back') onClose();
        else setSelection({ surfaceId: surface.id, view: destination });
      }}>Discard changes</button>
    </>}><p>Your unsaved resource edits will be discarded.</p></Modal> : null}
    {cloneMode && resourceItem?.repositoryCloneAssetId && onCloneRepository ? <Modal title="Clone repository"
      onClose={() => setCloneMode(null)} footer={<>
        <button className="secondary-button" type="button" disabled={clonePending} onClick={() => setCloneMode(null)}>Cancel</button>
        <button className="primary-button" type="button" disabled={clonePending} onClick={() => {
          setClonePending(true);
          setCloneError(null);
          void onCloneRepository(resourceItem.repositoryCloneAssetId!, cloneMode).then(() => setCloneMode(null),
            (caught: unknown) => setCloneError(errorMessage(caught))).finally(() => setClonePending(false));
        }}>{clonePending ? 'Cloning…' : 'Clone repository'}</button>
      </>}>
      <p>Choose how much Git history to keep for {resourceItem.label}.</p>
      <div className="settings-form-radio-list workspace-repository-clone-options">
        {(['deep', 'shallow'] as const).map((mode) => <label className="settings-form-control-row" key={mode}>
          <span className="settings-form-radio-copy"><strong>{mode === 'deep' ? 'Deep clone' : 'Shallow clone'}</strong>
            <small>{mode === 'deep' ? 'Complete history for research and prior-fix analysis.' : 'Current history tip only.'}</small></span>
          <input type="radio" name="surface-repository-clone-mode" value={mode} checked={cloneMode === mode}
            onChange={() => setCloneMode(mode)} />
        </label>)}
      </div>
      {cloneError ? <p className="form-error" role="alert">{cloneError}</p> : null}
    </Modal> : null}
  </aside>;
}
