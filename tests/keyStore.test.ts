import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  addBuiltInApiKey,
  buildRoutedCandidates,
  loadKeyStore,
  maskApiKey,
  upsertCustomProvider,
} from "../src/providers/keyStore.js";

describe("keyStore", () => {
  let tempDir = "";
  let storePath = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vidgen-keys-"));
    storePath = join(tempDir, "keys.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should mask API keys safely", () => {
    assert.equal(maskApiKey("nvapi-1234567890abcdef"), "nvap...cdef");
    assert.equal(maskApiKey("short"), "****");
  });

  it("should persist multiple built-in keys and custom providers", async () => {
    await addBuiltInApiKey({ providerId: "nvidia", apiKey: "nvapi-first-key-1111", storePath });
    await addBuiltInApiKey({ providerId: "nvidia", apiKey: "nvapi-second-key-2222", storePath });
    await upsertCustomProvider({
      storePath,
      provider: {
        id: "my-custom-llm",
        displayName: "My Custom Endpoint",
        dialect: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        apiKey: "custom-secret-9999",
        modelId: "custom-70b",
        roles: ["architect", "coder"],
        supportsVision: false,
        supportsJsonMode: true,
        codingTier: "high",
        priority: 5,
      },
    });

    const store = await loadKeyStore(storePath);
    const candidates = buildRoutedCandidates(store, {});
    const nvidiaMatches = candidates.filter((item) => item.model.providerId === "nvidia");
    const customMatch = candidates.find((item) => item.isCustom);

    assert.equal(nvidiaMatches.length, 4);
    assert.equal(customMatch?.model.id, "custom-70b");
    assert.equal(candidates[0]?.isCustom, true);
  });
});
