export async function fetchWhalePositions(wallet, settings) {
  const started = performance.now();

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet.address)) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      positions: [],
      error: "Invalid wallet address",
    };
  }

  const url = new URL("/positions", settings.apiBaseUrl);
  url.searchParams.set("user", wallet.address);
  url.searchParams.set("sizeThreshold", String(settings.sizeThreshold ?? 1));
  url.searchParams.set("limit", "500");

  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Polymarket positions request failed (${response.status})`);
    }
    const json = await response.json();
    const rows = Array.isArray(json) ? json : json.positions ?? json.data ?? [];
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      positions: rows.map((position, index) => normalizePosition(position, wallet, index)),
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      positions: [],
      error: error.message,
    };
  }
}

function normalizePosition(position, wallet, index) {
  const conditionId = String(position.conditionId ?? position.condition_id ?? position.market ?? position.slug ?? `unknown-${index}`);
  const marketTitle = String(position.title ?? position.marketTitle ?? position.question ?? position.marketSlug ?? conditionId);
  const outcome = String(position.outcome ?? position.outcomeTitle ?? position.side ?? position.asset ?? "UNKNOWN").toUpperCase();
  const currentValue = numberFrom(position.currentValue ?? position.value ?? position.usdcSize ?? position.sizeUsd ?? position.amount);
  const size = numberFrom(position.size ?? position.quantity ?? position.shares ?? currentValue);
  const price = numberFrom(position.avgPrice ?? position.price ?? position.curPrice ?? position.outcomePrice);

  return {
    id: `${wallet.id}:${conditionId}:${outcome}`,
    walletId: wallet.id,
    walletLabel: wallet.label,
    walletAddress: wallet.address,
    conditionId,
    marketSlug: String(position.marketSlug ?? position.slug ?? conditionId),
    marketTitle,
    outcome,
    side: outcome.includes("NO") ? "NO" : "YES",
    currentValue,
    initialValue: numberFrom(position.initialValue ?? position.costBasis ?? currentValue),
    size,
    price,
    cashPnl: numberFrom(position.cashPnl ?? position.pnl ?? position.unrealizedPnl),
    realizedPnl: numberFrom(position.realizedPnl ?? position.realized ?? 0),
    percentPnl: numberFrom(position.percentPnl ?? position.percentPnlOpen ?? 0),
    category: "",
    endDate: position.endDate ?? position.end_date ?? "",
    raw: position,
  };
}

function numberFrom(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
