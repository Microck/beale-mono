import { useState } from 'react';
import type { JSX } from 'react';
import { BookOpen, Boxes, Brain, FileText, GitBranch, ListChecks, Server, Settings } from 'lucide-react';
import type { BealeAppServerWorkspaceDetails } from '@beale/app-server-runtime/protocol';
import { isResearchKitId, researchKitLabel } from '../../../shared/researchKits';
import { renderTraceProseText } from '../traces/traceMarkup';

type DetailsView = 'campaign' | 'resources' | 'rules' | 'targets' | 'overview';
type CampaignView = 'claims' | 'memories' | 'runbooks' | 'reports';

const campaignViews: Array<{ id: CampaignView; label: string; icon: typeof GitBranch }> = [
  { id: 'claims', label: 'Claims', icon: GitBranch },
  { id: 'memories', label: 'Memories', icon: Brain },
  { id: 'runbooks', label: 'Runbooks', icon: BookOpen },
  { id: 'reports', label: 'Reports', icon: FileText }
];

const views: Array<{ id: DetailsView; label: string; icon: typeof GitBranch }> = [
  { id: 'campaign', label: 'Campaign', icon: GitBranch },
  { id: 'resources', label: 'Resources', icon: Boxes },
  { id: 'rules', label: 'Rules', icon: ListChecks },
  { id: 'targets', label: 'Targets', icon: Server },
  { id: 'overview', label: 'Settings', icon: Settings }
];

export function RemoteWorkspaceDetails({ details }: { details: BealeAppServerWorkspaceDetails }): JSX.Element {
  const [view, setView] = useState<DetailsView>('campaign');
  const [campaignView, setCampaignView] = useState<CampaignView>('claims');
  const workspaceName = details.scope?.name ?? details.workspace.name;
  const claims = [...details.memory.leads, ...details.memory.findings];
  return <main className={`workspace-dashboard wide-content-container remote-workspace-details${view === 'campaign' ? ' campaign-active' : ''}`} aria-label="Workspace dashboard">
    <div className="workspace-dashboard-tabs research-side-view-tabs pill-view-tabs" role="tablist" aria-label="Workspace dashboard views">
      {views.map(({ id, label, icon: Icon }) => <div className={`research-side-view-tab provider-settings-tab workspace-dashboard-tab${view === id ? ' active' : ''}`} key={id}>
        <button type="button" className="research-side-view-tab-activate" role="tab" aria-selected={view === id} onClick={() => setView(id)}>
          <Icon aria-hidden="true" className="workspace-dashboard-tab-icon" size={14} /><span>{label}</span>
        </button>
      </div>)}
    </div>
    {view === 'campaign' ? <div className="workspace-campaign-subview-navigation">
      <div className="workspace-campaign-subview-tabs research-side-view-tabs pill-view-tabs" role="tablist" aria-label="Campaign views">
        {campaignViews.map(({ id, label, icon: Icon }) => <div className={`research-side-view-tab provider-settings-tab workspace-campaign-subview-tab${campaignView === id ? ' active' : ''}`} key={id}>
          <button type="button" className="research-side-view-tab-activate" role="tab" aria-selected={campaignView === id} onClick={() => setCampaignView(id)}>
            <Icon aria-hidden="true" size={14} /><span>{label}</span>
          </button>
        </div>)}
      </div>
    </div> : null}
    <section className="workspace-dashboard-panel remote-workspace-details-panel settings-form" role="tabpanel" aria-label={`${workspaceName} ${view === 'campaign' ? campaignView : view}`}>
      {view === 'campaign' && campaignView === 'claims' ? <>
        <header className="settings-form-heading"><h2>{workspaceName} Claims</h2><p>{claims.length} recorded claims.</p></header>
        <div className="remote-workspace-details-list">
          {claims.map((claim) => <article className="settings-form-squircle remote-workspace-details-item" key={claim.id}>
            <strong>{claim.title}</strong><small>{claim.projection === 'finding' ? 'Finding' : 'Lead'} · {claim.maturity}</small>
            {claim.summary ? <p>{claim.summary}</p> : null}
          </article>)}
          {claims.length === 0 ? <p>No workspace claims yet.</p> : null}
        </div>
      </> : null}
      {view === 'campaign' && campaignView === 'memories' ? <>
        <header className="settings-form-heading"><h2>{workspaceName} Memories</h2><p>{details.memory.nodeCount} recorded memories.</p></header>
        <div className="remote-workspace-details-list">
          {details.memory.nodes.map((node) => <article className="settings-form-squircle remote-workspace-details-item" key={node.id}>
            <strong>{node.title}</strong><small>{node.type} · {node.status}</small>
            {node.summary ? <p>{node.summary}</p> : null}
          </article>)}
          {details.memory.nodes.length === 0 ? <p>No workspace memories yet.</p> : null}
        </div>
      </> : null}
      {view === 'campaign' && campaignView === 'runbooks' ? <>
        <header className="settings-form-heading"><h2>{workspaceName} Runbooks</h2><p>{details.runbooks.length} recorded runbooks.</p></header>
        <div className="remote-workspace-details-list">
          {details.runbooks.map((runbook) => <article className="settings-form-squircle remote-workspace-details-item" key={runbook.id}>
            <strong>{runbook.title}</strong>{runbook.purpose ? <p>{runbook.purpose}</p> : null}
          </article>)}
          {details.runbooks.length === 0 ? <p>No workspace runbooks yet.</p> : null}
        </div>
      </> : null}
      {view === 'campaign' && campaignView === 'reports' ? <>
        <header className="settings-form-heading"><h2>{workspaceName} Reports</h2><p>{details.reports.length} recorded reports.</p></header>
        <div className="remote-workspace-details-list">
          {details.reports.map((report) => <article className="settings-form-squircle remote-workspace-details-item" key={report.id}>
            <strong>{report.title}</strong><small>{report.status === 'stale' ? 'Stale' : 'Complete'}</small>
            {report.summary ? <p>{report.summary}</p> : null}
          </article>)}
          {details.reports.length === 0 ? <p>No workspace reports yet.</p> : null}
        </div>
      </> : null}
      {view === 'resources' ? <>
        <header className="settings-form-heading"><h2>{workspaceName} Resources</h2><p>Authorized scope recorded on this app server.</p></header>
        <div className="remote-workspace-details-list">
          {details.scope?.resources.map((resource) => <article className="settings-form-squircle remote-workspace-details-item" key={resource.id}>
            <strong>{resource.value ?? (resource.sensitivity === 'secret' ? 'Private resource' : 'Local resource')}</strong><small>{resource.kind} · {resource.direction === 'in_scope' ? 'In scope' : 'Out of scope'}</small>
          </article>)}
          {!details.scope?.resources.length ? <p>No workspace resources recorded.</p> : null}
        </div>
      </> : null}
      {view === 'rules' ? <>
        <header className="settings-form-heading"><h2>{workspaceName} Rules</h2><p>Operating constraints for research in this workspace.</p></header>
        <div className="settings-form-squircle remote-workspace-details-list">
          {details.rules.length ? <ol aria-label="Workspace rules" className="workspace-rule-list">{details.rules.map((rule) => <li key={rule.id}>{rule.text}</li>)}</ol> : <p>No workspace rules recorded.</p>}
        </div>
      </> : null}
      {view === 'targets' ? <>
        <header className="settings-form-heading"><h2>Targets</h2><p>Targets enabled for New Research on this app server.</p></header>
        <div className="settings-form-squircle settings-form-control-list">
          {details.targets.map((target) => <div className="settings-form-control-row" key={target.id}>
            <span className="settings-form-control-copy"><strong>{target.name}</strong><small>{target.ready ? 'Ready' : 'Configure in Fleet before use'}</small></span>
          </div>)}
          {details.targets.length === 0 ? <p>No workspace targets enabled.</p> : null}
        </div>
      </> : null}
      {view === 'overview' ? <>
        <header className="settings-form-heading"><h2>{workspaceName} Settings</h2><p>Workspace context on this app server.</p></header>
        <div className="settings-form-squircle settings-form-control-list">
          <DetailRow label="Research Profile" value={details.workspace.researchProfileId} />
          <DetailRow label="Research Kit" value={isResearchKitId(details.workspace.researchKitId) ? researchKitLabel(details.workspace.researchKitId) : details.workspace.researchKitId} />
          <DetailRow label="Research Subject" value={details.researchSubject || 'None recorded'} />
          <DetailRow label="Scope Owner" value={details.scope?.owner || 'None recorded'} />
          <DetailRow label="Workspace Name" value={workspaceName} />
          <DetailRow label="Sessions" value={String(details.workspace.runCount)} />
          {details.scope?.expiresAt ? <DetailRow label="Scope Expires" value={details.scope.expiresAt} /> : null}
          <div className="settings-form-control-row remote-workspace-guidance">
            <span className="settings-form-control-copy"><strong>Workspace Guidance</strong></span>
            <div>{details.scope?.descriptionMarkdown ? renderTraceProseText(details.scope.descriptionMarkdown, 'agent_output') : 'No workspace guidance recorded.'}</div>
          </div>
        </div>
      </> : null}
    </section>
  </main>;
}

function DetailRow({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="settings-form-control-row remote-workspace-details-row"><span className="settings-form-control-copy"><strong>{label}</strong></span><span>{value}</span></div>;
}
