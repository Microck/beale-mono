import type { AppServerSessionSummary } from './appServerCliClient';

// The app-server rejects operation requests larger than 512 KiB. Keep room for
// the registry operation envelope and workspace identifiers.
export const REGISTRY_RECONCILE_BATCH_BYTES = 384 * 1024;

export function canonicalSessionRegistryBatches(
  sessions: readonly AppServerSessionSummary[]
): AppServerSessionSummary[][] {
  const batches: AppServerSessionSummary[][] = [];
  let batch: AppServerSessionSummary[] = [];
  let batchBytes = 2; // JSON array brackets.

  for (const session of sessions) {
    const projected = canonicalSessionRegistrySummary(session);
    const projectedBytes = Buffer.byteLength(JSON.stringify(projected), 'utf8');
    if (batch.length && batchBytes + projectedBytes + 1 > REGISTRY_RECONCILE_BATCH_BYTES) {
      batches.push(batch);
      batch = [];
      batchBytes = 2;
    }
    batchBytes += projectedBytes + (batch.length ? 1 : 0);
    batch.push(projected);
  }

  if (batch.length) batches.push(batch);
  return batches;
}

function canonicalSessionRegistrySummary(session: AppServerSessionSummary): AppServerSessionSummary {
  // The sidebar projection uses only these metadata fields. In particular,
  // appServerRestartLaunch repeats the prompt and can make a batch exceed the
  // app-server request limit even with a modest number of sessions.
  const { bealeRun, shellSafetyMode } = session.metadata;
  return {
    schemaVersion: session.schemaVersion,
    id: session.id,
    workspaceId: session.workspaceId,
    status: session.status,
    title: session.title,
    prompt: session.prompt,
    summary: session.summary,
    provider: session.provider,
    model: session.model,
    reasoningEffort: session.reasoningEffort,
    workflowId: session.workflowId,
    profile: session.profile,
    metadata: {
      ...(bealeRun !== undefined ? { bealeRun } : {}),
      ...(shellSafetyMode !== undefined ? { shellSafetyMode } : {})
    },
    finalDisposition: session.finalDisposition,
    attempts: [],
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    updatedAt: session.updatedAt,
    revision: session.revision,
    lastMessageAt: session.lastMessageAt
  };
}
