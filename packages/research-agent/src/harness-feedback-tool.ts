import { nowIso } from "./ids.js";
import type { ResearchExecutableTool, ResearchToolExecutionResult } from "./tool-registry.js";

export const HARNESS_FEEDBACK_TOOL_NAME = "harness.feedback";

const PARAMETERS = {
  type: "object",
  required: ["kind", "observation"],
  properties: {
    kind: { type: "string", enum: ["flaw", "quirk", "limitation"] },
    observation: { type: "string", description: "The specific Beale behavior encountered and its effect on the work." },
    workaround: { type: "string", description: "What you did instead, if anything." },
  },
} as const;

export function createHarnessFeedbackTool(): ResearchExecutableTool {
  return {
    descriptor: {
      name: HARNESS_FEEDBACK_TOOL_NAME,
      transportName: "harness_feedback",
      description: "Record a Beale harness flaw, quirk, or limitation encountered during this development session. Include the observed behavior and any workaround. Call when encountered; do not invent feedback or include target findings.",
      actionClasses: ["respond"],
      sideEffects: "none",
      requiredPermissions: [],
      inputSchema: PARAMETERS,
      metadata: { provider: "appServer.session", developmentOnly: true },
    },
    parameters: PARAMETERS,
    async execute(action): Promise<ResearchToolExecutionResult> {
      const startedAt = nowIso();
      const input = action.input;
      const kind = input.kind;
      const observation = input.observation;
      const workaround = input.workaround;
      if ((kind !== "flaw" && kind !== "quirk" && kind !== "limitation")
        || typeof observation !== "string" || !observation.trim() || observation.length > 4_000
        || (workaround !== undefined && (typeof workaround !== "string" || workaround.length > 4_000))) {
        const message = "Provide kind (flaw, quirk, or limitation), an observation of 1–4,000 characters, and an optional workaround of up to 4,000 characters.";
        return {
          action, status: "error", startedAt, completedAt: nowIso(), summary: message,
          error: { message }, artifactRefs: [], followUpActions: [],
        };
      }
      return {
        action, status: "complete", startedAt, completedAt: nowIso(),
        summary: "Harness feedback recorded in the session trace.",
        output: { kind, observation: observation.trim(), ...(workaround?.trim() ? { workaround: workaround.trim() } : {}) },
        artifactRefs: [], followUpActions: [],
      };
    },
  };
}
