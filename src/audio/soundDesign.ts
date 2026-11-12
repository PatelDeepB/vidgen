import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SfxCue } from "../director/storyboardSchema.js";
import type { AudioLockedTimeline } from "./timelineSync.js";

const SAMPLE_RATE = 44_100;

/** Synthesize crisp procedural SFX WAV assets and an ambient music bed locally. */
export async function generateProceduralAudioAssets(
  audioDir: string,
  totalDurationSec: number,
  musicMood: string,
): Promise<{ sfxPaths: Record<Exclude<SfxCue, "none">, string>; musicPath: string }> {
  await mkdir(audioDir, { recursive: true });
  const sfxDir = join(audioDir, "sfx");
  await mkdir(sfxDir, { recursive: true });

  const sfxCues: ReadonlyArray<Exclude<SfxCue, "none">> = ["whoosh", "pop", "click", "chime", "riser"];
  const sfxPaths = {} as Record<Exclude<SfxCue, "none">, string>;

  for (const cue of sfxCues) {
    const path = join(sfxDir, `${cue}.wav`);
    const samples = synthesizeSfxSamples(cue);
    await writeFile(path, encodeMonoWav16(samples, SAMPLE_RATE));
    sfxPaths[cue] = path;
  }

  const musicPath = join(audioDir, "music_bed.wav");
  const musicSamples = synthesizeAmbientBed(totalDurationSec, musicMood);
  await writeFile(musicPath, encodeMonoWav16(musicSamples, SAMPLE_RATE));
  return { sfxPaths, musicPath };
}

/** Mix voiceover, SFX cues, and ducked background bed into a -14 LUFS master WAV. */
export async function mixMasterAudio(options: {
  timeline: AudioLockedTimeline;
  audioDir: string;
  outWavPath: string;
}): Promise<string> {
  const { timeline, audioDir, outWavPath } = options;
  const { sfxPaths, musicPath } = await generateProceduralAudioAssets(
    audioDir,
    timeline.totalDurationSec,
    timeline.storyboard.musicMood,
  );

  const inputs: string[] = ["-i", musicPath];
  const voiceFilters: string[] = [];
  const sfxFilters: string[] = [];
  let inputIdx = 1;

  for (const scene of timeline.scenes) {
    inputs.push("-i", scene.audioPath);
    const delayMs = Math.round(scene.audioStartSec * 1000);
    voiceFilters.push(`[${inputIdx}:a]aresample=${SAMPLE_RATE},adelay=${delayMs}|${delayMs}[v${inputIdx}]`);
    inputIdx += 1;
  }

  for (const scene of timeline.scenes) {
    if (scene.sfxCue === "none") {
      continue;
    }
    inputs.push("-i", sfxPaths[scene.sfxCue]);
    const delayMs = Math.round(scene.sfxAtSec * 1000);
    sfxFilters.push(`[${inputIdx}:a]aresample=${SAMPLE_RATE},volume=0.35,adelay=${delayMs}|${delayMs}[s${inputIdx}]`);
    inputIdx += 1;
  }

  const filterComplex = buildMixFilterGraph({
    voiceFilters,
    sfxFilters,
    voiceCount: timeline.scenes.length,
    sfxCount: sfxFilters.length,
    totalDurationSec: timeline.totalDurationSec,
  });

  const args = [
    "-y",
    ...inputs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[master]",
    "-t",
    String(timeline.totalDurationSec),
    outWavPath,
  ];
  const proc = spawnSync("ffmpeg", args, { encoding: "utf-8" });
  if (proc.status !== 0) {
    throw new Error(`FFmpeg audio mix failed: ${proc.stderr}`);
  }
  return outWavPath;
}

/** Build FFmpeg filter_complex combining voice, sidechain-ducked music, SFX, and loudnorm. */
function buildMixFilterGraph(params: {
  voiceFilters: ReadonlyArray<string>;
  sfxFilters: ReadonlyArray<string>;
  voiceCount: number;
  sfxCount: number;
  totalDurationSec: number;
}): string {
  const parts: string[] = [...params.voiceFilters, ...params.sfxFilters];
  const voiceLabels = Array.from({ length: params.voiceCount }, (_unused, idx) => `[v${idx + 1}]`).join("");
  parts.push(`${voiceLabels}amix=inputs=${params.voiceCount}:normalize=0,asplit=2[voice_mix][voice_sc]`);

  const fadeOutStart = Math.max(0, params.totalDurationSec - 0.9).toFixed(2);
  parts.push(
    `[0:a]volume=0.22,afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOutStart}:d=0.8[music_pre]`,
  );
  parts.push(
    `[music_pre][voice_sc]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=350[music_ducked]`,
  );

  if (params.sfxCount > 0) {
    const startIdx = params.voiceCount + 1;
    const sfxLabels = Array.from({ length: params.sfxCount }, (_unused, idx) => `[s${startIdx + idx}]`).join("");
    parts.push(`${sfxLabels}amix=inputs=${params.sfxCount}:normalize=0[sfx_mix]`);
    parts.push(
      `[voice_mix][music_ducked][sfx_mix]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[master]`,
    );
  } else {
    parts.push(`[voice_mix][music_ducked]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[master]`);
  }
  return parts.join(";");
}

/** Generate mono float PCM samples in [-1, 1] for a given SFX cue. */
function synthesizeSfxSamples(cue: Exclude<SfxCue, "none">): Float32Array {
  const durationSec = cue === "riser" ? 0.55 : cue === "chime" ? 0.45 : 0.24;
  const count = Math.floor(SAMPLE_RATE * durationSec);
  const buffer = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const t = i / SAMPLE_RATE;
    const progress = i / count;
    const env = Math.sin(Math.PI * progress);
    if (cue === "pop") {
      const freq = 260 + 420 * Math.exp(-t * 28);
      buffer[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 22) * 0.65;
    } else if (cue === "click") {
      buffer[i] = Math.sin(2 * Math.PI * 1400 * t) * Math.exp(-t * 65) * 0.5;
    } else if (cue === "chime") {
      const chord = Math.sin(2 * Math.PI * 523.25 * t) + 0.6 * Math.sin(2 * Math.PI * 659.25 * t);
      buffer[i] = chord * Math.exp(-t * 6) * 0.35;
    } else if (cue === "riser") {
      const freq = 180 + 620 * progress * progress;
      buffer[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.45;
    } else {
      const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      buffer[i] = noise * env * 0.35;
    }
  }
  return buffer;
}

/** Synthesize a warm, non-intrusive chord progression bed matching the music mood. */
function synthesizeAmbientBed(totalDurationSec: number, musicMood: string): Float32Array {
  const totalSamples = Math.max(SAMPLE_RATE, Math.ceil(totalDurationSec * SAMPLE_RATE));
  const buffer = new Float32Array(totalSamples);
  const rootHz = musicMood === "upbeat" ? 261.63 : musicMood === "cinematic" ? 196.0 : 220.0;
  const chordRatios = [
    [1, 1.25, 1.5],
    [1.125, 1.333, 1.667],
    [0.889, 1.125, 1.333],
    [0.75, 1, 1.25],
  ];

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / SAMPLE_RATE;
    const barIdx = Math.floor(t / 2.5) % chordRatios.length;
    const ratios = chordRatios[barIdx] ?? [1, 1.25, 1.5];
    let sample = 0;
    for (const ratio of ratios) {
      sample += Math.sin(2 * Math.PI * rootHz * ratio * t);
    }
    const pulse = 0.75 + 0.25 * Math.sin(2 * Math.PI * 2 * t);
    buffer[i] = (sample / ratios.length) * pulse * 0.22;
  }
  return buffer;
}

/** Encode mono Float32 PCM samples into a standard 16-bit RIFF WAV Buffer. */
export function encodeMonoWav16(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return out;
}
