import { DEFAULT_SETTINGS } from "./config.js";
import { storage } from "./storage.js";
import { fetchWhalePositions } from "./polymarketApi.js";
import {
  addIntelligenceScores,
  buildConsensus,
  buildProfiles,
  buildQualityReport,
  buildRankings,
  buildSimilarityMatrix,
  compactCurrency,
  currency,
  detectPositionChanges,
  enrichPositions,
  formatDuration,
  summarizeHealth,
} from "./analytics.js";
import { dispatchAlerts, requestNotificationPermission } from "./alerts.js";

const app = document.querySelector("#app");

const DEFAULT_LIMITS = {
  consensus: 4,
  activity: 4,
  positions: 12,
  profilePositions: 10,
  closed: 6,
  history: 30,
};

const LOAD_STEPS = {
  consensus: 4,
  activity: 4,
  positions: 12,
  profilePositions: 10,
  closed: 6,
  history: 30,
};

const state = {
  whales: storage.getWhales(),
  settings: storage.getSettings(),
  snapshots: storage.getSnapshots(),
  activities: storage.getActivities(),
  watchlists: storage.getWatchlists(),
  collapsed: storage.getCollapsedPanels(),
  positions: [],
  consensus: [],
  previousConsensus: [],
  profiles: [],
  rankings: {},
  similarity: [],
  health: { apiStatus: "Idle", avgLatency: 0, failures: [] },
  quality: { status: "clean", issues: [] },
  selectedWhaleId: "",
  query: "",
  view: "overview",
  refreshing: false,
  lastRefresh: "",
  timer: null,
  formError: "",
  limits: { ...DEFAULT_LIMITS },
  filters: {
    consensusCategory: "all",
    consensusStrength: "all",
    consensusSide: "all",
    activityType: "all",
    positionsCategory: "all",
  },
};

init();

function init() {
  const latest = state.snapshots.at(-1);
  if (latest) {
    state.positions = enrichPositions(latest.positions, state.snapshots);
    recomputeDerived();
  }
  window.addEventListener("hashchange", applyRoute);
  applyRoute();
  render();
  bindGlobalEvents();
  refreshAll({ silent: true });
  scheduleRefresh();
}

function bindGlobalEvents() {
  app.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;

    if (action === "refresh") refreshAll();
    if (action === "remove-whale") removeWhale(target.dataset.id);
    if (action === "profile") navigate("profile", target.dataset.id);
    if (action === "overview") navigate("overview");
    if (action === "history") navigate("history");
    if (action === "watchlists") navigate("watchlists");
    if (action === "settings") navigate("settings");
    if (action === "collapse") togglePanel(target.dataset.panel);
    if (action === "load-more") updateLimit(target.dataset.list, "more");
    if (action === "show-less") updateLimit(target.dataset.list, "less");
    if (action === "reset-layout") resetLayout();
    if (action === "notify") {
      const permission = await requestNotificationPermission();
      state.settings.notificationAlerts = permission === "granted";
      storage.saveSettings(state.settings);
      render();
    }
    if (action === "clear-history") {
      state.snapshots = [];
      state.activities = [];
      storage.saveSnapshots(state.snapshots, state.settings.historyLimit);
      storage.saveActivities(state.activities);
      recomputeDerived();
      render();
    }
    if (action === "delete-watchlist") {
      state.watchlists = state.watchlists.filter((item) => item.id !== target.dataset.id);
      storage.saveWatchlists(state.watchlists);
      render();
    }
  });

  app.addEventListener("change", (event) => {
    const control = event.target.closest("[data-filter]");
    if (!control) return;
    state.filters[control.dataset.filter] = control.value;
    if (control.dataset.filter.startsWith("consensus")) state.limits.consensus = DEFAULT_LIMITS.consensus;
    if (control.dataset.filter === "activityType") state.limits.activity = DEFAULT_LIMITS.activity;
    if (control.dataset.filter === "positionsCategory") state.limits.positions = DEFAULT_LIMITS.positions;
    render();
  });

  app.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.form === "add-whale") addWhale(new FormData(form), form);
    if (form.dataset.form === "settings") saveSettings(new FormData(form));
    if (form.dataset.form === "watchlist") addWatchlist(new FormData(form), form);
  });

  app.addEventListener("input", (event) => {
    if (event.target.matches("[data-search]")) {
      state.query = event.target.value.trim().toLowerCase();
      render();
    }
  });
}

function applyRoute() {
  const [view = "overview", id = ""] = window.location.hash.replace("#", "").split("/");
  state.view = view || "overview";
  state.selectedWhaleId = id;
  render();
}

function navigate(view, id = "") {
  window.location.hash = id ? `${view}/${id}` : view;
}

async function refreshAll({ silent = false } = {}) {
  if (state.refreshing) return;
  if (!state.whales.length) {
    state.positions = [];
    state.consensus = [];
    state.previousConsensus = [];
    state.health = { apiStatus: "No wallets", avgLatency: 0, failures: [], lastSuccessfulRefresh: null };
    state.quality = { status: "clean", issues: [] };
    recomputeDerived();
    render();
    return;
  }
  state.refreshing = true;
  if (!silent) render();

  const previousPositions = state.positions;
  const previousConsensus = state.consensus;
  const fetchResults = await Promise.all(state.whales.map(async (wallet) => ({
    wallet,
    ...(await fetchWhalePositions(wallet, state.settings)),
  })));

  const positions = fetchResults.flatMap((result) => result.positions);
  state.positions = enrichPositions(positions, state.snapshots);
  state.lastRefresh = new Date().toISOString();
  state.health = summarizeHealth(fetchResults, state.lastRefresh);
  state.quality = buildQualityReport(state.positions, fetchResults);

  const changes = detectPositionChanges(previousPositions, state.positions, state.settings);
  state.activities = [...changes, ...state.activities].slice(0, 300);
  state.previousConsensus = previousConsensus;
  recomputeDerived();

  if (state.positions.length) {
    state.snapshots.push({
      timestamp: state.lastRefresh,
      positions: state.positions.map(({ sizeSeries, ...position }) => position),
    });
    storage.saveSnapshots(state.snapshots, state.settings.historyLimit);
  }
  storage.saveActivities(state.activities);
  await dispatchAlerts(changes.map(activityToAlert), state.consensus, previousConsensus, state.settings).catch(() => {});

  state.refreshing = false;
  render();
  scheduleRefresh();
}

function activityToAlert(activity) {
  return {
    ...activity,
    body: `${activity.walletLabel} | ${activity.marketTitle} ${activity.side} | ${currency.format(activity.currentValue)}`,
  };
}

function recomputeDerived() {
  state.profiles = buildProfiles(state.whales, state.positions, state.snapshots);
  state.consensus = addIntelligenceScores(buildConsensus(state.positions, state.whales, state.previousConsensus), state.profiles);
  state.similarity = buildSimilarityMatrix(state.whales, state.positions);
  state.rankings = buildRankings(state.profiles, state.consensus);
}

function scheduleRefresh() {
  clearInterval(state.timer);
  if (!state.settings.autoRefresh) return;
  state.timer = setInterval(() => refreshAll({ silent: true }), state.settings.refreshSeconds * 1000);
}

function addWhale(formData, form) {
  const label = String(formData.get("label") || "").trim();
  const address = String(formData.get("address") || "").trim();
  if (!label || !address) return;
  if (!isValidWalletAddress(address)) {
    state.formError = "Enter a real 0x wallet address. Demo wallets are disabled.";
    render();
    return;
  }
  state.formError = "";
  state.whales.push({ id: crypto.randomUUID(), label, address, notes: String(formData.get("notes") || "").trim() });
  storage.saveWhales(state.whales);
  form.reset();
  recomputeDerived();
  render();
  refreshAll({ silent: true });
}

function removeWhale(id) {
  state.whales = state.whales.filter((whale) => whale.id !== id);
  state.positions = state.positions.filter((position) => position.walletId !== id);
  storage.saveWhales(state.whales);
  recomputeDerived();
  render();
}

function saveSettings(formData) {
  state.settings = {
    ...state.settings,
    refreshSeconds: Number(formData.get("refreshSeconds")) || DEFAULT_SETTINGS.refreshSeconds,
    sizeThreshold: Number(formData.get("sizeThreshold")) || DEFAULT_SETTINGS.sizeThreshold,
    largeIncreaseUsd: Number(formData.get("largeIncreaseUsd")) || DEFAULT_SETTINGS.largeIncreaseUsd,
    autoRefresh: formData.get("autoRefresh") === "on",
    discordWebhookUrl: String(formData.get("discordWebhookUrl") || "").trim(),
    telegramBotToken: String(formData.get("telegramBotToken") || "").trim(),
    telegramChatId: String(formData.get("telegramChatId") || "").trim(),
  };
  storage.saveSettings(state.settings);
  scheduleRefresh();
  render();
}

function addWatchlist(formData, form) {
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const whales = [...form.querySelectorAll("[name='whales']:checked")].map((input) => input.value);
  const markets = String(formData.get("markets") || "").split(",").map((item) => item.trim()).filter(Boolean);
  state.watchlists.push({ id: crypto.randomUUID(), name, whales, markets, group: true });
  storage.saveWatchlists(state.watchlists);
  form.reset();
  render();
}

function togglePanel(panel) {
  state.collapsed[panel] = !state.collapsed[panel];
  storage.saveCollapsedPanels(state.collapsed);
  render();
}

function updateLimit(list, direction) {
  if (!list || !(list in DEFAULT_LIMITS)) return;
  const step = LOAD_STEPS[list] ?? DEFAULT_LIMITS[list];
  state.limits[list] = direction === "more"
    ? state.limits[list] + step
    : DEFAULT_LIMITS[list];
  render();
}

function resetLayout() {
  state.collapsed = {};
  state.limits = { ...DEFAULT_LIMITS };
  state.filters = {
    consensusCategory: "all",
    consensusStrength: "all",
    consensusSide: "all",
    activityType: "all",
    positionsCategory: "all",
  };
  state.query = "";
  storage.saveCollapsedPanels(state.collapsed);
  render();
}

function render() {
  app.innerHTML = `
    ${renderTopbar()}
    <main class="terminal-grid ${state.view !== "overview" ? "single-view" : ""}">
      ${renderSidebar()}
      <section class="workspace">
        ${state.view === "overview" ? renderOverview() : ""}
        ${state.view === "profile" ? renderProfilePage() : ""}
        ${state.view === "history" ? renderHistoryPage() : ""}
        ${state.view === "watchlists" ? renderWatchlistsPage() : ""}
        ${state.view === "settings" ? renderSettingsPage() : ""}
      </section>
    </main>
  `;
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div>
        <p class="eyebrow">POLYMARKET WHALE INTELLIGENCE</p>
        <h1>Smart Trader Activity Terminal</h1>
      </div>
      <div class="topbar-controls">
        <details class="view-menu">
          <summary>Display</summary>
          <div>
            <button data-action="reset-layout">Reset layout</button>
            <span>Lists open with compact limits. Use Load more inside each panel when you need depth.</span>
          </div>
        </details>
        <label class="search">
          <span>Search</span>
          <input data-search value="${escapeHtml(state.query)}" placeholder="market, whale, category" />
        </label>
        <button class="icon-button ${state.refreshing ? "loading" : ""}" data-action="refresh" title="Refresh positions" aria-label="Refresh positions">↻</button>
      </div>
    </header>
  `;
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <nav class="nav-stack">
        ${navButton("overview", "Overview")}
        ${navButton("history", "History")}
        ${navButton("watchlists", "Watchlists")}
        ${navButton("settings", "Alerts")}
      </nav>
      ${panel("whales", "Tracked Whales", `
        <form class="add-whale" data-form="add-whale">
          <input name="label" placeholder="Label" />
          <input name="address" placeholder="0x wallet address" />
          <input name="notes" placeholder="Notes" />
          <button>Add Whale</button>
          ${state.formError ? `<p class="form-error">${escapeHtml(state.formError)}</p>` : ""}
        </form>
        <div class="whale-list">
          ${state.whales.length ? state.whales.map((whale) => `
            <div class="whale-row">
              <button data-action="profile" data-id="${whale.id}" class="link-button">${escapeHtml(whale.label)}</button>
              <button data-action="remove-whale" data-id="${whale.id}" class="ghost-icon" title="Remove whale">×</button>
            </div>
          `).join("") : `<div class="empty compact">No wallets tracked.</div>`}
        </div>
      `)}
      ${panel("health", "Health Monitor", renderHealth())}
    </aside>
  `;
}

function renderOverview() {
  const filtered = filterPositions(state.positions);
  if (!state.whales.length) {
    return `
      <section class="empty-workspace">
        <p class="eyebrow">NO WALLETS TRACKED</p>
        <h2>Add real Polymarket wallet addresses to begin.</h2>
      </section>
    `;
  }
  return `
    <div class="metrics-strip">
      ${metric("Active Value", compactCurrency.format(totalValue(filtered)), `${filtered.length} positions`)}
      ${metric("Consensus Signals", state.consensus.length, "2+ whale overlap")}
      ${metric("Strongest Signal", strongestSignalLabel(), "top whale overlap")}
      ${metric("Feed Health", state.health.apiStatus, `${state.quality.issues.length} data flags`)}
    </div>
    ${renderFocusControls()}
    <div class="dashboard-grid focus-grid">
      ${panel("consensus-board", "Consensus Panel: Who Bet On What", renderConsensusBoard(), "wide priority")}
      ${panel("activity", "Recent Whale Changes", renderActivityFeed())}
      ${panel("quality", "Feed Health", renderQualitySnapshot())}
      ${panel("positions", "Positions Behind The Signals", renderPositionsPanel(filtered), "wide")}
    </div>
    <details class="advanced-intel">
      <summary>Secondary intelligence</summary>
      <div class="dashboard-grid">
        ${panel("score", "Intelligence Score", renderIntelligenceScores())}
        ${panel("similarity", "Whale Similarity", renderSimilarity())}
        ${panel("rankings", "Performance Rankings", renderRankings())}
        ${panel("categories", "Category Exposure", renderCategoryExposure())}
      </div>
    </details>
  `;
}

function renderFocusControls() {
  const categories = uniqueOptions(state.positions.map((position) => position.category));
  return `
    <section class="focus-controls" aria-label="Dashboard filters">
      <label>Consensus category
        <select data-filter="consensusCategory">
          ${selectOption("all", "All categories", state.filters.consensusCategory)}
          ${categories.map((category) => selectOption(category, category, state.filters.consensusCategory)).join("")}
        </select>
      </label>
      <label>Consensus strength
        <select data-filter="consensusStrength">
          ${selectOption("all", "2+ whales", state.filters.consensusStrength)}
          ${[2, 3, 4, 5].map((value) => selectOption(String(value), `${value}+ whales`, state.filters.consensusStrength)).join("")}
        </select>
      </label>
      <label>Consensus side
        <select data-filter="consensusSide">
          ${selectOption("all", "YES and NO", state.filters.consensusSide)}
          ${selectOption("YES", "YES only", state.filters.consensusSide)}
          ${selectOption("NO", "NO only", state.filters.consensusSide)}
          ${selectOption("split", "Split markets", state.filters.consensusSide)}
        </select>
      </label>
      <label>Activity type
        <select data-filter="activityType">
          ${selectOption("all", "All changes", state.filters.activityType)}
          ${selectOption("new-position", "New positions", state.filters.activityType)}
          ${selectOption("flip", "Flips", state.filters.activityType)}
          ${selectOption("increase", "Size increases", state.filters.activityType)}
          ${selectOption("decrease", "Size decreases", state.filters.activityType)}
          ${selectOption("closed", "Exits", state.filters.activityType)}
          ${selectOption("large-increase", "Large increases", state.filters.activityType)}
        </select>
      </label>
    </section>
  `;
}

function renderActivityFeed() {
  const activities = filterActivities(state.activities);
  if (!activities.length) return emptyState("No matching position changes yet. Refreshes will populate new opens, exits, flips, and size changes.");
  const visible = activities.slice(0, state.limits.activity);
  return `
    <div class="result-summary"><span>${visible.length} of ${activities.length} events shown</span></div>
    <div class="activity-feed">
      ${visible.map((event) => `
        <article class="activity-card ${event.type}">
          <div>
            <strong>${event.title}</strong>
            <span>${timeOnly(event.timestamp)}</span>
          </div>
          <p>${escapeHtml(event.walletLabel)}</p>
          <h3>${escapeHtml(event.marketTitle)}</h3>
          ${event.detail?.previous ? `<div class="flip-line">${escapeHtml(event.detail.previous.outcome)} <span>↓</span> ${escapeHtml(event.outcome)}</div>` : `<div class="position-line">${escapeHtml(event.outcome)} <b>${currency.format(event.currentValue)}</b></div>`}
        </article>
      `).join("")}
    </div>
    ${renderListControls("activity", activities.length, "events")}
  `;
}

function renderIntelligenceScores() {
  if (!state.consensus.length) return emptyState("No consensus score yet. Track at least two whales with overlapping positions.");
  return `
    <div class="score-list">
      ${state.consensus.slice(0, 8).map((item) => `
        <button class="score-row" title="${escapeHtml(item.marketTitle)}">
          <span>${escapeHtml(item.marketTitle)}</span>
          <b>${item.side}</b>
          <meter min="0" max="100" value="${item.intelligenceScore}"></meter>
          <strong>${item.intelligenceScore}</strong>
        </button>
      `).join("")}
    </div>
  `;
}

function renderConsensusTable() {
  if (!state.consensus.length) return emptyState("Consensus positions appear here at 2/5, 3/5, 4/5, and 5/5 strength.");
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Market</th><th>Outcome</th><th>Whales</th><th>Combined Value</th><th>Consensus</th><th>Score</th></tr></thead>
        <tbody>
          ${state.consensus.map((item) => `
            <tr class="${item.movement}">
              <td>${escapeHtml(item.marketTitle)} ${movementBadge(item.movement)}</td>
              <td><span class="pill ${item.side.toLowerCase()}">${item.side}</span></td>
              <td>${item.whales.map(escapeHtml).join(", ")}</td>
              <td>${currency.format(item.combinedValue)}</td>
              <td>${item.consensusLabel}</td>
              <td><strong>${item.intelligenceScore}</strong></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderConsensusBoard() {
  const markets = filterConsensusMarkets(buildConsensusMarkets());
  if (!markets.length) {
    return emptyState("No consensus matches the selected filters. Once multiple tracked whales hold the same market side, this panel will show YES/NO groups and each whale's position size.");
  }
  const visible = markets.slice(0, state.limits.consensus);

  return `
    <div class="result-summary">
      <span>${visible.length} of ${markets.length} consensus markets shown</span>
      <b>${markets.filter((market) => market.sides.YES.length && market.sides.NO.length).length} split markets</b>
    </div>
    <div class="consensus-board">
      ${visible.map((market, index) => `
        <details class="consensus-card ${market.movement}" ${index === 0 ? "open" : ""}>
          <summary class="consensus-card-head">
            <div>
              <h3>${escapeHtml(market.marketTitle)}</h3>
              <p>${escapeHtml(market.category)} · ${market.topCount}/${state.whales.length || 1} whales aligned · ${currency.format(market.topValue)} on ${market.topSide}</p>
            </div>
            <div class="signal-score">
              <span>Score</span>
              <b>${market.intelligenceScore}</b>
            </div>
          </summary>
          <div class="side-columns">
            ${renderConsensusSide("YES", market.sides.YES)}
            ${renderConsensusSide("NO", market.sides.NO)}
          </div>
          ${market.sides.YES.length && market.sides.NO.length ? `<div class="split-warning">Split market: whales are on both sides.</div>` : ""}
        </details>
      `).join("")}
    </div>
    ${renderListControls("consensus", markets.length, "markets")}
  `;
}

function renderConsensusSide(side, positions) {
  const value = totalValue(positions);
  const visible = positions.slice(0, 5);
  const hidden = positions.slice(5);
  return `
    <section class="consensus-side ${side.toLowerCase()} ${positions.length ? "" : "empty-side"}">
      <div class="side-head">
        <strong>${side}</strong>
        <span>${positions.length} whales · ${currency.format(value)}</span>
      </div>
      <div class="whale-bets">
        ${visible.length ? visible.map((position) => `
          <button class="whale-bet" data-action="profile" data-id="${position.walletId}" title="${escapeHtml(position.walletLabel)} position">
            <span>${escapeHtml(position.walletLabel)}</span>
            <b>${compactCurrency.format(position.currentValue)}</b>
          </button>
        `).join("") : `<em>No tracked whales</em>`}
        ${hidden.length ? `
          <details class="side-more">
            <summary>${hidden.length} more whales</summary>
            ${hidden.map((position) => `
              <button class="whale-bet" data-action="profile" data-id="${position.walletId}" title="${escapeHtml(position.walletLabel)} position">
                <span>${escapeHtml(position.walletLabel)}</span>
                <b>${compactCurrency.format(position.currentValue)}</b>
              </button>
            `).join("")}
          </details>
        ` : ""}
      </div>
    </section>
  `;
}

function buildConsensusMarkets() {
  const consensusByMarket = new Map();
  state.consensus.forEach((item) => {
    const existing = consensusByMarket.get(item.conditionId);
    if (!existing || item.intelligenceScore > existing.intelligenceScore) {
      consensusByMarket.set(item.conditionId, item);
    }
  });

  const groups = new Map();
  filterPositions(state.positions).forEach((position) => {
    const group = groups.get(position.conditionId) ?? {
      conditionId: position.conditionId,
      marketTitle: position.marketTitle,
      category: position.category,
      sides: { YES: [], NO: [] },
      intelligenceScore: 0,
      movement: "stable",
      topSide: "YES",
      topCount: 0,
      topValue: 0,
    };
    group.sides[position.side === "NO" ? "NO" : "YES"].push(position);
    groups.set(position.conditionId, group);
  });

  return [...groups.values()]
    .map((group) => {
      group.sides.YES.sort((a, b) => b.currentValue - a.currentValue);
      group.sides.NO.sort((a, b) => b.currentValue - a.currentValue);
      const yesValue = totalValue(group.sides.YES);
      const noValue = totalValue(group.sides.NO);
      const yesCount = group.sides.YES.length;
      const noCount = group.sides.NO.length;
      const topSide = yesCount > noCount || (yesCount === noCount && yesValue >= noValue) ? "YES" : "NO";
      const topPositions = group.sides[topSide];
      const consensus = consensusByMarket.get(group.conditionId);
      return {
        ...group,
        topSide,
        topCount: topPositions.length,
        topValue: totalValue(topPositions),
        intelligenceScore: consensus?.intelligenceScore ?? 0,
        movement: consensus?.movement ?? "stable",
      };
    })
    .filter((group) => group.topCount >= 2)
    .sort((a, b) => b.topCount - a.topCount || b.intelligenceScore - a.intelligenceScore || b.topValue - a.topValue);
}

function filterConsensusMarkets(markets) {
  return markets.filter((market) => {
    const strength = Number(state.filters.consensusStrength);
    const categoryMatches = state.filters.consensusCategory === "all" || market.category === state.filters.consensusCategory;
    const strengthMatches = state.filters.consensusStrength === "all" || market.topCount >= strength;
    const sideMatches = state.filters.consensusSide === "all"
      || market.topSide === state.filters.consensusSide
      || (state.filters.consensusSide === "split" && market.sides.YES.length && market.sides.NO.length);
    return categoryMatches && strengthMatches && sideMatches;
  });
}

function renderPositionsPanel(positions) {
  const categories = uniqueOptions(positions.map((position) => position.category));
  const scoped = state.filters.positionsCategory === "all"
    ? positions
    : positions.filter((position) => position.category === state.filters.positionsCategory);
  return `
    <div class="panel-toolbar">
      <div class="result-summary">
        <span>${Math.min(scoped.length, state.limits.positions)} of ${scoped.length} positions shown</span>
        <b>${compactCurrency.format(totalValue(scoped))} tracked</b>
      </div>
      <label>Category
        <select data-filter="positionsCategory">
          ${selectOption("all", "All categories", state.filters.positionsCategory)}
          ${categories.map((category) => selectOption(category, category, state.filters.positionsCategory)).join("")}
        </select>
      </label>
    </div>
    ${renderPositionsTable(scoped)}
  `;
}

function renderPositionsTable(positions, limitKey = "positions") {
  if (!positions.length) return emptyState("No active positions match the current search.");
  const sorted = [...positions].sort((a, b) => b.currentValue - a.currentValue);
  const visible = sorted.slice(0, state.limits[limitKey] ?? DEFAULT_LIMITS.positions);
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Whale</th><th>Market</th><th>Outcome</th><th>Value</th><th>PnL</th><th>Category</th><th>Duration</th></tr></thead>
        <tbody>
          ${visible.map((position) => `
            <tr>
              <td><button class="link-button" data-action="profile" data-id="${position.walletId}">${escapeHtml(position.walletLabel)}</button></td>
              <td>${escapeHtml(position.marketTitle)}</td>
              <td><span class="pill ${position.side.toLowerCase()}">${escapeHtml(position.outcome)}</span></td>
              <td>${currency.format(position.currentValue)}</td>
              <td class="${(position.cashPnl + position.realizedPnl) >= 0 ? "positive" : "negative"}">${currency.format(position.cashPnl + position.realizedPnl)}</td>
              <td>${position.category}</td>
              <td>${formatDuration(position.firstSeen)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    ${renderListControls(limitKey, sorted.length, "positions")}
  `;
}

function renderSimilarity() {
  if (state.whales.length < 2) return emptyState("Add at least two whales to calculate overlap.");
  return `
    <div class="similarity-grid" style="--count:${state.whales.length + 1}">
      <span></span>
      ${state.whales.map((whale) => `<b>${escapeHtml(shortLabel(whale.label))}</b>`).join("")}
      ${state.whales.map((left, row) => `
        <b>${escapeHtml(shortLabel(left.label))}</b>
        ${state.whales.map((_, col) => `<span class="heat" style="--heat:${state.similarity[row]?.[col] ?? 0}">${state.similarity[row]?.[col] ?? 0}%</span>`).join("")}
      `).join("")}
    </div>
  `;
}

function renderRankings() {
  const blocks = [
    ["Best Win Rate", state.rankings.winRate, "winRate", "%"],
    ["Highest PnL", state.rankings.pnl, "totalRealizedPnl", ""],
    ["Largest Avg Position", state.rankings.averageSize, "averagePositionSize", ""],
    ["Consensus Trader", state.rankings.consensusAccuracy, "winRate", "%"],
  ];
  return `
    <div class="ranking-grid">
      ${blocks.map(([title, rows, key, suffix]) => `
        <section>
          <h3>${title}</h3>
          ${(rows ?? []).slice(0, 5).map((profile, index) => `
            <button data-action="profile" data-id="${profile.id}" class="ranking-row">
              <span>${index + 1}</span><b>${escapeHtml(profile.label)}</b><em>${suffix ? `${profile[key]}${suffix}` : currency.format(profile[key])}</em>
            </button>
          `).join("")}
        </section>
      `).join("")}
    </div>
  `;
}

function renderQuality() {
  if (!state.quality.issues.length) return `<div class="quality-ok">Clean feed. No duplicates, missing core fields, or failed wallet refreshes detected.</div>`;
  return `
    <div class="quality-list">
      ${state.quality.issues.slice(0, 8).map((issue) => `<div class="${issue.level}">${escapeHtml(issue.message)}</div>`).join("")}
    </div>
  `;
}

function renderQualitySnapshot() {
  return `
    <div class="health-snapshot">
      <div><span>API</span><b class="${state.health.apiStatus === "Operational" ? "positive" : "negative"}">${state.health.apiStatus}</b></div>
      <div><span>Latency</span><b>${state.health.avgLatency || 0}ms</b></div>
      <div><span>Failures</span><b>${state.health.failures.length}</b></div>
      <div><span>Data Flags</span><b>${state.quality.issues.length}</b></div>
    </div>
    ${state.quality.issues.length ? renderQuality() : ""}
  `;
}

function renderCategoryExposure() {
  const totals = state.positions.reduce((map, position) => {
    map[position.category] = (map[position.category] ?? 0) + position.currentValue;
    return map;
  }, {});
  const max = Math.max(...Object.values(totals), 1);
  return `
    <div class="category-bars">
      ${Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([category, value]) => `
        <div>
          <span>${category}</span><b>${compactCurrency.format(value)}</b>
          <i style="width:${Math.max(4, (value / max) * 100)}%"></i>
        </div>
      `).join("") || emptyState("Category exposure appears after positions load.")}
    </div>
  `;
}

function renderProfilePage() {
  const profile = state.profiles.find((item) => item.id === state.selectedWhaleId) ?? state.profiles[0];
  if (!profile) return emptyState("No whale profile is available.");
  const overlap = state.whales.map((whale, index) => ({
    whale,
    value: state.similarity[state.whales.findIndex((item) => item.id === profile.id)]?.[index] ?? 0,
  })).filter((item) => item.whale.id !== profile.id).sort((a, b) => b.value - a.value);

  return `
    <button class="back-button" data-action="overview">← Overview</button>
    <section class="profile-hero">
      <div>
        <p class="eyebrow">WHALE PROFILE</p>
        <h2>${escapeHtml(profile.label)}</h2>
        <span>${escapeHtml(profile.address)}</span>
      </div>
      <div class="profile-stats">
        ${metric("Win Rate", `${profile.winRate}%`, "realized/open PnL proxy")}
        ${metric("Realized PnL", currency.format(profile.totalRealizedPnl), "snapshot-derived")}
        ${metric("Average Size", currency.format(profile.averagePositionSize), "active positions")}
        ${metric("Largest Position", currency.format(profile.largestPosition), profile.favoriteMarketCategory)}
      </div>
    </section>
    <div class="dashboard-grid">
      ${panel("profile-active", "Active Positions", renderPositionsTable(profile.activePositions, "profilePositions"), "wide")}
      ${panel("profile-closed", "Closed Positions", renderClosedPositions(profile.closedPositions))}
      ${panel("profile-overlap", "Consensus Overlap", `
        <div class="overlap-list">
          ${overlap.map((item) => `<div><span>${escapeHtml(profile.label)} ↔ ${escapeHtml(item.whale.label)}</span><b>${item.value}%</b></div>`).join("")}
        </div>
      `)}
      ${panel("profile-category", "Favorite Market Category", renderProfileCategory(profile))}
    </div>
  `;
}

function renderClosedPositions(positions) {
  if (!positions.length) return emptyState("Closed positions are inferred after a position disappears from later snapshots.");
  const visible = positions.slice(0, state.limits.closed);
  return `
    <div class="closed-list">
      ${visible.map((position) => `
        <div><strong>${escapeHtml(position.marketTitle)}</strong><span>${position.side} · last seen ${timeOnly(position.lastSeen)}</span></div>
      `).join("")}
    </div>
    ${renderListControls("closed", positions.length, "closed positions")}
  `;
}

function renderProfileCategory(profile) {
  const entries = Object.entries(profile.categoryExposure);
  if (!entries.length) return emptyState("No active category exposure.");
  const max = Math.max(...entries.map(([, value]) => value), 1);
  return `
    <div class="category-bars">
      ${entries.sort((a, b) => b[1] - a[1]).map(([category, value]) => `
        <div><span>${category}</span><b>${compactCurrency.format(value)}</b><i style="width:${(value / max) * 100}%"></i></div>
      `).join("")}
    </div>
  `;
}

function renderHistoryPage() {
  return `
    <div class="page-heading">
      <div><p class="eyebrow">POSITION HISTORY</p><h2>Snapshot Review</h2></div>
      <button class="danger" data-action="clear-history">Clear History</button>
    </div>
    ${panel("history-table", "Snapshots", `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Timestamp</th><th>Positions</th><th>Tracked Value</th><th>Largest Position</th></tr></thead>
          <tbody>
            ${state.snapshots.slice().reverse().slice(0, state.limits.history).map((snapshot) => {
              const largest = snapshot.positions.reduce((max, position) => position.currentValue > (max?.currentValue ?? 0) ? position : max, null);
              return `<tr><td>${new Date(snapshot.timestamp).toLocaleString()}</td><td>${snapshot.positions.length}</td><td>${currency.format(totalValue(snapshot.positions))}</td><td>${largest ? `${escapeHtml(largest.walletLabel)} · ${escapeHtml(largest.marketTitle)} · ${currency.format(largest.currentValue)}` : "none"}</td></tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      ${renderListControls("history", state.snapshots.length, "snapshots")}
    `, "wide")}
  `;
}

function renderWatchlistsPage() {
  return `
    <div class="page-heading"><div><p class="eyebrow">WATCHLISTS</p><h2>Markets, Whales, and Groups</h2></div></div>
    <div class="dashboard-grid">
      ${panel("watchlist-create", "Create Watchlist", `
        <form data-form="watchlist" class="settings-form">
          <label>Name<input name="name" placeholder="Politics Group" /></label>
          <label>Markets<input name="markets" placeholder="market-slug, condition-id" /></label>
          <fieldset>
            <legend>Whales</legend>
            ${state.whales.map((whale) => `<label class="check"><input type="checkbox" name="whales" value="${whale.id}" /> ${escapeHtml(whale.label)}</label>`).join("")}
          </fieldset>
          <button>Save Watchlist</button>
        </form>
      `)}
      ${panel("watchlist-list", "Saved Watchlists", `
        <div class="watchlist-grid">
          ${state.watchlists.map((watchlist) => `
            <article class="watchlist-card">
              <div><strong>${escapeHtml(watchlist.name)}</strong><button data-action="delete-watchlist" data-id="${watchlist.id}" class="ghost-icon">×</button></div>
              <p>${watchlist.whales.length} whales · ${watchlist.markets.length} markets</p>
              <span>${watchlist.whales.map((id) => state.whales.find((whale) => whale.id === id)?.label).filter(Boolean).map(escapeHtml).join(", ") || "No whales selected"}</span>
            </article>
          `).join("")}
        </div>
      `, "wide")}
    </div>
  `;
}

function renderSettingsPage() {
  return `
    <div class="page-heading"><div><p class="eyebrow">ALERT SYSTEM</p><h2>Notifications and Integrations</h2></div></div>
    <div class="dashboard-grid">
      ${panel("alert-settings", "Alert Settings", `
        <form data-form="settings" class="settings-form">
          <label>Refresh seconds<input type="number" name="refreshSeconds" min="15" value="${state.settings.refreshSeconds}" /></label>
          <label>Minimum size threshold<input type="number" name="sizeThreshold" min="0" value="${state.settings.sizeThreshold}" /></label>
          <label>Large increase alert<input type="number" name="largeIncreaseUsd" min="1000" value="${state.settings.largeIncreaseUsd}" /></label>
          <label>Discord webhook<input name="discordWebhookUrl" value="${escapeHtml(state.settings.discordWebhookUrl)}" placeholder="https://discord.com/api/webhooks/..." /></label>
          <label>Telegram bot token<input name="telegramBotToken" value="${escapeHtml(state.settings.telegramBotToken)}" /></label>
          <label>Telegram chat id<input name="telegramChatId" value="${escapeHtml(state.settings.telegramChatId)}" /></label>
          <label class="check"><input type="checkbox" name="autoRefresh" ${state.settings.autoRefresh ? "checked" : ""} /> Auto refresh</label>
          <button>Save Settings</button>
        </form>
      `)}
      ${panel("alert-types", "Alert Conditions", `
        <div class="alert-conditions">
          ${["New position", "New 4/5 consensus", "New 5/5 consensus", "Whale position flip", "Whale exits position", "Large size increase"].map((item) => `<span>${item}</span>`).join("")}
        </div>
        <button data-action="notify">${state.settings.notificationAlerts ? "Browser Notifications Enabled" : "Enable Browser Notifications"}</button>
      `)}
    </div>
  `;
}

function renderHealth() {
  return `
    <div class="health">
      <div><span>API Status</span><b class="${state.health.apiStatus === "Operational" ? "positive" : "negative"}">${state.health.apiStatus}</b></div>
      <div><span>Last Success</span><b>${state.health.lastSuccessfulRefresh ? timeOnly(state.health.lastSuccessfulRefresh) : "none"}</b></div>
      <div><span>Wallet Failures</span><b>${state.health.failures.length}</b></div>
      <div><span>Latency</span><b>${state.health.avgLatency || 0}ms</b></div>
    </div>
  `;
}

function panel(id, title, body, size = "") {
  const collapsed = state.collapsed[id];
  return `
    <section class="panel ${size} ${collapsed ? "collapsed" : ""}">
      <header>
        <h2>${title}</h2>
        <button data-action="collapse" data-panel="${id}" title="Collapse panel">${collapsed ? "+" : "−"}</button>
      </header>
      <div class="panel-body">${collapsed ? "" : body}</div>
    </section>
  `;
}

function metric(label, value, sublabel) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong><em>${sublabel}</em></article>`;
}

function navButton(view, label) {
  return `<button data-action="${view}" class="${state.view === view ? "active" : ""}">${label}</button>`;
}

function movementBadge(movement) {
  if (movement === "stable") return "";
  return `<span class="movement ${movement}">${movement}</span>`;
}

function renderListControls(list, total, label) {
  const limit = state.limits[list] ?? total;
  if (total <= (DEFAULT_LIMITS[list] ?? total)) {
    return total ? `<div class="list-count">Showing ${total} ${label}</div>` : "";
  }
  const showing = Math.min(limit, total);
  return `
    <div class="list-controls">
      <span>Showing ${showing} of ${total} ${label}</span>
      <div>
        ${showing < total ? `<button data-action="load-more" data-list="${list}">Load more</button>` : ""}
        ${showing > (DEFAULT_LIMITS[list] ?? 0) ? `<button data-action="show-less" data-list="${list}" class="secondary">Show less</button>` : ""}
      </div>
    </div>
  `;
}

function filterPositions(positions) {
  if (!state.query) return positions;
  return positions.filter((position) => [
    position.walletLabel,
    position.marketTitle,
    position.outcome,
    position.category,
  ].some((value) => String(value).toLowerCase().includes(state.query)));
}

function filterActivities(activities) {
  if (state.filters.activityType === "all") return activities;
  return activities.filter((activity) => activity.type === state.filters.activityType);
}

function uniqueOptions(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function selectOption(value, label, selectedValue) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(selectedValue) ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function totalValue(positions) {
  return positions.reduce((sum, position) => sum + position.currentValue, 0);
}

function strongestSignalLabel() {
  const strongest = state.consensus[0];
  if (!strongest) return "None";
  return `${strongest.consensusLabel} ${strongest.side}`;
}

function timeOnly(value) {
  return value ? new Date(value).toLocaleTimeString() : "none";
}

function shortLabel(label) {
  return label.length > 9 ? `${label.slice(0, 8)}…` : label;
}

function emptyState(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function isValidWalletAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}
