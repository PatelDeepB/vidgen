import type { SceneSpec, SfxCue, Storyboard } from "../director/storyboardSchema.js";
import type { SceneAudioClip, WordTiming } from "./ttsEngine.js";

/** Global word timing anchored to the full video timeline. */
export interface GlobalWordCaption {
  readonly sceneId: string;
  readonly word: string;
  readonly startSec: number;
  readonly endSec: number;
}

/** Audio-locked scene schedule entry. */
export interface ScheduledScene {
  readonly scene: SceneSpec;
  readonly index: number;
  readonly startSec: number;
  readonly endSec: number;
  readonly durationSec: number;
  readonly audioStartSec: number;
  readonly audioPath: string;
  readonly sfxCue: SfxCue;
  readonly sfxAtSec: number;
  readonly entryDirection: string;
}

/** Complete audio-locked timeline driving both the renderer and audio mixer. */
export interface AudioLockedTimeline {
  readonly storyboard: Storyboard;
  readonly totalDurationSec: number;
  readonly scenes: ReadonlyArray<ScheduledScene>;
  readonly captions: ReadonlyArray<GlobalWordCaption>;
}

const SCENE_HEAD_PADDING_SEC = 0.25;
const SCENE_TAIL_PADDING_SEC = 0.55;
const MIN_SCENE_SEC = 2.8;

/** Compute audio-locked scene timestamps and global caption timings from measured TTS clips. */
export function buildAudioLockedTimeline(
  storyboard: Storyboard,
  clips: ReadonlyArray<SceneAudioClip>,
): AudioLockedTimeline {
  const clipById = new Map(clips.map((clip) => [clip.sceneId, clip]));
  const scheduled: ScheduledScene[] = [];
  const captions: GlobalWordCaption[] = [];
  let cursorSec = 0;

  storyboard.scenes.forEach((scene, index) => {
    const clip = clipById.get(scene.id);
    if (!clip) {
      throw new Error(`Missing synthesized audio clip for scene "${scene.id}"`);
    }
    const rawDuration = clip.durationSec + SCENE_HEAD_PADDING_SEC + SCENE_TAIL_PADDING_SEC;
    const durationSec = Number(Math.max(MIN_SCENE_SEC, rawDuration).toFixed(3));
    const startSec = Number(cursorSec.toFixed(3));
    const endSec = Number((startSec + durationSec).toFixed(3));
    const audioStartSec = Number((startSec + SCENE_HEAD_PADDING_SEC).toFixed(3));
    const prevExit = index > 0 ? storyboard.scenes[index - 1]?.exitVector ?? "fade" : "fade";

    scheduled.push({
      scene,
      index,
      startSec,
      endSec,
      durationSec,
      audioStartSec,
      audioPath: clip.audioPath,
      sfxCue: scene.sfxCue,
      sfxAtSec: startSec,
      entryDirection: mapExitToEntryDirection(prevExit),
    });

    captions.push(...mapSceneWordsToGlobal(scene.id, audioStartSec, clip.wordTimings));
    cursorSec = endSec;
  });

  return {
    storyboard,
    totalDurationSec: Number(cursorSec.toFixed(3)),
    scenes: scheduled,
    captions,
  };
}

/** Align scene entry motion vector to the previous scene's exit vector for continuity. */
function mapExitToEntryDirection(prevExit: string): string {
  switch (prevExit) {
    case "left":
      return "from-right";
    case "right":
      return "from-left";
    case "up":
      return "from-bottom";
    case "zoom-in":
      return "zoom-in";
    default:
      return "fade";
  }
}

/** Convert scene-relative millisecond word timings into global video seconds. */
function mapSceneWordsToGlobal(
  sceneId: string,
  audioStartSec: number,
  wordTimings: ReadonlyArray<WordTiming>,
): GlobalWordCaption[] {
  return wordTimings.map((word) => {
    const startSec = Number((audioStartSec + word.startMs / 1000).toFixed(3));
    const endSec = Number((startSec + Math.max(0.08, word.durationMs / 1000)).toFixed(3));
    return { sceneId, word: word.word, startSec, endSec };
  });
}

/** Format grouped SRT subtitle file from global word captions (scoped per scene, <= 6 words). */
export function buildSrtCaptions(captions: ReadonlyArray<GlobalWordCaption>): string {
  if (captions.length === 0) {
    return "";
  }
  const chunks: GlobalWordCaption[][] = [];
  let activeGroup: GlobalWordCaption[] = [];

  for (const item of captions) {
    const prev = activeGroup[activeGroup.length - 1];
    const sceneChanged = prev !== undefined && prev.sceneId !== item.sceneId;
    if (sceneChanged || activeGroup.length >= 6) {
      if (activeGroup.length > 0) {
        chunks.push(activeGroup);
      }
      activeGroup = [item];
    } else {
      activeGroup.push(item);
    }
  }
  if (activeGroup.length > 0) {
    chunks.push(activeGroup);
  }

  return chunks
    .map((group, idx) => {
      const start = formatSrtTimestamp(group[0]?.startSec ?? 0);
      const end = formatSrtTimestamp(group[group.length - 1]?.endSec ?? 0.5);
      const text = group.map((item) => item.word).join(" ");
      return `${idx + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join("\n");
}

/** Format seconds into standard SRT timestamp HH:MM:SS,mmm. */
function formatSrtTimestamp(totalSec: number): string {
  const safeMs = Math.max(0, Math.round(totalSec * 1000));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const ms = safeMs % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${String(ms).padStart(3, "0")}`;
}

/** Zero-pad a two-digit integer. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
