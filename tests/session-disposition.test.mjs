import assert from "node:assert/strict";
import test from "node:test";

import {
  ResearchDispositionRecorder,
  createSessionDispositionTool,
  fallbackResearchFinalDisposition,
} from "../packages/research-agent/dist/index.js";

test("Goal status records a minimal external dependency and derives durable disposition fields", async () => {
  const recorder = new ResearchDispositionRecorder();
  const tool = createSessionDispositionTool(recorder);
  const action = {
    id: "disposition_one",
    actionClass: "respond",
    toolName: "session.disposition",
    input: {
      state: "waiting_on_external_state",
      reason: "Live validation requires another authorized account.",
      requiredState: "Provide an authorized second test account.",
    },
  };

  assert.equal(tool.descriptor.metadata.requiredBeforeFinalResponse, true);
  assert.deepEqual(tool.parameters.required, ["state"]);
  assert.deepEqual(tool.parameters.properties.state.enum, ["achieved", "continue", "waiting_on_external_state"]);
  assert.equal(tool.parameters.properties.blockerDependencies, undefined);
  assert.equal(tool.parameters.properties.externalStateRequired, undefined);
  assert.equal(tool.parameters.properties.nextPromptSuggestions, undefined);
  assert.equal(tool.descriptor.sideEffects, "none");
  const result = await tool.execute(action);
  assert.equal(result.status, "complete");
  assert.deepEqual(recorder.get(), {
    outcome: "blocked",
    summary: action.input.reason,
    blockerDependencies: [{ kind: "other", description: action.input.reason,
      requiredState: action.input.requiredState, external: true }],
    externalStateRequired: true,
    recordedAt: recorder.get().recordedAt,
  });

  const duplicate = await tool.execute({ ...action, id: "disposition_two" });
  assert.equal(duplicate.status, "error");
  assert.match(duplicate.error.message, /already been recorded/);
});

test("session disposition can be reset between nonterminal goal turns", async () => {
  const recorder = new ResearchDispositionRecorder();
  const tool = createSessionDispositionTool(recorder);
  const first = await tool.execute({
    id: "disposition_partial",
    actionClass: "respond",
    toolName: "session.disposition",
    input: {
      state: "continue",
      reason: "The source is verified but the sink is not.",
    },
  });
  assert.equal(first.status, "complete");

  recorder.resetForGoalContinuation();
  const second = await tool.execute({
    id: "disposition_complete",
    actionClass: "respond",
    toolName: "session.disposition",
    input: {
      state: "achieved",
      reason: "The complete source-to-sink path is verified.",
    },
  });
  assert.equal(second.status, "complete");
  assert.equal(recorder.get().outcome, "objective_achieved");
});

test("session disposition cannot bypass a required investigation assignment", async () => {
  const recorder = new ResearchDispositionRecorder();
  let assigned = false;
  const tool = createSessionDispositionTool(recorder, {
    beforeRecord: () => {
      if (!assigned) throw new Error("Select the session investigation first.");
    },
  });
  const action = {
    id: "disposition_guarded",
    actionClass: "respond",
    toolName: "session.disposition",
    input: {
      state: "achieved",
      reason: "The proof is complete.",
    },
  };

  const blocked = await tool.execute(action);
  assert.equal(blocked.status, "error");
  assert.match(blocked.error.message, /investigation/iu);
  assert.equal(recorder.get(), null);

  assigned = true;
  assert.equal((await tool.execute(action)).status, "complete");
});

test("session disposition rejects inconsistent external blockers and provides terminal fallbacks", async () => {
  const recorder = new ResearchDispositionRecorder();
  const tool = createSessionDispositionTool(recorder);
  const missingState = await tool.execute({
    id: "missing_external_state",
    actionClass: "respond",
    toolName: "session.disposition",
    input: { state: "waiting_on_external_state" },
  });
  assert.equal(missingState.status, "error");
  assert.match(missingState.error.message, /requires requiredState/);
  const result = await tool.execute({
    id: "invalid_disposition",
    actionClass: "respond",
    toolName: "session.disposition",
    input: {
      outcome: "blocked",
      summary: "Blocked.",
      blockerDependencies: [{ kind: "environment", description: "Missing target.", requiredState: "Provide target.", external: true }],
      externalStateRequired: false,
    },
  });

  assert.equal(result.status, "error");
  assert.equal(recorder.get(), null);
  const fallback = fallbackResearchFinalDisposition("error", "Provider failed.");
  assert.deepEqual(fallback, {
    outcome: "failed",
    summary: "Provider failed.",
    blockerDependencies: [],
    externalStateRequired: false,
    recordedAt: fallback.recordedAt,
  });
  const stopped = fallbackResearchFinalDisposition("stopped", "");
  assert.deepEqual(stopped, {
    outcome: "inconclusive",
    summary: "The research session was stopped by the host before recording a structured final disposition.",
    blockerDependencies: [],
    externalStateRequired: false,
    recordedAt: stopped.recordedAt,
  });
});
