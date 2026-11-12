/**
 * Strict security sanitizer for AI-authored inline SVG illustrations.
 * Prevents script execution, external network calls, and sparse broken graphics.
 */

const BLOCKED_TAGS_PATTERN = /<\/?(?:script|foreignObject|iframe|object|embed|audio|video|image)[^>]*>/gi;
const EVENT_ATTR_PATTERN = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const UNSAFE_URI_PATTERN = /(?:javascript|vbscript|data|https?):/gi;
const SHAPE_TAG_PATTERN = /<(?:rect|circle|ellipse|line|polyline|polygon|path)\b/gi;

/** Sanitize an AI-generated SVG string, returning undefined if invalid or overly sparse. */
export function sanitizeInlineSvg(rawSvg: string, minPrimitives = 1): string | undefined {
  const trimmed = rawSvg.trim();
  const svgMatch = trimmed.match(/<svg[\s\S]*?<\/svg>/i);
  if (!svgMatch?.[0]) {
    return undefined;
  }

  let safe = svgMatch[0];
  safe = safe.replace(BLOCKED_TAGS_PATTERN, "");
  safe = safe.replace(EVENT_ATTR_PATTERN, "");
  safe = safe.replace(UNSAFE_URI_PATTERN, "blocked:");

  const primitives = safe.match(SHAPE_TAG_PATTERN) ?? [];
  if (primitives.length < minPrimitives) {
    return undefined;
  }

  if (!/viewBox\s*=/i.test(safe)) {
    safe = safe.replace(/<svg\b/i, '<svg viewBox="0 0 420 320"');
  }
  if (!/\bclass\s*=/i.test(safe.slice(0, safe.indexOf(">") + 1))) {
    safe = safe.replace(/<svg\b/i, '<svg class="ai-svg-art"');
  }
  return safe;
}

/** Generate a rich multi-node vector diagram fallback using theme colors. */
export function buildCuratedFallbackSvg(primaryHex: string, accentHex: string): string {
  return [
    '<svg class="ai-svg-art" viewBox="0 0 420 320" xmlns="http://www.w3.org/2000/svg">',
    '  <rect x="28" y="34" width="364" height="252" rx="18" fill="#0b1220" stroke="' + primaryHex + '44" stroke-width="1.5"/>',
    '  <path class="svg-draw" d="M 80 160 C 145 75, 275 245, 340 160" fill="none" stroke="' + primaryHex + '" stroke-width="4" stroke-linecap="round"/>',
    '  <path class="svg-draw" d="M 80 160 C 155 230, 265 90, 340 160" fill="none" stroke="' + accentHex + '" stroke-width="3" stroke-linecap="round" opacity="0.8"/>',
    '  <circle class="svg-pulse" cx="80" cy="160" r="14" fill="' + primaryHex + '"/>',
    '  <circle class="svg-pulse" cx="210" cy="160" r="18" fill="' + accentHex + '"/>',
    '  <circle class="svg-pulse" cx="340" cy="160" r="14" fill="' + primaryHex + '"/>',
    "</svg>",
  ].join("\n");
}
