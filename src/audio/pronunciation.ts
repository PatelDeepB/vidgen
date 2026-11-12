/**
 * Dual-text pronunciation normalizer converting visual notation into clean spoken phrases.
 */

const ACRONYM_MAP: Readonly<Record<string, string>> = {
  API: "A P I",
  APIs: "A P I s",
  SQL: "S Q L",
  CLI: "C L I",
  CPU: "C P U",
  GPU: "G P U",
  LLM: "L L M",
  LLMs: "L L M s",
  JSON: "jason",
  YAML: "yammel",
  HTTP: "H T T P",
  HTTPS: "H T T P S",
  URL: "U R L",
  UI: "U I",
  UX: "U X",
  DOM: "dom",
  CSS: "C S S",
  HTML: "H T M L",
  SVG: "S V G",
  FPS: "F P S",
  MP4: "M P 4",
  TTS: "T T S",
  SDK: "S D K",
  SaaS: "sass",
};

/** Normalize technical acronyms, versions, percentages, and currency for TTS clarity. */
export function normalizeForSpeech(displayText: string): string {
  let spoken = displayText.trim();
  spoken = spoken.replace(/\$([0-9]+(?:\.[0-9]+)?)\s*([BMKbmk])\b/g, expandCurrencyAbbrev);
  spoken = spoken.replace(/\$([0-9]+(?:\.[0-9]+)?)\b/g, "$1 dollars");
  spoken = spoken.replace(/\bv([0-9]+)\.([0-9]+)(?:\.([0-9]+))?\b/gi, expandSemver);
  spoken = spoken.replace(/([0-9]+(?:\.[0-9]+)?)%/g, "$1 percent");
  spoken = spoken.replace(/([0-9]+)x\b/gi, "$1 times");

  for (const [acronym, expansion] of Object.entries(ACRONYM_MAP)) {
    const pattern = new RegExp(`\\b${acronym}\\b`, "g");
    spoken = spoken.replace(pattern, expansion);
  }

  return spoken.replace(/\s+/g, " ").trim();
}

/** Escape XML special characters so Edge TTS SSML templates stay valid. */
export function escapeSsmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Expand currency abbreviations like $10M -> 10 million dollars. */
function expandCurrencyAbbrev(_match: string, amount: string, unit: string): string {
  const normalizedUnit = unit.toUpperCase();
  const scaleWord =
    normalizedUnit === "B" ? "billion" : normalizedUnit === "M" ? "million" : "thousand";
  return `${amount} ${scaleWord} dollars`;
}

/** Expand semantic versions like v2.4 -> version 2 point 4. */
function expandSemver(_match: string, major: string, minor: string, patch?: string): string {
  if (patch !== undefined) {
    return `version ${major} point ${minor} point ${patch}`;
  }
  return `version ${major} point ${minor}`;
}
