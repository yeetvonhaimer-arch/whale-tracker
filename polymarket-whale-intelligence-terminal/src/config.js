export const STORAGE_KEYS = {
  whales: "pmwi.whales",
  snapshots: "pmwi.snapshots",
  activities: "pmwi.activities",
  settings: "pmwi.settings",
  watchlists: "pmwi.watchlists",
  collapsed: "pmwi.collapsedPanels",
};

export const DEFAULT_SETTINGS = {
  refreshSeconds: 60,
  autoRefresh: true,
  sizeThreshold: 1,
  apiBaseUrl: "https://data-api.polymarket.com",
  historyLimit: 1200,
  notificationAlerts: false,
  discordWebhookUrl: "",
  telegramBotToken: "",
  telegramChatId: "",
  largeIncreaseUsd: 50000,
};

export const DEFAULT_WHALES = [
  {
    id: "leaderboard-latina",
    label: "Latina",
    address: "0x26437896ed9dfeb2f69765edcafe8fdceaab39ae",
    notes: "Polymarket leaderboard profile, 217 trades checked Jun 20 2026",
  },
  {
    id: "leaderboard-afghj2421",
    label: "afghj2421",
    address: "0xb91aeb5accc33a5f9a8615b8ed6b2d352e913987",
    notes: "Polymarket leaderboard profile, 138 trades checked Jun 20 2026",
  },
  {
    id: "leaderboard-0x5966",
    label: "0x5966...804",
    address: "0x5966db1fe50763c9e3c014d756369bad07e1f804",
    notes: "Polymarket leaderboard profile, 174 trades checked Jun 20 2026",
  },
  {
    id: "leaderboard-wan123",
    label: "wan123",
    address: "0xde7be6d489bce070a959e0cb813128ae659b5f4b",
    notes: "Polymarket leaderboard profile, 375 trades checked Jun 20 2026",
  },
  {
    id: "leaderboard-breakthebank",
    label: "BreakTheBank",
    address: "0xf0318c32136c2db7fec88b84869aee6a1106c80c",
    notes: "Polymarket leaderboard profile, 182 trades checked Jun 20 2026",
  },
  {
    id: "leaderboard-denizz",
    label: "denizz",
    address: "0xbaa2bcb5439e985ce4ccf815b4700027d1b92c73",
    notes: "Polymarket leaderboard profile, 929 trades checked Jun 20 2026",
  },
];

export const CATEGORY_RULES = [
  ["Soccer", ["world cup", "uefa", "fifa", "soccer", "premier league", "champions league", "la liga", "argentina", "brazil", "france", "england"]],
  ["MLB", ["mlb", "baseball", "yankees", "mets", "dodgers", "red sox", "cubs", "phillies", "astros"]],
  ["NBA", ["nba", "basketball", "lakers", "celtics", "knicks", "warriors", "mavericks", "nuggets", "finals"]],
  ["Politics", ["election", "president", "senate", "congress", "trump", "biden", "poll", "mayor", "governor", "politics"]],
  ["Crypto", ["bitcoin", "btc", "ethereum", "eth", "solana", "crypto", "coinbase", "binance", "stablecoin"]],
  ["Economics", ["fed", "inflation", "cpi", "rates", "recession", "gdp", "jobs", "unemployment", "tariff", "economy"]],
];
