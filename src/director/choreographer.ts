import { z } from "zod";

import type { Logger } from "../core/logger.js";
import type { ProviderRouter } from "../providers/router.js";
import { parseAndValidateJson } from "../providers/sanitizer.js";
import {
  CursorTargetSchema,
  LayoutModeSchema,
  type SceneSpec,
  type Storyboard,
} from "./storyboardSchema.js";
import { buildCuratedFallbackSvg, sanitizeInlineSvg } from "./svgSanitizer.js";

const SceneEnrichmentSchema = z.object({
  id: z.string().min(1),
  layoutMode: LayoutModeSchema.optional(),
  cursorTarget: CursorTargetSchema.optional(),
  ctaLabel: z.string().max(36).optional(),
  customSvg: z.string().max(4500).optional(),
});

const ChoreographyOutputSchema = z.object({
  scenes: z.array(SceneEnrichmentSchema).min(1),
});

/** Build Pass 2 prompt instructing the Coder model to craft bespoke animated SVGs and motion cues. */
function buildChoreographerPrompt(storyboard: Storyboard): string {
  const compactScenes = storyboard.scenes.map((scene) => ({
    id: scene.id,
    archetype: scene.archetype,
    headline: scene.headline,
    customSvgHint: scene.customSvgHint ?? scene.brollQuery ?? scene.headline,
  }));

  return [
    "You are a Motion-Graphics Visual Choreographer.",
    "For each scene, design layoutMode, cursorTarget, and a clean custom inline SVG illustration.",
    "Return ONLY valid JSON: { \"scenes\": [ { \"id\": \"...\", \"layoutMode\": \"centered\"|\"split\", \"cursorTarget\": \"none\"|\"metric\"|\"code\"|\"step\"|\"cta\"|\"visual\", \"ctaLabel\": \"optional\", \"customSvg\": \"<svg viewBox='0 0 420 320' ...>...</svg>\" } ] }",
    "",
    "Rules:",
    "1. Use layoutMode \"centered\" for HeroTitle and OutroCTA; use \"split\" for SplitShowcase, MetricCounter, StepFlow, CodeWalkthrough, KineticStatement.",
    "2. Generate crisp vector <svg viewBox=\"0 0 420 320\" xmlns=\"http://www.w3.org/2000/svg\"> diagrams using ONLY <rect>, <circle>, <line>, <path>, <polygon>, <text>, <g>, <defs>, <linearGradient>, <stop>.",
    `3. Use theme colors: primary=${storyboard.theme.primaryHex}, accent=${storyboard.theme.accentHex}, surface=${storyboard.theme.surfaceHex}, text=${storyboard.theme.textHex}.`,
    "4. Add class=\"svg-draw\" on key connecting <path> or <line> elements and class=\"svg-pulse\" on focal circles/nodes so our engine animates them smoothly.",
    "5. NO <script>, NO event handlers, NO external URLs.",
    "",
    `Video Title: ${storyboard.title}`,
    `Scenes: ${JSON.stringify(compactScenes)}`,
  ].join("\n");
}

/** Pass 2 Director: enrich a validated Storyboard with bespoke SVG visuals and pointer choreography. */
export async function enrichStoryboardWithChoreography(options: {
  storyboard: Storyboard;
  router: ProviderRouter;
  preferredProviderId?: string;
  logger?: Logger;
}): Promise<Storyboard> {
  try {
    const response = await options.router.complete({
      role: "coder",
      minCodingTier: "medium",
      preferJsonMode: true,
      preferredProviderId: options.preferredProviderId,
      temperature: 0.45,
      maxTokens: 3800,
      messages: [
        { role: "system", content: "Return strictly valid JSON only." },
        { role: "user", content: buildChoreographerPrompt(options.storyboard) },
      ],
    });

    const parsed = parseAndValidateJson(response.cleanContent, ChoreographyOutputSchema);
    const byId = new Map(parsed.scenes.map((item) => [item.id, item]));

    const enrichedScenes: SceneSpec[] = options.storyboard.scenes.map((scene) => {
      const patch = byId.get(scene.id);
      if (!patch) {
        return scene;
      }
      const sanitized = patch.customSvg ? sanitizeInlineSvg(patch.customSvg, 3) : undefined;
      const cleanSvg =
        sanitized ??
        scene.customSvg ??
        buildCuratedFallbackSvg(options.storyboard.theme.primaryHex, options.storyboard.theme.accentHex);
      return {
        ...scene,
        layoutMode: patch.layoutMode ?? defaultLayoutForArchetype(scene.archetype),
        cursorTarget: patch.cursorTarget ?? scene.cursorTarget,
        ctaLabel: patch.ctaLabel ?? scene.ctaLabel,
        customSvg: cleanSvg,
      };
    });

    return { ...options.storyboard, scenes: enrichedScenes };
  } catch (err) {
    options.logger?.warn("Pass 2 choreography enrichment skipped due to error, keeping base storyboard", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return options.storyboard;
  }
}

/** Pick sensible default layoutMode when choreography is skipped. */
function defaultLayoutForArchetype(archetype: SceneSpec["archetype"]): "centered" | "split" {
  if (archetype === "HeroTitle" || archetype === "OutroCTA") {
    return "centered";
  }
  return "split";
}
