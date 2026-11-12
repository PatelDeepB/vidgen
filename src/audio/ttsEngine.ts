import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

import type { Logger } from "../core/logger.js";
import { escapeSsmlText, normalizeForSpeech } from "./pronunciation.js";

/** Single word timing relative to a scene's audio clip start. */
export interface WordTiming {
  readonly word: string;
  readonly startMs: number;
  readonly durationMs: number;
}

/** Result of synthesizing one scene's narration track. */
export interface SceneAudioClip {
  readonly sceneId: string;
  readonly audioPath: string;
  readonly durationSec: number;
  readonly wordTimings: ReadonlyArray<WordTiming>;
  readonly isFallbackSilence: boolean;
}

/** Synthesize narration audio for a single scene using Edge TTS with offline fallback. */
export async function synthesizeSceneNarration(options: {
  sceneId: string;
  spokenText: string;
  outDir: string;
  voiceName?: string;
  logger?: Logger;
}): Promise<SceneAudioClip> {
  const sceneDir = join(options.outDir, options.sceneId);
  await mkdir(sceneDir, { recursive: true });

  const normalized = normalizeForSpeech(options.spokenText);
  const voice = options.voiceName ?? "en-US-AndrewMultilingualNeural";

  try {
    return await runEdgeTts({
      sceneId: options.sceneId,
      normalizedText: normalized,
      sceneDir,
      voice,
    });
  } catch (err) {
    options.logger?.warn("Edge TTS failed, falling back to measured silent track", {
      sceneId: options.sceneId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return generateFallbackSilentClip({
      sceneId: options.sceneId,
      normalizedText: normalized,
      sceneDir,
    });
  }
}

/** Call Microsoft Edge TTS and extract audio + WordBoundary timing events. */
async function runEdgeTts(params: {
  sceneId: string;
  normalizedText: string;
  sceneDir: string;
  voice: string;
}): Promise<SceneAudioClip> {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 12_000, synthesisTimeoutMs: 30_000 });
  try {
    await tts.setMetadata(params.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
    });
    const safeInput = escapeSsmlText(params.normalizedText);
    const { audioFilePath, metadataFilePath } = await tts.toFile(params.sceneDir, safeInput);
    const durationSec = probeAudioDurationSec(audioFilePath);
    const parsedTimings = metadataFilePath ? await parseEdgeMetadataFile(metadataFilePath) : [];
    const wordTimings =
      parsedTimings.length > 0
        ? parsedTimings
        : estimateWordTimings(params.normalizedText, durationSec);

    return {
      sceneId: params.sceneId,
      audioPath: audioFilePath,
      durationSec,
      wordTimings,
      isFallbackSilence: false,
    };
  } finally {
    tts.close();
  }
}

/** Parse Edge TTS metadata.json (pretty-printed JSON or NDJSON; 100ns ticks -> ms). */
export async function parseEdgeMetadataFile(metadataPath: string): Promise<WordTiming[]> {
  const raw = (await readFile(metadataPath, "utf-8")).trim();
  if (!raw) {
    return [];
  }

  try {
    const whole = JSON.parse(raw) as unknown;
    return extractWordBoundariesFromPayload(whole);
  } catch {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const timings: WordTiming[] = [];
    for (const line of lines) {
      try {
        timings.push(...extractWordBoundariesFromPayload(JSON.parse(line) as unknown));
      } catch {
        // Skip malformed partial metadata chunks cleanly.
      }
    }
    return timings;
  }
}

/** Extract WordBoundary entries from a parsed Edge TTS metadata object. */
function extractWordBoundariesFromPayload(payload: unknown): WordTiming[] {
  if (typeof payload !== "object" || payload === null || !("Metadata" in payload)) {
    return [];
  }
  const entries = (payload as { Metadata?: unknown }).Metadata;
  if (!Array.isArray(entries)) {
    return [];
  }

  const timings: WordTiming[] = [];
  for (const rawEntry of entries) {
    const entry = rawEntry as {
      Type?: string;
      Data?: { Offset?: number; Duration?: number; text?: { Text?: string } };
    };
    if (entry.Type !== "WordBoundary" || !entry.Data?.text?.Text) {
      continue;
    }
    timings.push({
      word: entry.Data.text.Text,
      startMs: Math.round((entry.Data.Offset ?? 0) / 10_000),
      durationMs: Math.max(80, Math.round((entry.Data.Duration ?? 2_000_000) / 10_000)),
    });
  }
  return timings;
}

/** Generate a deterministic silent WAV clip when offline or when TTS is unavailable. */
function generateFallbackSilentClip(params: {
  sceneId: string;
  normalizedText: string;
  sceneDir: string;
}): SceneAudioClip {
  const words = params.normalizedText.split(/\s+/).filter(Boolean);
  const durationSec = Math.max(2.5, Number((words.length / 2.3).toFixed(2)));
  const wavPath = join(params.sceneDir, "audio.wav");
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(durationSec), wavPath],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`FFmpeg fallback audio generation failed: ${result.stderr}`);
  }
  return {
    sceneId: params.sceneId,
    audioPath: wavPath,
    durationSec,
    wordTimings: estimateWordTimings(params.normalizedText, durationSec),
    isFallbackSilence: true,
  };
}

/** Estimate evenly spaced word timings across a known audio duration. */
export function estimateWordTimings(text: string, durationSec: number): WordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const totalMs = Math.max(300, Math.round(durationSec * 1000));
  const sliceMs = Math.floor(totalMs / words.length);
  return words.map((word, index) => ({
    word,
    startMs: index * sliceMs,
    durationMs: Math.max(80, sliceMs - 20),
  }));
}

/** Measure exact duration of an audio file via ffprobe. */
export function probeAudioDurationSec(filePath: string): number {
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf-8" },
  );
  const parsed = Number(probe.stdout.trim());
  if (probe.status !== 0 || !Number.isFinite(parsed) || parsed <= 0) {
    return 3.5;
  }
  return Number(parsed.toFixed(3));
}
