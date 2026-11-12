/**
 * Strict security sanitizer for AI-authored inline SVG illustrations.
 * Prevents script execution, external network calls, and broken markup.
 */

const BLOCKED_TAGS_PATTERN = /<\/?(?:script|foreignObject|iframe|object|embed|audio|video|image)[^>]*>/gi;
const EVENT_ATTR_PATTERN = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const UNSAFE_URI_PATTERN = /(?:javascript|vbscript|data|https?):/gi;

/** Sanitize an AI-generated SVG string, returning undefined if not a valid <svg> root. */
export function sanitizeInlineSvg(rawSvg: string): string | undefined {
  const trimmed = rawSvg.trim();
  const svgMatch = trimmed.match(/<svg[\s\S]*?<\/svg>/i);
  if (!svgMatch?.[0]) {
    return undefined;
  }

  let safe = svgMatch[0];
  safe = safe.replace(BLOCKED_TAGS_PATTERN, "");
  safe = safe.replace(EVENT_ATTR_PATTERN, "");
  safe = safe.replace(UNSAFE_URI_PATTERN, "blocked:");

  if (!/viewBox\s*=/i.test(safe)) {
    safe = safe.replace(/<svg\b/i, '<svg viewBox="0 0 420 320"');
  }
  if (!/\bclass\s*=/i.test(safe.slice(0, safe.indexOf(">") + 1))) {
    safe = safe.replace(/<svg\b/i, '<svg class="ai-svg-art"');
  }
  return safe;
}
