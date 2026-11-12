import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { mixMasterAudio } from "../audio/soundDesign.js";
import { buildAudioLockedTimeline, buildSrtCaptions } from "../audio/timelineSync.js";
import { type SceneAudioClip, synthesizeSceneNarration } from "../audio/ttsEngine.js";
import { detectLocalBrowserPath } from "../cli/commands.js";
import { ConfigurationError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { enrichStoryboardWithChoreography } from "../director/choreographer.js";
import { generateStoryboard } from "../director/storyboardGenerator.js";
import { type AspectRatio, type Storyboard, StoryboardSchema } from "../director/storyboardSchema.js";
import { enrichStoryboardWithBroll } from "../media/brollFetcher.js";
import { buildRoutedCandidates, loadKeyStore } from "../providers/keyStore.js";
import { ProviderRouter } from "../providers/router.js";
import {
  buildKeyframeContactSheet,
  critiqueRenderedContactSheet,
  type VisionCritique,
} from "../qa/visionCritic.js";
import {
  exportTimelineToMp4,
  extractKeyframesFromMp4,
  type RenderedMediaReport,
} from "../renderer/videoExporter.js";

/** Options controlling end-to-end video generation. */
export interface CreateVideoOptions {
  readonly prompt: string;
  readonly aspectRatio: AspectRatio;
  readonly quality: "draft" | "hq";
  readonly style?: string;
  readonly preferredProviderId?: string;
  readonly voiceName?: string;
  readonly enableBroll?: boolean;
  readonly enableVisionQa?: boolean;
  readonly jobDir?: string;
  readonly logger?: Logger;
}

/** Final output summary returned after completing all pipeline stages. */
export interface CreateVideoResult {
  readonly jobDir: string;
  readonly storyboardPath: string;
  readonly mp4Path: string;
  readonly srtPath: string;
  readonly keyframePaths: ReadonlyArray<string>;
  readonly contactSheetPath: string;
  readonly visionCritique?: VisionCritique;
  readonly report: RenderedMediaReport;
  readonly providerId: string;
  readonly modelId: string;
}

/** Run the resumable prompt -> storyboard -> B-roll -> audio-lock -> MP4 -> Vision QA pipeline. */
export async function runCreateVideoPipeline(
  options: CreateVideoOptions,
): Promise<CreateVideoResult> {
  const browserPath = detectLocalBrowserPath();
  if (!browserPath) {
    throw new ConfigurationError(
      "Chrome or Edge executable not found. Set VIDGEN_BROWSER_PATH or install Chrome/Edge.",
    );
  }

  const jobDir = resolve(options.jobDir ?? join(process.cwd(), "jobs", `job-${Date.now()}`));
  await mkdir(jobDir, { recursive: true });

  const store = await loadKeyStore();
  const candidates = buildRoutedCandidates(store);
  const router = new ProviderRouter({ candidates, logger: options.logger });

  let { storyboard, providerId, modelId } = await loadOrCreateStoryboard(jobDir, router, options);
  const storyboardPath = join(jobDir, "01_storyboard.json");

  if (options.enableBroll !== false) {
    storyboard = await enrichStoryboardWithBroll({
      storyboard,
      mediaDir: join(jobDir, "media"),
      logger: options.logger,
    });
    await writeFile(storyboardPath, `${JSON.stringify(storyboard, null, 2)}\n`, "utf-8");
  }

  const audioDir = join(jobDir, "02_audio");
  const clips: SceneAudioClip[] = [];
  for (const scene of storyboard.scenes) {
    const clip = await synthesizeSceneNarration({
      sceneId: scene.id,
      spokenText: scene.spokenText,
      outDir: audioDir,
      voiceName: options.voiceName,
      logger: options.logger,
    });
    clips.push(clip);
  }

  const timeline = buildAudioLockedTimeline(storyboard, clips);
  await writeFile(join(jobDir, "03_timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`, "utf-8");

  const srtPath = join(jobDir, "captions.srt");
  await writeFile(srtPath, buildSrtCaptions(timeline.captions), "utf-8");

  const masterWavPath = join(audioDir, "master.wav");
  await mixMasterAudio({ timeline, audioDir, outWavPath: masterWavPath });

  const htmlPath = join(jobDir, "timeline.html");
  const outMp4Path = join(jobDir, "final.mp4");
  const report = await exportTimelineToMp4({
    timeline,
    masterAudioPath: masterWavPath,
    htmlPath,
    outMp4Path,
    browserExecutablePath: browserPath,
    quality: options.quality,
    logger: options.logger,
  });

  const samplePoints = timeline.scenes.map((scene) =>
    Number((scene.startSec + scene.durationSec * 0.5).toFixed(2)),
  );
  const keyframePaths = await extractKeyframesFromMp4({
    mp4Path: outMp4Path,
    outDir: join(jobDir, "keyframes"),
    timestampsSec: samplePoints,
  });

  const contactSheetPath = buildKeyframeContactSheet({
    keyframePaths,
    outContactSheetPath: join(jobDir, "contact_sheet.png"),
  });

  let visionCritique: VisionCritique | undefined;
  if (options.enableVisionQa !== false) {
    visionCritique = await critiqueRenderedContactSheet({
      contactSheetPath,
      storyboard,
      router,
      preferredProviderId: options.preferredProviderId,
      logger: options.logger,
    });
    if (visionCritique) {
      await writeFile(
        join(jobDir, "04_vision_critique.json"),
        `${JSON.stringify(visionCritique, null, 2)}\n`,
        "utf-8",
      );
    }
  }

  return {
    jobDir,
    storyboardPath,
    mp4Path: outMp4Path,
    srtPath,
    keyframePaths,
    contactSheetPath,
    visionCritique,
    report,
    providerId,
    modelId,
  };
}

/** Reuse cached storyboard checkpoint when resuming a job, otherwise invoke 2-Pass AI Director. */
async function loadOrCreateStoryboard(
  jobDir: string,
  router: ProviderRouter,
  options: CreateVideoOptions,
): Promise<{ storyboard: Storyboard; providerId: string; modelId: string }> {
  const storyboardPath = join(jobDir, "01_storyboard.json");
  if (existsSync(storyboardPath)) {
    const raw = await readFile(storyboardPath, "utf-8");
    const parsed = StoryboardSchema.parse(JSON.parse(raw));
    return { storyboard: parsed, providerId: "cached", modelId: "cached" };
  }

  const generated = await generateStoryboard({
    prompt: options.prompt,
    aspectRatio: options.aspectRatio,
    style: options.style,
    preferredProviderId: options.preferredProviderId,
    router,
    logger: options.logger,
  });
  const choreographed = await enrichStoryboardWithChoreography({
    storyboard: generated.storyboard,
    router,
    preferredProviderId: options.preferredProviderId,
    logger: options.logger,
  });
  await writeFile(storyboardPath, `${JSON.stringify(choreographed, null, 2)}\n`, "utf-8");
  return { ...generated, storyboard: choreographed };
}
