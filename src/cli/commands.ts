import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Logger, writeCliOutput } from "../core/logger.js";
import { generateStoryboard } from "../director/storyboardGenerator.js";
import { type AspectRatio, calculateWordsPerSecond } from "../director/storyboardSchema.js";
import { runCreateVideoPipeline } from "../pipeline/createVideoPipeline.js";
import { BUILT_IN_PROVIDERS } from "../providers/catalog.js";
import { executeCandidateCompletion } from "../providers/clients.js";
import {
  addBuiltInApiKey,
  buildRoutedCandidates,
  getDefaultKeyStorePath,
  loadKeyStore,
  maskApiKey,
  resolveKeysByProvider,
  upsertCustomProvider,
} from "../providers/keyStore.js";
import { ProviderRouter } from "../providers/router.js";
import type { CodingTier, TaskRole } from "../providers/types.js";
import { startPreviewStudioServer } from "../studio/previewServer.js";

/** Print configured built-in keys and custom providers with masked secrets. */
export async function runKeysListCommand(): Promise<void> {
  const store = await loadKeyStore();
  const resolved = resolveKeysByProvider(store);

  writeCliOutput(`Key store: ${getDefaultKeyStorePath()}`);
  writeCliOutput("\nBuilt-in Free Providers:");
  for (const spec of BUILT_IN_PROVIDERS) {
    const keys = resolved.get(spec.providerId) ?? [];
    const status = keys.length > 0 ? keys.map(maskApiKey).join(", ") : "(not configured)";
    writeCliOutput(`  - ${spec.providerId.padEnd(12)} [${spec.envVarName}] -> ${status}`);
  }

  writeCliOutput("\nCustom Providers:");
  if (store.customProviders.length === 0) {
    writeCliOutput("  (none configured)");
    return;
  }
  for (const custom of store.customProviders) {
    writeCliOutput(
      `  - ${custom.id} (${custom.displayName}) -> ${custom.baseUrl} | model=${custom.modelId} | key=${maskApiKey(custom.apiKey)}`,
    );
  }
}

/** Add a built-in provider key to the user's persistent key store. */
export async function runKeysAddBuiltInCommand(providerId: string, apiKey: string): Promise<void> {
  await addBuiltInApiKey({ providerId, apiKey });
  writeCliOutput(`Saved key (${maskApiKey(apiKey)}) for provider "${providerId}".`);
}

/** Register a custom OpenAI-compatible or Gemini-compatible provider endpoint. */
export async function runKeysAddCustomCommand(options: {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  dialect: "openai-compatible" | "gemini";
  vision?: boolean;
  codingTier?: CodingTier;
}): Promise<void> {
  await upsertCustomProvider({
    provider: {
      id: options.id,
      displayName: options.name,
      dialect: options.dialect,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      modelId: options.model,
      roles: options.vision
        ? (["architect", "coder", "vision", "repair"] as TaskRole[])
        : (["architect", "coder", "repair"] as TaskRole[]),
      supportsVision: Boolean(options.vision),
      supportsJsonMode: true,
      codingTier: options.codingTier ?? "high",
      priority: 25,
    },
  });
  writeCliOutput(`Saved custom provider "${options.id}" (${options.model} at ${options.baseUrl}).`);
}

/** Probe every configured candidate with a tiny test prompt and report status/latency. */
export async function runKeysTestCommand(filterProvider?: string): Promise<void> {
  const store = await loadKeyStore();
  const allCandidates = buildRoutedCandidates(store);
  const candidates = filterProvider
    ? allCandidates.filter((item) => item.model.providerId === filterProvider)
    : allCandidates;

  if (candidates.length === 0) {
    writeCliOutput("No configured API candidates matched. Add a key or export an env var first.");
    return;
  }

  for (const candidate of candidates) {
    try {
      const result = await executeCandidateCompletion({
        candidate,
        request: {
          role: "repair",
          messages: [{ role: "user", content: 'Reply with JSON: {"ok":true}' }],
          maxTokens: 128,
          temperature: 0,
          disableThinking: true,
        },
        timeoutMs: 25_000,
      });
      writeCliOutput(
        `  PASS  ${candidate.candidateKey} (${result.latencyMs}ms) -> ${result.cleanContent.slice(0, 60)}`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      writeCliOutput(`  FAIL  ${candidate.candidateKey} -> ${reason}`);
    }
  }
}

/** Check local system dependencies (Node, FFmpeg, Chrome/Edge, API pool). */
export async function runDoctorCommand(): Promise<void> {
  const ffmpegResult = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8" });
  const hasFfmpeg = ffmpegResult.status === 0;
  const browserPath = detectLocalBrowserPath();

  const store = await loadKeyStore();
  const candidates = buildRoutedCandidates(store);
  const uniqueProviders = new Set(candidates.map((item) => item.model.providerId));

  writeCliOutput("vidgen Doctor Check:");
  writeCliOutput(`  Node.js   : ${process.version}`);
  writeCliOutput(`  FFmpeg    : ${hasFfmpeg ? "OK" : "MISSING (install ffmpeg in PATH)"}`);
  writeCliOutput(`  Browser   : ${browserPath ?? "NOT FOUND (Chrome/Edge needed for Phase 2+)"}`);
  writeCliOutput(`  API Pool  : ${candidates.length} candidate(s) across ${uniqueProviders.size} provider(s)`);
}

/** Generate a validated Storyboard JSON for a prompt using the API pool. */
export async function runPlanCommand(options: {
  prompt: string;
  aspectRatio: AspectRatio;
  provider?: string;
  outDir?: string;
}): Promise<void> {
  const logger = new Logger();
  const store = await loadKeyStore();
  const candidates = buildRoutedCandidates(store);
  const router = new ProviderRouter({ candidates, logger });

  const { storyboard, providerId, modelId } = await generateStoryboard({
    prompt: options.prompt,
    aspectRatio: options.aspectRatio,
    preferredProviderId: options.provider,
    router,
    logger,
  });

  const targetDir = options.outDir ?? join(process.cwd(), "jobs", `plan-${Date.now()}`);
  await mkdir(targetDir, { recursive: true });
  const outPath = join(targetDir, "storyboard.json");
  await writeFile(outPath, `${JSON.stringify(storyboard, null, 2)}\n`, "utf-8");

  writeCliOutput(`Generated storyboard "${storyboard.title}" via ${providerId}/${modelId}`);
  writeCliOutput(`Hook: ${storyboard.hookLine}`);
  for (const scene of storyboard.scenes) {
    const wps = calculateWordsPerSecond(scene);
    writeCliOutput(
      `  - ${scene.id} [${scene.archetype}] ${scene.estimatedDurationSec}s (${wps} wps) | ${scene.headline}`,
    );
  }
  writeCliOutput(`Saved to ${outPath}`);
}

/** Generate a complete MP4 video from a user prompt. */
export async function runCreateCommand(options: {
  prompt: string;
  aspectRatio: AspectRatio;
  quality: "draft" | "hq";
  style?: string;
  provider?: string;
  voice?: string;
  enableBroll?: boolean;
  enableVisionQa?: boolean;
  outDir?: string;
}): Promise<void> {
  const logger = new Logger();
  const result = await runCreateVideoPipeline({
    prompt: options.prompt,
    aspectRatio: options.aspectRatio,
    quality: options.quality,
    style: options.style,
    preferredProviderId: options.provider,
    voiceName: options.voice,
    enableBroll: options.enableBroll,
    enableVisionQa: options.enableVisionQa,
    jobDir: options.outDir,
    logger,
  });

  writeCliOutput(`Rendered MP4 via ${result.providerId}/${result.modelId}`);
  writeCliOutput(
    `  Video   : ${result.report.width}x${result.report.height} | ${result.report.durationSec}s | frames=${result.report.frameCount} | audio=${result.report.hasAudio}`,
  );
  writeCliOutput(`  MP4     : ${result.mp4Path}`);
  writeCliOutput(`  Captions: ${result.srtPath}`);
  writeCliOutput(`  Sheet   : ${result.contactSheetPath}`);
  if (result.visionCritique) {
    writeCliOutput(
      `  VisionQA: ${result.visionCritique.overallScore}/10 (${result.visionCritique.summary})`,
    );
  }
}

/** Launch the local Preview Studio web server for an existing job directory. */
export async function runPreviewCommand(jobDir: string, port?: number): Promise<void> {
  const { url } = await startPreviewStudioServer({ jobDir, port });
  writeCliOutput(`vidgen Studio running at ${url} (press Ctrl+C to stop)`);
}

/** Locate installed Chrome or Edge executable on Windows/macOS/Linux. */
export function detectLocalBrowserPath(): string | undefined {
  const candidates = [
    process.env.VIDGEN_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
