import { DEFAULT_SETTINGS, DEFAULT_WHALES, STORAGE_KEYS } from "./config.js";

const parseJson = (raw, fallback) => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

export const storage = {
  getWhales() {
    const raw = localStorage.getItem(STORAGE_KEYS.whales);
    const whales = parseJson(raw, DEFAULT_WHALES);
    const realWhales = Array.isArray(whales) ? whales.filter(isRealWallet) : [];
    if (realWhales.length !== whales.length) writeJson(STORAGE_KEYS.whales, realWhales);
    if (!realWhales.length) {
      writeJson(STORAGE_KEYS.whales, DEFAULT_WHALES);
      return DEFAULT_WHALES;
    }
    return raw ? realWhales : DEFAULT_WHALES;
  },

  saveWhales(whales) {
    writeJson(STORAGE_KEYS.whales, whales);
  },

  getSettings() {
    return { ...DEFAULT_SETTINGS, ...parseJson(localStorage.getItem(STORAGE_KEYS.settings), {}) };
  },

  saveSettings(settings) {
    writeJson(STORAGE_KEYS.settings, { ...this.getSettings(), ...settings });
  },

  getSnapshots() {
    const snapshots = parseJson(localStorage.getItem(STORAGE_KEYS.snapshots), []);
    if (!Array.isArray(snapshots)) return [];
    const filtered = snapshots
      .map((snapshot) => ({
        ...snapshot,
        positions: Array.isArray(snapshot.positions) ? snapshot.positions.filter(isRealPosition) : [],
      }))
      .filter((snapshot) => snapshot.positions.length);
    if (filtered.length !== snapshots.length || filtered.some((snapshot, index) => snapshot.positions.length !== snapshots[index]?.positions?.length)) {
      writeJson(STORAGE_KEYS.snapshots, filtered);
    }
    return filtered;
  },

  saveSnapshots(snapshots, limit = DEFAULT_SETTINGS.historyLimit) {
    writeJson(STORAGE_KEYS.snapshots, snapshots.slice(-limit));
  },

  getActivities() {
    const activities = parseJson(localStorage.getItem(STORAGE_KEYS.activities), []);
    const filtered = Array.isArray(activities) ? activities.filter(isRealActivity) : [];
    if (filtered.length !== activities.length) writeJson(STORAGE_KEYS.activities, filtered);
    return filtered;
  },

  saveActivities(activities) {
    writeJson(STORAGE_KEYS.activities, activities.slice(0, 300));
  },

  getWatchlists() {
    const watchlists = parseJson(localStorage.getItem(STORAGE_KEYS.watchlists), null);
    if (!Array.isArray(watchlists)) {
      writeJson(STORAGE_KEYS.watchlists, []);
      return [];
    }
    const filtered = watchlists
      .map((watchlist) => ({
        ...watchlist,
        whales: Array.isArray(watchlist.whales) ? watchlist.whales.filter((id) => !String(id).startsWith("demo-")) : [],
        markets: Array.isArray(watchlist.markets) ? watchlist.markets.filter((id) => !["argentina-final", "fed-cut-july", "btc-150k", "yankees-division", "senate-control", "nba-finals"].includes(id)) : [],
      }))
      .filter((watchlist) => watchlist.whales.length || watchlist.markets.length);
    if (filtered.length !== watchlists.length) writeJson(STORAGE_KEYS.watchlists, filtered);
    return filtered;
  },

  saveWatchlists(watchlists) {
    writeJson(STORAGE_KEYS.watchlists, watchlists);
  },

  getCollapsedPanels() {
    return parseJson(localStorage.getItem(STORAGE_KEYS.collapsed), {});
  },

  saveCollapsedPanels(collapsed) {
    writeJson(STORAGE_KEYS.collapsed, collapsed);
  },
};

function isRealWallet(wallet) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(wallet?.address ?? "")) && !String(wallet?.id ?? "").startsWith("demo-");
}

function isRealPosition(position) {
  return !String(position?.walletId ?? "").startsWith("demo-")
    && !String(position?.walletAddress ?? "").startsWith("demo:")
    && position?.raw?.demo !== true;
}

function isRealActivity(activity) {
  return !String(activity?.walletId ?? "").startsWith("demo-");
}
