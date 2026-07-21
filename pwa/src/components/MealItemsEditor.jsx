import { useRef } from "react";
import { blankItem } from "../lib/mealItems.js";
import { input, button, textMuted } from "../styles/ui.js";

// Controlled editor for a meal's item list. Owns no meal-level concerns - no
// meal name, no total, no save, no network. The parent owns the array.
//
// onRecalculate is optional: without it no recalculate control renders, which
// is what a caller with no photo needs.
export default function MealItemsEditor({ items, onChange, onRecalculate, busyIndex = null }) {
  // Row identity must survive add, remove and reorder. Array index would make
  // every row below a removed one remount and lose focus mid-edit, so each row
  // carries its own key from this counter. Never persisted.
  const nextKey = useRef(1000);

  function patch(i, fields) {
    onChange(items.map((it, n) => (n === i ? { ...it, ...fields } : it)));
  }

  function remove(i) {
    onChange(items.filter((_, n) => n !== i));
  }

  function add() {
    onChange([...items, blankItem(nextKey.current++)]);
  }

  return (
    <div>
      {items.map((it, i) => (
        <div key={it.key} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={it.name}
              onChange={(e) => patch(i, { name: e.target.value })}
              placeholder="Item"
              style={{ ...input, flex: 2, minWidth: 120 }}
            />
            <input
              type="number"
              value={it.calories}
              onChange={(e) => patch(i, { calories: e.target.value })}
              placeholder="kcal"
              style={{ ...input, flex: 1, minWidth: 80 }}
            />
            {onRecalculate && (
              <button
                type="button"
                onClick={() => onRecalculate(i)}
                disabled={busyIndex !== null || !it.name.trim()}
                style={{ ...button, padding: "6px 10px" }}
              >
                {busyIndex === i ? "…" : "↻"}
              </button>
            )}
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove ${it.name || "item"}`}
              style={{ ...button, padding: "6px 10px" }}
            >
              ✕
            </button>
          </div>
          {it.reasoning && (
            <div style={{ ...textMuted, fontSize: 13, marginTop: 2 }}>{it.reasoning}</div>
          )}
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...button, marginTop: 4 }}>
        + Add item
      </button>
    </div>
  );
}
