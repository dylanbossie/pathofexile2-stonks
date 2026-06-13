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

export interface NinjaLine {
  id: string;
  /** Value of one unit, denominated in the primary currency (divines). */
  primaryValue: number;
  /** Total trade volume, denominated in the primary currency (divines). */
  volumePrimaryValue: number;
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

/**
 * The most recent *ended* league. poe.ninja drops ended leagues from
 * index-state, but still serves their full price history through the same
 * endpoints, so we name it explicitly to mine that history. Update this when
 * a new league ends.
 */
export const PRIOR_LEAGUE = "Fate of the Vaal";

export interface PricedItem {
  /** Globally unique key: "<type>:<line id>". */
  key: string;
  name: string;
  /** Human-readable category label (e.g. "Liquid Emotions"). */
  category: string;
  /** poe.ninja API type, needed for the details endpoint (e.g. "Delirium"). */
  type: string;
  /** Slug for the details endpoint (e.g. "orb-of-chance"). */
  detailsId: string;
  /** Value of one unit in divines. */
  unitDivines: number;
  /** Total trade volume in divines. */
  volumeDivines: number;
}

/** One daily snapshot of an item's divine-denominated price. */
export interface HistoryPoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Unit value in divines on that day. */
  rate: number;
  /** Trade volume in divines on that day. */
  volume: number;
}

export interface MergedEconomy {
  exaltsPerDivine: number;
  items: PricedItem[];
  /** When the underlying data was actually fetched from poe.ninja. */
  fetchedAt: number;
}

/** Default cache lifetime; tunes price freshness vs. API politeness. */
const CACHE_TTL_MS = 15 * 60 * 1000;
/** Per-item history is bulky (many requests) and slow-moving, so cache longer. */
const HISTORY_CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_PREFIX = "ninja-cache:";

interface CacheEntry {
  fetchedAt: number;
  data: unknown;
}

/**
 * Fetch with a localStorage cache so poe.ninja is queried at most once per
 * `ttlMs` per URL, surviving page reloads.
 */
async function cachedFetchJson(
  url: string,
  ttlMs: number = CACHE_TTL_MS,
): Promise<{ data: unknown; fetchedAt: number }> {
  const key = CACHE_PREFIX + url;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const entry = JSON.parse(raw) as CacheEntry;
      if (Date.now() - entry.fetchedAt < ttlMs) {
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
    const meta = new Map(overview.items.map((item) => [item.id, item]));
    for (const line of overview.lines) {
      if (!(line.primaryValue > 0)) continue;
      const m = meta.get(line.id);
      items.push({
        key: `${EXCHANGE_TYPES[i].type}:${line.id}`,
        name: m?.name ?? line.id,
        category: EXCHANGE_TYPES[i].label,
        type: EXCHANGE_TYPES[i].type,
        detailsId: m?.detailsId ?? "",
        unitDivines: line.primaryValue,
        volumeDivines: line.volumePrimaryValue ?? 0,
      });
    }
  });

  if (exaltsPerDivine === null || items.length === 0) {
    throw new Error(`No exchange data available for league "${league}"`);
  }
  return { exaltsPerDivine, items, fetchedAt };
}

interface DetailsResponse {
  core: { primary: string };
  pairs: {
    id: string;
    history: { timestamp: string; rate: number; volumePrimaryValue: number }[];
  }[];
}

/**
 * Full divine-denominated daily price history for a single item, oldest
 * point first. Uses the same 15-minute cache as everything else.
 */
export async function fetchItemHistory(
  league: string,
  type: string,
  detailsId: string,
): Promise<HistoryPoint[]> {
  const params = new URLSearchParams({ league, type, id: detailsId });
  const { data } = await cachedFetchJson(
    `/ninja/poe2/api/economy/exchange/current/details?${params}`,
    HISTORY_CACHE_TTL_MS,
  );
  const d = data as DetailsResponse;
  // The pair against the primary currency (divine) is the divine price.
  const pair = d.pairs.find((p) => p.id === d.core.primary);
  if (!pair) return [];
  return pair.history
    .map((h) => ({
      date: h.timestamp.slice(0, 10),
      rate: h.rate,
      volume: h.volumePrimaryValue,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once, invoking
 * `onProgress` as each settles. Results preserve input order.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      onProgress?.(++done, items.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}
