import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAudioLockedTimeline } from "../src/audio/timelineSync.js";
import { StoryboardSchema } from "../src/director/storyboardSchema.js";
import { buildTimelineHtml, resolveViewportDimensions } from "../src/renderer/htmlBuilder.js";

describe("htmlBuilder", () => {
  it("should resolve aspect ratios cleanly for draft and hq", () => {
    assert.deepEqual(resolveViewportDimensions("16:9", "draft"), { width: 1280, height: 720 });
    assert.deepEqual(resolveViewportDimensions("9:16", "hq"), { width: 1080, height: 1920 });
    assert.deepEqual(resolveViewportDimensions("1:1", "hq"), { width: 1080, height: 1080 });
  });

  it("should compile self-contained timeline HTML with opaque stage ground", () => {
    const storyboard = StoryboardSchema.parse({
      title: "Demo",
      hookLine: "Hook",
      aspectRatio: "9:16",
      scenes: [
        { id: "s1", archetype: "HeroTitle", headline: "Title One", displayText: "Body One", spokenText: "One two" },
        { id: "s2", archetype: "StepFlow", headline: "Title Two", displayText: "Body Two", spokenText: "Three four", steps: ["One", "Two"] },
        { id: "s3", archetype: "OutroCTA", headline: "Title Three", displayText: "Body Three", spokenText: "Five six" },
      ],
    });
    const timeline = buildAudioLockedTimeline(storyboard, [
      { sceneId: "s1", audioPath: "1.mp3", durationSec: 2, wordTimings: [], isFallbackSilence: true },
      { sceneId: "s2", audioPath: "2.mp3", durationSec: 2, wordTimings: [], isFallbackSilence: true },
      { sceneId: "s3", audioPath: "3.mp3", durationSec: 2, wordTimings: [], isFallbackSilence: true },
    ]);

    const html = buildTimelineHtml(timeline, { width: 720, height: 1280 });
    assert.match(html, /id="stage"/);
    assert.match(html, /__VIDGEN_CLOCK__/);
    assert.match(html, /background: #090d16/);
  });
});
