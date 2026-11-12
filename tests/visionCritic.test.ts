import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { StoryboardSchema } from "../src/director/storyboardSchema.js";
import { ProviderRouter } from "../src/providers/router.js";
import { critiqueRenderedContactSheet } from "../src/qa/visionCritic.js";

describe("visionCritic", () => {
  it("should parse structured Vision critique from a vision-capable candidate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vidgen-vision-"));
    try {
      const sheetPath = join(dir, "sheet.png");
      await writeFile(sheetPath, Buffer.from([137, 80, 78, 71]));

      const storyboard = StoryboardSchema.parse({
        title: "Vision Test",
        hookLine: "Hook",
        aspectRatio: "16:9",
        scenes: [
          { id: "s1", archetype: "HeroTitle", headline: "One", displayText: "D1", spokenText: "Scene one" },
          { id: "s2", archetype: "MetricCounter", headline: "Two", displayText: "D2", spokenText: "Scene two" },
          { id: "s3", archetype: "OutroCTA", headline: "Three", displayText: "D3", spokenText: "Scene three" },
        ],
      });

      const fakeFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    overallScore: 9,
                    contrastOk: true,
                    readabilityOk: true,
                    visualVarietyOk: true,
                    summary: "Strong visual balance and contrast across scenes.",
                    weakScenes: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );

      const router = new ProviderRouter({
        fetchImpl: fakeFetch,
        candidates: [
          {
            candidateKey: "nvidia:vision:k1",
            apiKey: "test",
            isCustom: false,
            model: {
              id: "nvidia/nemotron-3.5-super-vl-120b-a12b",
              displayName: "Nemotron VL",
              providerId: "nvidia",
              dialect: "openai-compatible",
              baseUrl: "https://example.invalid/v1",
              roles: ["vision"],
              supportsVision: true,
              supportsJsonMode: true,
              codingTier: "high",
              priority: 1,
            },
          },
        ],
      });

      const critique = await critiqueRenderedContactSheet({
        contactSheetPath: sheetPath,
        storyboard,
        router,
      });

      assert.equal(critique?.overallScore, 9);
      assert.equal(critique?.contrastOk, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
