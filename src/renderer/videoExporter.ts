import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

import type { AudioLockedTimeline } from "../audio/timelineSync.js";
import { ConfigurationError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { auditAndHealTimelineDom, type SceneDomAudit } from "../qa/domAuditor.js";
import { buildTimelineHtml, resolveViewportDimensions } from "./htmlBuilder.js";
import { buildVirtualClockInitScript } from "./virtualClock.js";

/** Options controlling deterministic video export. */
export interface ExportVideoOptions {
  readonly timeline: AudioLockedTimeline;
  readonly masterAudioPath: string;
  readonly htmlPath: string;
  readonly outMp4Path: string;
  readonly browserExecutablePath: string;
  readonly quality?: "draft" | "hq";
  readonly fps?: number;
  readonly logger?: Logger;
}

/** Media metadata verified via ffprobe after rendering. */
export interface RenderedMediaReport {
  readonly width: number;
  readonly height: number;
  readonly durationSec: number;
  readonly hasAudio: boolean;
  readonly frameCount: number;
  readonly domAudits: ReadonlyArray<SceneDomAudit>;
}

/** Render a timeline HTML document frame-by-frame via Playwright directly into FFmpeg. */
export async function exportTimelineToMp4(
  options: ExportVideoOptions,
): Promise<RenderedMediaReport> {
  const quality = options.quality ?? "draft";
  const fps = options.fps ?? (quality === "hq" ? 30 : 24);
  const dimensions = resolveViewportDimensions(options.timeline.storyboard.aspectRatio, quality);
  const totalFrames = Math.max(1, Math.ceil(options.timeline.totalDurationSec * fps));

  const html = buildTimelineHtml(options.timeline, dimensions);
  await writeFile(options.htmlPath, html, "utf-8");

  const browser = await chromium.launch({
    executablePath: options.browserExecutablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu-sandbox"],
  });

  let domAudits: SceneDomAudit[] = [];
  try {
    const context = await browser.newContext({ viewport: dimensions, deviceScaleFactor: 1 });
    await context.addInitScript(buildVirtualClockInitScript());
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("file://") || url.startsWith("data:") || url.startsWith("blob:")) {
        return route.continue();
      }
      return route.abort();
    });

    const page = await context.newPage();
    const fileUrl = pathToFileURL(resolve(options.htmlPath)).href;
    await page.goto(fileUrl, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    const auditResult = await auditAndHealTimelineDom({
      page,
      timeline: options.timeline,
      dimensions,
      htmlPath: options.htmlPath,
      logger: options.logger,
    });
    domAudits = auditResult.audits;

    await pipeFramesToFfmpeg({
      page,
      fps,
      totalFrames,
      masterAudioPath: options.masterAudioPath,
      outMp4Path: options.outMp4Path,
    });
  } finally {
    await browser.close();
  }

  return { ...probeRenderedMp4(options.outMp4Path), domAudits };
}

/** Step Virtual Clock frame-by-frame and pipe PNG buffers straight into FFmpeg stdin. */
async function pipeFramesToFfmpeg(params: {
  page: import("playwright-core").Page;
  fps: number;
  totalFrames: number;
  masterAudioPath: string;
  outMp4Path: string;
}): Promise<void> {
  const ffmpegArgs = [
    "-y",
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "-r",
    String(params.fps),
    "-i",
    "pipe:0",
    "-i",
    params.masterAudioPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    params.outMp4Path,
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] });
  let stderrOutput = "";
  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  const exitPromise = new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg export failed (exit ${code}): ${stderrOutput.slice(-600)}`));
      }
    });
  });

  for (let frame = 0; frame < params.totalFrames; frame += 1) {
    const ms = (frame / params.fps) * 1000;
    await params.page.evaluate((targetMs: number) => {
      const clock = (window as unknown as { __VIDGEN_CLOCK__?: { seekToMs: (m: number) => void } })
        .__VIDGEN_CLOCK__;
      clock?.seekToMs(targetMs);
    }, ms);
    const pngBuffer = await params.page.screenshot({ type: "png" });
    const canContinue = ffmpeg.stdin.write(pngBuffer);
    if (!canContinue) {
      await new Promise<void>((resolve) => ffmpeg.stdin.once("drain", resolve));
    }
  }

  ffmpeg.stdin.end();
  await exitPromise;
}

/** Extract evenly spaced keyframe PNGs from an exported MP4 for visual inspection. */
export async function extractKeyframesFromMp4(options: {
  mp4Path: string;
  outDir: string;
  timestampsSec: ReadonlyArray<number>;
}): Promise<string[]> {
  await mkdir(options.outDir, { recursive: true });
  const paths: string[] = [];

  options.timestampsSec.forEach((sec, index) => {
    const outPath = join(options.outDir, `keyframe-${index + 1}.png`);
    const res = spawnSync(
      "ffmpeg",
      ["-y", "-ss", String(sec), "-i", options.mp4Path, "-frames:v", "1", outPath],
      { encoding: "utf-8" },
    );
    if (res.status !== 0) {
      throw new ConfigurationError(`Failed to extract keyframe at ${sec}s`, {
        stderr: res.stderr,
      });
    }
    paths.push(outPath);
  });

  return paths;
}

/** Inspect rendered MP4 dimensions, duration, frame count, and audio stream via ffprobe. */
export function probeRenderedMp4(
  mp4Path: string,
): Omit<RenderedMediaReport, "domAudits"> {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", mp4Path],
    { encoding: "utf-8" },
  );
  if (probe.status !== 0) {
    throw new Error(`ffprobe failed on ${mp4Path}: ${probe.stderr}`);
  }
  const parsed = JSON.parse(probe.stdout) as {
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      nb_frames?: string;
    }>;
    format?: { duration?: string };
  };
  const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audioStream = parsed.streams?.find((stream) => stream.codec_type === "audio");

  return {
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    durationSec: Number(Number(parsed.format?.duration ?? 0).toFixed(2)),
    hasAudio: Boolean(audioStream),
    frameCount: Number(videoStream?.nb_frames ?? 0),
  };
}
