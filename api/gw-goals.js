// /api/gw-goals?id=1498266&gw=5
//
// On-demand endpoint: computes raw goals scored by each manager's starting XI
// for a single gameweek (captain's goals are NOT doubled — this is a simple
// goal count, not an FPL points calculation).
// Kept separate from /api/league so this expensive per-manager calculation
// only ever runs for the one gameweek currently being viewed, not the
// whole season.

const FETCH_HEADERS = { "User-Agent": "Mozilla/5.0" };

async function fetchJson(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`FPL API returned ${res.status} for ${url}`);
  return res.json();
}

export default async function handler(req, res) {
  const { id, gw } = req.query;

  if (!id || !/^\d+$/.test(String(id))) {
    res.status(400).json({ error: "Missing or invalid league id. Use ?id=1498266&gw=5" });
    return;
  }
  if (!gw || !/^\d+$/.test(String(gw))) {
    res.status(400).json({ error: "Missing or invalid gameweek. Use ?id=1498266&gw=5" });
    return;
  }

  try {
    // 1. Get all managers in the league (handles pagination)
    const managerIds = [];
    let page = 1;
    let hasNext = true;

    while (hasNext) {
      const data = await fetchJson(
        `https://fantasy.premierleague.com/api/leagues-classic/${id}/standings/?page_standings=${page}`
      );
      const results = data.standings?.results || [];
      for (const r of results) managerIds.push(r.entry);
      hasNext = data.standings?.has_next || false;
      page += 1;
      if (page > 20) break;
    }

    if (managerIds.length === 0) {
      res.status(404).json({ error: "League not found or has no members." });
      return;
    }

    // 2. Get live goals_scored per player for this gameweek (one call)
    const live = await fetchJson(
      `https://fantasy.premierleague.com/api/event/${gw}/live/`
    );
    const goalsByElement = new Map();
    for (const el of live.elements || []) {
      goalsByElement.set(el.id, el.stats?.goals_scored ?? 0);
    }

    // 3. Get each manager's picks for this gameweek, batched for politeness
    const CONCURRENCY = 15;
    const goalsByManager = {};

    for (let i = 0; i < managerIds.length; i += CONCURRENCY) {
      const batch = managerIds.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (managerId) => {
          try {
            const picksData = await fetchJson(
              `https://fantasy.premierleague.com/api/entry/${managerId}/event/${gw}/picks/`
            );
            let goals = 0;
            for (const pick of picksData.picks || []) {
              if (pick.position > 11) continue; // starting XI only
              goals += goalsByElement.get(pick.element) ?? 0; // raw goals, no captain multiplier
            }
            goalsByManager[managerId] = goals;
          } catch {
            goalsByManager[managerId] = 0;
          }
        })
      );
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=150");
    res.status(200).json({
      leagueId: Number(id),
      event: Number(gw),
      goalsByManager,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch goals data." });
  }
}
