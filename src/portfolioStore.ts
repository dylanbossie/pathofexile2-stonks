import { useCallback, useEffect, useState } from "react";
import type { MergedEconomy } from "./api";

/** A holding the user is actively invested in, denominated in divines. */
export interface Position {
  /** Matches PricedItem.key ("<type>:<line id>"). */
  key: string;
  /** Snapshot for display even if the item drops out of the current economy. */
  name: string;
  category: string;
  quantity: number;
  /** Average per-unit purchase price in divines (cost basis ÷ quantity). */
  buyDivines: number;
  /** When the position was first opened. */
  addedAt: number;
}

/** Position priced against the current economy, with P&L derived. */
export interface ValuedPosition {
  position: Position;
  /** Current per-unit price in divines, or null if no longer listed. */
  currentDivines: number | null;
  /** quantity × buyDivines. */
  costBasis: number;
  /** quantity × currentDivines, or null when unpriced. */
  marketValue: number | null;
  /** marketValue − costBasis, or null when unpriced. */
  profit: number | null;
  /** profit ÷ costBasis, or null when unpriced or zero-cost. */
  returnPct: number | null;
}

export interface PortfolioValuation {
  rows: ValuedPosition[];
  /** Cost basis summed over positions that have a current price. */
  totalCost: number;
  /** Market value summed over positions that have a current price. */
  totalValue: number;
  totalProfit: number;
  totalReturnPct: number;
  /** Positions with no current price (e.g. delisted, or wrong league). */
  missing: number;
}

const STORAGE_PREFIX = "poe2-portfolio:";

/** Holdings are league-specific (prices reset between leagues), so scope by it. */
function storageKey(league: string): string {
  return STORAGE_PREFIX + league;
}

function loadPositions(league: string): Position[] {
  if (!league) return [];
  try {
    const raw = localStorage.getItem(storageKey(league));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Position[]) : [];
  } catch {
    return [];
  }
}

function savePositions(league: string, positions: Position[]): void {
  if (!league) return;
  try {
    localStorage.setItem(storageKey(league), JSON.stringify(positions));
  } catch {
    // Storage unavailable or over quota; the in-memory list still works.
  }
}

export interface Portfolio {
  positions: Position[];
  /**
   * Opens a holding, or — if one already exists for the item — adds to it and
   * blends the buy price into a quantity-weighted average cost.
   */
  addPosition: (input: {
    key: string;
    name: string;
    category: string;
    quantity: number;
    buyDivines: number;
  }) => void;
  updatePosition: (
    key: string,
    patch: Partial<Pick<Position, "quantity" | "buyDivines">>,
  ) => void;
  removePosition: (key: string) => void;
}

/**
 * Loads, exposes, and persists the per-league portfolio. Mutations write
 * through to localStorage immediately so holdings survive restarts.
 */
export function usePortfolio(league: string): Portfolio {
  const [positions, setPositions] = useState<Position[]>(() =>
    loadPositions(league),
  );

  // Swap in the saved holdings whenever the league changes.
  useEffect(() => {
    setPositions(loadPositions(league));
  }, [league]);

  // Apply a change and persist the result in one step. Persisting inside the
  // updater (rather than a positions-watching effect) keeps a league switch
  // from writing the previous league's holdings under the new league's key.
  const apply = useCallback(
    (fn: (prev: Position[]) => Position[]) => {
      setPositions((prev) => {
        const next = fn(prev);
        savePositions(league, next);
        return next;
      });
    },
    [league],
  );

  const addPosition = useCallback<Portfolio["addPosition"]>(
    (input) => {
      if (!(input.quantity > 0)) return;
      apply((prev) => {
        const existing = prev.find((p) => p.key === input.key);
        if (!existing) {
          return [
            ...prev,
            {
              key: input.key,
              name: input.name,
              category: input.category,
              quantity: input.quantity,
              buyDivines: input.buyDivines,
              addedAt: Date.now(),
            },
          ];
        }
        const totalQty = existing.quantity + input.quantity;
        const blendedBuy =
          totalQty > 0
            ? (existing.quantity * existing.buyDivines +
                input.quantity * input.buyDivines) /
              totalQty
            : existing.buyDivines;
        return prev.map((p) =>
          p.key === input.key
            ? { ...p, quantity: totalQty, buyDivines: blendedBuy }
            : p,
        );
      });
    },
    [apply],
  );

  const updatePosition = useCallback<Portfolio["updatePosition"]>(
    (key, patch) => {
      apply((prev) =>
        prev.map((p) => (p.key === key ? { ...p, ...patch } : p)),
      );
    },
    [apply],
  );

  const removePosition = useCallback<Portfolio["removePosition"]>(
    (key) => {
      apply((prev) => prev.filter((p) => p.key !== key));
    },
    [apply],
  );

  return { positions, addPosition, updatePosition, removePosition };
}

/** Prices the portfolio against the current economy and derives P&L. */
export function valuePortfolio(
  positions: Position[],
  economy: MergedEconomy | null,
): PortfolioValuation {
  const priceByKey = new Map(
    (economy?.items ?? []).map((item) => [item.key, item.unitDivines]),
  );

  let totalCost = 0;
  let totalValue = 0;
  let missing = 0;

  const rows = positions.map<ValuedPosition>((position) => {
    const currentDivines = priceByKey.get(position.key) ?? null;
    const costBasis = position.quantity * position.buyDivines;
    const marketValue =
      currentDivines === null ? null : position.quantity * currentDivines;
    const profit = marketValue === null ? null : marketValue - costBasis;
    const returnPct =
      profit === null || costBasis === 0 ? null : profit / costBasis;

    if (currentDivines === null) {
      missing += 1;
    } else {
      totalCost += costBasis;
      totalValue += marketValue as number;
    }

    return { position, currentDivines, costBasis, marketValue, profit, returnPct };
  });

  const totalProfit = totalValue - totalCost;
  const totalReturnPct = totalCost > 0 ? totalProfit / totalCost : 0;

  return { rows, totalCost, totalValue, totalProfit, totalReturnPct, missing };
}
