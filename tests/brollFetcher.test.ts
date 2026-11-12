import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { StoryboardSchema } from "../src/director/storyboardSchema.js";
import { enrichStoryboardWithBroll } from "../src/media/brollFetcher.js";

describe("brollFetcher", () => {
  it("should enrich non-code scenes with data URI B-roll images via mocked stock API", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vidgen-broll-"));
    try {
      const storyboard = StoryboardSchema.parse({
        title: "Stock Test",
        hookLine: "Hook",
        aspectRatio: "16:9",
        scenes: [
          {
            id: "s1",
            archetype: "HeroTitle",
            headline: "Cloud Scale",
            displayText: "Fast compute",
            spokenText: "Cloud systems scale globally",
            brollQuery: "server data center",
          },
          {
            id: "s2",
            archetype: "CodeWalkthrough",
            headline: "Code Scene",
            displayText: "TypeScript snippet",
            spokenText: "Write typed handlers cleanly",
            brollQuery: "typing code",
            codeSnippet: "const x = 1;",
          },
          {
            id: "s3",
            archetype: "OutroCTA",
            headline: "Start Now",
            displayText: "Launch today",
            spokenText: "Try it today",
          },
        ],
      });

      const fakeFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes("commons.wikimedia.org")) {
          return new Response(
            JSON.stringify({
              query: {
                pages: {
                  "1": { imageinfo: [{ thumburl: "https://img.invalid/pic.jpg", mime: "image/jpeg" }] },
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      };

      const enriched = await enrichStoryboardWithBroll({
        storyboard,
        mediaDir: dir,
        fetchImpl: fakeFetch,
        env: {},
      });

      assert.match(enriched.scenes[0]?.brollImageUrl ?? "", /^data:image\/jpeg;base64,/);
      assert.equal(enriched.scenes[1]?.brollImageUrl, undefined);
      assert.equal(enriched.scenes[2]?.brollImageUrl, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
