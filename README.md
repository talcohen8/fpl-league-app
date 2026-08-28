# FPL Weekly Winners

Shows, for your FPL classic league, who scored the most points **each gameweek** —
both gross points and points after subtracting that team's transfer-hit cost for the week.

## Why this needs deploying (not just opening the HTML file)

The official FPL API blocks direct requests from a browser (CORS policy). This project
includes a tiny serverless function (`/api/league.js`) that fetches the FPL data
server-side and hands it to the page — that's why it needs to run on Vercel rather
than just opening `index.html` locally.

## Deploy it (free, ~5 minutes)

1. Go to [vercel.com](https://vercel.com) and sign up / log in (GitHub login is easiest).
2. Install the Vercel CLI, or just drag-and-drop deploy:
   - **Easiest:** create a new GitHub repo, push this folder to it, then in Vercel click
     **"Add New Project"** → **Import** your repo → **Deploy**. No config needed, Vercel
     auto-detects everything.
   - **Alternative (CLI):**
     ```
     npm i -g vercel
     cd fpl-league-app
     vercel
     ```
     Follow the prompts (accept defaults) and it'll give you a live URL.
3. Once deployed, open your live URL, e.g. `https://your-project.vercel.app`.
4. Enter your league ID (**1498266** for your league) and click **Load League**.
   - You can also bookmark/share the direct link: `https://your-project.vercel.app/?id=1498266`

## Sharing with your league

Just send everyone the Vercel URL (with `?id=1498266` on the end so it loads
automatically). Anyone can open it — no login needed, since it only reads public FPL data.

## Updating each week

Nothing to do — it pulls live data from the FPL API every time the page loads.
Just refresh the page after a gameweek's results and bonus points are finalized.

## Notes

- "Hit" = points deducted for extra transfers that gameweek (FPL's `event_transfers_cost`).
- "Net" = gross points minus that hit — this is what determines the weekly winner shown
  in the "Most points after transfer hits" card.
- Works for any classic league, not just yours — just change the ID.
