import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { BealeAppServerWorkspaceDetails, BealeWorkspaceResearchClaim } from '@beale/app-server-runtime/protocol';
import type {
  AppServerFindingSummary, AppServerMemorySummary, AppServerMemoryNodeSummary,
  AppServerReportSummary, AppServerRunbookSummary, ScopeAssetKind, WorkspaceScopeVersion
} from '../../../shared/types';
import { isResearchKitId } from '../../../shared/researchKits';
import { Modal } from '../../app/Modal';
import { WorkspaceUnderstandingView } from '../workspaces/WorkspaceUnderstandingView';
import type { WorkspaceDashboardView } from '../workspaces/WorkspaceUnderstandingView';

const RESOURCE_KINDS: readonly ScopeAssetKind[] = ['repo', 'documentation', 'binary', 'service', 'domain', 'other'];

function remoteScope(details: BealeAppServerWorkspaceDetails): WorkspaceScopeVersion | null {
  const scope = details.scope;
  if (!scope) return null;
  return {
    id: scope.id, version: 1, status: 'active', workspaceName: scope.name,
    scopeOwner: scope.owner, descriptionMarkdown: scope.descriptionMarkdown,
    rulesMarkdown: '', activeFrom: '', expiresAt: scope.expiresAt,
    createdAt: '', createdBy: '',
    assets: scope.resources.map((resource) => ({
      id: resource.id, scopeVersionId: scope.id, createdAt: '',
      kind: RESOURCE_KINDS.includes(resource.kind as ScopeAssetKind) ? resource.kind as ScopeAssetKind : 'other',
      direction: resource.direction, value: resource.value ?? 'Private resource',
      sensitivity: resource.sensitivity
    }))
  };
}

function remoteClaim(claim: BealeWorkspaceResearchClaim, workspaceId: string): AppServerFindingSummary {
  const maturity = ['proposed', 'observed', 'reproduced', 'verified', 'refuted'].includes(claim.maturity)
    ? claim.maturity as AppServerFindingSummary['maturity'] : 'proposed';
  return {
    id: claim.id, workspaceId, subjectId: '', memoryNodeId: null, originSessionId: null,
    projection: claim.projection, maturity, freshness: claim.freshness === 'stale' ? 'stale' : 'current',
    workflow: ['open', 'active', 'reporting', 'published', 'closed'].includes(claim.workflow)
      ? claim.workflow as AppServerFindingSummary['workflow'] : 'open',
    rating: claim.rating, classification: claim.classification, componentClaimIds: claim.componentClaimIds,
    title: claim.title, summary: claim.summary, impact: claim.impact,
    securityTracking: claim.securityTracking ? {
      ...claim.securityTracking,
      reachability: { ...claim.securityTracking.reachability, evidenceIds: [], assessorId: null,
        sourceRevision: null, environmentFingerprint: null },
      riskDecisions: [],
      cvssAssessments: claim.securityTracking.cvssAssessments.map((assessment) => ({
        ...assessment, assessorId: '', environmentFingerprint: null
      }))
    } : null, status: maturity === 'proposed' ? 'hypothesis'
      : maturity === 'refuted' ? 'rejected' : maturity,
    operatorOverride: false,
    staleFromStatus: null, confidence: claim.confidence, sourceRevision: null,
    environmentFingerprint: null, reproductionRunbookId: null, reportId: null,
    disclosureReference: null, staleReason: null, duplicateOfClaimId: null,
    duplicateMarkedAt: null, duplicateClaims: [], evidence: [], transitions: [], authors: [],
    createdAt: claim.createdAt, updatedAt: claim.updatedAt, revision: claim.revision
  };
}

function remoteMemory(details: BealeAppServerWorkspaceDetails): AppServerMemorySummary {
  const { workspaceId } = details.workspace;
  const name = details.scope?.name ?? details.workspace.name;
  const nodes: AppServerMemoryNodeSummary[] = details.memory.nodes.map((node) => ({
    id: node.id, sessionIds: node.sessionIds, workspaces: [{ id: workspaceId, name }],
    subjectId: '', subjectName: details.researchSubject, type: node.type, title: node.title,
    summary: node.summary, body: '', status: node.status, confidence: node.confidence,
    assetIds: [], tags: node.tags, attributes: {}, evidenceRefs: [],
    createdAt: node.createdAt, updatedAt: node.updatedAt, revision: node.revision,
    duplicateMemories: node.duplicateMemories, authors: []
  }));
  const runbooks: AppServerRunbookSummary[] = details.runbooks.map((runbook) => ({
    id: runbook.id, workspaceId, workspaceName: name, subjectId: null, subjectName: details.researchSubject || null,
    sessionId: null, title: runbook.title, purpose: runbook.purpose, artifactId: '',
    revision: 1, contentRevision: 1, execution: { runCount: 0, completedRunCount: 0,
      executedCellCount: 0, latest: null, latestSuccessfulRunId: null },
    revisions: [], createdAt: runbook.updatedAt, updatedAt: runbook.updatedAt, authors: []
  }));
  const reports: AppServerReportSummary[] = details.reports.map((report) => ({
    id: report.id, workspaceId, workspaceName: name, subjectId: null, subjectName: details.researchSubject || null,
    sessionId: null, title: report.title, summary: report.summary, status: report.status,
    triageStatus: 'editing', artifactId: '', submissionPacket: null, recording: null,
    revision: 1, revisions: [], createdAt: report.updatedAt, updatedAt: report.updatedAt, authors: []
  }));
  const leads = details.memory.leads.map((claim) => remoteClaim(claim, workspaceId));
  const findings = details.memory.findings.map((claim) => remoteClaim(claim, workspaceId));
  return {
    status: details.memory.status === 'ready' || details.memory.status === 'empty'
      || details.memory.status === 'missing' || details.memory.status === 'error' ? details.memory.status : 'ready',
    source: 'app_server_sqlite', contextWorkspaceId: workspaceId, contextSubjectId: '',
    databasePath: '', storageRoot: '', artifactDirectoryPath: '', databaseSizeBytes: 0,
    nodeCount: details.memory.nodeCount, edgeCount: 0, evidenceRefCount: 0,
    storageArtifactCount: 0, runbookCount: runbooks.length, reportCount: reports.length,
    latestNodeUpdatedAt: nodes.reduce<string | null>((latest, node) =>
      !latest || node.updatedAt > latest ? node.updatedAt : latest, null),
    nodeTypeCounts: details.memory.nodeTypeCounts, nodeStatusCounts: {},
    nodes, edges: [], runbooks, reports, leads, findings,
    campaign: { nodes: [], edges: [], coverageGaps: [], contradictions: [],
      momentum: { state: 'empty', reason: '', supportingNodeIds: [] }, nextActions: [],
      counts: { leads: leads.length, findings: findings.length,
        verifiedFindings: findings.filter((claim) => claim.maturity === 'verified').length,
        disclosedFindings: 0, coverageGaps: 0, contradictions: 0 } },
    directories: [], lastError: null
  };
}

export function RemoteWorkspaceDetails({ details, initialView = 'board' }: { details: BealeAppServerWorkspaceDetails; initialView?: WorkspaceDashboardView }): JSX.Element {
  const [selected, setSelected] = useState<{ title: string; summary: string } | null>(null);
  const scope = useMemo(() => remoteScope(details), [details]);
  const memory = useMemo(() => remoteMemory(details), [details]);
  const workspaceName = scope?.workspaceName ?? details.workspace.name;
  return <>
    <WorkspaceUnderstandingView
      busy={false}
      initialView={initialView}
      readOnly
      remoteTargets={details.targets}
      appServerMemory={memory}
      activeScope={scope}
      workspaceRules={details.rules.map((rule) => ({
        ...rule, workspaceId: details.workspace.workspaceId, createdAt: '', createdBy: ''
      }))}
      researchKitId={isResearchKitId(details.workspace.researchKitId) ? details.workspace.researchKitId : 'general'}
      researchProfileLabel={details.workspace.researchProfileId === 'security-research'
        ? 'Security' : details.workspace.researchProfileId}
      researchSubjectName={details.researchSubject}
      workspaceId={details.workspace.workspaceId}
      workspaceName={workspaceName}
      runs={[]}
      onOpenClaim={(id) => {
        const claim = [...details.memory.leads, ...details.memory.findings].find((item) => item.id === id);
        if (claim) setSelected({ title: claim.title, summary: claim.summary });
      }}
      onOpenMemory={(id) => {
        const node = details.memory.nodes.find((item) => item.id === id);
        if (node) setSelected({ title: node.title, summary: node.summary });
      }}
      onOpenRunbook={(id) => {
        const runbook = details.runbooks.find((item) => item.id === id);
        if (runbook) setSelected({ title: runbook.title, summary: runbook.purpose });
      }}
      onOpenReport={(report) => setSelected({ title: report.title, summary: report.summary })}
    />
    {selected ? <Modal title={selected.title} onClose={() => setSelected(null)}>
      <p>{selected.summary || 'No summary recorded.'}</p>
    </Modal> : null}
  </>;
}
