import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  APPLE_SECURITY_BOUNTY_RESEARCH_KIT_ID,
  createResearchResourceScopeAuthorizer,
  createResearchResourceTool,
  createResearchToolRegistry,
  researchHistoryReminder,
  ResearchResourceCatalog,
  SurfaceStore,
} from "../packages/research-agent/dist/index.js";

test("Apple first-touch guidance is scoped to the Apple Security Bounty Research Kit", () => {
  const generic = researchHistoryReminder("repository").join(" ");
  const apple = researchHistoryReminder("repository", APPLE_SECURITY_BOUNTY_RESEARCH_KIT_ID).join(" ");

  assert.doesNotMatch(generic, /Apple Open Source/);
  assert.match(apple, /Apple Open Source releases/);
  assert.match(apple, /upstream project history/);
});

test("resource discovery is non-authoring and first touch requires relevance Auto-Review", async () => {
  const root = await mkdtemp(join(tmpdir(), "app-server-resources-"));
  const databasePath = join(root, "memory.sqlite");
  const reviews = [];
  const catalog = new ResearchResourceCatalog({
    databasePath,
    workspaceId: "workspace_example_campaign",
    explicitResources: [{
      id: "asset_display_service",
      direction: "in_scope",
      kind: "service",
      locator: "com.exampleco.DisplayService",
      name: "DisplayService",
      source: "explicit_scope",
    }, {
      id: "asset_excluded",
      direction: "out_of_scope",
      kind: "service",
      locator: "excluded.example.test",
      source: "explicit_scope",
    }, {
      id: "asset_excluded_wildcard",
      direction: "out_of_scope",
      kind: "domain",
      locator: "*.blocked.example.test",
      source: "explicit_scope",
    }],
  });
  try {
    const tool = createResearchResourceTool({
      catalog,
      campaignObjective: "Research default components for an authorized ExampleCo campaign.",
      authorizationRecorded: true,
      authorization: { recorded: true, source: "beale", description: "Default ExampleOS service components are in scope." },
      scopeResources: [{ id: "asset_display_service", direction: "in_scope", kind: "service",
        locator: "com.exampleco.DisplayService", source: "explicit_scope" }],
      environmentFingerprint: "platform-build-example-001",
      authorizeScopeRelevance: async (request) => {
        reviews.push(request);
        return {
          decision: request.resource.name === "unrelated-helper" ? "not_relevant" : "relevant",
          source: "auto_review",
          reason: "The default platform binary is directly relevant to the recorded campaign.",
        };
      },
    });
    const registry = createResearchToolRegistry([tool]);
    const discovered = await registry.execute({
      id: "discover_service_control",
      actionClass: "inspect",
      toolName: "resource.catalog",
      input: {
        operation: "discover",
        kind: "binary",
        name: "svcctl",
        locator: "/opt/example/bin/svcctl",
        rationale: "Default ExampleOS binary that reaches service-management interfaces.",
      },
    });
    assert.equal(discovered.result.status, "complete");
    assert.equal(discovered.result.output.discoveryIsNonAuthoring, true);
    assert.equal(discovered.result.output.authorizationChanged, false);
    assert.equal(discovered.result.output.firstTouchTriggered, false);
    assert.equal(reviews.length, 0);

    const resourceId = discovered.result.output.resource.id;
    const firstTouch = await registry.execute({
      id: "touch_service_control",
      actionClass: "inspect",
      toolName: "resource.catalog",
      input: {
        operation: "touch",
        resourceId,
        purpose: "Map reachable service-management sinks and historical fixes.",
      },
    });
    assert.equal(firstTouch.result.status, "complete");
    assert.equal(firstTouch.result.output.firstTouch, true);
    assert.equal(firstTouch.result.output.authorizationChanged, false);
    assert.match(firstTouch.result.output.reminder.join(" "), /release notes/i);
    assert.match(firstTouch.result.output.reminder.join(" "), /official source releases/i);
    assert.match(firstTouch.result.output.reminder.join(" "), /upstream/i);
    assert.equal(reviews.length, 1);
    const surfaceStore = new SurfaceStore({ databasePath, workspaceId: "workspace_example_campaign", resources: catalog });
    try {
      assert.equal(surfaceStore.list().surfaces.find((surface) => surface.id === resourceId).focusEligible, true);
      assert.equal(surfaceStore.require(resourceId, true).root, true);
    } finally { surfaceStore.close(); }

    const repeated = await registry.execute({
      id: "touch_service_control_again",
      actionClass: "inspect",
      toolName: "resource.catalog",
      input: { operation: "touch", resourceId, purpose: "Continue the same bounded inspection." },
    });
    assert.equal(repeated.result.output.firstTouch, false);
    assert.equal(reviews.length, 1);

    const excluded = catalog.list().find((resource) => resource.direction === "out_of_scope");
    const excludedTouch = await registry.execute({
      id: "touch_excluded",
      actionClass: "inspect",
      toolName: "resource.catalog",
      input: { operation: "touch", resourceId: excluded.id, purpose: "Inspect it." },
    });
    assert.equal(excludedTouch.result.status, "blocked");
    assert.match(excludedTouch.result.summary, /explicitly out of scope/i);
    assert.equal(reviews.length, 1);

    const crossKindExclusion = catalog.discover({ kind: "domain", name: "Excluded example host",
      locator: "excluded.example.test", rationale: "Candidate host under the example campaign." });
    const deniedCrossKind = await registry.execute({ id: "touch_excluded_other_kind", actionClass: "inspect",
      toolName: "resource.catalog", input: { operation: "touch", resourceId: crossKindExclusion.id,
        purpose: "Inspect the example host." } });
    assert.equal(deniedCrossKind.result.status, "blocked");
    assert.equal(reviews.length, 1);

    const wildcardExclusion = catalog.discover({ kind: "service", name: "Excluded child host",
      locator: "https://api.blocked.example.test/status", rationale: "Candidate example service." });
    const deniedWildcard = await registry.execute({ id: "touch_excluded_wildcard", actionClass: "inspect",
      toolName: "resource.catalog", input: { operation: "touch", resourceId: wildcardExclusion.id,
        purpose: "Inspect the example service." } });
    assert.equal(deniedWildcard.result.status, "blocked");
    assert.equal(reviews.length, 1);

    const noBoundaryTool = createResearchResourceTool({ catalog, authorizationRecorded: true,
      authorizeScopeRelevance: async (request) => {
        reviews.push(request);
        return { decision: "relevant", source: "auto_review", reason: "Would approve without a boundary." };
      } });
    const unlisted = catalog.discover({ kind: "service", name: "Unlisted example service",
      locator: "unlisted.example.test", rationale: "Candidate service." });
    const noBoundary = await noBoundaryTool.execute({ input: { operation: "touch", resourceId: unlisted.id,
      purpose: "Inspect this example service." } });
    assert.equal(noBoundary.status, "blocked");
    assert.match(noBoundary.summary, /recorded scope inclusion or rule/);
    assert.equal(reviews.length, 1);

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const authorshipTables = database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%authorship%'
      `).all();
      assert.deepEqual(authorshipTables, []);
      const touches = database.prepare("SELECT COUNT(*) AS count FROM app_server_research_resource_touches").get();
      assert.equal(touches.count, 1);
    } finally {
      database.close();
    }
  } finally {
    catalog.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("resource scope authorizer recognizes ambient platform dependencies without granting authorization", async () => {
  let captured;
  const authorize = createResearchResourceScopeAuthorizer({
    researchProfileName: "Security",
    workspaceRoot: "/tmp/workspace",
    getReviewerSelection: () => ({
      provider: "anthropic",
      model: "fixture-reviewer",
      reasoningEffort: "medium",
    }),
    completeClaudeText: async (input) => {
      captured = input;
      return {
        text: JSON.stringify({ decision: "relevant", reason: "ExampleVM is the isolation boundary used by the sandbox." }),
        usage: { input: 10, output: 5 },
      };
    },
  });
  const decision = await authorize({
    resource: {
      id: "resource_example_vm",
      workspaceId: "workspace_example_sandbox",
      kind: "service",
      name: "ExampleVM runtime",
      locator: "example-vm",
      source: "runtime_discovery",
      direction: null,
      scopeAssetId: null,
      rationale: "Execution isolation boundary used by the ExampleCo sandbox.",
      reviewStatus: "unreviewed",
      reviewReason: null,
      discoveredAt: "2026-08-24T00:00:00Z",
      updatedAt: "2026-08-24T00:00:00Z",
    },
    purpose: "Inspect the sandbox escape boundary.",
    campaignObjective: "Research the ExampleCo sandbox.",
    authorizationRecorded: true,
    authorization: { recorded: true, source: "beale", description: "The ExampleCo sandbox and its default platform components are in scope." },
    scopeResources: [{ id: "asset-sandbox", direction: "in_scope", kind: "service",
      locator: "sandbox.example.test", source: "explicit_scope" }],
  });
  assert.equal(decision.decision, "relevant");
  assert.equal(decision.source, "auto_review");
  assert.match(captured.systemPrompt, /default platform components, and upstream or downstream sources/);
  assert.match(captured.systemPrompt, /official vendor SDK or API can be covered by a broad vendor or product inclusion/i);
  assert.match(captured.systemPrompt, /third-party application, merchant, or account does not inherit authorization/i);
  assert.match(captured.prompt, /ExampleVM/);
  assert.match(captured.prompt, /sandbox\.example\.test/);
  assert.match(captured.systemPrompt, /do not expand the recorded authorization boundary/i);
});

test("a changed recorded scope revokes ambient eligibility until Auto-Review runs again", async () => {
  const root = await mkdtemp(join(tmpdir(), "beale-resource-scope-change-example-"));
  const databasePath = join(root, "memory.sqlite");
  const workspaceId = "workspace-scope-change-example";
  const scopeResources = [{ id: "asset-example-family", direction: "in_scope", kind: "domain",
    locator: "*.example.test", source: "explicit_scope" }];
  const firstAuthorization = { recorded: true, source: "beale", scopeId: "scope-example-first",
    description: "Example test services are within the recorded scope." };
  const first = new ResearchResourceCatalog({ databasePath, workspaceId,
    explicitResources: scopeResources, authorization: firstAuthorization });
  let resourceId;
  try {
    resourceId = first.discover({ kind: "service", name: "Example API", locator: "api.example.test",
      rationale: "A service under the recorded example family." }).id;
    const tool = createResearchResourceTool({ catalog: first, authorizationRecorded: true,
      authorization: firstAuthorization, scopeResources,
      authorizeScopeRelevance: async () => ({ decision: "relevant", source: "auto_review",
        reason: "The service fits the recorded example family." }) });
    const result = await tool.execute({ input: { operation: "touch", resourceId,
      purpose: "Inspect the example service." } });
    assert.equal(result.status, "complete");
    assert.equal(first.get(resourceId).reviewStatus, "relevant");
  } finally { first.close(); }

  const stale = new ResearchResourceCatalog({ databasePath, workspaceId,
    explicitResources: scopeResources, authorization: firstAuthorization });
  const nextAuthorization = { ...firstAuthorization, scopeId: "scope-example-second",
    description: "The scope requires a renewed relevance decision." };
  const next = new ResearchResourceCatalog({ databasePath, workspaceId,
    explicitResources: scopeResources, authorization: nextAuthorization });
  try {
    assert.throws(() => stale.recordReview(resourceId, { decision: "relevant", source: "auto_review",
      reason: "A stale review must not restore eligibility." }), /scope changed during resource review/);
    assert.equal(next.get(resourceId).reviewStatus, "unreviewed");
    const surfaces = new SurfaceStore({ databasePath, workspaceId, resources: next });
    try { assert.equal(surfaces.list().surfaces.find((surface) => surface.id === resourceId).focusEligible, false); }
    finally { surfaces.close(); }
    let reviews = 0;
    const tool = createResearchResourceTool({ catalog: next, authorizationRecorded: true,
      authorization: nextAuthorization, scopeResources, authorizeScopeRelevance: async () => {
        reviews += 1;
        return { decision: "not_relevant", source: "auto_review", reason: "The renewed scope does not cover this service." };
      } });
    const result = await tool.execute({ input: { operation: "touch", resourceId,
      purpose: "Continue inspecting the example service." } });
    assert.equal(result.status, "blocked");
    assert.equal(reviews, 1);
  } finally { next.close(); stale.close(); await rm(root, { recursive: true, force: true }); }
});

test("resource catalog replaces stale explicit scope classification on a new active scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "app-server-resource-scope-sync-"));
  const databasePath = join(root, "memory.sqlite");
  const original = new ResearchResourceCatalog({
    databasePath,
    workspaceId: "workspace_scope_sync",
    explicitResources: [{
      id: "asset_old",
      direction: "in_scope",
      kind: "binary",
      locator: "C:/Windows/System32/old.exe",
      source: "explicit_scope",
    }],
  });
  original.close();
  const refreshed = new ResearchResourceCatalog({
    databasePath,
    workspaceId: "workspace_scope_sync",
    explicitResources: [{
      id: "asset_current",
      direction: "in_scope",
      kind: "binary",
      locator: "C:/Windows/System32/current.exe",
      source: "explicit_scope",
    }],
  });
  try {
    const old = refreshed.list().find((resource) => resource.locator.endsWith("old.exe"));
    const current = refreshed.list().find((resource) => resource.locator.endsWith("current.exe"));
    assert.equal(old.source, "runtime_discovery");
    assert.equal(old.direction, null);
    assert.equal(old.reviewStatus, "unreviewed");
    assert.equal(current.source, "explicit_scope");
    assert.equal(current.direction, "in_scope");
  } finally {
    refreshed.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("recorded in-scope resources recover from an earlier ambient relevance rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "app-server-resource-promotion-example-"));
  const databasePath = join(root, "memory.sqlite");
  const workspaceId = "workspace_resource_promotion_example";
  const discovered = new ResearchResourceCatalog({ databasePath, workspaceId });
  try {
    const resource = discovered.discover({ kind: "service", name: "Example service",
      locator: "api.example.test", rationale: "Potential ambient dependency." });
    discovered.recordReview(resource.id, { decision: "not_relevant", source: "policy", reason: "Outside the prior scope." });
  } finally { discovered.close(); }
  const scoped = new ResearchResourceCatalog({ databasePath, workspaceId, explicitResources: [{
    id: "asset-example-service", direction: "in_scope", kind: "service", locator: "api.example.test",
    source: "explicit_scope"
  }] });
  try {
    const resource = scoped.list()[0];
    assert.equal(resource.source, "explicit_scope");
    assert.equal(resource.direction, "in_scope");
    assert.equal(resource.reviewStatus, "unreviewed");
  } finally {
    scoped.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an explicit exclusion takes precedence over the same included resource", async () => {
  const root = await mkdtemp(join(tmpdir(), "app-server-resource-exclusion-example-"));
  const catalog = new ResearchResourceCatalog({ databasePath: join(root, "memory.sqlite"),
    workspaceId: "workspace_exclusion_example", explicitResources: [{
      id: "asset-excluded", direction: "out_of_scope", kind: "service", locator: "api.example.test",
      source: "explicit_scope"
    }, {
      id: "asset-included", direction: "in_scope", kind: "service", locator: "api.example.test",
      source: "explicit_scope"
    }] });
  try {
    assert.equal(catalog.list()[0].direction, "out_of_scope");
    assert.equal(catalog.list()[0].reviewStatus, "explicit_out_of_scope");
  } finally {
    catalog.close();
    await rm(root, { recursive: true, force: true });
  }
});
