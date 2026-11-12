import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { ConfigurationError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import type { Storyboard } from "../director/storyboardSchema.js";
import type { ProviderRouter } from "../providers/router.js";
import { parseAndValidateJson } from "../providers/sanitizer.js";

export const WeakSceneFeedbackSchema = z.object({
  sceneId: z.string().min(1),
  issue: z.string().min(2),
  suggestion: z.string().min(2),
});

export const VisionCritiqueSchema = z.object({
  overallScore: z.number().min(1).max(10),
  contrastOk: z.boolean(),
  readabilityOk: z.boolean(),
  visualVarietyOk: z.boolean(),
  summary: z.string().min(2),
  weakScenes: z.array(WeakSceneFeedbackSchema).default([]),
});

export type VisionCritique = z.infer<typeof VisionCritiqueSchema>;

/** Stitch keyframe PNGs into a single compact 3-column contact sheet via FFmpeg. */
export function buildKeyframeContactSheet(options: {
  keyframePaths: ReadonlyArray<string>;
  outContactSheetPath: string;
}): string {
  const count = Math.min(9, options.keyframePaths.length);
  if (count === 0) {
    throw new ConfigurationError("Cannot build contact sheet from zero keyframes");
  }

  const cols = Math.min(3, count);
  const rows = Math.ceil(count / cols);
  const inputs: string[] = [];
  for (let i = 0; i < count; i += 1) {
    inputs.push("-i", options.keyframePaths[i]!);
  }

  const concatInputs = Array.from({ length: count }, (_unused, idx) => `[${idx}:v]scale=480:-1[s${idx}]`).join(";");
  const stackLabels = Array.from({ length: count }, (_unused, idx) => `[s${idx}]`).join("");
  const filter = `${concatInputs};${stackLabels}concat=n=${count}:v=1:a=0,tile=${cols}x${rows}:padding=8:color=#090d16[sheet]`;

  const res = spawnSync(
    "ffmpeg",
    ["-y", ...inputs, "-filter_complex", filter, "-map", "[sheet]", "-frames:v", "1", options.outContactSheetPath],
    { encoding: "utf-8" },
  );
  if (res.status !== 0) {
    throw new Error(`Failed to generate keyframe contact sheet: ${res.stderr}`);
  }
  return options.outContactSheetPath;
}

/** Run a single Vision-LLM critique call over the rendered keyframe contact sheet. */
export async function critiqueRenderedContactSheet(options: {
  contactSheetPath: string;
  storyboard: Storyboard;
  router: ProviderRouter;
  preferredProviderId?: string;
  logger?: Logger;
}): Promise<VisionCritique | undefined> {
  const pngBytes = await readFile(options.contactSheetPath);
  const imageBase64Png = pngBytes.toString("base64");
  const sceneSummary = options.storyboard.scenes
    .map((scene, idx) => `Frame ${idx + 1}: id="${scene.id}" (${scene.archetype}) headline="${scene.headline}"`)
    .join("\n");

  const prompt = [
    "Inspect this 3-column contact sheet of rendered video keyframes.",
    "Score contrast, readability, layout balance, and visual richness from 1 to 10.",
    "Return ONLY valid JSON:",
    '{ "overallScore": 8, "contrastOk": true, "readabilityOk": true, "visualVarietyOk": true, "summary": "concise verdict", "weakScenes": [{ "sceneId": "scene-2", "issue": "...", "suggestion": "..." }] }',
    "",
    "Scene mapping:",
    sceneSummary,
  ].join("\n");

  try {
    const response = await options.router.complete({
      role: "vision",
      requireVision: true,
      preferJsonMode: true,
      preferredProviderId: options.preferredProviderId,
      temperature: 0.2,
      maxTokens: 1500,
      disableThinking: true,
      messages: [
        { role: "system", content: "You are a strict Motion-Graphics Art Director. Output JSON only." },
        { role: "user", content: prompt, imageBase64Png },
      ],
    });
    return parseAndValidateJson(response.cleanContent, VisionCritiqueSchema);
  } catch (err) {
    if (err instanceof ConfigurationError) {
      options.logger?.info("Skipping Vision Critic (no vision-capable key configured)");
      return undefined;
    }
    options.logger?.warn("Vision Critic skipped due to provider error", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
