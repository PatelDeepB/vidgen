import type { AudioLockedTimeline } from "../audio/timelineSync.js";
import type { AspectRatio } from "../director/storyboardSchema.js";

/** Viewport pixel dimensions for rendering. */
export interface ViewportDimensions {
  readonly width: number;
  readonly height: number;
}

/** Resolve pixel dimensions for aspect ratio and quality tier. */
export function resolveViewportDimensions(
  aspectRatio: AspectRatio,
  quality: "draft" | "hq",
): ViewportDimensions {
  if (aspectRatio === "9:16") {
    return quality === "hq" ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
  }
  if (aspectRatio === "1:1") {
    return quality === "hq" ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
  }
  return quality === "hq" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}

/** Build a self-contained HTML5 document driven by window.__VIDGEN_CLOCK__. */
export function buildTimelineHtml(
  timeline: AudioLockedTimeline,
  dimensions: ViewportDimensions,
): string {
  const safePayload = JSON.stringify({
    theme: timeline.storyboard.theme,
    totalDurationSec: timeline.totalDurationSec,
    aspectRatio: timeline.storyboard.aspectRatio,
    scenes: timeline.scenes,
    captions: timeline.captions,
  }).replace(/</g, "\\u003c");

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(timeline.storyboard.title)}</title>`,
    "<style>",
    buildBaseStyles(timeline, dimensions),
    "</style>",
    "</head>",
    "<body>",
    '<main id="stage" aria-label="Video Stage">',
    '  <canvas id="bg-canvas"></canvas>',
    '  <div id="scene-host"></div>',
    '  <div id="caption-rail" aria-live="polite"></div>',
    '  <div id="progress-track"><div id="progress-fill"></div></div>',
    "</main>",
    `<script>window.__TIMELINE_DATA__ = ${safePayload};</script>`,
    "<script>",
    buildClientRuntimeScript(),
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");
}

/** Generate responsive CSS locked to the storyboard's theme tokens and viewport size. */
function buildBaseStyles(timeline: AudioLockedTimeline, dim: ViewportDimensions): string {
  const { theme } = timeline.storyboard;
  const isVertical = dim.height > dim.width;
  const captionBottom = isVertical ? "8.5%" : "6%";
  const contentPadBottom = isVertical ? "15%" : "10%";

  return `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: ${dim.width}px;
  height: ${dim.height}px;
  overflow: hidden;
  background: ${theme.backgroundHex};
  color: ${theme.textHex};
  font-family: "Segoe UI", "Inter", system-ui, -apple-system, sans-serif;
}
#stage {
  position: relative;
  width: 100%;
  height: 100%;
  background: ${theme.backgroundHex};
  overflow: hidden;
}
#bg-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}
#scene-host {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 7% 8% ${contentPadBottom} 8%;
}
.scene-card {
  width: 100%;
  max-width: ${isVertical ? "94%" : "86%"};
  display: flex;
  flex-direction: column;
  gap: clamp(14px, 2.2vh, 28px);
  will-change: transform, opacity;
}
.eyebrow {
  display: inline-flex;
  align-self: flex-start;
  padding: 8px 18px;
  border-radius: 999px;
  font-size: clamp(14px, 1.5vw, 22px);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${theme.primaryHex};
  background: ${theme.surfaceHex};
  border: 1px solid ${theme.primaryHex}55;
}
.headline {
  font-size: clamp(34px, ${isVertical ? "6.4vw" : "4.4vw"}, 84px);
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -0.025em;
}
.display-text {
  font-size: clamp(20px, ${isVertical ? "3.4vw" : "2.1vw"}, 36px);
  line-height: 1.42;
  opacity: 0.9;
  max-width: 58ch;
}
.metric-box {
  display: inline-flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px 32px;
  border-radius: 20px;
  background: ${theme.surfaceHex}dd;
  border: 1px solid ${theme.accentHex}66;
  align-self: flex-start;
}
.metric-value {
  font-size: clamp(48px, 7vw, 112px);
  font-weight: 900;
  color: ${theme.primaryHex};
}
.code-box {
  padding: 22px 26px;
  border-radius: 16px;
  background: #050811;
  border: 1px solid ${theme.primaryHex}44;
  font-family: "Cascadia Code", "Consolas", monospace;
  font-size: clamp(15px, 1.6vw, 24px);
  line-height: 1.5;
  color: ${theme.primaryHex};
  white-space: pre-wrap;
}
.steps-grid {
  display: grid;
  grid-template-columns: ${isVertical ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))"};
  gap: 16px;
}
.step-pill {
  padding: 18px 22px;
  border-radius: 16px;
  background: ${theme.surfaceHex};
  border-left: 4px solid ${theme.accentHex};
  font-size: clamp(16px, 1.7vw, 26px);
  font-weight: 600;
}
#caption-rail {
  position: absolute;
  left: 50%;
  bottom: ${captionBottom};
  transform: translateX(-50%);
  z-index: 10;
  max-width: 86%;
  padding: 10px 22px;
  border-radius: 14px;
  background: rgba(5, 8, 17, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.14);
  font-size: clamp(18px, ${isVertical ? "3.2vw" : "1.8vw"}, 30px);
  font-weight: 700;
  text-align: center;
  line-height: 1.35;
}
.word-active {
  color: ${theme.primaryHex};
  text-shadow: 0 0 18px ${theme.primaryHex}88;
}
#progress-track {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 5px;
  background: rgba(255, 255, 255, 0.12);
  z-index: 12;
}
#progress-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, ${theme.primaryHex}, ${theme.accentHex});
}
`.trim();
}

/** Generate client JS driving procedural background, staggered reveals, and word captions. */
function buildClientRuntimeScript(): string {
  return `
(() => {
  const data = window.__TIMELINE_DATA__;
  const canvas = document.getElementById("bg-canvas");
  const ctx = canvas.getContext("2d");
  const sceneHost = document.getElementById("scene-host");
  const captionRail = document.getElementById("caption-rail");
  const progressFill = document.getElementById("progress-fill");
  let activeSceneId = "";

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();

  function easeOutCubic(t) {
    const c = Math.max(0, Math.min(1, t));
    return 1 - Math.pow(1 - c, 3);
  }

  function drawBackground(tSec) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = data.theme.backgroundHex;
    ctx.fillRect(0, 0, w, h);

    const orbX = w * (0.28 + 0.14 * Math.sin(tSec * 0.45));
    const orbY = h * (0.3 + 0.12 * Math.cos(tSec * 0.35));
    const g1 = ctx.createRadialGradient(orbX, orbY, 10, orbX, orbY, Math.max(w, h) * 0.55);
    g1.addColorStop(0, data.theme.primaryHex + "33");
    g1.addColorStop(1, "transparent");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);

    const orb2X = w * (0.76 + 0.1 * Math.cos(tSec * 0.3));
    const orb2Y = h * (0.72 + 0.1 * Math.sin(tSec * 0.4));
    const g2 = ctx.createRadialGradient(orb2X, orb2Y, 10, orb2X, orb2Y, Math.max(w, h) * 0.45);
    g2.addColorStop(0, data.theme.accentHex + "2b");
    g2.addColorStop(1, "transparent");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    const step = 64;
    const offset = (tSec * 14) % step;
    for (let x = -step + offset; x < w + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }

  function mountSceneDom(scheduled) {
    const s = scheduled.scene;
    const parts = ['<div class="scene-card" data-scene-id="' + s.id + '">'];
    if (s.eyebrow) {
      parts.push('<div class="eyebrow anim-item" data-delay="0">' + esc(s.eyebrow) + '</div>');
    }
    parts.push('<h1 class="headline anim-item" data-delay="0.08">' + esc(s.headline) + '</h1>');
    parts.push('<p class="display-text anim-item" data-delay="0.18">' + esc(s.displayText) + '</p>');
    if (s.metricValue) {
      parts.push('<div class="metric-box anim-item" data-delay="0.26"><div class="metric-value">' + esc(s.metricValue) + '</div><div>' + esc(s.metricLabel || "") + '</div></div>');
    }
    if (s.codeSnippet) {
      parts.push('<pre class="code-box anim-item" data-delay="0.26">' + esc(s.codeSnippet) + '</pre>');
    }
    if (Array.isArray(s.steps) && s.steps.length > 0) {
      parts.push('<div class="steps-grid">' + s.steps.map((st, idx) => '<div class="step-pill anim-item" data-delay="' + (0.24 + idx * 0.09) + '">' + (idx + 1) + '. ' + esc(st) + '</div>').join("") + '</div>');
    }
    parts.push("</div>");
    sceneHost.innerHTML = parts.join("");
  }

  function applySceneMotion(scheduled, localSec) {
    const card = sceneHost.querySelector(".scene-card");
    if (!card) return;
    const enterP = easeOutCubic(localSec / 0.45);
    const exitRem = scheduled.durationSec - localSec;
    const exitP = exitRem < 0.3 ? easeOutCubic((0.3 - exitRem) / 0.3) : 0;

    let offsetX = 0;
    let offsetY = 0;
    let scale = 1;
    if (scheduled.entryDirection === "from-right") offsetX += (1 - enterP) * 70;
    if (scheduled.entryDirection === "from-left") offsetX -= (1 - enterP) * 70;
    if (scheduled.entryDirection === "from-bottom") offsetY += (1 - enterP) * 55;
    if (scheduled.entryDirection === "zoom-in") scale *= 0.92 + 0.08 * enterP;

    if (scheduled.scene.exitVector === "left") offsetX -= exitP * 70;
    if (scheduled.scene.exitVector === "right") offsetX += exitP * 70;
    if (scheduled.scene.exitVector === "up") offsetY -= exitP * 55;
    if (scheduled.scene.exitVector === "zoom-in") scale *= 1 + exitP * 0.08;

    const alpha = Math.min(enterP, 1 - exitP);
    card.style.opacity = String(Math.max(0, Math.min(1, alpha)));
    card.style.transform = "translate3d(" + offsetX.toFixed(1) + "px," + offsetY.toFixed(1) + "px,0) scale(" + scale.toFixed(4) + ")";

    const items = card.querySelectorAll(".anim-item");
    for (const item of items) {
      const delay = Number(item.getAttribute("data-delay") || "0");
      const itemP = easeOutCubic((localSec - delay) / 0.38);
      item.style.opacity = String(itemP);
      item.style.transform = "translateY(" + ((1 - itemP) * 20).toFixed(1) + "px)";
    }
  }

  function renderCaptions(tSec) {
    const active = data.captions.find((c) => tSec >= c.startSec && tSec <= c.endSec);
    const windowWords = data.captions.filter((c) => Math.abs(c.startSec - tSec) < 1.35).slice(0, 7);
    if (windowWords.length === 0) {
      captionRail.style.display = "none";
      return;
    }
    captionRail.style.display = "block";
    captionRail.innerHTML = windowWords.map((w) => {
      const isActive = active && w.startSec === active.startSec && w.word === active.word;
      return isActive ? '<span class="word-active">' + esc(w.word) + '</span>' : esc(w.word);
    }).join(" ");
  }

  function esc(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  window.__VIDGEN_CLOCK__.onFrame((_ms, tSec) => {
    drawBackground(tSec);
    const pct = Math.min(100, (tSec / Math.max(0.1, data.totalDurationSec)) * 100);
    progressFill.style.width = pct.toFixed(2) + "%";

    const current = data.scenes.find((s) => tSec >= s.startSec && tSec < s.endSec) || data.scenes[data.scenes.length - 1];
    if (current) {
      if (activeSceneId !== current.scene.id) {
        activeSceneId = current.scene.id;
        mountSceneDom(current);
      }
      applySceneMotion(current, tSec - current.startSec);
    }
    renderCaptions(tSec);
  });

  window.__VIDGEN_CLOCK__.seekToMs(0);
})();
`.trim();
}

/** Escape plain text safely for HTML title insertion. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
