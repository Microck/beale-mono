import type { RunDetail } from '@shared/types';
import { formatDurationHms, formatSessionDateTime, formatSessionStart, traceLabel } from '../lib/formatting';

export interface SessionConfigPill {
  label: string;
  tooltip: string;
}

export interface SessionDurationTiming {
  durationMs: number;
  durationLabel: string;
  durationTooltip: string;
}

export function sessionConfigPills(detail: RunDetail): SessionConfigPill[] {
  return [
    { label: traceLabel(detail.run.mode), tooltip: `Mode: ${traceLabel(detail.run.mode)}` },
    { label: traceLabel(detail.run.attemptStrategy), tooltip: `Strategy: ${traceLabel(detail.run.attemptStrategy)}` }
  ];
}

export function sessionDurationTiming(detail: RunDetail, nowMs: number): SessionDurationTiming | null {
  const updated = latestRunDetailDate(detail);
  if (!updated) return null;

  const intervals = detail.activityIntervals?.length
    ? detail.activityIntervals
    : detail.attempts.length
      ? detail.attempts.map((attempt, index) => ({
          startedAt: attempt.startedAt,
          endedAt: attempt.endedAt ?? detail.attempts[index + 1]?.startedAt ?? null
        }))
      : [{ startedAt: detail.run.startedAt ?? detail.run.createdAt, endedAt: detail.run.endedAt }];
  const durationMs = intervals.reduce((total, interval, index) => {
    const startedMs = Date.parse(interval.startedAt);
    const endedMs = interval.endedAt
      ? Date.parse(interval.endedAt)
      : detail.run.status === 'active' && index === intervals.length - 1 ? nowMs : updated.getTime();
    return total + (Number.isFinite(startedMs) && Number.isFinite(endedMs)
      ? Math.max(0, endedMs - startedMs) : 0);
  }, 0);

  return {
    durationMs,
    durationLabel: formatDurationHms(durationMs),
    durationTooltip: `Active across ${intervals.length} ${intervals.length === 1 ? 'period' : 'periods'}\nCreated ${formatSessionDateTime(detail.run.createdAt)}\nUpdated ${formatSessionStart(updated)}`
  };
}

export function latestRunDetailDate(detail: RunDetail): Date | null {
  const timestamps = [
    detail.run.createdAt,
    detail.run.startedAt,
    detail.run.endedAt,
    ...detail.attempts.flatMap((attempt) => [attempt.startedAt, attempt.endedAt]),
    ...detail.traceEvents.map((event) => event.createdAt),
    ...detail.artifacts.map((artifact) => artifact.createdAt),
    ...(detail.appServerMemory?.nodes.flatMap((node) => [node.createdAt, node.updatedAt]) ?? []),
    ...detail.verifierContracts.flatMap((contract) => [contract.createdAt, contract.updatedAt]),
    ...detail.verifierRuns.flatMap((run) => [run.startedAt, run.endedAt]),
    ...detail.modelSessions.flatMap((session) => [session.createdAt, session.updatedAt]),
    ...detail.policyEvents.flatMap((event) => [event.createdAt, event.decidedAt]),
    ...detail.exports.flatMap((exportRecord) => [exportRecord.createdAt, exportRecord.reviewedAt])
  ];
  const latestTimestamp = timestamps.reduce<number | null>((latest, value) => {
    if (!value) return latest;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return latest;
    return latest === null ? timestamp : Math.max(latest, timestamp);
  }, null);
  return latestTimestamp === null ? null : new Date(latestTimestamp);
}
