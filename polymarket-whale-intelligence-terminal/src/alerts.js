export async function dispatchAlerts(events, consensus, previousConsensus, settings) {
  const consensusAlerts = detectConsensusAlerts(consensus, previousConsensus);
  const alerts = [...events.filter(shouldAlertForEvent), ...consensusAlerts];
  if (!alerts.length) return [];

  const deliveries = [];
  for (const alert of alerts) {
    if (settings.notificationAlerts && "Notification" in window) {
      deliveries.push(sendBrowserNotification(alert));
    }
    if (settings.discordWebhookUrl) {
      deliveries.push(postJson(settings.discordWebhookUrl, {
        content: `**${alert.title}**\n${alert.body}`,
      }, "Discord"));
    }
    if (settings.telegramBotToken && settings.telegramChatId) {
      const url = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;
      deliveries.push(postJson(url, {
        chat_id: settings.telegramChatId,
        text: `${alert.title}\n${alert.body}`,
      }, "Telegram"));
    }
  }

  return Promise.allSettled(deliveries);
}

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}

function shouldAlertForEvent(event) {
  return ["new-position", "flip", "closed", "large-increase"].includes(event.type);
}

function detectConsensusAlerts(consensus, previousConsensus) {
  const previousByKey = new Map(previousConsensus.map((item) => [`${item.conditionId}::${item.side}`, item]));
  return consensus
    .filter((item) => item.score >= 4)
    .filter((item) => {
      const previous = previousByKey.get(`${item.conditionId}::${item.side}`);
      return !previous || previous.score < item.score;
    })
    .map((item) => ({
      id: `consensus:${item.conditionId}:${item.side}:${Date.now()}`,
      type: item.score >= 5 ? "new-5-consensus" : "new-4-consensus",
      title: `NEW ${item.score}/${item.denominator} CONSENSUS`,
      body: `${item.marketTitle} ${item.side} | ${item.whales.join(", ")} | ${Math.round(item.combinedValue).toLocaleString()} USDC`,
    }));
}

function sendBrowserNotification(alert) {
  if (Notification.permission !== "granted") return Promise.resolve({ skipped: true });
  new Notification(alert.title, { body: alert.body ?? `${alert.marketTitle} ${alert.side}` });
  return Promise.resolve({ ok: true, target: "Browser" });
}

async function postJson(url, payload, target) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`${target} alert failed (${response.status})`);
  return { ok: true, target };
}
