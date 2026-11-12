import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright-core";

import type { AudioLockedTimeline } from "../audio/timelineSync.js";
import type { Logger } from "../core/logger.js";
import { buildTimelineHtml, type ViewportDimensions } from "../renderer/htmlBuilder.js";

/** Result of inspecting a single scene for overflow or caption overlap. */
export interface SceneDomAudit {
  readonly sceneId: string;
  readonly hasOverflow: boolean;
  readonly overlapsCaption: boolean;
  readonly appliedScale: number;
}

const SCALE_STEPS = [1, 0.9, 0.82, 0.74] as const;

/**
 * Audit every scene in Playwright and deterministically downscale overflowing scenes
 * without spending any LLM tokens.
 */
export async function auditAndHealTimelineDom(options: {
  page: Page;
  timeline: AudioLockedTimeline;
  dimensions: ViewportDimensions;
  htmlPath: string;
  logger?: Logger;
}): Promise<{ scaleOverrides: Record<string, number>; audits: SceneDomAudit[] }> {
  const scaleOverrides: Record<string, number> = {};
  const audits: SceneDomAudit[] = [];

  for (const scheduled of options.timeline.scenes) {
    const sampleMs = Math.round((scheduled.startSec + scheduled.durationSec * 0.55) * 1000);
    let finalAudit: SceneDomAudit = {
      sceneId: scheduled.scene.id,
      hasOverflow: false,
      overlapsCaption: false,
      appliedScale: 1,
    };

    for (const candidateScale of SCALE_STEPS) {
      if (candidateScale < 1) {
        scaleOverrides[scheduled.scene.id] = candidateScale;
        const rebuilt = buildTimelineHtml(options.timeline, options.dimensions, scaleOverrides);
        await writeFile(options.htmlPath, rebuilt, "utf-8");
        await options.page.goto(pathToFileURL(resolve(options.htmlPath)).href, { waitUntil: "load" });
        await options.page.evaluate(() => document.fonts.ready);
      }

      const check = await measureSceneAtTimestamp(options.page, sampleMs, options.dimensions);
      finalAudit = {
        sceneId: scheduled.scene.id,
        hasOverflow: check.hasOverflow,
        overlapsCaption: check.overlapsCaption,
        appliedScale: candidateScale,
      };
      if (!check.hasOverflow && !check.overlapsCaption) {
        if (candidateScale < 1) {
          options.logger?.info("DOM overflow/caption collision healed deterministically", {
            sceneId: scheduled.scene.id,
            appliedScale: candidateScale,
          });
        }
        break;
      }
    }

    audits.push(finalAudit);
  }

  return { scaleOverrides, audits };
}

/** Measure DOM bounding boxes at a given virtual timestamp inside the browser page. */
async function measureSceneAtTimestamp(
  page: Page,
  sampleMs: number,
  dimensions: ViewportDimensions,
): Promise<{ hasOverflow: boolean; overlapsCaption: boolean }> {
  return page.evaluate(
    ({ targetMs, vpWidth, vpHeight }) => {
      const clock = (window as unknown as { __VIDGEN_CLOCK__?: { seekToMs: (m: number) => void } })
        .__VIDGEN_CLOCK__;
      clock?.seekToMs(targetMs);

      const card = document.querySelector(".scene-card");
      const caption = document.getElementById("caption-rail");
      if (!card) {
        return { hasOverflow: false, overlapsCaption: false };
      }

      const cardRect = card.getBoundingClientRect();
      const clipsViewport =
        cardRect.left < -2 ||
        cardRect.top < -2 ||
        cardRect.right > vpWidth + 2 ||
        cardRect.bottom > vpHeight + 2;
      const scrollClips =
        card.scrollHeight > card.clientHeight + 6 || card.scrollWidth > card.clientWidth + 6;

      let overlapsCaption = false;
      if (caption && getComputedStyle(caption).display !== "none") {
        const capRect = caption.getBoundingClientRect();
        overlapsCaption = cardRect.bottom > capRect.top - 8;
      }
      return { hasOverflow: clipsViewport || scrollClips, overlapsCaption };
    },
    { targetMs: sampleMs, vpWidth: dimensions.width, vpHeight: dimensions.height },
  );
}
