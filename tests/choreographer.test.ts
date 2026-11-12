import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enrichStoryboardWithChoreography } from "../src/director/choreographer.js";
import { StoryboardSchema } from "../src/director/storyboardSchema.js";
import { ProviderRouter } from "../src/providers/router.js";

describe("choreographer", () => {
  it("should enrich storyboard scenes with layoutMode, cursorTarget, and sanitized customSvg", async () => {
    const base = StoryboardSchema.parse({
      title: "Test Video",
      hookLine: "Hook line",
      aspectRatio: "16:9",
      scenes: [
        {
          id: "s1",
          archetype: "HeroTitle",
          headline: "Hero One",
          displayText: "Display One",
          spokenText: "Hello scene one",
        },
        {
          id: "s2",
          archetype: "SplitShowcase",
          headline: "Split Two",
          displayText: "Display Two",
          spokenText: "Hello scene two",
        },
        {
          id: "s3",
          archetype: "OutroCTA",
          headline: "Outro Three",
          displayText: "Display Three",
          spokenText: "Hello scene three",
        },
      ],
    });

    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  scenes: [
                    {
                      id: "s2",
                      layoutMode: "split",
                      cursorTarget: "visual",
                      customSvg:
                        '<svg viewBox="0 0 420 320"><circle class="svg-pulse" cx="210" cy="160" r="60"/></svg>',
                    },
                    {
                      id: "s3",
                      layoutMode: "centered",
                      cursorTarget: "cta",
                      ctaLabel: "Try vidgen Free",
                    },
                  ],
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
          candidateKey: "nvidia:nemotron:k1",
          apiKey: "test",
          isCustom: false,
          model: {
            id: "nvidia/nemotron-3.5-lightning-30b-a3b",
            displayName: "Nemotron",
            providerId: "nvidia",
            dialect: "openai-compatible",
            baseUrl: "https://example.invalid/v1",
            roles: ["coder"],
            supportsVision: false,
            supportsJsonMode: true,
            codingTier: "high",
            priority: 1,
          },
        },
      ],
    });

    const enriched = await enrichStoryboardWithChoreography({ storyboard: base, router });
    assert.equal(enriched.scenes[1]?.layoutMode, "split");
    assert.equal(enriched.scenes[1]?.cursorTarget, "visual");
    assert.match(enriched.scenes[1]?.customSvg ?? "", /svg-pulse/);
    assert.equal(enriched.scenes[2]?.ctaLabel, "Try vidgen Free");
  });
});
