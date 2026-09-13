// /api/league?id=1498266
//
// Fast endpoint: proxies the FPL API and returns gross points, transfer
// hit cost, and net points for every gameweek and every manager in the
// league. Deliberately does NOT compute goals scored here — that's a much
// more expensive per-manager-per-gameweek calculation, handled separately
// by /api/gw-goals so it only runs for the one gameweek being viewed.

const FETCH_HEADERS = { "User-Agent": "Mozilla/5.0" };

async function fetchJson(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`FPL API returned ${res.status} for ${url}`);
  return res.json();
}

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id || !/^\d+$/.test(String(id))) {
    res.status(400).json({ error: "Missing or invalid league id. Use ?id=1498266" });
    return;
  }

  try {
    // 1. Get all managers in the league (handles pagination for >50 teams)
    const managers = [];
    let page = 1;
    let hasNext = true;
    let leagueName = "";

    while (hasNext) {
      const data = await fetchJson(
        `https://fantasy.premierleague.com/api/leagues-classic/${id}/standings/?page_standings=${page}`
      );
      leagueName = data.league?.name || leagueName;

      const results = data.standings?.results || [];
      for (const r of results) {
        managers.push({
          managerId: r.entry,
          teamName: r.entry_name,
          playerName: r.player_name,
        });
      }

      hasNext = data.standings?.has_next || false;
      page += 1;
      if (page > 20) break; // safety cap
    }

    if (managers.length === 0) {
      res.status(404).json({ error: "League not found or has no members." });
      return;
    }

    // 2. Get each manager's gameweek-by-gameweek history in parallel
    const historyResults = await Promise.all(
      managers.map(async (m) => {
        try {
          const hist = await fetchJson(
            `https://fantasy.premierleague.com/api/entry/${m.managerId}/history/`
          );
          return { ...m, current: hist.current || [] };
        } catch {
          return { ...m, current: [] };
        }
      })
    );

    // 3. Reshape into per-gameweek rows (no goals field yet)
    const gwMap = new Map();

    for (const m of historyResults) {
      for (const gw of m.current) {
        const gross = gw.points ?? 0;
        const hit = gw.event_transfers_cost ?? 0;
        const net = gross - hit;

        if (!gwMap.has(gw.event)) gwMap.set(gw.event, []);
        gwMap.get(gw.event).push({
          managerId: m.managerId,
          teamName: m.teamName,
          playerName: m.playerName,
          transfers: gw.event_transfers ?? 0,
          gross,
          hit,
          net,
          overallTotal: gw.total_points ?? null,
        });
      }
    }

    const gameweeks = Array.from(gwMap.keys()).sort((a, b) => a - b);

    const weeks = gameweeks.map((event) => {
      const rows = gwMap.get(event).sort((a, b) => b.net - a.net);
      const grossWinner = [...rows].sort((a, b) => b.gross - a.gross)[0];
      const netWinner = rows[0];
      return {
        event,
        rows,
        grossWinner: grossWinner
          ? { teamName: grossWinner.teamName, playerName: grossWinner.playerName, gross: grossWinner.gross }
          : null,
        netWinner: netWinner
          ? { teamName: netWinner.teamName, playerName: netWinner.playerName, net: netWinner.net }
          : null,
      };
    });

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=300");
    res.status(200).json({
      leagueId: Number(id),
      leagueName,
      managerCount: managers.length,
      weeks,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch FPL data." });
  }
}
