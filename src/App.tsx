import { useEffect, useState } from "react";
import {
  fetchEconomy,
  fetchLeagues,
  PRIOR_LEAGUE,
  type League,
  type MergedEconomy,
} from "./api";
import { formatNumber } from "./format";
import Calculator from "./Calculator";
import Stonks from "./Stonks";

type Tab = "calculator" | "stonks";

export default function App() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [league, setLeague] = useState<string>("");
  const [economy, setEconomy] = useState<MergedEconomy | null>(null);
  const [priorEconomy, setPriorEconomy] = useState<MergedEconomy | null>(null);
  const [tab, setTab] = useState<Tab>("calculator");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchLeagues()
      .then((ls) => {
        setLeagues(ls);
        const def = ls.find((l) => l.indexed && !l.hardcore) ?? ls[0];
        if (def) setLeague(def.name);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Eagerly load the prior (ended) league's economy on mount — its name is a
  // constant, independent of the selected league — so the prior-league chart,
  // projections, and the portfolio's Fate of the Vaal panels have their data
  // ready tab-wide without separate on-demand fetches. Best-effort: a failure
  // here never blocks the current-league view.
  useEffect(() => {
    fetchEconomy(PRIOR_LEAGUE)
      .then(setPriorEconomy)
      .catch(() => setPriorEconomy(null));
  }, []);

  useEffect(() => {
    if (!league) return;
    setLoading(true);
    setError(null);
    setEconomy(null);
    fetchEconomy(league)
      .then(setEconomy)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [league]);

  return (
    <main className="container">
      <h1>PoE2 Stonks</h1>

      {error && <p className="error">{error}</p>}

      <div className="topbar">
        <label>
          League
          <select value={league} onChange={(e) => setLeague(e.target.value)}>
            {leagues.map((l) => (
              <option key={l.name} value={l.name}>
                {l.displayName}
              </option>
            ))}
          </select>
        </label>

        <nav className="tabs">
          <button
            type="button"
            className={tab === "calculator" ? "active" : ""}
            onClick={() => setTab("calculator")}
          >
            Calculator
          </button>
          <button
            type="button"
            className={tab === "stonks" ? "active" : ""}
            onClick={() => setTab("stonks")}
          >
            Stonks
          </button>
        </nav>
      </div>

      {loading && <p className="muted">Loading prices…</p>}

      {economy && (
        <p className="ratio">
          1 Divine Orb ={" "}
          <strong>{formatNumber(economy.exaltsPerDivine, 1)}</strong> Exalted
          Orbs
          <span className="muted">
            {" "}
            · {formatNumber(economy.items.length, 0)} items tracked · prices
            from{" "}
            {Math.max(0, Math.round((Date.now() - economy.fetchedAt) / 60000))}{" "}
            min ago (cached up to 15 min)
          </span>
        </p>
      )}

      {tab === "calculator" ? (
        <Calculator economy={economy} loading={loading} />
      ) : (
        <Stonks
          economy={economy}
          priorEconomy={priorEconomy}
          league={league}
          loading={loading}
        />
      )}
    </main>
  );
}
