import { CATEGORY_RULES } from "./config.js";

export const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function positionKey(position) {
  return `${position.walletId}::${position.conditionId}`;
}

export function outcomeKey(position) {
  return `${position.conditionId}::${position.side}`;
}

export function classifyMarket(title) {
  const text = String(title).toLowerCase();
  const match = CATEGORY_RULES.find(([, terms]) => terms.some((term) => text.includes(term)));
  return match ? match[0] : "Miscellaneous";
}

export function enrichPositions(positions, previousSnapshots = []) {
  const firstSeenByKey = new Map();
  const lastSeenByKey = new Map();
  const sizeSeriesByKey = new Map();

  previousSnapshots.forEach((snapshot) => {
    snapshot.positions.forEach((position) => {
      const key = positionKey(position);
      if (!firstSeenByKey.has(key) || snapshot.timestamp < firstSeenByKey.get(key)) {
        firstSeenByKey.set(key, snapshot.timestamp);
      }
      if (!lastSeenByKey.has(key) || snapshot.timestamp > lastSeenByKey.get(key)) {
        lastSeenByKey.set(key, snapshot.timestamp);
      }
      const series = sizeSeriesByKey.get(key) ?? [];
      series.push({ timestamp: snapshot.timestamp, value: position.currentValue });
      sizeSeriesByKey.set(key, series);
    });
  });

  const now = new Date().toISOString();
  return positions.map((position) => {
    const key = positionKey(position);
    return {
      ...position,
      category: position.category || classifyMarket(position.marketTitle),
      firstSeen: firstSeenByKey.get(key) ?? now,
      lastSeen: now,
      sizeSeries: [...(sizeSeriesByKey.get(key) ?? []), { timestamp: now, value: position.currentValue }],
    };
  });
}

export function detectPositionChanges(previousPositions, currentPositions, settings) {
  const previousByKey = new Map(previousPositions.map((position) => [positionKey(position), position]));
  const currentByKey = new Map(currentPositions.map((position) => [positionKey(position), position]));
  const previousByWalletOutcome = new Map(previousPositions.map((position) => [`${position.walletId}::${outcomeKey(position)}`, position]));
  const currentByWalletCondition = new Map(currentPositions.map((position) => [`${position.walletId}::${position.conditionId}`, position]));
  const now = new Date().toISOString();
  const events = [];

  currentPositions.forEach((current) => {
    const previous = previousByKey.get(positionKey(current));
    const reverseSide = current.side === "YES" ? "NO" : "YES";
    const flipFrom = previousByWalletOutcome.get(`${current.walletId}::${current.conditionId}::${reverseSide}`);

    if (!previous && flipFrom && flipFrom.walletId === current.walletId) {
      events.push(buildEvent("flip", "POSITION FLIP DETECTED", current, now, { previous: flipFrom }));
      return;
    }

    if (!previous) {
      events.push(buildEvent("new-position", "NEW POSITION DETECTED", current, now));
      return;
    }

    const delta = current.currentValue - previous.currentValue;
    const absDelta = Math.abs(delta);
    const material = absDelta >= Math.max(1000, previous.currentValue * 0.08);
    if (delta > 0 && material) {
      events.push(buildEvent("increase", "POSITION SIZE INCREASE", current, now, { delta }));
    }
    if (delta < 0 && material) {
      events.push(buildEvent("decrease", "POSITION SIZE DECREASE", current, now, { delta }));
    }
    if (delta >= settings.largeIncreaseUsd) {
      events.push(buildEvent("large-increase", "LARGE SIZE INCREASE", current, now, { delta }));
    }
  });

  previousPositions.forEach((previous) => {
    if (!currentByKey.has(positionKey(previous)) && !currentByWalletCondition.has(`${previous.walletId}::${previous.conditionId}`)) {
      events.push(buildEvent("closed", "WHALE EXITED POSITION", previous, now));
    }
  });

  return events;
}

function buildEvent(type, title, position, timestamp, detail = {}) {
  return {
    id: `${type}:${position.walletId}:${position.conditionId}:${timestamp}`,
    type,
    title,
    timestamp,
    walletId: position.walletId,
    walletLabel: position.walletLabel,
    marketTitle: position.marketTitle,
    conditionId: position.conditionId,
    outcome: position.outcome,
    side: position.side,
    currentValue: position.currentValue,
    detail,
  };
}

export function buildConsensus(positions, whales, previousConsensus = []) {
  const whaleCount = whales.length || 1;
  const previousByKey = new Map(previousConsensus.map((item) => [`${item.conditionId}::${item.side}`, item]));
  const groups = new Map();

  positions.forEach((position) => {
    const key = outcomeKey(position);
    const existing = groups.get(key) ?? {
      conditionId: position.conditionId,
      marketTitle: position.marketTitle,
      outcome: position.outcome,
      side: position.side,
      category: position.category,
      whales: [],
      combinedValue: 0,
      score: 0,
      intelligenceScore: 0,
      movement: "stable",
    };
    existing.whales.push(position.walletLabel);
    existing.combinedValue += position.currentValue;
    groups.set(key, existing);
  });

  return [...groups.values()]
    .map((item) => {
      const previous = previousByKey.get(`${item.conditionId}::${item.side}`);
      const participants = new Set(item.whales).size;
      const score = participants;
      const movement = !previous ? "new" : score > previous.score ? "up" : score < previous.score ? "down" : "stable";
      return {
        ...item,
        whales: [...new Set(item.whales)],
        score,
        denominator: whaleCount,
        consensusLabel: `${score}/${whaleCount}`,
        movement,
      };
    })
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score || b.combinedValue - a.combinedValue);
}

export function addIntelligenceScores(consensus, profiles) {
  const accuracyByLabel = new Map(profiles.map((profile) => [profile.label, profile.winRate || 50]));
  const maxValue = Math.max(...consensus.map((item) => item.combinedValue), 1);
  return consensus.map((item) => {
    const whaleFactor = Math.min(40, item.score * 10);
    const accuracyFactor = item.whales.reduce((sum, label) => sum + (accuracyByLabel.get(label) ?? 50), 0) / Math.max(1, item.whales.length) * 0.25;
    const sizeFactor = Math.min(25, (item.combinedValue / maxValue) * 25);
    const recencyFactor = item.movement === "new" || item.movement === "up" ? 10 : 6;
    return {
      ...item,
      intelligenceScore: Math.round(Math.min(100, whaleFactor + accuracyFactor + sizeFactor + recencyFactor)),
    };
  }).sort((a, b) => b.intelligenceScore - a.intelligenceScore);
}

export function buildProfiles(whales, positions, snapshots) {
  return whales.map((whale) => {
    const active = positions.filter((position) => position.walletId === whale.id);
    const historical = snapshots.flatMap((snapshot) => snapshot.positions.filter((position) => position.walletId === whale.id));
    const closed = inferClosedPositions(whale.id, snapshots, positions);
    const all = active.length ? active : historical;
    const wins = all.filter((position) => (position.realizedPnl || position.cashPnl) > 0).length;
    const pnl = all.reduce((sum, position) => sum + (position.realizedPnl || position.cashPnl || 0), 0);
    const avg = active.reduce((sum, position) => sum + position.currentValue, 0) / Math.max(1, active.length);
    const largest = active.reduce((max, position) => Math.max(max, position.currentValue), 0);
    const categoryExposure = active.reduce((map, position) => {
      map[position.category] = (map[position.category] ?? 0) + position.currentValue;
      return map;
    }, {});
    const favoriteMarketCategory = Object.entries(categoryExposure).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "No active exposure";

    return {
      ...whale,
      activePositions: active,
      closedPositions: closed,
      winRate: all.length ? Math.round((wins / all.length) * 100) : 0,
      totalRealizedPnl: Math.round(pnl),
      averagePositionSize: Math.round(avg),
      largestPosition: Math.round(largest),
      favoriteMarketCategory,
      categoryExposure,
    };
  });
}

function inferClosedPositions(whaleId, snapshots, currentPositions) {
  const currentKeys = new Set(currentPositions.filter((position) => position.walletId === whaleId).map(positionKey));
  const latestByKey = new Map();
  snapshots.forEach((snapshot) => {
    snapshot.positions.filter((position) => position.walletId === whaleId).forEach((position) => {
      latestByKey.set(positionKey(position), { ...position, lastSeen: snapshot.timestamp });
    });
  });
  return [...latestByKey.values()].filter((position) => !currentKeys.has(positionKey(position)));
}

export function buildSimilarityMatrix(whales, positions) {
  const marketsByWhale = new Map(whales.map((whale) => [whale.id, new Set()]));
  positions.forEach((position) => marketsByWhale.get(position.walletId)?.add(`${position.conditionId}:${position.side}`));

  return whales.map((left) => whales.map((right) => {
    if (left.id === right.id) return 100;
    const a = marketsByWhale.get(left.id) ?? new Set();
    const b = marketsByWhale.get(right.id) ?? new Set();
    const intersection = [...a].filter((item) => b.has(item)).length;
    const union = new Set([...a, ...b]).size;
    return union ? Math.round((intersection / union) * 100) : 0;
  }));
}

export function buildRankings(profiles, consensus) {
  const consensusHits = new Map();
  consensus.forEach((item) => item.whales.forEach((label) => consensusHits.set(label, (consensusHits.get(label) ?? 0) + item.intelligenceScore)));

  return {
    winRate: [...profiles].sort((a, b) => b.winRate - a.winRate),
    pnl: [...profiles].sort((a, b) => b.totalRealizedPnl - a.totalRealizedPnl),
    averageSize: [...profiles].sort((a, b) => b.averagePositionSize - a.averagePositionSize),
    consensusAccuracy: [...profiles].sort((a, b) => (consensusHits.get(b.label) ?? 0) - (consensusHits.get(a.label) ?? 0)),
  };
}

export function buildQualityReport(positions, fetchResults) {
  const seen = new Set();
  const issues = [];

  positions.forEach((position) => {
    const key = positionKey(position);
    if (seen.has(key)) issues.push({ level: "warn", message: `Duplicate position detected for ${position.walletLabel} in ${position.marketTitle}` });
    seen.add(key);
    if (!position.marketTitle || position.marketTitle.startsWith("unknown")) issues.push({ level: "warn", message: `Missing market metadata for ${position.walletLabel}` });
    if (!position.currentValue && !position.size) issues.push({ level: "warn", message: `Missing position size for ${position.walletLabel} in ${position.marketTitle}` });
  });

  fetchResults.filter((result) => !result.ok).forEach((result) => {
    issues.push({ level: "error", message: `${result.wallet.label} failed to refresh: ${result.error}` });
  });

  return {
    status: issues.some((issue) => issue.level === "error") ? "degraded" : issues.length ? "questionable" : "clean",
    issues,
  };
}

export function summarizeHealth(fetchResults, lastRefresh) {
  const failures = fetchResults.filter((result) => !result.ok);
  const latencies = fetchResults.map((result) => result.latencyMs).filter(Number.isFinite);
  const avgLatency = latencies.length ? Math.round(latencies.reduce((sum, item) => sum + item, 0) / latencies.length) : 0;
  return {
    apiStatus: failures.length ? "Degraded" : "Operational",
    lastSuccessfulRefresh: failures.length === fetchResults.length ? null : lastRefresh,
    failures,
    avgLatency,
  };
}

export function formatDuration(start, end = new Date().toISOString()) {
  const ms = new Date(end) - new Date(start);
  if (!Number.isFinite(ms) || ms <= 0) return "new";
  const hours = Math.floor(ms / 36e5);
  const days = Math.floor(hours / 24);
  if (days) return `${days}d ${hours % 24}h`;
  return `${hours}h ${Math.floor((ms % 36e5) / 6e4)}m`;
}
