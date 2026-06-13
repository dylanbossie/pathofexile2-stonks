import { useEffect, useMemo, useRef, useState } from "react";
import { EXCHANGE_TYPES, type PricedItem } from "./api";

/**
 * Builds a case-insensitive subsequence regex: "annul" becomes
 * /a.*n.*n.*u.*l/i, matching names that contain those letters in order but
 * not necessarily adjacent. Metacharacters in the query are escaped.
 */
function subsequenceRegex(query: string): RegExp {
  const pattern = query
    .split("")
    .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(pattern, "i");
}

/**
 * A type-to-search dropdown over priced items, with keyboard navigation.
 * Self-contained: it reports the chosen item via `onSelect`. To clear it
 * after a selection, remount it with a changing `key`.
 */
export default function ItemSearch({
  items,
  onSelect,
  disabled,
  placeholder,
  label = "Item",
}: {
  items: PricedItem[];
  onSelect: (item: PricedItem) => void;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLLabelElement>(null);

  /** Matches, sorted by category (in registry order) then name. */
  const matches = useMemo(() => {
    const regex = subsequenceRegex(query);
    const categoryOrder = new Map(
      EXCHANGE_TYPES.map(({ label }, i) => [label, i]),
    );
    return items
      .filter((item) => regex.test(item.name))
      .sort(
        (a, b) =>
          (categoryOrder.get(a.category) ?? 99) -
            (categoryOrder.get(b.category) ?? 99) ||
          a.name.localeCompare(b.name),
      );
  }, [items, query]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  // Close the suggestion list on any click outside the search box.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  function choose(item: PricedItem) {
    setQuery(item.name);
    setOpen(false);
    onSelect(item);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlighted((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && matches[highlighted]) choose(matches[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <label className="search" ref={ref}>
      {label}
      <input
        type="text"
        placeholder={placeholder ?? "Type to search…"}
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && (
        <ul className="suggestions">
          {matches.length === 0 && (
            <li className="muted">No items match “{query}”</li>
          )}
          {matches.slice(0, 50).map((item, i) => (
            <li
              key={item.key}
              className={i === highlighted ? "highlighted" : ""}
              onMouseDown={() => choose(item)}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span>{item.name}</span>
              <span className="muted">{item.category}</span>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
