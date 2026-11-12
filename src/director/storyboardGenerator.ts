import type { Logger } from "../core/logger.js";
import type { ProviderRouter } from "../providers/router.js";
import { parseAndValidateJson } from "../providers/sanitizer.js";
import type { ChatMessage } from "../providers/types.js";
import { type AspectRatio, type Storyboard, StoryboardSchema } from "./storyboardSchema.js";

/** Options controlling AI storyboard generation. */
export interface GenerateStoryboardOptions {
  readonly prompt: string;
  readonly aspectRatio: AspectRatio;
  readonly style?: string;
  readonly targetDurationSec?: number;
  readonly preferredProviderId?: string;
  readonly router: ProviderRouter;
  readonly logger?: Logger;
}

/** Build the system instruction guiding the AI Director toward crisp, visual storytelling. */
function buildDirectorSystemPrompt(aspectRatio: AspectRatio, targetDurationSec: number): string {
  return [
    "You are an expert Motion-Graphics Video Director.",
    "Convert the user's prompt into a structured JSON storyboard.",
    "Return ONLY valid JSON matching the exact schema below, with no prose outside JSON.",
    "",
    "Rules for high-quality output:",
    "1. Scene 1 MUST be a pattern-interrupt HeroTitle hook that grabs attention in <= 3.5 seconds.",
    "2. Keep on-screen headlines punchy (<= 8 words) and displayText concise (<= 20 words).",
    "3. Keep spokenText natural and paced at ~2.2 words per second so narration never rushes.",
    "4. Do NOT invent ungrounded fake percentages or bogus studies; for MetricCounter, use authentic engineering specs (e.g., 60 FPS, 0ms Drift, 10+ APIs) or metrics explicitly provided by the user.",
    "5. For CodeWalkthrough, provide clean 3-6 line real syntax snippets (not pseudocode).",
    "6. Vary archetypes across consecutive scenes (HeroTitle, KineticStatement, MetricCounter, SplitShowcase, StepFlow, CodeWalkthrough, OutroCTA) and end with OutroCTA.",
    `7. Target aspectRatio: "${aspectRatio}" and total duration around ${targetDurationSec} seconds across 4-6 scenes.`,
    "",
    "Required JSON shape:",
    "{",
    '  "title": "string",',
    '  "hookLine": "string",',
    `  "aspectRatio": "${aspectRatio}",`,
    '  "musicMood": "ambient" | "upbeat" | "tech" | "cinematic",',
    '  "theme": { "backgroundHex": "#090d16", "surfaceHex": "#121a2b", "primaryHex": "#38bdf8", "accentHex": "#a855f7", "textHex": "#f8fafc" },',
    '  "scenes": [',
    "    {",
    '      "id": "scene-1",',
    '      "archetype": "HeroTitle",',
    '      "eyebrow": "SHORT TAG",',
    '      "headline": "Punchy Title",',
    '      "displayText": "Concise visual subtext",',
    '      "spokenText": "Natural voiceover sentence.",',
    '      "metricValue": "optional for MetricCounter e.g. 10x",',
    '      "metricLabel": "optional for MetricCounter",',
    '      "steps": ["optional for StepFlow"],',
    '      "codeSnippet": "optional for CodeWalkthrough",',
    '      "brollQuery": "2-3 word visual query",',
    '      "customSvgHint": "short visual motif hint",',
    '      "sfxCue": "whoosh" | "pop" | "click" | "chime" | "riser" | "none",',
    '      "exitVector": "left" | "right" | "up" | "zoom-in" | "fade",',
    '      "estimatedDurationSec": 4.5',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

/** Generate and validate a Storyboard JSON from a user prompt using the ProviderRouter. */
export async function generateStoryboard(
  options: GenerateStoryboardOptions,
): Promise<{ storyboard: Storyboard; providerId: string; modelId: string }> {
  const targetSec = options.targetDurationSec ?? 28;
  const styleLine = options.style ? `Style preset: ${options.style}.` : "";

  const messages: ChatMessage[] = [
    { role: "system", content: buildDirectorSystemPrompt(options.aspectRatio, targetSec) },
    { role: "user", content: `${styleLine}\nUser request: ${options.prompt}`.trim() },
  ];

  const firstAttempt = await options.router.complete({
    messages,
    role: "architect",
    preferJsonMode: true,
    preferredProviderId: options.preferredProviderId,
    temperature: 0.4,
    maxTokens: 3200,
  });

  try {
    const storyboard = parseAndValidateJson(firstAttempt.cleanContent, StoryboardSchema);
    return {
      storyboard,
      providerId: firstAttempt.providerId,
      modelId: firstAttempt.modelId,
    };
  } catch (validationErr) {
    options.logger?.warn("Initial storyboard failed validation, attempting structured repair", {
      providerId: firstAttempt.providerId,
      reason: validationErr instanceof Error ? validationErr.message : String(validationErr),
    });

    const repairResponse = await options.router.complete({
      messages: [
        ...messages,
        { role: "assistant", content: firstAttempt.cleanContent },
        {
          role: "user",
          content: `Fix this validation error and return ONLY valid JSON matching the schema: ${
            validationErr instanceof Error ? validationErr.message : String(validationErr)
          }`,
        },
      ],
      role: "repair",
      preferJsonMode: true,
      preferredProviderId: options.preferredProviderId,
      temperature: 0.1,
      maxTokens: 3200,
    });

    const repaired = parseAndValidateJson(repairResponse.cleanContent, StoryboardSchema);
    return {
      storyboard: repaired,
      providerId: repairResponse.providerId,
      modelId: repairResponse.modelId,
    };
  }
}
