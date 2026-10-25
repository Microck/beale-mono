import type { Api, Model } from "@earendil-works/pi-ai";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const REFRESH_INTERVAL_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

let currentModels: readonly Model<Api>[] | undefined;
let refreshedAt = 0;
let pendingRefresh: Promise<void> | undefined;

export function currentOpenRouterModels(): readonly Model<Api>[] | undefined {
  return currentModels;
}

export function refreshOpenRouterModels(fetchModels: typeof fetch = fetch): Promise<void> {
  if (refreshedAt && Date.now() - refreshedAt < REFRESH_INTERVAL_MS) return Promise.resolve();
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = (async () => {
    try {
      const response = await fetchModels(MODELS_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) return;
      const contentLength = Number(response.headers.get("content-length"));
      if (contentLength > MAX_RESPONSE_BYTES) return;
      const raw = await response.text();
      if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) return;
      const models = parseOpenRouterModels(JSON.parse(raw) as unknown);
      if (models.length > 0) currentModels = models;
    } catch {
      // Keep the last successful catalog, or the bundled Pi catalog when offline.
    } finally {
      refreshedAt = Date.now();
      pendingRefresh = undefined;
    }
  })();
  return pendingRefresh;
}

export function parseOpenRouterModels(value: unknown): Model<Api>[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  const models = new Map<string, Model<Api>>();
  for (const item of value.data) {
    if (!isRecord(item) || typeof item.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/~+-]*$/u.test(item.id)) continue;
    if (typeof item.name !== "string" || !item.name.trim()) continue;
    if (!isRecord(item.architecture) || !Array.isArray(item.architecture.input_modalities)
      || !item.architecture.input_modalities.includes("text")
      || !Array.isArray(item.architecture.output_modalities)
      || !item.architecture.output_modalities.includes("text")) continue;
    if (!Array.isArray(item.supported_parameters) || !item.supported_parameters.includes("tools")) continue;
    const contextWindow = positiveInteger(item.context_length);
    const topProvider = isRecord(item.top_provider) ? item.top_provider : undefined;
    const maxTokens = positiveInteger(topProvider?.max_completion_tokens);
    if (!contextWindow || !maxTokens) continue;
    const pricing = isRecord(item.pricing) ? item.pricing : {};
    const inputPrice = pricePerMillion(pricing.prompt);
    const outputPrice = pricePerMillion(pricing.completion);
    if (inputPrice === undefined || outputPrice === undefined) continue;
    const reasoningInfo = isRecord(item.reasoning) ? item.reasoning : undefined;
    const reasoning = reasoningInfo?.mandatory === true || reasoningInfo?.default_enabled === true
      || item.supported_parameters.includes("reasoning") || item.supported_parameters.includes("reasoning_effort");
    const supportedEfforts = Array.isArray(reasoningInfo?.supported_efforts)
      ? new Set(reasoningInfo.supported_efforts.filter((effort): effort is string => typeof effort === "string"))
      : undefined;
    const thinkingLevelMap: NonNullable<Model<Api>["thinkingLevelMap"]> | undefined = supportedEfforts
      ? {
          off: reasoningInfo?.mandatory === true || !supportedEfforts.has("none") ? null : "none",
          minimal: supportedEfforts.has("minimal") ? "minimal" : null,
          low: supportedEfforts.has("low") ? "low" : null,
          medium: supportedEfforts.has("medium") ? "medium" : null,
          high: supportedEfforts.has("high") ? "high" : null,
          xhigh: supportedEfforts.has("xhigh") ? "xhigh" : null,
          max: supportedEfforts.has("max") ? "max" : null,
        }
      : reasoningInfo?.mandatory === true ? { off: null } : undefined;
    const input: Array<"text" | "image"> = item.architecture.input_modalities.includes("image")
      ? ["text", "image"] : ["text"];
    models.set(item.id, {
      id: item.id,
      name: item.name.trim(),
      api: "openai-completions",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter" },
      reasoning,
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      input,
      cost: {
        input: inputPrice,
        output: outputPrice,
        cacheRead: pricePerMillion(pricing.input_cache_read) ?? 0,
        cacheWrite: pricePerMillion(pricing.input_cache_write) ?? 0,
      },
      contextWindow,
      maxTokens,
    });
  }
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function pricePerMillion(value: unknown): number | undefined {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : undefined;
}
