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
  SubagentManager,
  SurfaceStore,
} from "../packages/research-agent/dist/index.js";

const workspaceId = "workspace-example-surfaces";
const foundation = {
  bugHistory: { summary: "No relevant published bug found in the searched component history.", limits: "Only the dated public sources inspected so far." },
  coverage: { summary: "Reviewed one parser path.", gaps: "Alternate input modes remain unexamined.", opportunities: "Check the boundary before dispatch." },
  threatModel: { attackerControl: "Supplied request bytes.", trustBoundaries: "Untrusted request to privileged parser.", assetsAtRisk: "ExampleCo service state.", plausibleImpacts: "Unauthorized state change if parsing fails open.", assumptions: "Reachability requires the enabled service." },
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
    } finally { database.close(); }
  } finally { state.close(); }
});

test("surface tools expose simple query and track focus without duplicate touch", async () => {
  const state = fixture();
  try {
    const tools = Object.fromEntries(createSurfaceTools(state.surface).map((tool) => [tool.descriptor.name, tool]));
    const action = (name, input) => ({ id: `action-${name}`, toolName: name, actionClass: "recall", input });
    const entered = await tools["surface.focus"].execute(action("surface.focus", { surfaceId: state.rootId }), { agentId: "agent-example" });
    assert.equal(entered.output.firstTouch, true);
    const repeated = await tools["surface.focus"].execute(action("surface.focus", { surfaceId: state.rootId }), { agentId: "agent-example" });
    assert.equal(repeated.output.firstTouch, false);
    const query = await tools["surface.query"].execute(action("surface.query", { query: "example service" }));
    assert.equal(query.output.surfaces[0].id, state.rootId);
    const missing = await tools["surface.get"].execute(action("surface.get", { surfaceId: "surface-missing" }));
    assert.equal(missing.status, "error");
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
    assert.match(requests[0].prompt, /one-time foundation/);
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
    surfaces.update(child.id, child.revision, foundation);
    publishWorkspaceResearch(options);
    const published = JSON.parse(readFileSync(join(workspaceRoot, "references", "resources.json"), "utf8"));
    assert.equal(published.surfaces.length, 1);
    assert.equal(published.surfaceTouches.length, 1);
    assert.equal(published.surfaceFocusEvents.length, 1);
    surfaces.close(); resources.close(); memory.close();
    releaseWorkspaceResearchIndex(options);
    rebuildWorkspaceResearchIndex(options);
    const restoredResources = new ResearchResourceCatalog({ databasePath, workspaceId, explicitResources: [{ id: "asset-example", direction: "in_scope", kind: "repository", locator: "https://example.test/repository", name: "Example repository", source: "explicit_scope" }] });
    const restored = new SurfaceStore({ databasePath, workspaceId, sessionId: "session-later", resources: restoredResources });
    try {
      assert.equal(restored.get(child.id).foundation.threatModel.attackerControl, foundation.threatModel.attackerControl);
      assert.equal(restored.focus("agent-later", child.id).firstTouch, false);
    } finally { restored.close(); restoredResources.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
