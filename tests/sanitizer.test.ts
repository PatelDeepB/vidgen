import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import { ValidationError } from "../src/core/errors.js";
import { parseAndValidateJson, stripThinkingBlocks } from "../src/providers/sanitizer.js";

describe("sanitizer", () => {
  it("should strip Nemotron and DeepSeek think blocks cleanly", () => {
    const raw = `<think>Internal reasoning about scenes\nmore thought</think>\n{"title":"Demo"}`;
    assert.equal(stripThinkingBlocks(raw), '{"title":"Demo"}');
  });

  it("should repair trailing commas and markdown code fences", () => {
    const schema = z.object({ ok: z.boolean(), count: z.number() });
    const raw = `<think>checking</think>\n\`\`\`json\n{\n  "ok": true,\n  "count": 3,\n}\n\`\`\``;
    const parsed = parseAndValidateJson(raw, schema);
    assert.deepEqual(parsed, { ok: true, count: 3 });
  });

  it("should strip null optional properties emitted by LLMs before Zod validation", () => {
    const schema = z.object({ title: z.string(), subtitle: z.string().optional() });
    const parsed = parseAndValidateJson('{"title":"Async TS","subtitle":null}', schema);
    assert.deepEqual(parsed, { title: "Async TS" });
  });

  it("should throw ValidationError when schema mismatches", () => {
    const schema = z.object({ ok: z.boolean() });
    assert.throws(() => parseAndValidateJson('{"ok": "yes"}', schema), ValidationError);
  });
});
