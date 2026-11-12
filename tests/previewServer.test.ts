import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { startPreviewStudioServer } from "../src/studio/previewServer.js";

describe("previewServer", () => {
  it("should serve the Studio wrapper and timeline.html on localhost", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vidgen-studio-"));
    await writeFile(join(dir, "timeline.html"), "<html><body>Timeline</body></html>", "utf-8");

    const { server, url } = await startPreviewStudioServer({ jobDir: dir, port: 0 });
    try {
      const studioRes = await fetch(url);
      assert.equal(studioRes.status, 200);
      assert.match(await studioRes.text(), /vidgen Studio/);

      const timelineRes = await fetch(`${url}/timeline.html`);
      assert.equal(timelineRes.status, 200);
      assert.match(await timelineRes.text(), /Timeline/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
