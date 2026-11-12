import { z } from "zod";

export const AspectRatioSchema = z.enum(["16:9", "9:16", "1:1"]);
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

export const SceneArchetypeSchema = z.enum([
  "HeroTitle",
  "KineticStatement",
  "MetricCounter",
  "SplitShowcase",
  "StepFlow",
  "CodeWalkthrough",
  "OutroCTA",
]);
export type SceneArchetype = z.infer<typeof SceneArchetypeSchema>;

export const SfxCueSchema = z.enum(["whoosh", "pop", "click", "chime", "riser", "none"]);
export type SfxCue = z.infer<typeof SfxCueSchema>;

export const ExitVectorSchema = z.enum(["left", "right", "up", "zoom-in", "fade"]);
export type ExitVector = z.infer<typeof ExitVectorSchema>;

export const ThemeTokensSchema = z.object({
  backgroundHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#090d16"),
  surfaceHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#121a2b"),
  primaryHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#38bdf8"),
  accentHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#a855f7"),
  textHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#f8fafc"),
});
export type ThemeTokens = z.infer<typeof ThemeTokensSchema>;

export const LayoutModeSchema = z.enum(["centered", "split"]);
export type LayoutMode = z.infer<typeof LayoutModeSchema>;

export const CursorTargetSchema = z.enum(["none", "metric", "code", "step", "cta", "visual"]);
export type CursorTarget = z.infer<typeof CursorTargetSchema>;

export const SceneSpecSchema = z.object({
  id: z.string().min(1).max(40),
  archetype: SceneArchetypeSchema,
  layoutMode: LayoutModeSchema.optional(),
  eyebrow: z.string().max(40).optional(),
  headline: z.string().min(2).max(72),
  displayText: z.string().min(2).max(180),
  spokenText: z.string().min(4).max(360),
  metricValue: z.string().max(24).optional(),
  metricLabel: z.string().max(48).optional(),
  codeSnippet: z.string().max(320).optional(),
  steps: z.array(z.string().max(48)).max(4).optional(),
  ctaLabel: z.string().max(36).optional(),
  brollQuery: z.string().max(64).optional(),
  brollImageUrl: z.string().optional(),
  customSvgHint: z.string().max(180).optional(),
  customSvg: z.string().max(4500).optional(),
  cursorTarget: CursorTargetSchema.default("none"),
  sfxCue: SfxCueSchema.default("whoosh"),
  exitVector: ExitVectorSchema.default("left"),
  estimatedDurationSec: z.number().min(2).max(16).default(4.5),
});
export type SceneSpec = z.infer<typeof SceneSpecSchema>;

export const StoryboardSchema = z.object({
  title: z.string().min(3).max(96),
  hookLine: z.string().min(4).max(140),
  aspectRatio: AspectRatioSchema.default("16:9"),
  musicMood: z.enum(["ambient", "upbeat", "tech", "cinematic"]).default("tech"),
  theme: ThemeTokensSchema.default({}),
  scenes: z.array(SceneSpecSchema).min(3).max(10),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

/** Compute reading-rate words per second for a scene to guard against overly dense narration. */
export function calculateWordsPerSecond(scene: SceneSpec): number {
  const words = scene.spokenText.trim().split(/\s+/).filter(Boolean).length;
  return Number((words / scene.estimatedDurationSec).toFixed(2));
}
