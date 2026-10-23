import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openResearchDatabase } from "./database.js";
import type { ResearchExecutableTool, ResearchToolExecutionContext } from "./tool-registry.js";
import type { ResearchToolAction } from "./types.js";

export type ResearchTrackStatus = "running" | "paused" | "waiting" | "complete" | "stopped";
export type ResearchTrackWorkStatus = "unexamined" | "active" | "deferred" | "blocked" | "complete" | "excluded";
export type ResearchTrackImpact = "unknown" | "low" | "medium" | "high" | "critical";

export interface ResearchTrackSurfaceState {
  surfaceId: string;
  name: string;
  status: ResearchTrackWorkStatus;
  impact: ResearchTrackImpact;
  theory: string;
  nextAction: string;
  evidenceRefs: string[];
  epochs: number;
  noProgressEpochs: number;
  revisits: number;
  revisitAfter: string | null;
  lastWorkedAt: string | null;
  updatedAt: string;
}

export interface ResearchTrackSnapshot {
  id: string;
  workspaceId: string;
  status: ResearchTrackStatus;
  pass: number;
  scopeId: string;
  provider: { id: string; model?: string; reasoningEffort?: string };
  targetIds: string[];
  collaboration?: Record<string, unknown>;
  activeSessionId: string | null;
  activeSurfaceId: string | null;
  epochCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  surfaces: ResearchTrackSurfaceState[];
}

export interface ResearchTrackSurfaceProjection {
  id: string;
  parentId: string | null;
  name: string;
  coverageState: { covered: boolean; unmetRequirements: string[]; unblockedFindingIds?: string[] };
  progressBlocker: { reason: string } | null;
}

type Row = Record<string, unknown>;

const IMPACT_RANK: Record<ResearchTrackImpact, number> = { unknown: 2, low: 1, medium: 2, high: 3, critical: 4 };

/** Durable workspace-wide research work. The app-server owns scheduling; model tools only record research. */
export class ResearchTrackStore {
  readonly #database: DatabaseSync;
  readonly #workspaceId: string;
  readonly #sessionId: string | null;

  public constructor(input: { databasePath: string; workspaceId: string; sessionId?: string }) {
    this.#database = openResearchDatabase(input.databasePath);
    this.#workspaceId = required(input.workspaceId, "workspaceId");
    this.#sessionId = input.sessionId ?? null;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS app_server_research_tracks (
        workspace_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
        pass INTEGER NOT NULL, scope_id TEXT NOT NULL, provider_json TEXT NOT NULL,
        target_ids_json TEXT NOT NULL, collaboration_json TEXT,
        active_session_id TEXT, active_surface_id TEXT,
        epoch_count INTEGER NOT NULL, last_surface_id TEXT, consecutive_surface_epochs INTEGER NOT NULL,
        last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_server_research_track_surfaces (
        workspace_id TEXT NOT NULL, surface_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
        impact TEXT NOT NULL, theory TEXT NOT NULL, next_action TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL, epochs INTEGER NOT NULL, no_progress_epochs INTEGER NOT NULL,
        revisits INTEGER NOT NULL, revisit_after TEXT, last_worked_at TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id, surface_id)
      );
      CREATE TABLE IF NOT EXISTS app_server_research_track_history (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, pass INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL, saved_at TEXT NOT NULL
      );
    `);
    const columns = this.#database.prepare("PRAGMA table_info(app_server_research_tracks)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "collaboration_json")) {
      this.#database.exec("ALTER TABLE app_server_research_tracks ADD COLUMN collaboration_json TEXT");
    }
  }

  public close(): void { this.#database.close(); }

  public get(): ResearchTrackSnapshot | null {
    const row = this.#database.prepare("SELECT * FROM app_server_research_tracks WHERE workspace_id = ?")
      .get(this.#workspaceId) as Row | undefined;
    if (!row) return null;
    const surfaces = this.#database.prepare("SELECT * FROM app_server_research_track_surfaces WHERE workspace_id = ? ORDER BY updated_at, surface_id")
      .all(this.#workspaceId) as Row[];
    return {
      id: String(row.id), workspaceId: this.#workspaceId, status: row.status as ResearchTrackStatus,
      pass: Number(row.pass), scopeId: String(row.scope_id),
      provider: JSON.parse(String(row.provider_json)) as ResearchTrackSnapshot["provider"],
      targetIds: JSON.parse(String(row.target_ids_json)) as string[],
      ...(row.collaboration_json ? { collaboration: JSON.parse(String(row.collaboration_json)) as Record<string, unknown> } : {}),
      activeSessionId: nullable(row.active_session_id), activeSurfaceId: nullable(row.active_surface_id),
      epochCount: Number(row.epoch_count), lastError: nullable(row.last_error),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      surfaces: surfaces.map((surface) => ({
        surfaceId: String(surface.surface_id), name: String(surface.name), status: surface.status as ResearchTrackWorkStatus,
        impact: surface.impact as ResearchTrackImpact, theory: String(surface.theory),
        nextAction: String(surface.next_action), evidenceRefs: JSON.parse(String(surface.evidence_refs_json)) as string[],
        epochs: Number(surface.epochs), noProgressEpochs: Number(surface.no_progress_epochs),
        revisits: Number(surface.revisits), revisitAfter: nullable(surface.revisit_after),
        lastWorkedAt: nullable(surface.last_worked_at), updatedAt: String(surface.updated_at),
      })),
    };
  }

  public start(input: {
    scopeId: string;
    provider: ResearchTrackSnapshot["provider"];
    targetIds: string[];
    collaboration?: Record<string, unknown>;
    surfaces: readonly ResearchTrackSurfaceProjection[];
    replaceUnfinished?: boolean;
  }): ResearchTrackSnapshot {
    if (input.surfaces.length === 0) throw new Error("A research track requires an eligible scope surface.");
    if (input.targetIds.length === 0 || input.targetIds.length > 16
      || new Set(input.targetIds).size !== input.targetIds.length) {
      throw new Error("A research track requires 1 to 16 distinct research targets.");
    }
    const existing = this.get();
    if (existing?.status === "running" || existing?.activeSessionId
      || (existing?.status === "paused" || existing?.status === "waiting") && !input.replaceUnfinished) {
      throw new Error("This workspace already has an unfinished research track.");
    }
    const now = new Date().toISOString();
    const id = existing?.id ?? `track_${randomUUID().replaceAll("-", "")}`;
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      if (existing) this.#database.prepare(`INSERT INTO app_server_research_track_history
        (id, workspace_id, pass, snapshot_json, saved_at) VALUES (?, ?, ?, ?, ?)`)
        .run(`track_history_${randomUUID().replaceAll("-", "")}`, this.#workspaceId,
          existing.pass, JSON.stringify(existing), now);
      this.#database.prepare(`INSERT INTO app_server_research_tracks
        (workspace_id, id, status, pass, scope_id, provider_json, target_ids_json, collaboration_json, active_session_id,
         active_surface_id, epoch_count, last_surface_id, consecutive_surface_epochs, last_error, created_at, updated_at)
        VALUES (?, ?, 'running', ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, 0, NULL, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET status='running', pass=excluded.pass,
          scope_id=excluded.scope_id, provider_json=excluded.provider_json,
          target_ids_json=excluded.target_ids_json, collaboration_json=excluded.collaboration_json,
          active_session_id=NULL, active_surface_id=NULL,
          epoch_count=0, last_surface_id=NULL, consecutive_surface_epochs=0,
          last_error=NULL, updated_at=excluded.updated_at`)
        .run(this.#workspaceId, id, (existing?.pass ?? 0) + 1, required(input.scopeId, "scopeId"),
          JSON.stringify(input.provider), JSON.stringify(input.targetIds),
          input.collaboration ? JSON.stringify(input.collaboration) : null, now, now);
      if (existing) this.#database.prepare("DELETE FROM app_server_research_track_surfaces WHERE workspace_id = ?").run(this.#workspaceId);
      this.#insertSurfaces(input.surfaces, now);
      this.#database.exec("COMMIT");
    } catch (error) { this.#database.exec("ROLLBACK"); throw error; }
    return this.get()!;
  }

  public syncSurfaces(surfaces: readonly ResearchTrackSurfaceProjection[]): ResearchTrackSnapshot | null {
    const track = this.get();
    if (!track) return null;
    const now = new Date().toISOString();
    const visibleIds = new Set(surfaces.map((surface) => surface.id));
    const newSurface = surfaces.some((surface) => !track.surfaces.some((work) => work.surfaceId === surface.id));
    this.#insertSurfaces(surfaces, now);
    for (const work of track.surfaces) {
      if (!visibleIds.has(work.surfaceId) && work.status !== "excluded") {
        this.#database.prepare(`UPDATE app_server_research_track_surfaces SET status='excluded', updated_at=?
          WHERE workspace_id=? AND surface_id=?`).run(now, this.#workspaceId, work.surfaceId);
      }
    }
    for (const surface of surfaces) {
      this.#database.prepare(`UPDATE app_server_research_track_surfaces SET name=?
        WHERE workspace_id=? AND surface_id=?`).run(surface.name, this.#workspaceId, surface.id);
      const work = track.surfaces.find((item) => item.surfaceId === surface.id);
      if (!work) continue;
      if (work.status === "excluded") {
        this.#database.prepare(`UPDATE app_server_research_track_surfaces SET status=?, updated_at=?
          WHERE workspace_id=? AND surface_id=?`).run(surface.progressBlocker ? "blocked" : "deferred", now, this.#workspaceId, surface.id);
      } else if (surface.progressBlocker && work.status !== "blocked") {
        this.#database.prepare(`UPDATE app_server_research_track_surfaces SET status='blocked', updated_at=?
          WHERE workspace_id=? AND surface_id=?`).run(now, this.#workspaceId, surface.id);
      } else if (!surface.progressBlocker && work.status === "blocked") {
        this.#database.prepare(`UPDATE app_server_research_track_surfaces SET status='deferred', updated_at=?
          WHERE workspace_id=? AND surface_id=?`).run(now, this.#workspaceId, surface.id);
      } else if (work.status === "complete" && !this.#coverageSatisfied(surface, track)) {
        this.#database.prepare(`UPDATE app_server_research_track_surfaces SET status='deferred', next_action=?, updated_at=?
          WHERE workspace_id=? AND surface_id=?`).run("Revisit changed or incomplete security coverage.", now, this.#workspaceId, surface.id);
      }
    }
    if (newSurface && track.status === "complete") this.pauseWithError("A new eligible security surface appeared. Resume for another pass.");
    return this.get();
  }

  public control(action: "pause" | "resume" | "stop"): ResearchTrackSnapshot {
    const track = this.get();
    if (!track) throw new Error("No research track exists in this workspace.");
    if (action === "resume" && track.status !== "paused" && track.status !== "waiting") {
      throw new Error("Only a paused or waiting research track can resume.");
    }
    if (action === "pause" && track.status !== "running") throw new Error("Only a running research track can pause.");
    const status = action === "resume" ? "running" : action === "pause" ? "paused" : "stopped";
    this.#database.prepare(`UPDATE app_server_research_tracks SET status=?,
      last_error=CASE WHEN ? THEN NULL ELSE last_error END, updated_at=? WHERE workspace_id=?`)
      .run(status, action === "resume" || action === "stop" ? 1 : 0, new Date().toISOString(), this.#workspaceId);
    return this.get()!;
  }

  public pauseWithError(reason: string): ResearchTrackSnapshot | null {
    if (!this.get()) return null;
    this.#database.prepare(`UPDATE app_server_research_tracks SET status='paused', last_error=?, updated_at=?
      WHERE workspace_id=?`).run(bounded(required(reason, "reason"), 1_000), new Date().toISOString(), this.#workspaceId);
    return this.get();
  }

  public reserveNext(sessionId: string, surfaces: readonly ResearchTrackSurfaceProjection[]): { track: ResearchTrackSnapshot; surface: ResearchTrackSurfaceProjection } | null {
    const track = this.syncSurfaces(surfaces);
    if (!track || track.status !== "running" || track.activeSessionId) return null;
    const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
    const actionable = track.surfaces.filter((work) => {
      const surface = byId.get(work.surfaceId);
      if (!surface || work.status === "complete" || work.status === "blocked" || work.status === "excluded") return false;
      if (surface.parentId === null && surface.coverageState.unmetRequirements.length > 0
        && surface.coverageState.unmetRequirements.every((item) => item === "child_surfaces")
        && track.surfaces.some((child) => byId.get(child.surfaceId)?.parentId === surface.id
          && child.status !== "complete" && child.status !== "excluded")) return false;
      return true;
    });
    const ready = actionable.filter((work) => !work.revisitAfter || work.revisitAfter <= new Date().toISOString());
    // A second look should follow other available work, but never leave a
    // running track idle solely because its remaining revisit time is future.
    const eligible = ready.length > 0 ? ready : actionable;
    const rootFirstPass = eligible.some((work) => byId.get(work.surfaceId)?.parentId === null && work.epochs === 0);
    const candidates = eligible.filter((work) => !rootFirstPass || byId.get(work.surfaceId)?.parentId === null
      || work.impact === "critical").sort((left, right) => {
      const priority = (work: ResearchTrackSurfaceState): number =>
        IMPACT_RANK[work.impact] * 100 + (work.epochs === 0 ? 40 : 0)
        + (work.status === "deferred" ? 5 : 0) - work.noProgressEpochs * 25;
      return priority(right) - priority(left)
        || (left.lastWorkedAt ?? "").localeCompare(right.lastWorkedAt ?? "")
        || left.surfaceId.localeCompare(right.surfaceId);
    });
    const history = this.#database.prepare("SELECT last_surface_id, consecutive_surface_epochs FROM app_server_research_tracks WHERE workspace_id=?")
      .get(this.#workspaceId) as { last_surface_id: string | null; consecutive_surface_epochs: number };
    const selected = history.consecutive_surface_epochs >= 2 && candidates.length > 1
      ? candidates.find((candidate) => candidate.surfaceId !== history.last_surface_id) ?? candidates[0]
      : candidates[0];
    if (!selected) {
      const status = track.surfaces.every((work) => work.status === "complete" || work.status === "excluded") ? "complete"
        : track.surfaces.some((work) => work.status === "blocked") ? "waiting" : "paused";
      const error = status === "paused" ? "No actionable surface could be selected; review remaining coverage gaps." : null;
      this.#database.prepare("UPDATE app_server_research_tracks SET status=?, last_error=?, updated_at=? WHERE workspace_id=?")
        .run(status, error, new Date().toISOString(), this.#workspaceId);
      return null;
    }
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const reserved = this.#database.prepare(`UPDATE app_server_research_tracks SET active_session_id=?, active_surface_id=?,
        epoch_count=epoch_count+1, last_surface_id=?,
        consecutive_surface_epochs=CASE WHEN last_surface_id=? THEN consecutive_surface_epochs+1 ELSE 1 END,
        updated_at=? WHERE workspace_id=? AND status='running' AND active_session_id IS NULL`)
        .run(required(sessionId, "sessionId"), selected.surfaceId, selected.surfaceId, selected.surfaceId, now, this.#workspaceId).changes;
      if (!reserved) { this.#database.exec("ROLLBACK"); return null; }
      this.#database.prepare(`UPDATE app_server_research_track_surfaces SET status='active', epochs=epochs+1,
        last_worked_at=?, updated_at=? WHERE workspace_id=? AND surface_id=?`)
        .run(now, now, this.#workspaceId, selected.surfaceId);
      this.#database.exec("COMMIT");
    } catch (error) { this.#database.exec("ROLLBACK"); throw error; }
    return { track: this.get()!, surface: byId.get(selected.surfaceId)! };
  }

  public checkpoint(input: {
    surfaceId: string;
    outcome: "continue" | "defer" | "blocked" | "complete";
    impact: ResearchTrackImpact;
    theory: string;
    nextAction: string;
    evidenceRefs: string[];
  }, surface: ResearchTrackSurfaceProjection): ResearchTrackSurfaceState {
    const track = this.get();
    if (!track || !this.#sessionId || track.activeSessionId !== this.#sessionId
      || track.activeSurfaceId !== input.surfaceId || surface.id !== input.surfaceId) {
      throw new Error("The active research track assigned a different surface to this session.");
    }
    if (input.outcome === "complete" && (!this.#coverageSatisfied(surface, track) || input.evidenceRefs.length === 0)) {
      throw new Error("A surface needs complete threat-model coverage, report-ready findings, and durable evidence before track completion.");
    }
    if (input.outcome === "blocked" && !surface.progressBlocker) {
      throw new Error("Set a concrete surface progress blocker before marking track work blocked.");
    }
    const evidenceRefs = [...new Set(input.evidenceRefs.map((ref) => required(ref, "evidenceRef")))].slice(0, 32);
    const work = track.surfaces.find((item) => item.surfaceId === input.surfaceId)!;
    if (evidenceRefs.some((ref) => !this.#validEvidenceRef(ref))) {
      throw new Error("Track checkpoints may cite only existing canonical evidence in this workspace.");
    }
    if (input.outcome === "complete" && !evidenceRefs.some((ref) => this.#validEvidenceRef(ref, work.lastWorkedAt))) {
      throw new Error("Completed track work must cite canonical evidence updated during this research epoch.");
    }
    const secondLook = input.outcome === "complete" && (input.impact === "high" || input.impact === "critical") && work.revisits === 0;
    const status = input.outcome === "continue" || input.outcome === "defer" || secondLook ? "deferred" : input.outcome;
    const prior = work;
    const now = new Date().toISOString();
    const revisitAfter = secondLook ? new Date(Date.now() + 30 * 60_000).toISOString() : null;
    const nextAction = secondLook
      ? `Revisit this high-impact surface from a different attacker path after other surface work. ${input.nextAction}`
      : input.nextAction;
    const changed = JSON.stringify(prior.evidenceRefs) !== JSON.stringify(evidenceRefs)
      || evidenceRefs.some((ref) => this.#validEvidenceRef(ref, work.lastWorkedAt))
      || status === "complete" || status === "blocked";
    this.#database.prepare(`UPDATE app_server_research_track_surfaces SET status=?, impact=?, theory=?, next_action=?,
      evidence_refs_json=?, no_progress_epochs=?, revisits=?, revisit_after=?, updated_at=?
      WHERE workspace_id=? AND surface_id=?`)
      .run(status, input.impact, bounded(input.theory, 2_000), bounded(nextAction, 2_000),
        JSON.stringify(evidenceRefs), changed ? 0 : prior.noProgressEpochs + 1,
        input.outcome === "complete" ? prior.revisits + 1 : prior.revisits,
        revisitAfter, now, this.#workspaceId, input.surfaceId);
    return this.get()!.surfaces.find((work) => work.surfaceId === input.surfaceId)!;
  }

  public finishEpoch(sessionId: string, succeeded: boolean, diagnostic?: string): ResearchTrackSnapshot | null {
    const track = this.get();
    if (!track || track.activeSessionId !== sessionId) return track;
    const work = track.surfaces.find((item) => item.surfaceId === track.activeSurfaceId);
    const now = new Date().toISOString();
    if (work?.status === "active") {
      this.#database.prepare(`UPDATE app_server_research_track_surfaces SET status='deferred', no_progress_epochs=no_progress_epochs+1,
        next_action=?, updated_at=? WHERE workspace_id=? AND surface_id=?`)
        .run("Resume the assigned threat-model investigation and record a durable checkpoint.", now, this.#workspaceId, work.surfaceId);
    }
    const noProgressEpochs = work ? work.noProgressEpochs + (work.status === "active" ? 1 : 0) : 0;
    const repeatedNoProgress = noProgressEpochs >= 3;
    this.#database.prepare(`UPDATE app_server_research_tracks SET active_session_id=NULL, active_surface_id=NULL,
      status=CASE WHEN ? THEN 'paused' ELSE status END, last_error=?, updated_at=? WHERE workspace_id=?`)
      .run(repeatedNoProgress ? 1 : 0,
        repeatedNoProgress ? "Three epochs on one surface produced no durable progress. Review its theory or scope before resuming."
          : succeeded ? null : bounded(diagnostic ?? "The research epoch ended before completion.", 1_000), now, this.#workspaceId);
    return this.get();
  }

  #insertSurfaces(surfaces: readonly ResearchTrackSurfaceProjection[], now: string): void {
    const insert = this.#database.prepare(`INSERT OR IGNORE INTO app_server_research_track_surfaces
      (workspace_id, surface_id, name, status, impact, theory, next_action, evidence_refs_json,
       epochs, no_progress_epochs, revisits, revisit_after, last_worked_at, updated_at)
      VALUES (?, ?, ?, 'unexamined', 'unknown', '', 'Map the attacker path and highest-impact plausible effect.', '[]', 0, 0, 0, NULL, NULL, ?)`);
    for (const surface of surfaces) insert.run(this.#workspaceId, surface.id, surface.name, now);
  }

  #validEvidenceRef(ref: string, since?: string | null): boolean {
    const match = /^(finding|memory|runbook|report):([A-Za-z0-9_-]{1,160})$/u.exec(ref);
    if (!match) return false;
    const kind = match[1] as "finding" | "memory" | "runbook" | "report";
    const table = { finding: "app_server_research_claims", memory: "memory_nodes",
      runbook: "app_server_runbooks", report: "app_server_reports" }[kind];
    if (!this.#database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) return false;
    if (kind === "memory" && !this.#database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_node_workspaces'").get()) return false;
    const query = kind === "memory"
      ? `SELECT node.updated_at FROM memory_nodes node
          JOIN memory_node_workspaces membership ON membership.node_id=node.id
          WHERE node.id=? AND membership.workspace_id=? LIMIT 1`
      : `SELECT updated_at FROM ${table} WHERE id=? AND workspace_id=? LIMIT 1`;
    const row = this.#database.prepare(query)
      .get(match[2]!, this.#workspaceId) as { updated_at?: unknown } | undefined;
    return typeof row?.updated_at === "string" && (!since || row.updated_at >= since);
  }

  #coverageSatisfied(surface: ResearchTrackSurfaceProjection, track: ResearchTrackSnapshot): boolean {
    if (surface.coverageState.covered) return true;
    if (surface.coverageState.unmetRequirements.length === 0) return false;
    return surface.coverageState.unmetRequirements.every((requirement) => {
      if (requirement === "unblocked_findings") {
        const ids = surface.coverageState.unblockedFindingIds ?? [];
        if (ids.length === 0) return false;
        return ids.every((id) => {
          const row = this.#database.prepare(`SELECT status FROM app_server_research_claims
            WHERE id=? AND workspace_id=?`).get(id, this.#workspaceId) as { status?: unknown } | undefined;
          return row?.status === "report_ready" || row?.status === "disclosed";
        });
      }
      if (requirement === "child_surfaces") {
        const children = this.#database.prepare(`SELECT id FROM app_server_surfaces
          WHERE workspace_id=? AND parent_id=?`).all(this.#workspaceId, surface.id) as { id: string }[];
        return children.length > 0 && children.every((child) => track.surfaces.some((work) =>
          work.surfaceId === child.id && (work.status === "complete" || work.status === "excluded")));
      }
      return false;
    });
  }
}

export function createResearchTrackTool(store: ResearchTrackStore, surface: (id: string) => ResearchTrackSurfaceProjection): ResearchExecutableTool {
  const parameters = { type: "object", required: ["surfaceId", "outcome", "impact", "theory", "nextAction", "evidenceRefs"],
    additionalProperties: false, properties: {
      surfaceId: { type: "string" }, outcome: { type: "string", enum: ["continue", "defer", "blocked", "complete"] },
      impact: { type: "string", enum: ["unknown", "low", "medium", "high", "critical"] },
      theory: { type: "string", description: "The concrete attacker-control-to-impact theory tested this epoch, including contrary evidence." },
      nextAction: { type: "string", description: "The next positive proof step, revisit trigger, or unblock condition." },
      evidenceRefs: { type: "array", items: { type: "string" }, description: "Existing canonical IDs as finding:id, memory:id, runbook:id, or report:id. A negative result should be recorded in a memory first." },
    } };
  return { descriptor: { name: "track.checkpoint", transportName: "track_checkpoint",
    description: "Record substantive progress on the surface assigned to this continuous research track epoch. Completing work requires covered threat-model state and existing durable evidence. Use defer when rotation is due; ordinary uncertainty is not a blocker.",
    actionClasses: ["synthesize"], sideEffects: "write", requiredPermissions: ["research-resource:inventory"], inputSchema: parameters },
    parameters, async execute(action: ResearchToolAction, _context?: ResearchToolExecutionContext) {
      const startedAt = new Date().toISOString();
      try {
        const input = action.input;
        const surfaceId = required(input.surfaceId, "surfaceId");
        const outcome = input.outcome;
        const impact = input.impact;
        if (outcome !== "continue" && outcome !== "defer" && outcome !== "blocked" && outcome !== "complete") throw new Error("Invalid track outcome.");
        if (impact !== "unknown" && impact !== "low" && impact !== "medium" && impact !== "high" && impact !== "critical") throw new Error("Invalid impact estimate.");
        if (!Array.isArray(input.evidenceRefs) || !input.evidenceRefs.every((ref) => typeof ref === "string")) throw new Error("evidenceRefs must be strings.");
        const output = store.checkpoint({ surfaceId, outcome, impact,
          theory: required(input.theory, "theory"), nextAction: required(input.nextAction, "nextAction"),
          evidenceRefs: input.evidenceRefs as string[] }, surface(surfaceId));
        return { action, status: "complete", startedAt, completedAt: new Date().toISOString(),
          summary: "Research track checkpoint recorded.", output, followUpActions: [] };
      } catch (error) {
        if (error && typeof error === "object" && "code" in error
          && typeof error.code === "string" && error.code.startsWith("ERR_SQLITE_")) {
          try { store.pauseWithError(`Track checkpoint storage failed: ${error instanceof Error ? error.message : String(error)}`); }
          catch { /* The original storage error is still returned to the session. */ }
        }
        return { action, status: "error", startedAt, completedAt: new Date().toISOString(),
          summary: "Research track checkpoint failed.", error: { message: error instanceof Error ? error.message : String(error) }, followUpActions: [] };
      }
    } };
}

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}
function nullable(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function bounded(value: string, max: number): string { return value.trim().slice(0, max); }
