import { jsonrepair } from "jsonrepair";
import type { z } from "zod";

import { ValidationError } from "../core/errors.js";

/** Strip `<think>...</think>` reasoning blocks emitted by Nemotron/DeepSeek models. */
export function stripThinkingBlocks(rawText: string): string {
  const withoutFullTags = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "");
  return withoutFullTags.replace(/<\/?think>/gi, "").trim();
}

/** Extract the outermost JSON object or array from prose or markdown code fences. */
export function extractJsonCandidate(cleanText: string): string {
  const fencedMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch?.[1] ? fencedMatch[1].trim() : cleanText.trim();

  const firstObjectIdx = candidate.indexOf("{");
  const firstArrayIdx = candidate.indexOf("[");
  const startIdx = pickEarliestPositiveIndex(firstObjectIdx, firstArrayIdx);
  if (startIdx === -1) {
    return candidate;
  }

  const isArray = candidate[startIdx] === "[";
  const lastIdx = candidate.lastIndexOf(isArray ? "]" : "}");
  if (lastIdx <= startIdx) {
    return candidate.slice(startIdx);
  }
  return candidate.slice(startIdx, lastIdx + 1);
}

/** Pick the earliest non-negative index between two candidate positions. */
function pickEarliestPositiveIndex(firstIdx: number, secondIdx: number): number {
  if (firstIdx === -1) {
    return secondIdx;
  }
  if (secondIdx === -1) {
    return firstIdx;
  }
  return Math.min(firstIdx, secondIdx);
}

/**
 * Clean reasoning tags, repair malformed JSON syntax, and validate via Zod.
 * Throws a ValidationError with field paths if validation still fails.
 */
export function parseAndValidateJson<T>(
  rawResponse: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T {
  const stripped = stripThinkingBlocks(rawResponse);
  const candidate = extractJsonCandidate(stripped);

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(candidate);
  } catch {
    try {
      const repaired = jsonrepair(candidate);
      parsedValue = JSON.parse(repaired);
    } catch (repairErr) {
      throw new ValidationError("Model returned unrepairable JSON", {
        snippet: candidate.slice(0, 240),
        reason: repairErr instanceof Error ? repairErr.message : String(repairErr),
      });
    }
  }

  const result = schema.safeParse(parsedValue);
  if (!result.success) {
    const issueText = result.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new ValidationError(`JSON failed schema validation: ${issueText}`, {
      issues: result.error.issues,
    });
  }

  return result.data;
}
