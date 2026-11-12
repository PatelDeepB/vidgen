import type { AudioLockedTimeline } from "../audio/timelineSync.js";
import type { ViewportDimensions } from "./htmlBuilder.js";

/** Generate responsive CSS locked to theme tokens, aspect ratio, and safe areas. */
export function buildTimelineStyles(
  timeline: AudioLockedTimeline,
  dim: ViewportDimensions,
): string {
  const { theme } = timeline.storyboard;
  const isVertical = dim.height > dim.width;
  const captionBottom = isVertical ? "8%" : "5.5%";
  const contentPadBottom = isVertical ? "17%" : "12%";

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
#bg-canvas { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; }
#broll-layer {
  position: absolute;
  inset: -4%;
  width: 108%;
  height: 108%;
  background-size: cover;
  background-position: center;
  opacity: 0;
  z-index: 1;
  filter: saturate(0.95) brightness(0.45);
}
#broll-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: radial-gradient(circle at 50% 45%, ${theme.backgroundHex}88, ${theme.backgroundHex}ee 80%);
}
#scene-host {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5.5% 7% ${contentPadBottom} 7%;
}
.scene-card {
  width: 100%;
  max-width: ${isVertical ? "96%" : "92%"};
  transform-origin: center center;
  will-change: transform, opacity;
}
.scene-centered {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: clamp(16px, 2.4vh, 28px);
}
.scene-split {
  display: grid;
  grid-template-columns: ${isVertical ? "1fr" : "1.08fr 0.92fr"};
  align-items: center;
  gap: clamp(20px, 3.2vw, 48px);
}
.copy-col {
  display: flex;
  flex-direction: column;
  gap: clamp(12px, 1.9vh, 22px);
}
.visual-col {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 14px;
}
.eyebrow {
  display: inline-flex;
  align-self: flex-start;
  padding: 7px 16px;
  border-radius: 999px;
  font-size: clamp(12px, 1.3vw, 18px);
  font-weight: 700;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: ${theme.primaryHex};
  background: ${theme.surfaceHex}ee;
  border: 1px solid ${theme.primaryHex}66;
}
.scene-centered .eyebrow { align-self: center; }
.headline {
  font-size: clamp(32px, ${isVertical ? "6.2vw" : "4.0vw"}, 76px);
  font-weight: 800;
  line-height: 1.07;
  letter-spacing: -0.025em;
}
.display-text {
  font-size: clamp(18px, ${isVertical ? "3.2vw" : "1.85vw"}, 30px);
  line-height: 1.42;
  opacity: 0.9;
  max-width: 52ch;
}
.metric-box {
  padding: 24px 28px;
  border-radius: 20px;
  background: linear-gradient(145deg, ${theme.surfaceHex}ee, #070b14ee);
  border: 1px solid ${theme.primaryHex}55;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
}
.metric-value {
  font-size: clamp(46px, ${isVertical ? "10vw" : "6.0vw"}, 104px);
  font-weight: 900;
  color: ${theme.primaryHex};
  line-height: 1.02;
}
.metric-label { font-size: clamp(15px, 1.5vw, 22px); opacity: 0.85; margin-top: 6px; }
.code-box {
  padding: 20px 24px;
  border-radius: 16px;
  background: #04070f;
  border: 1px solid ${theme.primaryHex}55;
  font-family: "Cascadia Code", "Consolas", monospace;
  font-size: clamp(14px, ${isVertical ? "2.4vw" : "1.35vw"}, 20px);
  line-height: 1.55;
  color: #e2e8f0;
  white-space: pre-wrap;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
}
.code-line { display: block; padding: 2px 8px; border-radius: 6px; }
.code-line.active { background: ${theme.primaryHex}26; color: ${theme.primaryHex}; }
.steps-grid { display: flex; flex-direction: column; gap: 12px; }
.step-pill {
  padding: 15px 20px;
  border-radius: 14px;
  background: ${theme.surfaceHex}ee;
  border-left: 4px solid ${theme.accentHex};
  font-size: clamp(15px, ${isVertical ? "2.8vw" : "1.55vw"}, 23px);
  font-weight: 600;
}
.svg-frame {
  padding: 16px;
  border-radius: 20px;
  background: ${theme.surfaceHex}bb;
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ai-svg-art { width: 100%; max-height: ${isVertical ? "26vh" : "44vh"}; height: auto; }
.cta-pill {
  margin-top: 8px;
  padding: 16px 34px;
  border-radius: 999px;
  background: linear-gradient(90deg, ${theme.primaryHex}, ${theme.accentHex});
  color: #04070f;
  font-size: clamp(18px, 1.9vw, 28px);
  font-weight: 800;
  box-shadow: 0 12px 36px ${theme.primaryHex}55;
}
#pointer-cursor {
  position: absolute;
  left: -120px;
  top: -120px;
  width: 46px;
  height: 46px;
  z-index: 15;
  pointer-events: none;
  opacity: 0;
  filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.55));
}
#caption-rail {
  position: absolute;
  left: 50%;
  bottom: ${captionBottom};
  transform: translateX(-50%);
  z-index: 12;
  max-width: 86%;
  padding: 10px 22px;
  border-radius: 14px;
  background: rgba(5, 8, 17, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.16);
  font-size: clamp(17px, ${isVertical ? "3.0vw" : "1.65vw"}, 28px);
  font-weight: 700;
  text-align: center;
  line-height: 1.35;
}
.word-active { color: ${theme.primaryHex}; text-shadow: 0 0 18px ${theme.primaryHex}88; }
#progress-track {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 5px;
  background: rgba(255, 255, 255, 0.12);
  z-index: 14;
}
#progress-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, ${theme.primaryHex}, ${theme.accentHex});
}
`.trim();
}
