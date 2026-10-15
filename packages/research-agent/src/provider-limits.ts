import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { createCredentialStore } from "./auth.js";
import { ProviderAuthenticationRouter } from "./auth-routing.js";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

/** Host-only access token for the same xAI OAuth account used by Beale sessions. */
export async function readXaiSubscriptionAccessToken(): Promise<string | null> {
  const store = createCredentialStore();
  const oauth = builtinModels().getProvider("xai")?.auth.oauth;
  if (!oauth) return null;
  const current = await store.read("xai");
  if (!current || current.type !== "oauth") return null;
  if (current.expires > Date.now()) return current.access;
  const credential = await store.modify("xai", async (current) => {
    if (!current || current.type !== "oauth") return undefined;
    return current.expires > Date.now() ? current : oauth.refresh(current);
  });
  return credential?.type === "oauth" ? credential.access : null;
}

/** Read Claude Code plan windows without starting a model turn. */
export async function readClaudeSubscriptionRateLimits(): Promise<{
  available: boolean;
  fiveHour?: { utilization: number | null; resetsAt: string | null } | null;
  sevenDay?: { utilization: number | null; resetsAt: string | null } | null;
}> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 10_000);
  const sdkQuery = query({
    prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
      await new Promise<void>((resolve) => {
        if (abortController.signal.aborted) resolve();
        else abortController.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    })(),
    options: {
      abortController,
      cwd: process.cwd(),
      tools: [],
      allowedTools: [],
      permissionMode: "dontAsk",
      settingSources: [],
      persistSession: false,
      env: new ProviderAuthenticationRouter({ anthropic: "subscription" }).claudeEnvironment(),
    },
  });
  try {
    await sdkQuery.initializationResult();
    const response = await sdkQuery.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
    return {
      available: response.rate_limits_available,
      fiveHour: response.rate_limits?.five_hour ? {
        utilization: response.rate_limits.five_hour.utilization,
        resetsAt: response.rate_limits.five_hour.resets_at,
      } : null,
      sevenDay: response.rate_limits?.seven_day ? {
        utilization: response.rate_limits.seven_day.utilization,
        resetsAt: response.rate_limits.seven_day.resets_at,
      } : null,
    };
  } finally {
    clearTimeout(timeout);
    sdkQuery.close();
  }
}
