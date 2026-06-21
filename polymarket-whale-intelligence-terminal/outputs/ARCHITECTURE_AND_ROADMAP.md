# Polymarket Whale Intelligence Terminal: Architecture and Roadmap

## Current Implementation

The project is implemented as a modular static web app so it can run immediately without dependency installation. It starts with verified Polymarket leaderboard wallets and supports live wallet tracking through the Polymarket positions endpoint after wallet addresses are added.

### Data Flow

1. Wallets are loaded from localStorage.
2. Each refresh fetches positions per wallet with latency/error tracking.
3. Positions are normalized into one internal schema.
4. Snapshots are persisted locally for history and duration tracking.
5. Analytics modules compute activity events, consensus, intelligence scores, profiles, similarity, rankings, quality flags, and health status.
6. The UI renders hash-routed overview, profile, history, watchlist, and alert/settings pages.

### Main Components

- API adapter: isolates Polymarket response shape changes and wallet fetch failures.
- Snapshot store: stores first seen, last seen, size series, and closed-position inference.
- Activity engine: detects new positions, exits, size increases/decreases, large increases, and YES/NO flips.
- Consensus engine: tracks 2/N through 5/N overlap, combined value, movement, and score.
- Intelligence score: combines whale count, historical win proxy, size, and recency.
- Whale profiles: exposes win rate, realized PnL proxy, average size, largest position, active/closed positions, favorite category, and overlap.
- Similarity engine: Jaccard overlap by market/outcome.
- Alert system: browser notifications, Discord webhook, Telegram bot API settings.
- Health and data quality: API status, refresh time, wallet failures, latency, duplicates, missing fields, and inconsistent feed flags.

## Production Architecture Recommendation

Move from local-only storage to a thin backend with durable persistence:

- Frontend: React or Next.js with the same module boundaries used here.
- API worker: scheduled refreshes, rate limiting, Polymarket API retries, webhook delivery, and secrets management.
- Database: Postgres for wallets, users, teams, subscriptions, snapshots, positions, activities, alerts, and watchlists.
- Queue: Redis/BullMQ or managed queue for 100+ whale refresh jobs.
- Realtime: WebSocket or Server-Sent Events for activity cards and alert state.
- Auth/billing: Clerk/Auth0 plus Stripe plans mapped to feature gates.
- Observability: structured logs, latency histograms, alert delivery metrics, and API failure dashboards.

## Suggested Database Tables

- `users`
- `teams`
- `subscriptions`
- `wallets`
- `watchlists`
- `watchlist_items`
- `position_snapshots`
- `positions`
- `activity_events`
- `consensus_signals`
- `alert_rules`
- `alert_deliveries`
- `data_quality_issues`

## Expansion Roadmap

### Phase 1: Hardening

- Add backend proxy for Polymarket API calls.
- Store snapshots in Postgres.
- Add retry/backoff and wallet-level refresh scheduling.
- Replace PnL proxies with canonical realized PnL when available from trusted sources.
- Add unit tests for normalization, change detection, scoring, and consensus movement.

### Phase 2: Trader Intelligence

- Add trader tagging and notes.
- Add position-size charts per market/wallet.
- Add market detail pages with whale timeline, consensus history, and score changes.
- Add custom alert builder with thresholds and categories.
- Add category exposure over time.

### Phase 3: Product Hardening

- Add accounts, billing, and feature gates.
- Add server-side Discord and Telegram integrations.
- Add CSV export and saved searches.
- Add team/shared watchlists.
- Add historical backfill jobs.

### Phase 4: Advanced Operations

- Add API keys and rate-limited customer API.
- Add audit logs.
- Add custom scoring formulas.
- Add Slack, email, and webhook alert targets.
- Add multi-tenant admin controls.
