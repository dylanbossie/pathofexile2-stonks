// Client for poe.ninja's PoE2 economy endpoints, routed through the
// /ninja dev-server proxy (see vite.config.ts) to avoid CORS.

export interface League {
  name: string;
  displayName: string;
  hardcore: boolean;
  indexed: boolean;
}

export interface NinjaItem {
  id: string;
  name: string;
  image: string;
  category: string;
  detailsId: string;
}

export interface Sparkline {
  /** 7-day cumulative % change overall. */
  totalChange: number;
  /** 7 daily cumulative % change points. */
  data: number[];
}

export interface NinjaLine {
  id: string;
  /** Value of one unit, denominated in the primary currency (divines). */
  primaryValue: number;
  /** Total trade volume, denominated in the primary currency (divines). */
  volumePrimaryValue: number;
  sparkline: Sparkline;
}

export interface ExchangeOverview {
  core: {
    items: NinjaItem[];
    /** Units of each currency per 1 primary (divine), e.g. { exalted: 698.8 }. */
    rates: Record<string, number>;
    primary: string;
    secondary: string;
  };
  lines: NinjaLine[];
  items: NinjaItem[];
}

/**
 * Every category poe.ninja's PoE2 exchange overview supports, extracted
 * from their frontend's category registry (availableViews: ["exchange"]).
 */
export const EXCHANGE_TYPES: { type: string; label: string }[] = [
  { type: "Currency", label: "Currency" },
  { type: "Fragments", label: "Fragments" },
  { type: "Abyss", label: "Abyssal Bones" },
  { type: "UncutGems", label: "Uncut Gems" },
  { type: "LineageSupportGems", label: "Lineage Gems" },
  { type: "Essences", label: "Essences" },
  { type: "SoulCores", label: "Soul Cores" },
  { type: "Idols", label: "Idols" },
  { type: "Runes", label: "Runes" },
  { type: "Ritual", label: "Omens" },
  { type: "Expedition", label: "Expedition" },
  { type: "Delirium", label: "Liquid Emotions" },
  { type: "Breach", label: "Catalysts" },
  { type: "Verisium", label: "Verisium" },
];

export interface PricedItem {
  /** Globally unique key: "<type>:<line id>". */
  key: string;
  name: string;
  category: string;
  /** Value of one unit in divines. */
  unitDivines: number;
  /** Total trade volume in divines. */
  volumeDivines: number;
  /** 7-day cumulative % change. */
  totalChange: number;
  /** 7 daily cumulative % change points. */
  sparkline: number[];
}

export interface MergedEconomy {
  exaltsPerDivine: number;
  items: PricedItem[];
  /** When the underlying data was actually fetched from poe.ninja. */
  fetchedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_PREFIX = "ninja-cache:";

interface CacheEntry {
  fetchedAt: number;
  data: unknown;
}

/**
 * Fetch with a 15-minute localStorage cache so poe.ninja is queried at
 * most once per TTL per URL, surviving page reloads.
 */
async function cachedFetchJson(
  url: string,
): Promise<{ data: unknown; fetchedAt: number }> {
  const key = CACHE_PREFIX + url;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const entry = JSON.parse(raw) as CacheEntry;
      if (Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
        return { data: entry.data, fetchedAt: entry.fetchedAt };
      }
    }
  } catch {
    // Corrupt cache entry; fall through to a network fetch.
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const data = await res.json();
  const fetchedAt = Date.now();
  try {
    localStorage.setItem(key, JSON.stringify({ fetchedAt, data }));
  } catch {
    // Quota exceeded; serve uncached.
  }
  return { data, fetchedAt };
}

export async function fetchLeagues(): Promise<League[]> {
  const { data } = await cachedFetchJson("/ninja/poe2/api/data/index-state");
  return (data as { economyLeagues: League[] }).economyLeagues;
}

async function fetchOverview(
  league: string,
  type: string,
): Promise<{ overview: ExchangeOverview; fetchedAt: number }> {
  const params = new URLSearchParams({ league, type });
  const { data, fetchedAt } = await cachedFetchJson(
    `/ninja/poe2/api/economy/exchange/current/overview?${params}`,
  );
  return { overview: data as ExchangeOverview, fetchedAt };
}

/**
 * Fetches every exchange category for the league and merges them into a
 * single priced item list. Categories that fail or are empty (e.g. league
 * mechanics not present in this league) are skipped.
 */
export async function fetchEconomy(league: string): Promise<MergedEconomy> {
  const results = await Promise.allSettled(
    EXCHANGE_TYPES.map(({ type }) => fetchOverview(league, type)),
  );

  let exaltsPerDivine: number | null = null;
  let fetchedAt = 0;
  const items: PricedItem[] = [];

  results.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    const { overview } = result.value;
    fetchedAt = Math.max(fetchedAt, result.value.fetchedAt);
    exaltsPerDivine ??= overview.core.rates["exalted"] ?? null;
    const names = new Map(overview.items.map((item) => [item.id, item.name]));
    for (const line of overview.lines) {
      if (!(line.primaryValue > 0)) continue;
      items.push({
        key: `${EXCHANGE_TYPES[i].type}:${line.id}`,
        name: names.get(line.id) ?? line.id,
        category: EXCHANGE_TYPES[i].label,
        unitDivines: line.primaryValue,
        volumeDivines: line.volumePrimaryValue ?? 0,
        totalChange: line.sparkline?.totalChange ?? 0,
        sparkline: line.sparkline?.data ?? [],
      });
    }
  });

  if (exaltsPerDivine === null || items.length === 0) {
    throw new Error(`No exchange data available for league "${league}"`);
  }
  return { exaltsPerDivine, items, fetchedAt };
}
