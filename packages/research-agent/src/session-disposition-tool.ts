import { nowIso } from "./ids.js";
import type { ResearchExecutableTool, ResearchToolExecutionResult } from "./tool-registry.js";
import type { ResearchNextPromptSuggestion, ResearchToolAction } from "./types.js";

export const RESEARCH_DISPOSITION_OUTCOMES = [
  "objective_achieved",
  "objective_partially_achieved",
  "blocked",
  "inconclusive",
  "failed",
  "stopped",
] as const;

export const RESEARCH_BLOCKER_DEPENDENCY_KINDS = [
  "user_input",
  "credentials",
  "authorization",
  "source_material",
  "environment",
  "network_access",
  "external_service",
  "target_state",
  "other",
] as const;

export type ResearchDispositionOutcome = (typeof RESEARCH_DISPOSITION_OUTCOMES)[number];
export type ResearchBlockerDependencyKind = (typeof RESEARCH_BLOCKER_DEPENDENCY_KINDS)[number];

export interface ResearchBlockerDependency {
  kind: ResearchBlockerDependencyKind;
  description: string;
  requiredState: string;
  external: boolean;
}

export interface ResearchFinalDisposition {
  outcome: ResearchDispositionOutcome;
  summary: string;
  blockerDependencies: readonly ResearchBlockerDependency[];
  externalStateRequired: boolean;
  nextPromptSuggestions?: readonly ResearchNextPromptSuggestion[];
  recordedAt: string;
}

const PARAMETERS = {
  type: "object",
  required: ["state"],
  properties: {
    state: {
      type: "string",
      enum: ["achieved", "continue", "waiting_on_external_state"],
      description: "Complete the goal, continue research, or wait for a concrete external change.",
    },
    reason: { type: "string", description: "Optional brief basis for this goal state; explain the result in the final response." },
    requiredState: { type: "string", description: "For waiting_on_external_state, the concrete change or input required before research can continue." },
  },
};

export class ResearchDispositionRecorder {
  private disposition: ResearchFinalDisposition | null = null;

  public record(input: unknown): ResearchFinalDisposition {
    if (this.disposition) throw new Error("The session final disposition has already been recorded.");
    const disposition = parseDisposition(input);
    this.disposition = disposition;
    return disposition;
  }

  public get(): ResearchFinalDisposition | null {
    return this.disposition ? cloneDisposition(this.disposition) : null;
  }

  public resetForGoalContinuation(): void {
    this.disposition = null;
  }
}

export function createSessionDispositionTool(
  recorder: ResearchDispositionRecorder,
  options: { beforeRecord?: (input: unknown) => void } = {},
): ResearchExecutableTool {
  return {
    descriptor: {
      name: "session.disposition",
      transportName: "session_disposition",
      description: "Record Goal mode progress once before the root response: achieved, continue, or waiting on a concrete external change.",
      actionClasses: ["synthesize", "respond"],
      sideEffects: "none",
      requiredPermissions: [],
      inputSchema: PARAMETERS,
      metadata: { provider: "appServer.session", requiredBeforeFinalResponse: true },
    },
    parameters: PARAMETERS,
    async execute(action): Promise<ResearchToolExecutionResult> {
      const startedAt = nowIso();
      try {
        options.beforeRecord?.(action.input);
        const disposition = recorder.record(action.input);
        return complete(action, startedAt, disposition);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          action,
          status: "error",
          startedAt,
          completedAt: nowIso(),
          summary: message,
          error: { message },
          artifactRefs: [],
          followUpActions: ["Correct and record Goal status before responding."],
        };
      }
    },
  };
}

export function fallbackResearchFinalDisposition(status: "complete" | "error" | "stopped", text: string): ResearchFinalDisposition {
  return {
    outcome: status === "error" ? "failed" : "inconclusive",
    summary: text.trim() || (status === "error"
      ? "The research session failed without a final response."
      : status === "stopped"
        ? "The research session was stopped by the host before recording a structured final disposition."
        : "The research session ended without a structured final disposition."),
    blockerDependencies: [],
    externalStateRequired: false,
    recordedAt: nowIso(),
  };
}

function parseDisposition(value: unknown): ResearchFinalDisposition {
  const input = record(value, "session disposition");
  if (input.state !== undefined) return parseGoalSignal(input);
  // Existing saved/model continuations can still submit the prior shape.
  const outcome = requiredString(input.outcome, "outcome") as ResearchDispositionOutcome;
  if (!RESEARCH_DISPOSITION_OUTCOMES.slice(0, 4).includes(outcome as (typeof RESEARCH_DISPOSITION_OUTCOMES)[number])) {
    throw new Error(`Unsupported model-recorded session outcome: ${outcome}`);
  }
  const summary = requiredString(input.summary, "summary");
  if (!Array.isArray(input.blockerDependencies)) throw new Error("blockerDependencies must be an array.");
  const blockerDependencies = input.blockerDependencies.map(parseDependency);
  const externalStateRequired = requiredBoolean(input.externalStateRequired, "externalStateRequired");
  if (externalStateRequired && !blockerDependencies.some((dependency) => dependency.external)) {
    throw new Error("externalStateRequired requires at least one external blocker dependency.");
  }
  if (!externalStateRequired && blockerDependencies.some((dependency) => dependency.external)) {
    throw new Error("An external blocker dependency requires externalStateRequired=true.");
  }
  if (outcome === "blocked" && blockerDependencies.length === 0) {
    throw new Error("A blocked disposition requires at least one blocker dependency.");
  }
  if (outcome === "objective_achieved" && blockerDependencies.length > 0) {
    throw new Error("An achieved objective cannot retain blocker dependencies.");
  }
  const nextPromptSuggestions = input.nextPromptSuggestions === undefined
    ? undefined
    : parseNextPromptSuggestions(input.nextPromptSuggestions);
  return {
    outcome,
    summary,
    blockerDependencies,
    externalStateRequired,
    ...(nextPromptSuggestions ? { nextPromptSuggestions } : {}),
    recordedAt: nowIso(),
  };
}

function parseGoalSignal(input: Record<string, unknown>): ResearchFinalDisposition {
  const state = requiredString(input.state, "state");
  const reason = optionalString(input.reason, "reason");
  const requiredState = optionalString(input.requiredState, "requiredState");
  if (state !== "achieved" && state !== "continue" && state !== "waiting_on_external_state") {
    throw new Error(`Unsupported goal state: ${state}`);
  }
  if (state === "waiting_on_external_state" && !requiredState) {
    throw new Error("waiting_on_external_state requires requiredState.");
  }
  if (state !== "waiting_on_external_state" && requiredState) {
    throw new Error("requiredState is only valid when waiting_on_external_state.");
  }
  const blockerDependencies: ResearchBlockerDependency[] = requiredState
    ? [{ kind: "other", description: reason ?? requiredState, requiredState, external: true }]
    : [];
  return {
    outcome: state === "achieved" ? "objective_achieved"
      : state === "continue" ? "objective_partially_achieved" : "blocked",
    summary: reason ?? (state === "achieved" ? "Goal achieved."
      : state === "continue" ? "Goal research continues." : `Waiting for external state: ${requiredState}`),
    blockerDependencies,
    externalStateRequired: blockerDependencies.length > 0,
    recordedAt: nowIso(),
  };
}

function parseNextPromptSuggestions(value: unknown): ResearchNextPromptSuggestion[] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error("nextPromptSuggestions must contain exactly three suggestions.");
  }
  const identities = new Set<string>();
  return value.map((candidate) => {
    const input = record(candidate, "next prompt suggestion");
    const title = requiredString(input.title, "suggestion title");
    const identity = title.toLocaleLowerCase();
    if (identities.has(identity)) throw new Error("nextPromptSuggestions titles must be distinct.");
    identities.add(identity);
    const promptMarkdown = requiredString(input.promptMarkdown, "suggestion promptMarkdown");
    const rationale = optionalString(input.rationale, "suggestion rationale");
    return { title, promptMarkdown, ...(rationale ? { rationale } : {}) };
  });
}

function parseDependency(value: unknown): ResearchBlockerDependency {
  const input = record(value, "blocker dependency");
  const kind = requiredString(input.kind, "dependency kind") as ResearchBlockerDependencyKind;
  if (!RESEARCH_BLOCKER_DEPENDENCY_KINDS.includes(kind)) throw new Error(`Unsupported blocker dependency kind: ${kind}`);
  return {
    kind,
    description: requiredString(input.description, "dependency description"),
    requiredState: requiredString(input.requiredState, "dependency requiredState"),
    external: requiredBoolean(input.external, "dependency external"),
  };
}

function complete(action: ResearchToolAction, startedAt: string, disposition: ResearchFinalDisposition): ResearchToolExecutionResult {
  return {
    action,
    status: "complete",
    startedAt,
    completedAt: nowIso(),
    summary: "Goal status recorded.",
    output: disposition,
    artifactRefs: [],
    followUpActions: [],
  };
}

function cloneDisposition(disposition: ResearchFinalDisposition): ResearchFinalDisposition {
  return {
    ...disposition,
    blockerDependencies: disposition.blockerDependencies.map((dependency) => ({ ...dependency })),
    ...(disposition.nextPromptSuggestions
      ? { nextPromptSuggestions: disposition.nextPromptSuggestions.map((suggestion) => ({ ...suggestion })) }
      : {}),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}
