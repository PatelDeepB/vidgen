import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderResponseError,
} from "../core/errors.js";
import { stripThinkingBlocks } from "./sanitizer.js";
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  RoutedCandidate,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_COOLDOWN_MS = 30_000;

export type FetchImplementation = typeof fetch;

/** Execute a completion call against either an OpenAI-compatible or Gemini endpoint. */
export async function executeCandidateCompletion(options: {
  candidate: RoutedCandidate;
  request: CompletionRequest;
  fetchImpl?: FetchImplementation;
  timeoutMs?: number;
}): Promise<CompletionResponse> {
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  if (options.candidate.model.dialect === "gemini") {
    return callGeminiEndpoint({
      candidate: options.candidate,
      request: options.request,
      fetchFn,
      timeoutMs,
      startedAt,
    });
  }

  return callOpenAiCompatibleEndpoint({
    candidate: options.candidate,
    request: options.request,
    fetchFn,
    timeoutMs,
    startedAt,
  });
}

/** Call an OpenAI-compatible chat completions endpoint (NVIDIA NIM, Groq, OpenRouter, custom). */
async function callOpenAiCompatibleEndpoint(params: {
  candidate: RoutedCandidate;
  request: CompletionRequest;
  fetchFn: FetchImplementation;
  timeoutMs: number;
  startedAt: number;
}): Promise<CompletionResponse> {
  const { candidate, request, fetchFn, timeoutMs, startedAt } = params;
  const baseUrl = candidate.model.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${candidate.apiKey}`,
    ...(candidate.model.defaultHeaders ?? {}),
  };

  const body = buildOpenAiPayload(candidate, request);
  const response = await fetchWithTimeout({ url, headers, body, fetchFn, timeoutMs });
  await assertOkResponse(response, candidate.candidateKey);

  const json = (await response.json()) as Record<string, unknown>;
  return parseOpenAiResponse({ json, candidate, startedAt });
}

/** Build JSON body for OpenAI-compatible endpoints including NVIDIA Nemotron kwargs. */
function buildOpenAiPayload(
  candidate: RoutedCandidate,
  request: CompletionRequest,
): Record<string, unknown> {
  const maxTokens = request.maxTokens ?? 4096;
  const payload: Record<string, unknown> = {
    model: candidate.model.id,
    messages: request.messages.map((message) => formatOpenAiMessage(message)),
    temperature: request.temperature ?? 0.5,
    max_tokens: maxTokens,
  };

  if (request.preferJsonMode && candidate.model.supportsJsonMode) {
    payload.response_format = { type: "json_object" };
  }
  if (candidate.model.enableThinkingPayload) {
    const shouldThink = !request.disableThinking && maxTokens >= 512;
    payload.chat_template_kwargs = { enable_thinking: shouldThink };
    if (shouldThink) {
      payload.reasoning_budget = Math.min(maxTokens, 2048);
    }
  }
  return payload;
}

/** Convert internal ChatMessage to OpenAI multimodal or text message structure. */
function formatOpenAiMessage(message: ChatMessage): Record<string, unknown> {
  if (!message.imageBase64Png) {
    return { role: message.role, content: message.content };
  }
  return {
    role: message.role,
    content: [
      { type: "text", text: message.content },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${message.imageBase64Png}` },
      },
    ],
  };
}

/** Parse OpenAI-compatible JSON completion response into CompletionResponse. */
function parseOpenAiResponse(params: {
  json: Record<string, unknown>;
  candidate: RoutedCandidate;
  startedAt: number;
}): CompletionResponse {
  const choices = params.json.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderResponseError("Missing choices in OpenAI-compatible response", {
      candidate: params.candidate.candidateKey,
    });
  }
  const firstChoice = choices[0] as Record<string, unknown>;
  const message = firstChoice.message as Record<string, unknown> | undefined;
  const rawContent = typeof message?.content === "string" ? message.content : "";
  if (!rawContent) {
    throw new ProviderResponseError("Empty completion content received", {
      candidate: params.candidate.candidateKey,
    });
  }
  const usage = (params.json.usage as Record<string, unknown> | undefined) ?? {};
  return {
    rawContent,
    cleanContent: stripThinkingBlocks(rawContent),
    providerId: params.candidate.model.providerId,
    modelId: params.candidate.model.id,
    latencyMs: Date.now() - params.startedAt,
    promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
    completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
  };
}

/** Call Google Gemini native REST generateContent endpoint. */
async function callGeminiEndpoint(params: {
  candidate: RoutedCandidate;
  request: CompletionRequest;
  fetchFn: FetchImplementation;
  timeoutMs: number;
  startedAt: number;
}): Promise<CompletionResponse> {
  const { candidate, request, fetchFn, timeoutMs, startedAt } = params;
  const baseUrl = candidate.model.baseUrl.replace(/\/+$/, "");
  const encodedModel = encodeURIComponent(candidate.model.id);
  const url = `${baseUrl}/models/${encodedModel}:generateContent`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-goog-api-key": candidate.apiKey,
    ...(candidate.model.defaultHeaders ?? {}),
  };

  const body = buildGeminiPayload(candidate, request);
  const response = await fetchWithTimeout({ url, headers, body, fetchFn, timeoutMs });
  await assertOkResponse(response, candidate.candidateKey);

  const json = (await response.json()) as Record<string, unknown>;
  return parseGeminiResponse({ json, candidate, startedAt });
}

/** Build Gemini generateContent request payload with optional system prompt & PNG image. */
function buildGeminiPayload(
  candidate: RoutedCandidate,
  request: CompletionRequest,
): Record<string, unknown> {
  const systemMessages = request.messages.filter((msg) => msg.role === "system");
  const conversational = request.messages.filter((msg) => msg.role !== "system");

  const generationConfig: Record<string, unknown> = {
    temperature: request.temperature ?? 0.5,
    maxOutputTokens: request.maxTokens ?? 4096,
  };
  if (request.preferJsonMode && candidate.model.supportsJsonMode) {
    generationConfig.responseMimeType = "application/json";
  }

  const payload: Record<string, unknown> = {
    contents: conversational.map((msg) => formatGeminiContent(msg)),
    generationConfig,
  };
  if (systemMessages.length > 0) {
    payload.systemInstruction = {
      parts: [{ text: systemMessages.map((msg) => msg.content).join("\n\n") }],
    };
  }
  return payload;
}

/** Format a ChatMessage into Gemini parts including optional inline PNG data. */
function formatGeminiContent(message: ChatMessage): Record<string, unknown> {
  const parts: Array<Record<string, unknown>> = [{ text: message.content }];
  if (message.imageBase64Png) {
    parts.push({
      inlineData: {
        mimeType: "image/png",
        data: message.imageBase64Png,
      },
    });
  }
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts,
  };
}

/** Parse Gemini generateContent JSON into CompletionResponse. */
function parseGeminiResponse(params: {
  json: Record<string, unknown>;
  candidate: RoutedCandidate;
  startedAt: number;
}): CompletionResponse {
  const candidates = params.json.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new ProviderResponseError("Missing candidates in Gemini response", {
      candidate: params.candidate.candidateKey,
    });
  }
  const first = candidates[0] as Record<string, unknown>;
  const contentObj = first.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(contentObj?.parts) ? contentObj.parts : [];
  const rawContent = parts
    .map((part) => (typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, unknown>).text : ""))
    .join("");

  if (!rawContent) {
    throw new ProviderResponseError("Empty Gemini completion text", {
      candidate: params.candidate.candidateKey,
    });
  }
  const usage = (params.json.usageMetadata as Record<string, unknown> | undefined) ?? {};
  return {
    rawContent,
    cleanContent: stripThinkingBlocks(rawContent),
    providerId: params.candidate.model.providerId,
    modelId: params.candidate.model.id,
    latencyMs: Date.now() - params.startedAt,
    promptTokens: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : 0,
    completionTokens: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0,
  };
}

/** Execute HTTP POST with an explicit AbortController timeout. */
async function fetchWithTimeout(params: {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  fetchFn: FetchImplementation;
  timeoutMs: number;
}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    return await params.fetchFn(params.url, {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify(params.body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ProviderResponseError("Network or timeout error calling provider", {
      reason: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Map non-2xx HTTP statuses into typed auth, rate-limit, or response errors. */
async function assertOkResponse(response: Response, candidateKey: string): Promise<void> {
  if (response.ok) {
    return;
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProviderAuthError(candidateKey, response.status);
  }
  if (response.status === 429) {
    const retryHeader = response.headers.get("retry-after");
    const parsedSeconds = retryHeader ? Number(retryHeader) : NaN;
    const retryAfterMs = Number.isFinite(parsedSeconds) && parsedSeconds > 0
      ? parsedSeconds * 1000
      : DEFAULT_COOLDOWN_MS;
    throw new ProviderRateLimitError(candidateKey, retryAfterMs);
  }
  const errorText = await response.text().catch(() => "");
  throw new ProviderResponseError(`HTTP ${response.status} from ${candidateKey}`, {
    status: response.status,
    snippet: errorText.slice(0, 300),
  });
}
