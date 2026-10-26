import { describe, expect, it } from 'vitest';
import type { RunDetail } from '../src/shared/types';
import { sessionDurationTiming } from '../src/renderer/view-models/sessionHeader';
import {
  clampPriorityScoreForDisplay,
  formatCompactTimeSince,
  formatDurationHms,
  formatPercent,
  formatPriorityPill,
  formatSessionDateTime,
  formatSessionStart,
  formatSessionTime,
  researchModelNameLabel,
  shortDate,
  stateClass,
  traceLabel,
  truncateText
} from '../src/renderer/lib/formatting';

describe('renderer formatting helpers', () => {
  it('sums only active session periods across long idle gaps', () => {
    const detail = {
      run: {
        status: 'active', createdAt: '2026-01-01T00:00:00.000Z',
        startedAt: '2026-01-01T00:00:00.000Z', endedAt: null,
      },
      activityIntervals: [
        { id: 'period_one', runId: 'session_example', attemptId: 'attempt_one',
          startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:10:00.000Z' },
        { id: 'period_two', runId: 'session_example', attemptId: 'attempt_two',
          startedAt: '2026-01-03T00:00:00.000Z', endedAt: null },
      ],
      attempts: [], traceEvents: [], artifacts: [], verifierContracts: [], verifierRuns: [],
      modelSessions: [], policyEvents: [], exports: [],
    } as unknown as RunDetail;
    const nowMs = Date.parse('2026-01-03T00:05:00.000Z');
    expect(sessionDurationTiming(detail, nowMs)).toMatchObject({
      durationMs: 15 * 60_000,
      durationLabel: '00:15:00',
    });

    const olderDetail = {
      ...detail,
      run: { ...detail.run, status: 'completed', endedAt: '2026-01-03T00:05:00.000Z' },
      activityIntervals: undefined,
      attempts: [
        { startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:10:00.000Z' },
        { startedAt: '2026-01-03T00:00:00.000Z', endedAt: '2026-01-03T00:05:00.000Z' },
      ],
    } as RunDetail;
    expect(sessionDurationTiming(olderDetail, nowMs)?.durationMs).toBe(15 * 60_000);
  });

  it('formats session dates, times, and durations with compact product labels', () => {
    const date = new Date(2026, 3, 30, 0, 5, 9);

    expect(formatSessionTime(date)).toBe('12:05a');
    expect(formatSessionStart(date)).toBe('Apr 30, 12:05a');
    expect(formatSessionDateTime('not-a-date')).toBe('Unknown');
    expect(formatDurationHms(3_661_900)).toBe('01:01:01');
  });

  it('formats normalized labels and bounded priority pills', () => {
    expect(traceLabel('host_research_only')).toBe('Host Research Only');
    expect(formatPriorityPill(65.8)).toBe('P64');
    expect(clampPriorityScoreForDisplay(Number.NaN)).toBe(0);
  });

  it('keeps model family names and collapses a repeated DeepSeek prefix', () => {
    expect(researchModelNameLabel('openai-codex', 'GPT-5.6 Sol')).toBe('GPT-5.6 Sol');
    expect(researchModelNameLabel('openai-codex', 'gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(researchModelNameLabel('openai-codex', 'Legacy GPT-5.6')).toBe('Legacy GPT-5.6');
    expect(researchModelNameLabel('anthropic', 'Claude Opus 5')).toBe('Claude Opus 5');
    expect(researchModelNameLabel('anthropic', 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(researchModelNameLabel('anthropic', 'Legacy Claude Sonnet')).toBe('Legacy Claude Sonnet');
    expect(researchModelNameLabel('openrouter', 'Deepseek: Deepseek R1')).toBe('DeepSeek R1');
    expect(researchModelNameLabel('openrouter', 'DeepSeek: DeepSeek-V3')).toBe('DeepSeek-V3');
    expect(researchModelNameLabel('openrouter', 'Deepseek: Coder V2')).toBe('Deepseek: Coder V2');
    expect(researchModelNameLabel('openrouter', 'Deepseek: Deepseeker')).toBe('Deepseek: Deepseeker');
  });

  it('formats compact time since labels from minutes through years', () => {
    const nowMs = Date.UTC(2026, 7, 19, 12, 0, 0);
    const ago = (durationMs: number): string => new Date(nowMs - durationMs).toISOString();
    expect(formatCompactTimeSince(ago(30_000), nowMs)).toBe('1m');
    expect(formatCompactTimeSince(ago(60_000), nowMs)).toBe('1m');
    expect(formatCompactTimeSince(ago(2 * 60 * 60_000), nowMs)).toBe('2h');
    expect(formatCompactTimeSince(ago(3 * 24 * 60 * 60_000), nowMs)).toBe('3d');
    expect(formatCompactTimeSince(ago(4 * 7 * 24 * 60 * 60_000), nowMs)).toBe('4w');
    expect(formatCompactTimeSince(ago(5 * 30 * 24 * 60 * 60_000), nowMs)).toBe('5M');
    expect(formatCompactTimeSince(ago(6 * 365 * 24 * 60 * 60_000), nowMs)).toBe('6y');
    expect(formatCompactTimeSince('not-a-date', nowMs)).toBe('--');
  });

  it('formats small utility labels consistently', () => {
    expect(formatPercent(0.125)).toBe('+13%');
    expect(formatPercent(-0.125)).toBe('-12%');
    expect(shortDate('2026-04-30T12:34:56.000Z')).toBe('2026-04-30');
    expect(stateClass('Needs Evidence!')).toBe('needs-evidence-');
    expect(truncateText('Trace output with a long body', 16)).toBe('Trace output...');
  });
});
