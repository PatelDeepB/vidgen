import type { AudioLockedTimeline } from "../audio/timelineSync.js";
import type { AspectRatio } from "../director/storyboardSchema.js";
import { buildClientRuntimeScript } from "./clientRuntime.js";
import { buildTimelineStyles } from "./sceneStyles.js";

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
  scaleOverrides: Readonly<Record<string, number>> = {},
): string {
  const safePayload = JSON.stringify({
    theme: timeline.storyboard.theme,
    totalDurationSec: timeline.totalDurationSec,
    aspectRatio: timeline.storyboard.aspectRatio,
    scenes: timeline.scenes,
    captions: timeline.captions,
    scaleOverrides,
  }).replace(/</g, "\\u003c");

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(timeline.storyboard.title)}</title>`,
    "<style>",
    buildTimelineStyles(timeline, dimensions),
    "</style>",
    "</head>",
    "<body>",
    '<main id="stage" aria-label="Video Stage">',
    '  <canvas id="bg-canvas"></canvas>',
    '  <div id="broll-layer"></div>',
    '  <div id="broll-scrim"></div>',
    '  <div id="scene-host"></div>',
    '  <svg id="pointer-cursor" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M5 3L25 16L15.5 18.2L20.5 28L17 29.6L12 19.8L5 25V3Z" fill="#ffffff" stroke="#090d16" stroke-width="2" stroke-linejoin="round"/></svg>',
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

/** Escape plain text safely for HTML title insertion. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
