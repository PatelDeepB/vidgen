import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AllProvidersExhaustedError, ConfigurationError } from "../src/core/errors.js";
import { ProviderRouter } from "../src/providers/router.js";
import type { RoutedCandidate } from "../src/providers/types.js";

function makeCandidate(overrides: Partial<RoutedCandidate["model"]> & { key?: string }): RoutedCandidate {
  const id = overrides.id ?? "model-a";
  const providerId = overrides.providerId ?? "groq";
  return {
    candidateKey: `${providerId}:${id}:${overrides.key ?? "k1"}`,
    apiKey: overrides.key ?? "test-key",
    isCustom: false,
    model: {
      id,
      displayName: id,
      providerId,
      dialect: overrides.dialect ?? "openai-compatible",
      baseUrl: overrides.baseUrl ?? "https://example.invalid/v1",
      roles: overrides.roles ?? ["architect", "coder", "repair"],
      supportsVision: overrides.supportsVision ?? false,
      supportsJsonMode: overrides.supportsJsonMode ?? true,
      codingTier: overrides.codingTier ?? "high",
      priority: overrides.priority ?? 10,
    },
  };
}

describe("ProviderRouter", () => {
  it("should fail over to next candidate on HTTP 429 rate limit", async () => {
    const calledUrls: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes("first.invalid")) {
        return new Response("Rate limit", { status: 429, headers: { "retry-after": "5" } });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "<think>ok</think>{\"ok\":true}" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const router = new ProviderRouter({
      fetchImpl: fakeFetch,
      candidates: [
        makeCandidate({ baseUrl: "https://first.invalid/v1", priority: 1 }),
        makeCandidate({ baseUrl: "https://second.invalid/v1", priority: 2 }),
      ],
    });

    const response = await router.complete({
      role: "architect",
      messages: [{ role: "user", content: "hi" }],
    });

    assert.equal(calledUrls.length, 2);
    assert.equal(response.cleanContent, '{"ok":true}');
  });

  it("should route vision requests exclusively to vision-capable models", async () => {
    const requestedModels: string[] = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      requestedModels.push(body.model ?? "gemini");
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"score":9}' }] } }],
        }),
        { status: 200 },
      );
    };

    const router = new ProviderRouter({
      fetchImpl: fakeFetch,
      candidates: [
        makeCandidate({ id: "text-only", supportsVision: false, priority: 1 }),
        makeCandidate({
          id: "vision-model",
          providerId: "gemini",
          dialect: "gemini",
          supportsVision: true,
          roles: ["vision"],
          priority: 2,
        }),
      ],
    });

    const response = await router.complete({
      role: "vision",
      requireVision: true,
      messages: [{ role: "user", content: "audit", imageBase64Png: "AAAA" }],
    });

    assert.deepEqual(requestedModels, ["gemini"]);
    assert.equal(response.modelId, "vision-model");
  });

  it("should throw ConfigurationError when no candidates support vision", async () => {
    const router = new ProviderRouter({
      candidates: [makeCandidate({ supportsVision: false })],
    });

    await assert.rejects(
      () =>
        router.complete({
          role: "vision",
          requireVision: true,
          messages: [{ role: "user", content: "audit" }],
        }),
      ConfigurationError,
    );
  });

  it("should throw AllProvidersExhaustedError when all candidates fail", async () => {
    const fakeFetch: typeof fetch = async () => new Response("Too many requests", { status: 429 });
    const router = new ProviderRouter({
      fetchImpl: fakeFetch,
      candidates: [makeCandidate({ priority: 1 }), makeCandidate({ priority: 2, key: "k2" })],
    });

    await assert.rejects(
      () =>
        router.complete({
          role: "architect",
          messages: [{ role: "user", content: "hello" }],
        }),
      AllProvidersExhaustedError,
    );
  });
});
