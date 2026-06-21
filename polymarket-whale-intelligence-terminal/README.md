# Polymarket Whale Intelligence Terminal

A browser-based intelligence dashboard for tracking Polymarket whale wallets, detecting position changes, scoring consensus trades, and monitoring data quality.

## Run

```bash
python3 -m http.server 5180
```

Then open:

```text
http://127.0.0.1:5180
```

The app runs without a build step. It starts with verified Polymarket leaderboard wallets that had more than 100 trades when checked on June 20, 2026. Add or remove `0x...` wallet addresses in the sidebar.

## Publish

The site is ready for GitHub Pages. Once this folder is pushed to a GitHub repo named however you like:

1. Open the repo on GitHub.
2. Go to Settings -> Pages.
3. Set Source to GitHub Actions.
4. Push to the `main` branch.

After that, every push updates the live website automatically.

Netlify and Vercel config files are also included, so either service can publish this folder as a static site with no build command.

## Core Modules

- `src/app.js`: routing, rendering, refresh loop, forms, and interaction handlers.
- `src/polymarketApi.js`: Polymarket positions API access and response normalization.
- `src/analytics.js`: change detection, consensus, intelligence scoring, whale profiles, similarity, rankings, history, health, and data quality.
- `src/alerts.js`: browser notification, Discord webhook, and Telegram delivery.
- `src/storage.js`: localStorage persistence for whales, snapshots, activities, settings, watchlists, and collapsed panels.
- `styles.css`: dark intelligence-dashboard UI system.

## Notes

Telegram and Discord delivery are implemented client-side for local use. In production, route those calls through a small backend worker so webhook secrets are not exposed in the browser and so CORS does not block delivery.
