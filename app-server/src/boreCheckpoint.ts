import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BealeBoreCheckpointResult, BealeBoreHostReceiptResult } from '@beale/app-server-runtime/protocol';

const BORE_PROBES = new Set([
  'own-container-round-trip', 'foreign-container-canary-read',
  'foreign-container-canary-write-open', 'foreign-container-foundation-read',
  'foreign-container-directory-list', 'foreign-container-canary-metadata',
  'foreign-keychain-canary-read', 'foreign-container-absent-existence-control',
  'foreign-container-canary-existence'
]);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const STATUSES = new Set(['running', 'paused', 'candidate', 'exhausted', 'controlFailed']);
const VERDICTS = new Set(['expected', 'unexpected', 'inconclusive', 'skipped']);
const STEP_NAMES = new Set(['build-proof', 'install-proof', 'launch-proof', 'seed-fixture',
  'read-fixture-pairing', 'relaunch-bore']);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function noPrivatePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 300
    && !value.includes('/') && !value.includes('\\');
}

function validObservation(value: unknown): boolean {
  if (!record(value)) return false;
  return onlyKeys(value, ['id', 'probeID', 'verdict', 'summary', 'posixError', 'timestamp'])
    && typeof value.id === 'string' && UUID.test(value.id)
    && typeof value.probeID === 'string' && BORE_PROBES.has(value.probeID)
    && typeof value.verdict === 'string' && VERDICTS.has(value.verdict)
    && noPrivatePath(value.summary)
    && typeof value.timestamp === 'string' && !Number.isNaN(Date.parse(value.timestamp))
    && (value.posixError == null || typeof value.posixError === 'number'
      && Number.isInteger(value.posixError) && value.posixError >= 0 && value.posixError < 4096);
}

function validSession(value: unknown): value is Record<string, unknown> {
  if (!record(value) || !record(value.environment)) return false;
  const environment = value.environment;
  return onlyKeys(value, ['schemaVersion', 'id', 'prompt', 'startedAt', 'updatedAt',
    'environment', 'status', 'planner', 'observations'])
    && onlyKeys(environment, ['platform', 'osVersion', 'osBuild', 'hardwareModel', 'bundleID',
      'appVersion', 'entitlementProfile', 'executionContext'])
    && value.schemaVersion === 1
    && typeof value.id === 'string' && UUID.test(value.id)
    && typeof value.prompt === 'string' && value.prompt.length > 0 && value.prompt.length <= 500
    && typeof value.startedAt === 'string' && !Number.isNaN(Date.parse(value.startedAt))
    && typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt))
    && typeof value.status === 'string' && STATUSES.has(value.status)
    && typeof value.planner === 'string' && value.planner.length <= 120
    && environment.platform === 'iOS'
    && ['osVersion', 'osBuild', 'hardwareModel', 'bundleID', 'appVersion',
      'entitlementProfile', 'executionContext'].every((key) => typeof environment[key] === 'string' && environment[key].length <= 160)
    && Array.isArray(value.observations) && value.observations.length <= 12
    && value.observations.every(validObservation);
}

function validReceipt(value: unknown): value is Record<string, unknown> {
  if (!record(value)) return false;
  return onlyKeys(value, ['schemaVersion', 'jobId', 'sessionId', 'kind', 'status', 'steps',
    'completedAt', 'sourceRevision', 'sourceDirty'])
    && value.schemaVersion === 1
    && typeof value.jobId === 'string' && UUID.test(value.jobId)
    && typeof value.sessionId === 'string' && UUID.test(value.sessionId)
    && value.kind === 'proof-cycle'
    && (value.status === 'completed' || value.status === 'failed')
    && typeof value.completedAt === 'string' && !Number.isNaN(Date.parse(value.completedAt))
    && (value.sourceRevision == null || typeof value.sourceRevision === 'string' && /^[0-9a-f]{40,64}$/u.test(value.sourceRevision))
    && (value.sourceDirty == null || typeof value.sourceDirty === 'boolean')
    && Array.isArray(value.steps) && value.steps.length <= STEP_NAMES.size
    && value.steps.every((step: unknown) => record(step) && onlyKeys(step, ['name', 'status'])
      && typeof step.name === 'string'
      && STEP_NAMES.has(step.name) && (step.status === 'completed' || step.status === 'failed'));
}

async function writeImmutable(file: string, bytes: string): Promise<void> {
  try { await writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (!record(error) || error.code !== 'EEXIST') throw error;
    if (!(await lstat(file)).isFile()) throw new Error('Bore record path is not a regular file.');
    if (await readFile(file, 'utf8') !== bytes) throw new Error('Bore record ID collision.');
  }
}

async function evidenceDirectory(workspaceRoot: string, sessionId: string, jobs = false): Promise<string> {
  const parts = ['evidence', 'bore', sessionId, ...(jobs ? ['jobs'] : [])];
  let directory = workspaceRoot;
  for (const part of parts) {
    directory = join(directory, part);
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) { if (!record(error) || error.code !== 'EEXIST') throw error; }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Bore evidence directory is not a real directory.');
  }
  return directory;
}

export async function saveBoreCheckpoint(workspaceRoot: string, value: unknown): Promise<BealeBoreCheckpointResult> {
  if (!validSession(value)) throw new Error('Invalid Bore session checkpoint.');
  const sessionId = value.id as string;
  const bytes = JSON.stringify(value);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  if (!SHA256.test(contentHash)) throw new Error('Invalid Bore checkpoint hash.');
  const directory = await evidenceDirectory(workspaceRoot, sessionId);
  await writeImmutable(join(directory, `${contentHash}.json`), bytes);
  return { schemaVersion: 1, sessionId, contentHash };
}

export async function saveBoreHostReceipt(workspaceRoot: string, value: unknown): Promise<BealeBoreHostReceiptResult> {
  if (!validReceipt(value)) throw new Error('Invalid Bore host receipt.');
  const jobId = value.jobId as string;
  const sessionId = value.sessionId as string;
  const bytes = JSON.stringify(value);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const directory = await evidenceDirectory(workspaceRoot, sessionId, true);
  await writeImmutable(join(directory, `${jobId}.json`), bytes);
  return { schemaVersion: 1, jobId, contentHash };
}

export async function readBoreHostReceipt(workspaceRoot: string, sessionId: string, jobId: string): Promise<{
  schemaVersion: 1; jobId: string; sessionId: string; status: 'completed' | 'failed';
  steps: Array<{ name: string; status: 'completed' | 'failed' }>;
} | null> {
  if (!UUID.test(sessionId) || !UUID.test(jobId)) throw new Error('Invalid Bore receipt identity.');
  let directory = workspaceRoot;
  for (const part of ['evidence', 'bore', sessionId, 'jobs']) {
    directory = join(directory, part);
    let info;
    try { info = await lstat(directory); }
    catch (error) {
      if (record(error) && error.code === 'ENOENT') return null;
      throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Bore receipt directory is not a real directory.');
  }
  const file = join(directory, `${jobId}.json`);
  let value: unknown;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Bore receipt path is not a regular file.');
    value = JSON.parse(await readFile(file, 'utf8')) as unknown;
  }
  catch (error) {
    if (record(error) && error.code === 'ENOENT') return null;
    throw error;
  }
  if (!validReceipt(value) || value.sessionId !== sessionId || value.jobId !== jobId) {
    throw new Error('Stored Bore receipt is invalid.');
  }
  return {
    schemaVersion: 1, jobId, sessionId,
    status: value.status as 'completed' | 'failed',
    steps: value.steps as Array<{ name: string; status: 'completed' | 'failed' }>,
  };
}
