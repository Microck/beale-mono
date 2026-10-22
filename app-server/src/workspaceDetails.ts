import { isAbsolute, win32 } from 'node:path';
import type { BealeAppServerWorkspaceDetails, BealeAppServerWorkspaceSummary, BealeWorkspaceMemoryCatalog, BealeWorkspaceSurfaceMap } from '@beale/app-server-runtime/protocol';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function projectWorkspaceDetails(
  workspace: BealeAppServerWorkspaceSummary,
  state: unknown,
  memory: BealeWorkspaceMemoryCatalog,
  memorySummary: unknown,
  targets: BealeAppServerWorkspaceDetails['targets'],
  surfaceMap: BealeWorkspaceSurfaceMap
): BealeAppServerWorkspaceDetails {
  const source = record(state);
  if (!source) throw new Error('Workspace state is unavailable.');
  const activeScope = record(source.activeScope);
  const subject = record(source.researchSubject);
  const summary = record(memorySummary);
  return {
    schemaVersion: 1,
    workspace,
    scope: activeScope ? {
      id: string(activeScope.id),
      name: string(activeScope.workspaceName) || workspace.name,
      owner: string(activeScope.scopeOwner),
      descriptionMarkdown: string(activeScope.descriptionMarkdown),
      expiresAt: typeof activeScope.expiresAt === 'string' ? activeScope.expiresAt : null,
      resources: Array.isArray(activeScope.assets) ? activeScope.assets.flatMap((value: unknown) => {
        const asset = record(value);
        if (!asset || typeof asset.id !== 'string' || typeof asset.kind !== 'string') return [];
        const locator = string(asset.value);
        const attributes = record(asset.attributes);
        const restricted = attributes?.legacyKind === 'credential_ref' || attributes?.legacyKind === 'account'
          || locator.startsWith('secret://') || locator.startsWith('credential://');
        const hostPath = isAbsolute(locator) || win32.isAbsolute(locator) || /^(?:file:|~[\\/]|\.\.?[\\/])/iu.test(locator)
          || asset.kind === 'repo' && !/^(?:https?:\/\/|ssh:\/\/|git@)/iu.test(locator);
        return [{
          id: asset.id,
          kind: asset.kind,
          direction: asset.direction === 'out_of_scope' ? 'out_of_scope' as const : 'in_scope' as const,
          value: restricted || hostPath ? null : locator,
          sensitivity: string(asset.sensitivity)
        }];
      }) : []
    } : null,
    researchSubject: string(subject?.name),
    rules: Array.isArray(source.workspaceRules) ? source.workspaceRules.flatMap((value: unknown) => {
      const rule = record(value);
      return rule && typeof rule.id === 'string' && typeof rule.text === 'string'
        ? [{ id: rule.id, text: rule.text }]
        : [];
    }) : [],
    memory,
    runbooks: Array.isArray(summary?.runbooks) ? summary.runbooks.flatMap((value: unknown) => {
      const runbook = record(value);
      return runbook && typeof runbook.id === 'string' && typeof runbook.title === 'string'
        ? [{ id: runbook.id, title: runbook.title, purpose: string(runbook.purpose), updatedAt: string(runbook.updatedAt) }]
        : [];
    }) : [],
    reports: Array.isArray(summary?.reports) ? summary.reports.flatMap((value: unknown) => {
      const report = record(value);
      return report && typeof report.id === 'string' && typeof report.title === 'string'
        ? [{ id: report.id, title: report.title, summary: string(report.summary),
          status: report.status === 'stale' ? 'stale' as const : 'complete' as const, updatedAt: string(report.updatedAt) }]
        : [];
    }) : [],
    targets,
    surfaceMap
  };
}
