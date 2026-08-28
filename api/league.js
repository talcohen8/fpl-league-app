// /api/league?id=1498266
//
// Proxies the FPL API (which blocks browser CORS requests) and returns
// a ready-to-use per-gameweek breakdown for every manager in the league:
//   - gross points scored that gameweek
//   - points lost to transfer costs ("hits") that gameweek
//   - net points (gross - transfer cost)
// plus who had the most gross and most net points each gameweek.

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
      const standingsRes = await fetch(
        `https://fantasy.premierleague.com/api/leagues-classic/${id}/standings/?page_standings=${page}`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );

      if (!standingsRes.ok) {
        throw new Error(`FPL API returned ${standingsRes.status} for league standings`);
      }

      const data = await standingsRes.json();
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

      // safety cap so a huge public league can't loop forever
      if (page > 20) break;
    }

    if (managers.length === 0) {
      res.status(404).json({ error: "League not found or has no members." });
      return;
    }

    // 2. Get each manager's gameweek-by-gameweek history in parallel
    const historyResults = await Promise.all(
      managers.map(async (m) => {
        const histRes = await fetch(
          `https://fantasy.premierleague.com/api/entry/${m.managerId}/history/`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (!histRes.ok) {
          return { ...m, current: [] };
        }
        const hist = await histRes.json();
        return { ...m, current: hist.current || [] };
      })
    );

    // 3. Reshape into per-gameweek rows
    const gwMap = new Map(); // event -> [{managerId, teamName, playerName, gross, hit, net}]

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
