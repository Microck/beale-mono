import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { assessSurfaceCoverage, type SurfaceFoundation, type SurfaceProgressBlocker } from '@beale/research-agent';
import type { BealeWorkspaceSurfaceMap } from '@beale/app-server-runtime/protocol';

type Row = Record<string, unknown>;
type Surface = BealeWorkspaceSurfaceMap['surfaces'][number];
type StoredFoundation = SurfaceFoundation & { progressBlocker: SurfaceProgressBlocker | null };

function tableExists(database: DatabaseSync, name: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function parsed(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try { return object(JSON.parse(value) as unknown); } catch { return null; }
}
function foundation(value: unknown): StoredFoundation | null {
  const record = parsed(value);
  const coverage = object(record?.coverage);
  if (!coverage || !Array.isArray(coverage.openQuestions) || !Array.isArray(coverage.unexploredConnections)) return null;
  const blocker = object(record?.progressBlocker);
  const progressBlocker = blocker && typeof blocker.reason === 'string' && typeof blocker.actorId === 'string'
    && typeof blocker.setAt === 'string'
    ? { reason: blocker.reason, actorId: blocker.actorId, setAt: blocker.setAt } : null;
  return { ...record, progressBlocker } as unknown as StoredFoundation;
}
function displayFoundation(value: SurfaceFoundation | null): Surface['foundation'] {
  const coverage = value?.coverage;
  return coverage ? { coverage: {
    mappingComplete: coverage.mappingComplete === true,
    sinksInvestigated: coverage.sinksInvestigated === true,
    openQuestions: Array.isArray(coverage.openQuestions) ? coverage.openQuestions : [],
    unexploredConnections: Array.isArray(coverage.unexploredConnections) ? coverage.unexploredConnections : []
  } } : null;
}

/** App-server-owned, path-free projection of the durable workspace surface map. */
export function readWorkspaceSurfaceMap(databasePath: string, workspaceId: string): BealeWorkspaceSurfaceMap {
  const empty = (): BealeWorkspaceSurfaceMap => ({ schemaVersion: 1, workspaceId, surfaces: [], agents: [] });
  if (!existsSync(databasePath)) return empty();
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    if (!tableExists(database, 'app_server_research_resources')) return empty();
    const roots = (database.prepare(`SELECT id, name, rationale, kind, direction, review_status, source
      FROM app_server_research_resources WHERE workspace_id=? ORDER BY discovered_at, id`).all(workspaceId) as Row[])
      .filter((row) => row.direction !== 'out_of_scope' && row.review_status !== 'not_relevant'
        && row.review_status !== 'explicit_out_of_scope'
        && (row.source !== 'runtime_discovery' || row.review_status === 'relevant'));
    const eligibleRootIds = new Set(roots.map((row) => string(row.id)));
    const resourceKinds = new Map(roots.map((row) => [string(row.id), string(row.kind)]));
    const resourceSources = new Map(roots.map((row) => [string(row.id), string(row.source)]));
    const children = tableExists(database, 'app_server_surfaces')
      ? (database.prepare(`SELECT id, resource_id, parent_id, name, description, foundation_json
          FROM app_server_surfaces WHERE workspace_id=? ORDER BY created_at, id`).all(workspaceId) as Row[])
        .filter((row) => eligibleRootIds.has(string(row.resource_id))) : [];
    const rootFoundations = new Map<string, StoredFoundation | null>((tableExists(database, 'app_server_surface_roots')
      ? database.prepare('SELECT resource_id, foundation_json FROM app_server_surface_roots WHERE workspace_id=?').all(workspaceId) as Row[] : [])
      .map((row) => [string(row.resource_id), foundation(row.foundation_json)]));
    const firstTouches = new Map<string, string>((tableExists(database, 'app_server_surface_touches')
      ? database.prepare('SELECT surface_id, first_touched_at FROM app_server_surface_touches WHERE workspace_id=?').all(workspaceId) as Row[] : [])
      .map((row) => [string(row.surface_id), string(row.first_touched_at)]));
    const raw = [
      ...roots.map((row) => ({ id: string(row.id), resourceId: string(row.id),
        resourceKind: string(row.kind), resourceSource: string(row.source), parentId: null, name: string(row.name),
        description: string(row.rationale), firstTouchedAt: firstTouches.get(string(row.id)) ?? null,
        foundation: rootFoundations.get(string(row.id)) ?? null })),
      ...children.map((row) => ({ id: string(row.id), resourceId: string(row.resource_id),
        resourceKind: resourceKinds.get(string(row.resource_id)) ?? '',
        resourceSource: resourceSources.get(string(row.resource_id)) ?? '', parentId: string(row.parent_id),
        name: string(row.name), description: string(row.description), firstTouchedAt: firstTouches.get(string(row.id)) ?? null,
        foundation: foundation(row.foundation_json) }))
    ];
    const claims = tableExists(database, 'app_server_research_claims')
      ? database.prepare(`SELECT id, status, security_tracking_json
          FROM app_server_research_claims WHERE workspace_id=? AND duplicate_of_claim_id IS NULL
            AND (classification='security' OR classification LIKE 'security.%')
            AND status IN ('observed','reproduced','verified','report_ready')`).all(workspaceId) as Row[] : [];
    const byParent = new Map<string, string[]>();
    for (const surface of raw) if (surface.parentId) byParent.set(surface.parentId, [...(byParent.get(surface.parentId) ?? []), surface.id]);
    const byId = new Map(raw.map((surface) => [surface.id, surface]));
    const coverageCache = new Map<string, Surface['coverageState']>();
    const coverage = (id: string, trail = new Set<string>()): Surface['coverageState'] => {
      const cached = coverageCache.get(id);
      if (cached) return cached;
      const surface = byId.get(id);
      if (!surface || trail.has(id)) return { covered: false, unmetRequirements: ['surface_map'], unblockedFindingIds: [] };
      const nextTrail = new Set(trail).add(id);
      const findingIds = claims.flatMap((claim) => {
        const tracking = parsed(claim.security_tracking_json);
        const surfaceIds = Array.isArray(tracking?.surfaceIds) ? tracking.surfaceIds : [];
        const blocked = (claim.status === 'observed' || claim.status === 'reproduced') && Boolean(tracking?.progressBlocker);
        const affected = Array.isArray(tracking?.affectedAssetIds) ? tracking.affectedAssetIds : [];
        const unassignedRoot = surface.parentId === null && surfaceIds.length === 0
          && (affected.length === 0 || affected.includes(surface.resourceId));
        return !blocked && (surfaceIds.includes(id) || unassignedRoot) ? [string(claim.id)] : [];
      });
      const state = assessSurfaceCoverage(surface.foundation, findingIds,
        (byParent.get(id) ?? []).some((child) => !coverage(child, nextTrail).covered), Boolean(surface.foundation?.progressBlocker));
      coverageCache.set(id, state);
      return state;
    };
    const surfaces = raw.map((surface) => ({ ...surface, progressBlocker: surface.foundation?.progressBlocker ?? null,
      foundation: displayFoundation(surface.foundation), coverageState: coverage(surface.id) }));
    const visibleSurfaceIds = new Set(surfaces.map((surface) => surface.id));
    const agents = tableExists(database, 'app_server_surface_focus') && tableExists(database, 'app_server_sessions')
      ? (database.prepare(`SELECT focus.session_id, sessions.title AS session_title, focus.agent_id, focus.surface_id
          FROM app_server_surface_focus AS focus
          JOIN app_server_sessions AS sessions ON sessions.id = focus.session_id AND sessions.status = 'active'
          WHERE focus.workspace_id=? ORDER BY focus.session_id, focus.agent_id`).all(workspaceId) as Row[])
        .filter((row) => visibleSurfaceIds.has(string(row.surface_id)))
        .map((row) => ({ sessionId: string(row.session_id), sessionTitle: string(row.session_title),
          agentId: string(row.agent_id), surfaceId: string(row.surface_id) })) : [];
    return { schemaVersion: 1, workspaceId, surfaces, agents };
  } finally {
    database.close();
  }
}
