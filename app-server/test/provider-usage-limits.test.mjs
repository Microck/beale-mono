import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ProviderUsageLimitsService,
  codexRateLimitsToSnapshot,
  xaiBillingToSnapshot,
  claudeRateLimitsToSnapshot
} from '../dist/providerUsageLimits.js';
import { decodeBealeProviderUsageLimits } from '../../packages/app-server-runtime/dist/protocol.js';

test('Codex maps provider durations to session and weekly labels', () => {
  const result = codexRateLimitsToSnapshot({
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex',
        primary: { usedPercent: 42, windowDurationMins: 240, resetsAt: 2_000_000_000 },
        secondary: { usedPercent: 71, windowDurationMins: 10_080, resetsAt: 2_000_500_000 }
      }
    }
  });
  assert.equal(result.status, 'available');
  assert.deepEqual(result.windows.map(({ label, usedPercent }) => [label, usedPercent]), [
    ['Session Limit', 42], ['Weekly Limit', 71]
  ]);
  assert.equal(result.windows[0].durationMinutes, 240);
  assert.deepEqual(decodeBealeProviderUsageLimits(result), result);
});

test('Codex excludes a model-specific bucket and handles a monthly primary window', () => {
  assert.equal(codexRateLimitsToSnapshot({ rateLimits: {
    limitId: 'codex-spark', primary: { usedPercent: 90 }
  } }).windows.length, 0);
  assert.equal(codexRateLimitsToSnapshot({ rateLimits: {
    planType: 'free', primary: { usedPercent: 20 }
  } }).windows[0].label, 'Monthly Limit');
});

test('xAI uses the reported billing period and treats an omitted zero percent as unused', () => {
  const result = xaiBillingToSnapshot({ config: {
    creditUsagePercent: 12.5,
    currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2033-01-01T00:00:00Z' }
  } });
  assert.equal(result.windows[0].label, 'Weekly Limit');
  assert.equal(result.windows[0].usedPercent, 12.5);
  const unused = xaiBillingToSnapshot({ config: {
    currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2033-01-01T00:00:00Z' }
  } });
  assert.equal(unused.status, 'available');
  assert.equal(unused.windows[0].usedPercent, 0);
  assert.equal(unused.windows[0].resetsAt, '2033-01-01T00:00:00.000Z');
  assert.deepEqual(decodeBealeProviderUsageLimits(unused), unused);
  assert.equal(xaiBillingToSnapshot({ config: {} }).status, 'unavailable');
  assert.equal(xaiBillingToSnapshot({ config: {
    creditUsagePercent: null,
    currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2033-01-01T00:00:00Z' }
  } }).status, 'unavailable');
});

test('Claude maps five-hour and seven-day utilization independently', () => {
  const result = claudeRateLimitsToSnapshot({
    available: true,
    fiveHour: { utilization: 32, resetsAt: '2033-01-01T00:00:00Z' },
    sevenDay: { utilization: null, resetsAt: null }
  });
  assert.deepEqual(result.windows.map(({ label, usedPercent }) => [label, usedPercent]), [
    ['Session Limit', 32]
  ]);
  assert.equal(claudeRateLimitsToSnapshot({ available: false }).status, 'unsupported');
});

test('limits service caches reads and allows an explicit refresh', async () => {
  let calls = 0;
  const service = new ProviderUsageLimitsService(async (providerId) => ({
    providerId, checkedAt: '2033-01-01T00:00:00.000Z', status: 'available', detail: null,
    windows: [{ id: 'weekly', label: 'Weekly Limit', usedPercent: ++calls, resetsAt: null, durationMinutes: 10_080 }]
  }));
  assert.equal((await service.read('xai')).windows[0].usedPercent, 1);
  assert.equal((await service.read('xai')).windows[0].usedPercent, 1);
  assert.equal((await service.read('xai', true)).windows[0].usedPercent, 2);
});
