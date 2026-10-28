import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createSurfaceTools,
  initializeWorkspaceProject,
  MemoryGraphStore,
  publishWorkspaceResearch,
  rebuildWorkspaceResearchIndex,
  releaseWorkspaceResearchIndex,
  ResearchResourceCatalog,
  ResearchToolRegistry,
  SubagentManager,
  SurfaceStore,
} from "../packages/research-agent/dist/index.js";

const workspaceId = "workspace-example-surfaces";
const foundation = {
  bugHistory: { summary: "No relevant published bug found in the searched component history.", limits: "Only the dated public sources inspected so far." },
  coverage: { summary: "Reviewed one parser path.", gaps: "Alternate input modes remain unexamined.", opportunities: "Check the boundary before dispatch." },
  threatModel: { attackerControl: "Supplied request bytes.", trustBoundaries: "Untrusted request to privileged parser.", assetsAtRisk: "ExampleCo service state.", plausibleImpacts: "Unauthorized state change if parsing fails open.", assumptions: "Reachability requires the enabled service." },
};
const completeFoundation = {
  ...foundation,
  coverage: { ...foundation.coverage, gaps: "", mappingComplete: true, sinksInvestigated: true,
    openQuestions: [], unexploredConnections: [] },
};

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "beale-surfaces-example-"));
  const databasePath = join(directory, "memory.sqlite");
  const resources = new ResearchResourceCatalog({
    databasePath, workspaceId,
    explicitResources: [
      { id: "asset-example", direction: "in_scope", kind: "service", locator: "service.example.test", name: "Example service", source: "explicit_scope" },
      { id: "asset-excluded", direction: "out_of_scope", kind: "service", locator: "excluded.example.test", name: "Excluded service", source: "explicit_scope" },
    ],
  });
  const surface = new SurfaceStore({ databasePath, workspaceId, sessionId: "session-example-one", resources });
  return { directory, databasePath, resources, surface, rootId: resources.list().find((item) => item.direction === "in_scope").id,
    close() { surface.close(); resources.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("resource roots, agent-discovered children, lookup, and one-time first touch share workspace state", () => {
  const state = fixture();
  try {
    const root = state.surface.get(state.rootId);
    assert.equal(root.id, state.rootId);
    assert.equal(root.root, true);
    assert.equal(root.firstTouchedAt, null);
    assert.equal(state.surface.list().total, 2);
    assert.equal(state.surface.list().surfaces.find((item) => item.id === root.id).focusEligible, true);
    assert.equal(state.surface.list({ resourceKind: 'service' }).total, 2);
    assert.equal(state.surface.list({ resourceKind: 'repository' }).total, 0);
    assert.equal(state.surface.list().surfaces.find((item) => item.id === root.id).resourceKind, 'service');

    const child = state.surface.create(root.id, "Request parser", "Lower-trust request parser boundary.");
    assert.equal(child.parentId, root.id);
    assert.equal(child.resourceId, root.id);
    assert.throws(() => state.surface.create(root.id, "request parser", "Duplicate boundary"), /UNIQUE constraint/);
    assert.equal(state.surface.path(child.id), "Example service / Request parser");
    assert.equal(state.surface.query("request parser").surfaces[0].id, child.id);
    assert.equal(state.surface.query("parser", 1, 1).surfaces.length, 0);
    assert.equal(state.surface.list({ resourceId: root.id, limit: 1 }).nextOffset, 1);

    const first = state.surface.focus("agent-one", child.id);
    assert.equal(first.firstTouch, true);
    assert.deepEqual(first.surfaceTrail, [
      { id: root.id, name: "Example service" }, { id: child.id, name: "Request parser" },
    ]);
    assert.equal(first.previousSurfaceId, null);
    assert.equal(state.surface.focus("agent-two", child.id).firstTouch, false);
    assert.equal(state.surface.focus("agent-one", root.id).firstTouch, true);
    assert.equal(state.surface.focus("agent-one", child.id).firstTouch, false);
    assert.equal(state.surface.current("agent-one").id, child.id);
    assert.equal(state.surface.modelContext().counts.pendingFoundation, 2);
    const rootUpdated = state.surface.update(root.id, root.revision, foundation);
    assert.equal(rootUpdated.revision, 2);
    assert.equal(state.surface.get(root.id).foundation.bugHistory.summary, foundation.bugHistory.summary);

    const updated = state.surface.update(child.id, child.revision, foundation);
    assert.equal(updated.revision, 2);
    assert.equal(state.surface.query("privileged parser").surfaces.some((item) => item.id === child.id), true);
    assert.throws(() => state.surface.update(child.id, child.revision, foundation), /revision changed/i);

    const otherSession = new SurfaceStore({ databasePath: state.databasePath, workspaceId, sessionId: "session-example-two", resources: state.resources });
    try {
      assert.equal(otherSession.focus("agent-three", child.id).firstTouch, false);
      assert.equal(otherSession.get(child.id).foundation.coverage.gaps, foundation.coverage.gaps);
    } finally { otherSession.close(); }

    const excludedId = state.resources.list().find((item) => item.direction === "out_of_scope").id;
    assert.equal(state.surface.list().surfaces.find((item) => item.id === excludedId).focusEligible, false);
    assert.throws(() => state.surface.create(excludedId, "Child", "Disallowed"), /not eligible/i);
    assert.throws(() => state.surface.focus("agent-one", excludedId), /not eligible/i);
    const database = new DatabaseSync(state.databasePath, { readOnly: true });
    try {
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM app_server_surface_touches").get().count, 2);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM app_server_surface_focus_events").get().count, 5);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM app_server_surface_update_events").get().count, 2);
    } finally { database.close(); }
  } finally { state.close(); }
});

test("surface tools expose simple query and track focus without duplicate touch", async () => {
  const state = fixture();
  try {
    const tools = Object.fromEntries(createSurfaceTools(state.surface).map((tool) => [tool.descriptor.name, tool]));
    assert.match(tools["surface.create"].descriptor.description, /component tree/);
    assert.match(tools["surface.create"].parameters.properties.name.description, /concrete component or subcomponent/);
    assert.deepEqual(tools["surface.create"].parameters.required, ["parentId", "name"]);
    assert.match(tools["surface.update"].parameters.properties.foundation.properties.coverage.properties.summary.description,
      /Brief account of what has been examined/);
    assert.match(tools["surface.update"].parameters.properties.foundation.properties.threatModel.properties.plausibleImpacts.description,
      /ordinary malfunction alone is not security impact/);
    assert.match(tools["surface.update"].parameters.properties.progressBlocker.anyOf[0].properties.reason.description, /external dependency/);
    assert.deepEqual(tools["surface.update"].parameters.required, ["surfaceId", "expectedRevision"]);
    assert.equal(tools["surface.update"].parameters.properties.progressBlocker.anyOf[1].type, "null");
    const action = (name, input) => ({ id: `action-${name}`, toolName: name, actionClass: "recall", input });
    const entered = await tools["surface.focus"].execute(action("surface.focus", { surfaceId: state.rootId }), { agentId: "agent-example" });
    assert.equal(entered.output.firstTouch, true);
    const repeated = await tools["surface.focus"].execute(action("surface.focus", { surfaceId: state.rootId }), { agentId: "agent-example" });
    assert.equal(repeated.output.firstTouch, false);
    const query = await tools["surface.query"].execute(action("surface.query", { query: "example service" }));
    assert.equal(query.output.surfaces[0].id, state.rootId);
    const services = await tools["surface.list"].execute(action("surface.list", { resourceKind: "service" }));
    assert.equal(services.output.total, 2);
    assert.equal(services.output.surfaces[0].resourceKind, "service");
    const missing = await tools["surface.get"].execute(action("surface.get", { surfaceId: "surface-missing" }));
    assert.equal(missing.status, "error");
    const created = await tools["surface.create"].execute(action("surface.create", { parentId: state.rootId, name: "Request decoder" }));
    assert.equal(created.status, "complete");
    assert.equal(created.output.description, "");
  } finally { state.close(); }
});

test("a surface blocker records a concrete dependency after first touch and remains visible until cleared", async () => {
  const state = fixture();
  try {
    const child = state.surface.create(state.rootId, "Authenticated endpoint", "Session boundary.");
    const reason = "Mapped public routes and tested pre-auth inputs; an authorized account is required to test the authenticated endpoint. Provide a test account to resume.";
    state.surface.focus("agent-example", child.id);
    const tools = Object.fromEntries(createSurfaceTools(state.surface).map((tool) => [tool.descriptor.name, tool]));
    const action = (input) => ({ id: "action-surface-update", toolName: "surface.update", actionClass: "recall", input });
    const invalid = await tools["surface.update"].execute(action({ surfaceId: child.id, expectedRevision: child.revision,
      foundation, progressBlocker: "missing account" }), { agentId: "agent-example" });
    assert.equal(invalid.status, "error");
    assert.match(invalid.error.message, /progressBlocker must be an object/);
    const set = await tools["surface.update"].execute(action({ surfaceId: child.id, expectedRevision: child.revision,
      foundation, progressBlocker: { reason } }), { agentId: "agent-example" });
    assert.equal(set.status, "complete");
    assert.equal(set.output.progressBlocker.reason, reason);
    assert.equal(Object.hasOwn(set.output.foundation, "progressBlocker"), false);
    assert.equal(set.output.progressBlocker.actorId, "agent-example");
    assert.ok(Number.isFinite(Date.parse(set.output.progressBlocker.setAt)));
    assert.deepEqual(state.surface.coverageState(child.id).unmetRequirements.includes("blocked"), true);
    assert.equal(state.surface.list().surfaces.find((item) => item.id === child.id).progressBlocker.reason, reason);
    assert.equal(state.surface.query("authorized account").surfaces[0].id, child.id);
    const updated = state.surface.update(child.id, set.output.revision, foundation);
    assert.equal(updated.progressBlocker.reason, reason);
    const registry = new ResearchToolRegistry([tools["surface.update"]]);
    const cleared = (await registry.execute({ ...action({ surfaceId: child.id, expectedRevision: updated.revision,
      progressBlocker: null }), actionClass: "synthesize" }, { agentId: "agent-example" })).result;
    assert.equal(cleared.status, "complete");
    assert.deepEqual(cleared.output.foundation, updated.foundation);
    assert.equal(cleared.output.progressBlocker, null);
    const stale = await tools["surface.update"].execute(action({ surfaceId: child.id, expectedRevision: updated.revision,
      progressBlocker: null }), { agentId: "agent-example" });
    assert.equal(stale.status, "error");
    assert.match(stale.error.message, /revision changed/i);
    const completed = state.surface.update(child.id, cleared.output.revision, completeFoundation);
    assert.equal(completed.progressBlocker, null);
    assert.equal(state.surface.coverageState(child.id).covered, true);
  } finally { state.close(); }
});

test("a concrete external blocker can be recorded without completing a foundation form", () => {
  const state = fixture();
  try {
    const child = state.surface.create(state.rootId, "Session verifier");
    const blocked = state.surface.update(child.id, child.revision, undefined, undefined, undefined,
      { reason: "An example account is needed to continue." });
    assert.equal(blocked.progressBlocker.reason, "An example account is needed to continue.");
    assert.equal(blocked.foundation.coverage.mappingComplete, false);
  } finally { state.close(); }
});

test("surface coverage reflects a bounded component review without gating open leads or children", () => {
  const state = fixture();
  try {
    const child = state.surface.create(state.rootId, "Request parser", "Parser boundary.");
    assert.deepEqual(state.surface.coverageState(child.id).unmetRequirements, ["foundation", "surface_map"]);
    const renamed = state.surface.update(child.id, child.revision, undefined, "Request decoder");
    assert.equal(renamed.name, "Request decoder");
    assert.equal(renamed.foundation, null);
    const noted = state.surface.update(child.id, renamed.revision, {
      coverage: { summary: "Reviewed decoding boundaries.", openQuestions: ["Is the fallback reachable?"] }
    });
    assert.equal(noted.foundation.coverage.summary, "Reviewed decoding boundaries.");
    assert.equal(noted.foundation.coverage.openQuestions.length, 1);
    assert.deepEqual(state.surface.coverageState(child.id).unmetRequirements, ["surface_map"]);
    state.surface.update(child.id, noted.revision, { coverage: { mappingComplete: true } });
    assert.equal(state.surface.coverageState(child.id).covered, true);
    assert.equal(state.surface.get(child.id).foundation.coverage.summary, "Reviewed decoding boundaries.");
    state.surface.update(state.rootId, 1, { coverage: { summary: "Reviewed service structure.", mappingComplete: true } });
    assert.equal(state.surface.coverageState(state.rootId).covered, true);
    const database = new DatabaseSync(state.databasePath);
    try {
      database.exec(`CREATE TABLE app_server_research_claims (
        id TEXT, workspace_id TEXT, status TEXT, classification TEXT,
        duplicate_of_claim_id TEXT, security_tracking_json TEXT
      )`);
      database.prepare(`INSERT INTO app_server_research_claims VALUES (?, ?, ?, ?, NULL, ?)`).run(
        "claim-example", workspaceId, "observed", "security.vulnerability", JSON.stringify({ surfaceIds: [child.id], progressBlocker: null }),
      );
      assert.deepEqual(state.surface.coverageState(child.id).unblockedFindingIds, ["claim-example"]);
      assert.equal(state.surface.coverageState(child.id).covered, true);
      assert.equal(state.surface.coverageState(state.rootId).covered, true);
    } finally { database.close(); }
  } finally { state.close(); }
});

test("the first focus automatically launches one foundation scout and reports its result to the root", async () => {
  const state = fixture();
  try {
    const requests = [];
    const activities = [];
    const manager = new SubagentManager({
      rootProvider: "openai", rootModel: "example-model", surfaceStore: state.surface,
      allowManualDelegation: false,
      onActivity(activity) { activities.push(activity); },
      async run(request) {
        requests.push(request);
        const current = state.surface.get(state.rootId);
        state.surface.update(current.id, current.revision, completeFoundation);
        return { messages: [], text: "Foundation recorded with no remaining questions.", turnCount: 1,
          toolCallCount: 1, modelCalls: [], toolEvents: [] };
      },
    });
    assert.deepEqual(manager.createTools("root"), []);
    const first = state.surface.focus("root", state.rootId);
    assert.equal(first.foundationScout.status, "running");
    assert.match(first.foundationScout.agentPath, /^\/root\/surface_foundation_/);
    await manager.settle();
    assert.equal(requests.length, 1);
    assert.match(requests[0].prompt, /Give this component a concise research foundation/);
    assert.match(requests[0].prompt, /Mark mappingComplete when a bounded review/);
    assert.match(requests[0].prompt, /Keep hypotheses and tests in research records/);
    assert.deepEqual(activities.find((activity) => activity.type === "spawned")?.surfaceTrail,
      [{ id: state.rootId, name: "Example service" }]);
    assert.equal(state.surface.coverageState(state.rootId).covered, true);
    assert.match(JSON.stringify(manager.collaborationFollowUp("root")), /Foundation recorded/);
    assert.equal(state.surface.focus("root", state.rootId).firstTouch, false);
    assert.equal(requests.length, 1);
  } finally { state.close(); }
});

test("first touch stays one-time even when the foundation remains incomplete", async () => {
  const state = fixture();
  try {
    let firstRuns = 0;
    const firstManager = new SubagentManager({
      rootProvider: "openai", rootModel: "example-model", surfaceStore: state.surface,
      allowManualDelegation: false,
      async run() {
        firstRuns += 1;
        return { messages: [], text: "Foundation remains incomplete.", turnCount: 1,
          toolCallCount: 0, modelCalls: [], toolEvents: [] };
      },
    });
    const firstFocus = state.surface.focus("root", state.rootId);
    assert.equal(firstFocus.firstTouch, true);
    assert.equal(firstFocus.foundationScout.status, "running");
    assert.equal(state.surface.focus("root", state.rootId).foundationScout, undefined);
    await firstManager.settle();
    assert.equal(firstRuns, 1);

    const laterSurface = new SurfaceStore({
      databasePath: state.databasePath, workspaceId, sessionId: "session-example-later", resources: state.resources,
    });
    try {
      new SubagentManager({
        rootProvider: "openai", rootModel: "example-model", surfaceStore: laterSurface,
        async run() { throw new Error("The later session must not launch another foundation scout."); },
      });
      const laterFocus = laterSurface.focus("root", state.rootId);
      assert.equal(laterFocus.firstTouch, false);
      assert.equal(laterFocus.foundationScout, undefined);
      assert.equal(laterSurface.coverageState(state.rootId).covered, false);
    } finally { laterSurface.close(); }
  } finally { state.close(); }
});

test("subagent spawn requires a valid surface assignment and records first touch", async () => {
  const state = fixture();
  try {
    const requests = [];
    const manager = new SubagentManager({
      rootProvider: "openai", rootModel: "example-model", surfaceStore: state.surface,
      async run(request) {
        requests.push(request);
        return { messages: [], text: "Complete.", turnCount: 1, toolCallCount: 0, modelCalls: [], toolEvents: [] };
      },
    });
    const spawn = manager.createTools("root").find((tool) => tool.name === "spawn_agent");
    assert.ok(spawn.parameters.required.includes("surface_id"));
    await assert.rejects(spawn.execute("missing-surface", { task_name: "missing", message: "Inspect." }), /surface_id/);
    const excludedId = state.resources.list().find((item) => item.direction === "out_of_scope").id;
    await assert.rejects(spawn.execute("excluded-surface", { task_name: "excluded", message: "Inspect.", surface_id: excludedId }), /not eligible/i);
    const child = state.surface.create(state.rootId, "Parser", "Parser boundary");
    const result = await spawn.execute("assigned-surface", { task_name: "parser", message: "Inspect parser.", surface_id: child.id });
    assert.equal(result.details.surface_id, child.id);
    assert.equal(state.surface.get(child.id).firstTouchedAt !== null, true);
    await manager.settle();
    assert.match(requests[0].prompt, /Assigned surface: Example service \/ Parser/);
    assert.match(requests[0].prompt, /brief foundation when useful/);
    assert.equal(state.surface.current(result.details.agent_id).id, child.id);
    state.surface.focus(result.details.agent_id, state.rootId, "Moved to parent boundary");
    const listed = await manager.createTools("root").find((tool) => tool.name === "list_agents").execute("list-after-move", {});
    assert.equal(listed.details.agents[0].surface_id, state.rootId);
    assert.equal(listed.details.agents[0].assigned_surface_id, child.id);
  } finally { state.close(); }
});

test("surface foundations, first touch, and movement survive workspace publication and rebuild", () => {
  const directory = mkdtempSync(join(tmpdir(), "beale-surfaces-publication-example-"));
  const workspaceRoot = join(directory, "workspace");
  const databasePath = join(directory, "runtime", "memory.sqlite");
  const options = { workspaceRoot, databasePath, artifactDirectoryPath: join(directory, "runtime", "artifacts"), workspaceId };
  mkdirSync(workspaceRoot);
  initializeWorkspaceProject(workspaceRoot, workspaceId);
  const memory = new MemoryGraphStore({ workspaceRoot, databasePath, context: { workspaceId, workspaceName: "Example", subjectId: "subject-example", subjectName: "Example" } });
  const resources = new ResearchResourceCatalog({ databasePath, workspaceId, explicitResources: [{ id: "asset-example", direction: "in_scope", kind: "repository", locator: "https://example.test/repository", name: "Example repository", source: "explicit_scope" }] });
  const surfaces = new SurfaceStore({ databasePath, workspaceId, sessionId: "session-example", resources });
  try {
    const child = surfaces.create(resources.list()[0].id, "Parser", "Parser boundary");
    surfaces.focus("agent-example", child.id);
    surfaces.update(child.id, child.revision, foundation, undefined, undefined,
      { reason: "Public parser paths were reviewed; an authorized account is required to test the session path. Provide a test account to resume." }, "agent-example");
    publishWorkspaceResearch(options);
    const published = JSON.parse(readFileSync(join(workspaceRoot, "references", "resources.json"), "utf8"));
    assert.equal(published.surfaces.length, 1);
    assert.match(JSON.parse(published.surfaces[0].foundation_json).progressBlocker.reason, /authorized account/);
    assert.equal(published.surfaceTouches.length, 1);
    assert.equal(published.surfaceFocusEvents.length, 1);
    assert.equal(published.surfaceUpdateEvents.length, 1);
    surfaces.close(); resources.close(); memory.close();
    releaseWorkspaceResearchIndex(options);
    const emptied = new DatabaseSync(databasePath);
    try {
      for (const table of ['app_server_surface_update_events', 'app_server_surface_focus_events',
        'app_server_surface_focus', 'app_server_surface_touches', 'app_server_surfaces', 'app_server_surface_roots']) {
        emptied.exec(`DROP TABLE ${table}`);
      }
    } finally { emptied.close(); }
    rebuildWorkspaceResearchIndex(options);
    const restoredResources = new ResearchResourceCatalog({ databasePath, workspaceId, explicitResources: [{ id: "asset-example", direction: "in_scope", kind: "repository", locator: "https://example.test/repository", name: "Example repository", source: "explicit_scope" }] });
    const restored = new SurfaceStore({ databasePath, workspaceId, sessionId: "session-later", resources: restoredResources });
    try {
      assert.equal(restored.get(child.id).foundation.threatModel.attackerControl, foundation.threatModel.attackerControl);
      assert.match(restored.get(child.id).progressBlocker.reason, /authorized account/);
      assert.equal(restored.focus("agent-later", child.id).firstTouch, false);
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM app_server_surface_update_events WHERE surface_id=?').get(child.id).count, 1);
      } finally { database.close(); }
    } finally { restored.close(); restoredResources.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
