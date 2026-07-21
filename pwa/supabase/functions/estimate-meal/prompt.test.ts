import { describe, it, expect } from "vitest";
import {
  mealPrompt, normalizeName, MAX_NAME, DEFAULT_PROMPT,
  DENSITIES, systemPrompt, PLATE_CM, BOWL_CM, itemPrompt,
} from "./prompt.ts";

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

describe("DENSITIES", () => {
  it("has enough entries to be useful", () => {
    expect(DENSITIES.length).toBeGreaterThanOrEqual(30);
  });

  it("entries are well formed", () => {
    for (const d of DENSITIES) {
      expect(d.name.trim()).not.toBe("");
      expect(Number.isInteger(d.kcal100g)).toBe(true);
      expect(d.kcal100g).toBeGreaterThan(0);
    }
  });

  it("has no duplicate names", () => {
    const names = DENSITIES.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers the high-error fat and starch cases", () => {
    const names = DENSITIES.map((d) => d.name);
    for (const required of ["olive oil", "butter", "white rice", "bread"]) {
      expect(names).toContain(required);
    }
  });
});

describe("systemPrompt", () => {
  it("keeps the plate and bowl reference sizes", () => {
    const out = systemPrompt();
    expect(out).toContain(String(PLATE_CM));
    expect(out).toContain(String(BOWL_CM));
  });

  it("includes density lines the model can multiply against", () => {
    const out = systemPrompt();
    expect(out).toContain("olive oil");
    expect(out).toContain(String(DENSITIES.find((d) => d.name === "olive oil")!.kcal100g));
  });

  it("instructs the grams-then-multiply method", () => {
    const out = systemPrompt();
    expect(out).toMatch(/gram/i);
    expect(out).toMatch(/multiply/i);
  });

  it("still tells the model to estimate generously", () => {
    expect(systemPrompt()).toMatch(/generous/i);
  });
});

describe("itemPrompt", () => {
  const plate = [{ name: "chicken breast" }, { name: "white rice" }, { name: "broccoli" }];

  it("names the target item and constrains scope to it", () => {
    const out = itemPrompt(plate, 1);
    expect(out).toContain("white rice");
    expect(out).toMatch(/only/i);
    expect(out).toMatch(/not the whole plate/i);
  });

  it("includes the other items as context so the model knows which region", () => {
    const out = itemPrompt(plate, 1);
    expect(out).toContain("chicken breast");
    expect(out).toContain("broccoli");
  });

  it("tells the model to assume a typical serving when the item is not visible", () => {
    const out = itemPrompt(plate, 1);
    expect(out).toMatch(/not visible|cannot find|typical serving/i);
  });

  it("truncates a long item name like every other owner-supplied string", () => {
    const out = itemPrompt([{ name: "c".repeat(500) }], 0);
    expect(out).toContain("c".repeat(MAX_NAME));
    expect(out).not.toContain("c".repeat(MAX_NAME + 1));
  });

  it("falls back to the whole-meal prompt on unusable input", () => {
    expect(itemPrompt(plate, 9)).toBe(DEFAULT_PROMPT);
    expect(itemPrompt(plate, -1)).toBe(DEFAULT_PROMPT);
    expect(itemPrompt(plate, "x")).toBe(DEFAULT_PROMPT);
    expect(itemPrompt([], 0)).toBe(DEFAULT_PROMPT);
    expect(itemPrompt([{ name: "   " }], 0)).toBe(DEFAULT_PROMPT);
  });
});

describe("systemPrompt photo/text modes", () => {
  it("defaults to photo mode so existing callers are unaffected", () => {
    expect(systemPrompt()).toBe(systemPrompt({ photo: true }));
  });

  it("keeps the plate and bowl scale reference in photo mode", () => {
    const out = systemPrompt({ photo: true });
    expect(out).toContain(String(PLATE_CM));
    expect(out).toContain(String(BOWL_CM));
  });

  it("drops the plate and bowl reference in text mode", () => {
    // "cm" suffix avoids a false match against unrelated numbers in the
    // density table (e.g. steak's "271" contains "27").
    const out = systemPrompt({ photo: false });
    expect(out).not.toContain(`${PLATE_CM} cm`);
    expect(out).not.toContain(`${BOWL_CM} cm`);
  });

  it("leans on stated quantities instead of scale in text mode", () => {
    expect(systemPrompt({ photo: false })).toMatch(/stated quantit|typical serving/i);
  });

  it("carries the density table in both modes", () => {
    for (const photo of [true, false]) {
      const out = systemPrompt({ photo });
      expect(out).toContain("olive oil");
      expect(out).toContain(String(DENSITIES.find((d) => d.name === "olive oil")!.kcal100g));
    }
  });

  it("carries the grams-then-multiply method in both modes", () => {
    for (const photo of [true, false]) {
      const out = systemPrompt({ photo });
      expect(out).toMatch(/gram/i);
      expect(out).toMatch(/multiply/i);
    }
  });
});
