import { describe, it, expect } from "vitest";
import { itemsTotal, itemsForSave, blankItem, hasIncompleteItem } from "./mealItems.js";

describe("itemsTotal", () => {
  it("sums calorie fields", () => {
    expect(itemsTotal([{ calories: 250 }, { calories: 260 }])).toBe(510);
  });

  it("treats blank fields mid-edit as zero", () => {
    expect(itemsTotal([{ calories: 250 }, { calories: "" }])).toBe(250);
  });

  it("ignores non-numeric junk rather than returning NaN", () => {
    expect(itemsTotal([{ calories: "abc" }, { calories: 100 }])).toBe(100);
  });

  it("is zero for an empty list", () => {
    expect(itemsTotal([])).toBe(0);
  });

  it("accepts numeric strings from number inputs", () => {
    expect(itemsTotal([{ calories: "250" }])).toBe(250);
  });
});

describe("itemsForSave", () => {
  it("strips the client-side key", () => {
    const out = itemsForSave([{ key: 3, name: "egg", calories: "143", reasoning: "one large" }]);
    expect(out).toEqual([{ name: "egg", calories: 143, reasoning: "one large" }]);
  });

  it("drops fully blank rows", () => {
    const out = itemsForSave([
      { key: 1, name: "egg", calories: "143", reasoning: null },
      { key: 2, name: "", calories: "", reasoning: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("egg");
  });

  it("keeps a named row with no calories (the save guard catches it)", () => {
    const out = itemsForSave([{ key: 1, name: "toast", calories: "", reasoning: null }]);
    expect(out).toHaveLength(1);
    expect(out[0].calories).toBe(0);
  });

  it("preserves a null reasoning rather than inventing one", () => {
    const out = itemsForSave([{ key: 1, name: "juice", calories: "110", reasoning: null }]);
    expect(out[0].reasoning).toBeNull();
  });
});

describe("hasIncompleteItem", () => {
  it("is true when a named row has no calories", () => {
    expect(hasIncompleteItem([{ name: "toast", calories: "" }])).toBe(true);
  });

  it("is false when every named row has calories", () => {
    expect(hasIncompleteItem([{ name: "toast", calories: "90" }])).toBe(false);
  });

  it("ignores fully blank rows, which are dropped at save", () => {
    expect(hasIncompleteItem([{ name: "", calories: "" }])).toBe(false);
  });
});

describe("blankItem", () => {
  it("carries the given key and empty fields", () => {
    expect(blankItem(7)).toEqual({ key: 7, name: "", calories: "", reasoning: null });
  });
});
