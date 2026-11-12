#!/usr/bin/env node
import { Command } from "commander";

import { redactSecrets } from "../core/logger.js";
import { AspectRatioSchema } from "../director/storyboardSchema.js";
import {
  runDoctorCommand,
  runKeysAddBuiltInCommand,
  runKeysAddCustomCommand,
  runKeysListCommand,
  runKeysTestCommand,
  runPlanCommand,
} from "./commands.js";

/** Build and configure the root vidgen CLI program. */
function buildProgram(): Command {
  const program = new Command();
  program
    .name("vidgen")
    .description("Free-API multi-provider prompt-to-video pipeline")
    .version("0.1.0");

  program
    .command("doctor")
    .description("Verify FFmpeg, browser, and configured AI API pool")
    .action(async () => {
      await runDoctorCommand();
    });

  registerKeysCommands(program);
  registerPlanCommand(program);
  return program;
}

/** Register `vidgen keys` subcommands for managing built-in and custom APIs. */
function registerKeysCommands(program: Command): void {
  const keysCmd = program.command("keys").description("Manage built-in and custom AI API keys");

  keysCmd
    .command("list")
    .description("List configured built-in and custom API endpoints (masked)")
    .action(async () => {
      await runKeysListCommand();
    });

  keysCmd
    .command("add <providerId> <apiKey>")
    .description("Add an API key for a built-in provider (nvidia, gemini, groq, openrouter, etc.)")
    .action(async (providerId: string, apiKey: string) => {
      await runKeysAddBuiltInCommand(providerId, apiKey);
    });

  keysCmd
    .command("add-custom")
    .description("Add a custom OpenAI-compatible or Gemini-compatible API endpoint")
    .requiredOption("--id <id>", "Unique lowercase provider identifier")
    .requiredOption("--name <name>", "Human-readable provider name")
    .requiredOption("--base-url <url>", "API base URL (e.g., https://api.example.com/v1)")
    .requiredOption("--api-key <key>", "API key or token")
    .requiredOption("--model <modelId>", "Model identifier")
    .option("--dialect <dialect>", "openai-compatible or gemini", "openai-compatible")
    .option("--vision", "Mark model as supporting image inputs", false)
    .action(async (opts: Record<string, unknown>) => {
      await runKeysAddCustomCommand({
        id: String(opts.id),
        name: String(opts.name),
        baseUrl: String(opts.baseUrl),
        apiKey: String(opts.apiKey),
        model: String(opts.model),
        dialect: opts.dialect === "gemini" ? "gemini" : "openai-compatible",
        vision: Boolean(opts.vision),
      });
    });

  keysCmd
    .command("test")
    .description("Probe configured API keys with a live test request")
    .option("--provider <providerId>", "Filter to a specific provider")
    .action(async (opts: { provider?: string }) => {
      await runKeysTestCommand(opts.provider);
    });
}

/** Register `vidgen plan` command to generate a Storyboard JSON from a prompt. */
function registerPlanCommand(program: Command): void {
  program
    .command("plan <prompt>")
    .description("Generate a structured Storyboard JSON from a user prompt")
    .option("--aspect <ratio>", "Aspect ratio (16:9, 9:16, 1:1)", "16:9")
    .option("--provider <providerId>", "Preferred provider identifier (e.g., nvidia, gemini)")
    .option("--out-dir <path>", "Directory to write storyboard.json")
    .action(async (prompt: string, opts: { aspect: string; provider?: string; outDir?: string }) => {
      const aspectRatio = AspectRatioSchema.parse(opts.aspect);
      await runPlanCommand({
        prompt,
        aspectRatio,
        provider: opts.provider,
        outDir: opts.outDir,
      });
    });
}

buildProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${redactSecrets(message)}\n`);
    process.exitCode = 1;
  });
