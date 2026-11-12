import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeInlineSvg } from "../src/director/svgSanitizer.js";

describe("svgSanitizer", () => {
  it("should strip script tags, event handlers, and unsafe URIs from AI SVGs", () => {
    const dirty =
      '<svg onclick="alert(1)"><script>evil()</script><a href="javascript:steal()"><circle cx="10" cy="10" r="8"/></a></svg>';
    const clean = sanitizeInlineSvg(dirty);
    assert.ok(clean);
    assert.doesNotMatch(clean, /<script/i);
    assert.doesNotMatch(clean, /onclick/i);
    assert.doesNotMatch(clean, /javascript:/i);
    assert.match(clean, /viewBox="0 0 420 320"/);
    assert.match(clean, /class="ai-svg-art"/);
  });

  it("should return undefined when input contains no svg root", () => {
    assert.equal(sanitizeInlineSvg("<div>Not an svg</div>"), undefined);
  });
});
