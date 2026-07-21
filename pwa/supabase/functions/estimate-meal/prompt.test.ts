import { describe, it, expect } from "vitest";
import { mealPrompt, normalizeName, MAX_NAME, DEFAULT_PROMPT } from "./prompt.ts";

describe("normalizeName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeName("  chicken burrito  ")).toBe("chicken burrito");
  });

  it("treats blank and non-string input as absent", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName("   ")).toBe("");
    expect(normalizeName(undefined)).toBe("");
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(42)).toBe("");
  });

  it("caps length at MAX_NAME", () => {
    expect(normalizeName("a".repeat(500))).toHaveLength(MAX_NAME);
  });
});

describe("mealPrompt", () => {
  it("returns the unchanged default when there is no usable name", () => {
    expect(mealPrompt(undefined)).toBe(DEFAULT_PROMPT);
    expect(mealPrompt("")).toBe(DEFAULT_PROMPT);
    expect(mealPrompt("   ")).toBe(DEFAULT_PROMPT);
    expect(mealPrompt(42)).toBe(DEFAULT_PROMPT);
  });

  it("includes the corrected name and defers to it", () => {
    const out = mealPrompt("chicken burrito");
    expect(out).toContain("chicken burrito");
    expect(out).toMatch(/portion/i);
    expect(out).not.toBe(DEFAULT_PROMPT);
  });

  it("uses the truncated name, not the raw one", () => {
    const out = mealPrompt("b".repeat(500));
    expect(out).toContain("b".repeat(MAX_NAME));
    expect(out).not.toContain("b".repeat(MAX_NAME + 1));
  });
});
