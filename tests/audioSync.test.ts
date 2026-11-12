import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { normalizeForSpeech } from "../src/audio/pronunciation.js";
import { buildAudioLockedTimeline, buildSrtCaptions } from "../src/audio/timelineSync.js";
import { parseEdgeMetadataFile } from "../src/audio/ttsEngine.js";
import { StoryboardSchema } from "../src/director/storyboardSchema.js";

describe("pronunciation and timelineSync", () => {
  it("should normalize technical acronyms, currency, and versions for TTS", () => {
    const raw = "v2.4 cuts API latency by 40% and saves $10M";
    assert.equal(
      normalizeForSpeech(raw),
      "version 2 point 4 cuts A P I latency by 40 percent and saves 10 million dollars",
    );
  });

  it("should lock scene durations to measured TTS durations and emit SRT", () => {
    const storyboard = StoryboardSchema.parse({
      title: "Test",
      hookLine: "Hook",
      aspectRatio: "16:9",
      scenes: [
        {
          id: "s1",
          archetype: "HeroTitle",
          headline: "H1",
          displayText: "D1",
          spokenText: "Hello world today",
          exitVector: "left",
        },
        {
          id: "s2",
          archetype: "KineticStatement",
          headline: "H2",
          displayText: "D2",
          spokenText: "Second scene line",
          exitVector: "up",
        },
        {
          id: "s3",
          archetype: "OutroCTA",
          headline: "H3",
          displayText: "D3",
          spokenText: "Final call",
          exitVector: "fade",
        },
      ],
    });

    const timeline = buildAudioLockedTimeline(storyboard, [
      {
        sceneId: "s1",
        audioPath: "a1.mp3",
        durationSec: 3.1,
        wordTimings: [{ word: "Hello", startMs: 0, durationMs: 400 }],
        isFallbackSilence: false,
      },
      {
        sceneId: "s2",
        audioPath: "a2.mp3",
        durationSec: 2.5,
        wordTimings: [{ word: "Second", startMs: 0, durationMs: 450 }],
        isFallbackSilence: false,
      },
      {
        sceneId: "s3",
        audioPath: "a3.mp3",
        durationSec: 2.0,
        wordTimings: [{ word: "Final", startMs: 0, durationMs: 350 }],
        isFallbackSilence: false,
      },
    ]);

    assert.equal(timeline.scenes[0]?.durationSec, 3.9);
    assert.equal(timeline.scenes[1]?.entryDirection, "from-right");
    assert.equal(timeline.scenes[2]?.entryDirection, "from-bottom");
    const srt = buildSrtCaptions(timeline.captions);
    assert.match(srt, /00:00:00,250 -->/);
  });

  it("should parse pretty-printed Edge TTS WordBoundary metadata files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vidgen-meta-"));
    try {
      const metaPath = join(dir, "metadata.json");
      await writeFile(
        metaPath,
        JSON.stringify(
          {
            Metadata: [
              {
                Type: "WordBoundary",
                Data: { Offset: 1_125_000, Duration: 6_750_000, text: { Text: "Deterministic" } },
              },
            ],
          },
          null,
          2,
        ),
        "utf-8",
      );
      const parsed = await parseEdgeMetadataFile(metaPath);
      assert.deepEqual(parsed, [{ word: "Deterministic", startMs: 113, durationMs: 675 }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
