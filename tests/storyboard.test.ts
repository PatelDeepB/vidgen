import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateWordsPerSecond, StoryboardSchema } from "../src/director/storyboardSchema.js";

describe("storyboardSchema", () => {
  it("should validate a complete multi-scene storyboard and compute WPS", () => {
    const sample = {
      title: "How Vector Search Works",
      hookLine: "Find meaning in milliseconds, not keywords.",
      aspectRatio: "9:16",
      musicMood: "tech",
      scenes: [
        {
          id: "scene-1",
          archetype: "HeroTitle",
          headline: "Keyword Search Is Blind",
          displayText: "Exact words miss real intent.",
          spokenText: "Keyword search misses what your users actually mean.",
          sfxCue: "whoosh",
          exitVector: "zoom-in",
          estimatedDurationSec: 4,
        },
        {
          id: "scene-2",
          archetype: "MetricCounter",
          headline: "100x Faster Recall",
          displayText: "Embeddings map concepts to coordinates.",
          spokenText: "Vector embeddings turn concepts into fast geometric math.",
          metricValue: "100x",
          metricLabel: "Semantic Recall Speed",
          sfxCue: "pop",
          exitVector: "left",
          estimatedDurationSec: 4.5,
        },
        {
          id: "scene-3",
          archetype: "OutroCTA",
          headline: "Build Smarter Search",
          displayText: "Try hybrid vector + keyword retrieval today.",
          spokenText: "Combine vectors with keywords for instant accuracy.",
          sfxCue: "chime",
          exitVector: "fade",
          estimatedDurationSec: 4,
        },
      ],
    };

    const parsed = StoryboardSchema.parse(sample);
    assert.equal(parsed.scenes.length, 3);
    assert.equal(calculateWordsPerSecond(parsed.scenes[0]!), 2);
  });
});
