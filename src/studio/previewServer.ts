import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

/** Build the interactive Studio wrapper HTML embedding timeline.html with a live scrubber. */
export function buildStudioWrapperHtml(title: string): string {
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>vidgen Studio - ${safeTitle}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #070a12; color: #f8fafc; font-family: "Segoe UI", system-ui, sans-serif; display: flex; flex-direction: column; height: 100vh; }
  header { padding: 12px 20px; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; }
  .stage-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px; overflow: hidden; }
  iframe { width: 100%; max-width: 1120px; aspect-ratio: 16 / 9; max-height: 75vh; border: 1px solid #334155; border-radius: 14px; background: #090d16; }
  footer { padding: 14px 20px; border-top: 1px solid #1e293b; display: flex; gap: 14px; align-items: center; }
  button { padding: 8px 18px; border-radius: 8px; border: 0; background: #38bdf8; color: #04070f; font-weight: 700; cursor: pointer; }
  input[type="range"] { flex: 1; accent-color: #38bdf8; }
  #time-label { font-variant-numeric: tabular-nums; min-width: 110px; text-align: right; color: #94a3b8; }
</style>
</head>
<body>
  <header><strong>vidgen Studio</strong><span>${safeTitle}</span></header>
  <div class="stage-wrap"><iframe id="stage-frame" src="/timeline.html"></iframe></div>
  <footer>
    <button id="play-btn" type="button">Play</button>
    <input id="scrubber" type="range" min="0" max="30" step="0.04" value="0">
    <span id="time-label">0.00s</span>
  </footer>
  <script>
    const frame = document.getElementById("stage-frame");
    const btn = document.getElementById("play-btn");
    const scrubber = document.getElementById("scrubber");
    const label = document.getElementById("time-label");
    let playing = false;
    let rafId = 0;
    let lastTs = 0;

    frame.addEventListener("load", () => {
      const data = frame.contentWindow.__TIMELINE_DATA__;
      if (data && data.totalDurationSec) {
        scrubber.max = String(data.totalDurationSec);
      }
      seek(0);
    });

    function seek(sec) {
      const clock = frame.contentWindow && frame.contentWindow.__VIDGEN_CLOCK__;
      if (clock) clock.seekToMs(sec * 1000);
      scrubber.value = String(sec);
      label.textContent = sec.toFixed(2) + "s / " + Number(scrubber.max).toFixed(2) + "s";
    }

    scrubber.addEventListener("input", () => {
      playing = false;
      btn.textContent = "Play";
      seek(Number(scrubber.value));
    });

    function tick(ts) {
      if (!playing) return;
      const dt = lastTs ? (ts - lastTs) / 1000 : 0;
      lastTs = ts;
      let next = Number(scrubber.value) + dt;
      if (next > Number(scrubber.max)) next = 0;
      seek(next);
      rafId = requestAnimationFrame(tick);
    }

    btn.addEventListener("click", () => {
      playing = !playing;
      btn.textContent = playing ? "Pause" : "Play";
      lastTs = 0;
      if (playing) rafId = requestAnimationFrame(tick);
      else cancelAnimationFrame(rafId);
    });
  </script>
</body>
</html>`;
}

/** Start a localhost-only preview Studio server for an existing rendered job directory. */
export async function startPreviewStudioServer(options: {
  jobDir: string;
  port?: number;
}): Promise<{ server: Server; url: string }> {
  const port = options.port ?? 4173;
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const reqPath = (req.url ?? "/").split("?")[0];
    if (reqPath === "/timeline.html") {
      try {
        const html = await readFile(join(options.jobDir, "timeline.html"), "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("timeline.html not found in job directory");
      }
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildStudioWrapperHtml("Interactive Scrubber"));
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  return { server, url: `http://127.0.0.1:${resolvedPort}` };
}
