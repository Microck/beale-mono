import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openResearchDatabase } from "./database.js";
import { nowIso } from "./ids.js";
import type { ResearchResourceCatalog, TrackedResearchResource } from "./research-resources.js";
import type { ResearchExecutableTool, ResearchToolExecutionContext } from "./tool-registry.js";
import type { ResearchResourceKind, ResearchToolAction } from "./types.js";

export interface SurfaceFoundation {
  bugHistory: { summary: string; limits: string };
  coverage: {
    summary: string;
    gaps: string;
    opportunities: string;
    mappingComplete: boolean;
    sinksInvestigated: boolean;
    openQuestions: string[];
    unexploredConnections: string[];
  };
  threatModel: { attackerControl: string; trustBoundaries: string; assetsAtRisk: string; plausibleImpacts: string; assumptions: string };
}

export interface SurfaceProgressBlocker {
  reason: string;
  actorId: string;
  setAt: string;
}

export interface SurfaceCoverageState {
  covered: boolean;
  unmetRequirements: string[];
  unblockedFindingIds: string[];
}

export function assessSurfaceCoverage(
  foundation: SurfaceFoundation | null,
  unblockedFindingIds: string[],
  incompleteChildren: boolean,
  blocked = false,
): SurfaceCoverageState {
  const coverage = foundation?.coverage;
  const unmetRequirements: string[] = [];
  if (!foundation) unmetRequirements.push("foundation");
  if (!coverage?.mappingComplete) unmetRequirements.push("surface_map");
  if (!coverage?.sinksInvestigated) unmetRequirements.push("sinks");
  if (coverage?.openQuestions?.length) unmetRequirements.push("open_questions");
  if (coverage?.unexploredConnections?.length) unmetRequirements.push("surface_connections");
  if (unblockedFindingIds.length) unmetRequirements.push("unblocked_findings");
  if (incompleteChildren) unmetRequirements.push("child_surfaces");
  if (blocked) unmetRequirements.push("blocked");
  return { covered: unmetRequirements.length === 0, unmetRequirements, unblockedFindingIds };
}

export interface SurfaceFoundationScout {
  status: "running" | "queued" | "unavailable";
  agentPath: string | null;
  reason: string | null;
}

export interface ResearchSurface {
  id: string;
  workspaceId: string;
  resourceId: string;
  parentId: string | null;
  name: string;
  description: string;
  root: boolean;
  firstTouchedAt: string | null;
  foundation: SurfaceFoundation | null;
  progressBlocker: SurfaceProgressBlocker | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SurfaceCard {
  id: string;
  resourceId: string;
  resourceKind: ResearchResourceKind | null;
  resourceSource: TrackedResearchResource["source"] | null;
  parentId: string | null;
  name: string;
  path: string;
  root: boolean;
  focusEligible: boolean;
  firstTouchedAt: string | null;
  foundationReady: boolean;
  coverage: SurfaceFoundation["coverage"] | null;
  progressBlocker: SurfaceProgressBlocker | null;
  coverageState: SurfaceCoverageState;
  updatedAt: string;
}

export interface SurfaceModelContext {
  counts: { roots: number; children: number; touched: number; pendingFoundation: number };
  surfaces: SurfaceCard[];
  omitted: number;
}

type SurfaceRow = Record<string, unknown>;

/** Workspace-scoped surface structure. Root identity is the existing resource ID. */
export class SurfaceStore {
  readonly #database: DatabaseSync;
  readonly #workspaceId: string;
  readonly #sessionId: string;
  readonly #resources: ResearchResourceCatalog;
  #firstTouchHandler: ((surface: ResearchSurface, agentId: string) => SurfaceFoundationScout) | null = null;

  public constructor(input: { databasePath: string; workspaceId: string; sessionId?: string; resources: ResearchResourceCatalog }) {
    this.#database = openResearchDatabase(input.databasePath);
    this.#workspaceId = nonempty(input.workspaceId, "workspaceId");
    this.#sessionId = input.sessionId?.trim() || "external";
    this.#resources = input.resources;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS app_server_surfaces (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, resource_id TEXT NOT NULL,
        parent_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
        foundation_json TEXT, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS app_server_surfaces_resource ON app_server_surfaces(workspace_id, resource_id, parent_id);
      CREATE UNIQUE INDEX IF NOT EXISTS app_server_surfaces_sibling_name
        ON app_server_surfaces(workspace_id, parent_id, name COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS app_server_surface_roots (
        resource_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, foundation_json TEXT,
        revision INTEGER NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_server_surface_touches (
        surface_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, first_touched_at TEXT NOT NULL,
        first_session_id TEXT NOT NULL, first_agent_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_server_surface_focus (
        workspace_id TEXT NOT NULL, session_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        surface_id TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id, session_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS app_server_surface_focus_events (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL, previous_surface_id TEXT, surface_id TEXT NOT NULL,
        reason TEXT NOT NULL, moved_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS app_server_surface_focus_events_session
        ON app_server_surface_focus_events(workspace_id, session_id, moved_at);
    `);
  }

  public close(): void { this.#database.close(); }

  public setFirstTouchHandler(handler: ((surface: ResearchSurface, agentId: string) => SurfaceFoundationScout) | null): void {
    this.#firstTouchHandler = handler;
  }

  public get(id: string): ResearchSurface | null {
    const resource = this.#resources.get(nonempty(id, "surfaceId"));
    if (resource?.workspaceId === this.#workspaceId) return this.#root(resource);
    const row = this.#database.prepare("SELECT * FROM app_server_surfaces WHERE workspace_id = ? AND id = ?")
      .get(this.#workspaceId, id) as SurfaceRow | undefined;
    return row ? this.#child(row) : null;
  }

  public require(id: string, eligible = false): ResearchSurface {
    const surface = this.get(id);
    if (!surface) throw new Error(`Surface not found in the active workspace: ${id}`);
    if (eligible && !this.#focusEligible(surface)) throw new Error("Surface resource is not eligible for research focus in this workspace.");
    return surface;
  }

  public list(input: { resourceId?: string; resourceKind?: string; parentId?: string; limit?: number; offset?: number } = {}): { surfaces: SurfaceCard[]; nextOffset: number | null; total: number } {
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const limit = bound(input.limit, 50);
    const matches = this.#all().filter((surface) => (!input.resourceId || surface.resourceId === input.resourceId)
      && (!input.resourceKind || this.#resources.get(surface.resourceId)?.kind === input.resourceKind)
      && (input.parentId === undefined || surface.parentId === input.parentId));
    return { surfaces: matches.slice(offset, offset + limit).map((surface) => this.#card(surface)), nextOffset: offset + limit < matches.length ? offset + limit : null, total: matches.length };
  }

  #all(): ResearchSurface[] {
    return [
      ...this.#resources.list().filter((resource) => resource.workspaceId === this.#workspaceId).map((resource) => this.#root(resource)),
      ...(this.#database.prepare("SELECT * FROM app_server_surfaces WHERE workspace_id = ? ORDER BY created_at, id")
        .all(this.#workspaceId) as SurfaceRow[]).map((row) => this.#child(row)),
    ];
  }

  public query(text: string, limit = 20, offset = 0): { surfaces: SurfaceCard[]; nextOffset: number | null; total: number } {
    const words = nonempty(text, "query").toLowerCase().split(/\s+/u).slice(0, 12);
    const matches = this.#all().filter((surface) => {
      const path = this.path(surface.id);
      const haystack = [surface.name, surface.description, path,
        surface.foundation?.bugHistory.summary, surface.foundation?.bugHistory.limits, surface.foundation?.coverage.summary,
        surface.foundation?.coverage.gaps, surface.foundation?.coverage.opportunities, surface.progressBlocker?.reason,
        ...Object.values(surface.foundation?.threatModel ?? {})].join(" ").toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
    const start = Math.max(0, Math.floor(offset));
    const pageLimit = bound(limit, 20);
    return { surfaces: matches.slice(start, start + pageLimit).map((surface) => this.#card(surface)), nextOffset: start + pageLimit < matches.length ? start + pageLimit : null, total: matches.length };
  }

  public modelContext(): SurfaceModelContext {
    const all = this.#all();
    const selected = [
      ...all.filter((surface) => surface.root).sort((left, right) => left.name.localeCompare(right.name)).slice(0, 8),
      ...all.filter((surface) => !surface.root).sort((left, right) =>
        Number(Boolean(right.firstTouchedAt && !right.foundation)) - Number(Boolean(left.firstTouchedAt && !left.foundation))
        || right.updatedAt.localeCompare(left.updatedAt)).slice(0, 8),
    ];
    return {
      counts: {
        roots: all.filter((surface) => surface.root).length,
        children: all.filter((surface) => !surface.root).length,
        touched: all.filter((surface) => surface.firstTouchedAt).length,
        pendingFoundation: all.filter((surface) => surface.firstTouchedAt && !surface.foundation).length,
      },
      surfaces: selected.map((surface) => this.#card(surface)),
      omitted: Math.max(0, all.length - selected.length),
    };
  }

  public path(id: string): string {
    return this.hierarchy(id).map((surface) => surface.name).join(" / ");
  }

  public hierarchy(id: string): { id: string; name: string }[] {
    const hierarchy: { id: string; name: string }[] = [];
    let surface = this.require(id);
    for (let depth = 0; depth < 64; depth += 1) {
      hierarchy.unshift({ id: surface.id, name: surface.name });
      if (!surface.parentId) return hierarchy;
      surface = this.require(surface.parentId);
    }
    throw new Error("Surface hierarchy is too deep.");
  }

  public create(parentId: string, name: string, description: string): ResearchSurface {
    const parent = this.require(parentId, true);
    const at = nowIso();
    const id = `surface_${randomUUID().replaceAll("-", "")}`;
    this.#database.prepare(`INSERT INTO app_server_surfaces
      (id, workspace_id, resource_id, parent_id, name, description, foundation_json, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`).run(
      id, this.#workspaceId, parent.resourceId, parent.id,
      bounded(nonempty(name, "name"), 180), bounded(description, 2_000), at, at,
    );
    return this.require(id);
  }

  public update(id: string, expectedRevision: number, foundation?: SurfaceFoundation, name?: string, description?: string,
    progressBlocker?: { reason: string } | null, actorId?: string): ResearchSurface {
    const surface = this.require(id, true);
    if (surface.root && (name !== undefined || description !== undefined)) throw new Error("Root surface name and description belong to the resource catalog.");
    if (surface.revision !== expectedRevision) throw new Error("Surface revision changed; read it again before updating.");
    const normalized = foundation === undefined ? surface.foundation : parseFoundation(foundation);
    if (!normalized) throw new Error("foundation is required before updating a surface without a foundation.");
    const at = nowIso();
    if (progressBlocker && !surface.firstTouchedAt) {
      throw new Error("Focus and investigate the surface before recording a progress blocker.");
    }
    const stored: SurfaceFoundation & { progressBlocker: SurfaceProgressBlocker | null } = {
      ...normalized,
      progressBlocker: progressBlocker === undefined ? surface.progressBlocker
        : progressBlocker === null ? null
          : { reason: bounded(nonempty(progressBlocker.reason, "Progress blocker reason"), 2_000),
              actorId: bounded(nonempty(actorId ?? "host", "Progress blocker actor"), 200), setAt: at },
    };
    if (stored.progressBlocker && !stored.coverage.gaps) {
      throw new Error("Describe the work blocked by the dependency in foundation.coverage.gaps.");
    }
    const changed = surface.root
      ? this.#database.prepare(`INSERT INTO app_server_surface_roots(resource_id, workspace_id, foundation_json, revision, updated_at)
          VALUES (?, ?, ?, 2, ?)
          ON CONFLICT(resource_id) DO UPDATE SET foundation_json = excluded.foundation_json,
            revision = app_server_surface_roots.revision + 1, updated_at = excluded.updated_at
          WHERE app_server_surface_roots.revision = ?`)
        .run(id, this.#workspaceId, JSON.stringify(stored), at, expectedRevision).changes
      : this.#database.prepare(`UPDATE app_server_surfaces SET name = ?, description = ?, foundation_json = ?,
          revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ? AND revision = ?`)
        .run(name === undefined ? surface.name : bounded(nonempty(name, "name"), 180),
          description === undefined ? surface.description : bounded(description, 2_000),
          JSON.stringify(stored), at, this.#workspaceId, id, expectedRevision).changes;
    if (!changed) throw new Error("Surface revision changed; read it again before updating.");
    return this.require(id);
  }

  public focus(agentId: string, surfaceId: string, reason = "research"): { surface: ResearchSurface; surfaceTrail: { id: string; name: string }[]; firstTouch: boolean; previousSurfaceId: string | null; foundationScout?: SurfaceFoundationScout } {
    const surface = this.require(surfaceId, true);
    const agent = nonempty(agentId, "agentId");
    const at = nowIso();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.#database.prepare(`SELECT surface_id FROM app_server_surface_focus
        WHERE workspace_id = ? AND session_id = ? AND agent_id = ?`)
        .get(this.#workspaceId, this.#sessionId, agent) as { surface_id: string } | undefined;
      const touched = this.#database.prepare(`INSERT OR IGNORE INTO app_server_surface_touches
        (surface_id, workspace_id, first_touched_at, first_session_id, first_agent_id)
        VALUES (?, ?, ?, ?, ?)`).run(surfaceId, this.#workspaceId, at, this.#sessionId, agent).changes > 0;
      if (previous?.surface_id !== surfaceId) {
        this.#database.prepare(`INSERT INTO app_server_surface_focus_events
          (id, workspace_id, session_id, agent_id, previous_surface_id, surface_id, reason, moved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          `surface_move_${randomUUID().replaceAll("-", "")}`, this.#workspaceId, this.#sessionId,
          agent, previous?.surface_id ?? null, surfaceId, bounded(reason, 500), at,
        );
        this.#database.prepare(`INSERT INTO app_server_surface_focus
          (workspace_id, session_id, agent_id, surface_id, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id, session_id, agent_id) DO UPDATE SET surface_id = excluded.surface_id,
            updated_at = excluded.updated_at`).run(this.#workspaceId, this.#sessionId, agent, surfaceId, at);
      }
      this.#database.exec("COMMIT");
      const focused = this.require(surfaceId);
      let foundationScout: SurfaceFoundationScout | undefined;
      if (touched) {
        try {
          foundationScout = this.#firstTouchHandler?.(focused, agent) ??
            { status: "unavailable", agentPath: null, reason: "No foundation scout is available in this session." };
        } catch (error) {
          foundationScout = { status: "unavailable", agentPath: null, reason: error instanceof Error ? error.message : String(error) };
        }
      }
      return { surface: focused, surfaceTrail: this.hierarchy(surfaceId), firstTouch: touched, previousSurfaceId: previous?.surface_id ?? null,
        ...(foundationScout ? { foundationScout } : {}) };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public current(agentId: string): ResearchSurface | null {
    const row = this.#database.prepare(`SELECT surface_id FROM app_server_surface_focus
      WHERE workspace_id = ? AND session_id = ? AND agent_id = ?`)
      .get(this.#workspaceId, this.#sessionId, agentId) as { surface_id: string } | undefined;
    return row ? this.get(row.surface_id) : null;
  }

  #root(resource: TrackedResearchResource): ResearchSurface {
    const row = this.#database.prepare("SELECT * FROM app_server_surface_roots WHERE resource_id = ? AND workspace_id = ?")
      .get(resource.id, this.#workspaceId) as SurfaceRow | undefined;
    const stored = decodeStoredFoundation(row?.foundation_json);
    return {
      id: resource.id, workspaceId: this.#workspaceId, resourceId: resource.id, parentId: null,
      name: resource.name, description: resource.rationale, root: true,
      firstTouchedAt: this.#touchedAt(resource.id),
      foundation: stored?.foundation ?? null, progressBlocker: stored?.progressBlocker ?? null,
      revision: row ? Number(row.revision) : 1,
      createdAt: resource.discoveredAt, updatedAt: row ? String(row.updated_at) : resource.updatedAt,
    };
  }

  #child(row: SurfaceRow): ResearchSurface {
    const stored = decodeStoredFoundation(row.foundation_json);
    return {
      id: String(row.id), workspaceId: String(row.workspace_id), resourceId: String(row.resource_id),
      parentId: String(row.parent_id), name: String(row.name), description: String(row.description), root: false,
      firstTouchedAt: this.#touchedAt(String(row.id)), foundation: stored?.foundation ?? null,
      progressBlocker: stored?.progressBlocker ?? null,
      revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  #touchedAt(id: string): string | null {
    const row = this.#database.prepare("SELECT first_touched_at FROM app_server_surface_touches WHERE surface_id = ? AND workspace_id = ?")
      .get(id, this.#workspaceId) as { first_touched_at: string } | undefined;
    return row?.first_touched_at ?? null;
  }

  #card(surface: ResearchSurface): SurfaceCard {
    const coverage = surface.foundation?.coverage;
    const resource = this.#resources.get(surface.resourceId);
    return {
      id: surface.id, resourceId: surface.resourceId, resourceKind: resource?.kind ?? null,
      resourceSource: resource?.source ?? null, parentId: surface.parentId,
      name: surface.name, path: this.path(surface.id), root: surface.root,
      focusEligible: this.#focusEligible(surface),
      firstTouchedAt: surface.firstTouchedAt, foundationReady: surface.foundation !== null,
      progressBlocker: surface.progressBlocker,
      coverage: coverage ? { ...coverage, summary: bounded(coverage.summary, 260), gaps: bounded(coverage.gaps, 260), opportunities: bounded(coverage.opportunities, 260) } : null,
      coverageState: this.coverageState(surface.id),
      updatedAt: surface.updatedAt,
    };
  }

  public coverageState(id: string): SurfaceCoverageState {
    const surface = this.require(id);
    const unblockedFindingIds = this.#unblockedFindingIds(surface);
    const children = this.#database.prepare("SELECT id FROM app_server_surfaces WHERE workspace_id = ? AND parent_id = ?")
      .all(this.#workspaceId, id) as { id: string }[];
    return assessSurfaceCoverage(surface.foundation, unblockedFindingIds,
      children.some((child) => !this.coverageState(child.id).covered), Boolean(surface.progressBlocker));
  }

  #unblockedFindingIds(surface: ResearchSurface): string[] {
    const table = this.#database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_server_research_claims'").get();
    if (!table) return [];
    const rows = this.#database.prepare(`SELECT id, status, security_tracking_json FROM app_server_research_claims
      WHERE workspace_id = ? AND duplicate_of_claim_id IS NULL
        AND (classification = 'security' OR classification LIKE 'security.%')
        AND status IN ('observed', 'reproduced', 'verified', 'report_ready')`).all(this.#workspaceId) as { id: string; status: string; security_tracking_json: string }[];
    return rows.flatMap((row) => {
      try {
        const tracking: unknown = JSON.parse(row.security_tracking_json);
        if (!tracking || typeof tracking !== "object" || Array.isArray(tracking)) return [];
        const record = tracking as Record<string, unknown>;
        const blocked = (row.status === "observed" || row.status === "reproduced") && Boolean(record.progressBlocker);
        const surfaceIds = Array.isArray(record.surfaceIds) ? record.surfaceIds : [];
        const unassigned = surface.root && surfaceIds.length === 0
          && (!Array.isArray(record.affectedAssetIds) || record.affectedAssetIds.length === 0
            || record.affectedAssetIds.includes(surface.resourceId));
        return !blocked && (surfaceIds.includes(surface.id) || unassigned) ? [row.id] : [];
      } catch { return []; }
    });
  }

  #focusEligible(surface: ResearchSurface): boolean {
    const resource = this.#resources.get(surface.resourceId);
    return Boolean(resource && resource.workspaceId === this.#workspaceId
      && resource.direction !== "out_of_scope" && resource.reviewStatus !== "not_relevant"
      && (resource.source !== "runtime_discovery" || resource.reviewStatus === "relevant"));
  }
}

export function createSurfaceTools(store: SurfaceStore): ResearchExecutableTool[] {
  const foundationSchema = {
    type: "object", required: ["bugHistory", "coverage", "threatModel"], additionalProperties: false,
    properties: {
      bugHistory: { type: "object", required: ["summary", "limits"], properties: {
        summary: { type: "string", description: "What prior security bugs, advisories, or bounded searches establish for this surface; include dated no-match findings only within their searched bounds." },
        limits: { type: "string", description: "Unsearched sources, versions, aliases, or other limits; write Unknown when needed." },
      } },
      coverage: { type: "object", required: ["summary", "gaps", "opportunities"], properties: {
        summary: { type: "string", description: "Attacker paths, trust boundaries, privilege contexts, and security-relevant sinks actually inspected or tested; do not count general code browsing as security coverage." },
        gaps: { type: "string", description: "Narrative of known missing, blocked, or stale areas. Record unresolved work in the structured coverage fields; a blocked finding may remain here after its progress blocker is recorded." },
        opportunities: { type: "string", description: "Promising security-relevant paths, chains, or experiments that could distinguish a plausible unauthorized effect from harmless behavior." },
        mappingComplete: { type: "boolean", description: "Whether all threat-model-defined attacker paths, boundaries, and plausible unauthorized effects in this surface are mapped. Unknown counts as false." },
        sinksInvestigated: { type: "boolean", description: "Whether every known security-relevant sink and effect in this surface has been investigated. Unknown counts as false." },
        openQuestions: { type: "array", items: { type: "string" }, description: "Unanswered attacker-control, reachability, boundary, or security-impact questions." },
        unexploredConnections: { type: "array", items: { type: "string" }, description: "Known security-relevant connections or possible chains to other surfaces that remain unexplored." },
      } },
      threatModel: { type: "object", required: ["attackerControl", "trustBoundaries", "assetsAtRisk", "plausibleImpacts", "assumptions"], properties: {
        attackerControl: { type: "string", description: "Concrete attacker-controlled inputs, entry points, and preconditions." },
        trustBoundaries: { type: "string", description: "Where lower-trust control crosses into higher-trust parsing, identity, authority, or execution." },
        assetsAtRisk: { type: "string", description: "Assets or privileges an attacker could affect." },
        plausibleImpacts: { type: "string", description: "Plausible unauthorized effects, with reachability and evidence limits; ordinary malfunction alone is not security impact." },
        assumptions: { type: "string", description: "Unknowns and assumptions required for the attacker path or impact." },
      } },
    },
  };
  const specs = [
    { name: "surface.list", transportName: "surface_list", effect: "read", properties: { resourceId: { type: "string" }, resourceKind: { type: "string", enum: ["domain", "repository", "binary", "service", "tool", "documentation", "other"], description: "Filter roots and children by resource kind to compare research outside a dominant source index." }, parentId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 }, offset: { type: "integer", minimum: 0 } }, required: [] },
    { name: "surface.get", transportName: "surface_get", effect: "read", properties: { surfaceId: { type: "string" } }, required: ["surfaceId"] },
    { name: "surface.query", transportName: "surface_query", effect: "read", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 }, offset: { type: "integer", minimum: 0 } }, required: ["query"] },
    { name: "surface.create", transportName: "surface_create", effect: "write", properties: { parentId: { type: "string" }, name: { type: "string" }, description: { type: "string", description: "Security-relevant attacker path, trust boundary, privilege context, sink, or effect that distinguishes this child surface." } }, required: ["parentId", "name", "description"] },
    { name: "surface.update", transportName: "surface_update", effect: "write", properties: { surfaceId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 }, name: { type: "string" }, description: { type: "string" }, foundation: { ...foundationSchema, description: "Required for a surface without a foundation; omit to preserve an existing foundation when only changing other fields." },
      progressBlocker: { anyOf: [{ type: "object", required: ["reason"], additionalProperties: false,
        properties: { reason: { type: "string", description: "Name the blocked action, concrete external dependency, the authorized work already completed without it (such as pre-auth testing), and what would unblock the rest. Set only after reachable work is exhausted." } } }, { type: "null" }], description: "Set a concrete external blocker, or pass null to clear it. The existing foundation may be omitted." } }, required: ["surfaceId", "expectedRevision"] },
    { name: "surface.focus", transportName: "surface_focus", effect: "write", properties: { surfaceId: { type: "string" }, reason: { type: "string" } }, required: ["surfaceId"] },
  ] as const;
  return specs.map((spec): ResearchExecutableTool => ({
    descriptor: {
      name: spec.name, transportName: spec.transportName,
      description: spec.name === "surface.focus"
        ? "Declare a move to a security-relevant surface. The first focus ever in this workspace records its one-time touch and starts its security bug-history, coverage, and threat-model foundation. Focus neither authorizes target access nor restricts research tools."
        : spec.name === "surface.query"
          ? "Find surfaces by simple text across names, descriptions, paths, and foundation summaries."
          : `Read or refine the resource-owned security surface tree (${spec.name}). Child surfaces distinguish attacker paths, trust boundaries, privilege contexts, or security-relevant sinks and effects. Foundations summarize relevant security bug history, threat model, and coverage without duplicating memory or evidence.`,
      actionClasses: [spec.effect === "read" ? "recall" : "synthesize"], sideEffects: spec.effect,
      requiredPermissions: ["research-resource:inventory"],
      inputSchema: { type: "object", required: spec.required, properties: spec.properties, additionalProperties: false },
    },
    parameters: { type: "object", required: spec.required, properties: spec.properties, additionalProperties: false },
    async execute(action: ResearchToolAction, context?: ResearchToolExecutionContext) {
      const input = action.input;
      const startedAt = nowIso();
      try {
        let output: unknown;
        switch (spec.name) {
          case "surface.list": output = store.list({ ...(typeof input.resourceId === "string" ? { resourceId: input.resourceId } : {}), ...(typeof input.resourceKind === "string" ? { resourceKind: input.resourceKind } : {}), ...(typeof input.parentId === "string" ? { parentId: input.parentId } : {}), ...(typeof input.limit === "number" ? { limit: input.limit } : {}), ...(typeof input.offset === "number" ? { offset: input.offset } : {}) }); break;
          case "surface.get": {
            const surface = store.require(nonempty(input.surfaceId, "surfaceId"));
            output = { ...surface, coverageState: store.coverageState(surface.id) };
            break;
          }
          case "surface.query": output = store.query(nonempty(input.query, "query"), typeof input.limit === "number" ? input.limit : 20, typeof input.offset === "number" ? input.offset : 0); break;
          case "surface.create": output = store.create(nonempty(input.parentId, "parentId"), nonempty(input.name, "name"), nonempty(input.description, "description")); break;
          case "surface.update": output = store.update(nonempty(input.surfaceId, "surfaceId"), positive(input.expectedRevision, "expectedRevision"), input.foundation === undefined ? undefined : parseFoundation(input.foundation), typeof input.name === "string" ? input.name : undefined, typeof input.description === "string" ? input.description : undefined,
            parseBlockerUpdate(input.progressBlocker),
            context?.agentId ?? "root"); break;
          case "surface.focus": output = store.focus(context?.agentId ?? "root", nonempty(input.surfaceId, "surfaceId"), typeof input.reason === "string" ? input.reason : "research"); break;
        }
        return { action, status: "complete", startedAt, completedAt: nowIso(), summary: `${spec.name} completed.`, output, followUpActions: spec.name === "surface.focus" && typeof output === "object" && output !== null && "foundationScout" in output && output.foundationScout
          ? ["A first-touch foundation scout has been requested. Coordinate with it using its reported status and avoid duplicating its assignment."] : [] };
      } catch (error) {
        return { action, status: "error", startedAt, completedAt: nowIso(), summary: `${spec.name} failed.`, error: { message: error instanceof Error ? error.message : String(error) }, followUpActions: [] };
      }
    },
  }));
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function bounded(value: string, max: number): string { return value.trim().slice(0, max); }
function bound(value: number | undefined, fallback: number): number { return value === undefined ? fallback : Math.max(1, Math.min(50, Math.floor(value))); }
function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}
function section(value: unknown, keys: readonly string[], name: string): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, bounded(nonempty(record[key], `${name}.${key}`), 4_000)]));
}
function parseFoundation(value: unknown): SurfaceFoundation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("foundation must be an object.");
  const record = value as Record<string, unknown>;
  return {
    bugHistory: section(record.bugHistory, ["summary", "limits"], "foundation.bugHistory") as unknown as SurfaceFoundation["bugHistory"],
    coverage: parseCoverage(record.coverage),
    threatModel: section(record.threatModel, ["attackerControl", "trustBoundaries", "assetsAtRisk", "plausibleImpacts", "assumptions"], "foundation.threatModel") as unknown as SurfaceFoundation["threatModel"],
  };
}
function parseProgressBlocker(value: unknown): SurfaceProgressBlocker | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored surface progress blocker must be an object.");
  const record = value as Record<string, unknown>;
  const setAt = nonempty(record.setAt, "Progress blocker timestamp");
  if (!Number.isFinite(Date.parse(setAt))) throw new Error("Progress blocker timestamp must be a date-time.");
  return { reason: bounded(nonempty(record.reason, "Progress blocker reason"), 2_000),
    actorId: bounded(nonempty(record.actorId, "Progress blocker actor"), 200), setAt };
}
function parseBlockerUpdate(value: unknown): { reason: string } | null | undefined {
  if (value === undefined || value === null) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("progressBlocker must be an object or null.");
  return { reason: nonempty((value as Record<string, unknown>).reason, "progressBlocker.reason") };
}
function parseCoverage(value: unknown): SurfaceFoundation["coverage"] {
  const text = section(value, ["summary", "opportunities"], "foundation.coverage") as Pick<SurfaceFoundation["coverage"], "summary" | "opportunities">;
  const record = value as Record<string, unknown>;
  if (typeof record.gaps !== "string") throw new Error("foundation.coverage.gaps must be a string.");
  return {
    ...text,
    gaps: bounded(record.gaps, 4_000),
    mappingComplete: record.mappingComplete === true,
    sinksInvestigated: record.sinksInvestigated === true,
    openQuestions: coverageList(record.openQuestions, "foundation.coverage.openQuestions"),
    unexploredConnections: coverageList(record.unexploredConnections, "foundation.coverage.unexploredConnections"),
  };
}
function coverageList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${name} must be an array with at most 100 entries.`);
  return [...new Set(value.map((item) => bounded(nonempty(item, name), 500)))];
}
function decodeStoredFoundation(value: unknown): { foundation: SurfaceFoundation; progressBlocker: SurfaceProgressBlocker | null } | null {
  if (typeof value !== "string") return null;
  const parsed = JSON.parse(value) as unknown;
  return { foundation: parseFoundation(parsed), progressBlocker: parseProgressBlocker((parsed as Record<string, unknown>).progressBlocker) };
}
