const $ = (id) => document.getElementById(id);

const formatNumber = (value, digits = 0) =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

const formatPercent = (value) =>
  value === null || value === undefined
    ? "—"
    : `${(Number(value) * 100).toFixed(1)}%`;

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString();
};

function setText(id, value) {
  $(id).textContent = value;
}

function renderSummary(payload) {
  const { player = {}, tracker = {}, stats = {} } = payload;
  const competitive = stats.competitive ?? {};
  const deep = stats.deep ?? {};
  const statuses = stats.replayStatus ?? {};

  setText("player-name", player.username ?? "Irvinwop");
  setText(
    "subtitle",
    `${formatNumber(player.gamesplayed)} account games · ${formatNumber(stats.totalRecords)} locally stored`,
  );
  setText("total-games", formatNumber(stats.totalRecords));
  setText("win-rate", formatPercent(competitive.winRate));
  setText("average-apm", formatNumber(competitive.apm, 2));
  setText("average-pps", formatNumber(competitive.pps, 3));
  setText("average-vs", formatNumber(competitive.vs, 2));
  setText("analyzed-games", formatNumber(statuses.processed ?? 0));
  setText("deep-pieces", formatNumber(deep.pieces));
  setText("deep-attack", formatNumber(deep.attack));
  setText("deep-lines", formatNumber(deep.linesCleared));
  setText("deep-kpp", formatNumber(deep.kpp, 3));
  setText("deep-app", formatNumber(deep.app, 3));
  setText("deep-pps", formatNumber(deep.pps, 3));
  setText("tracker-phase", tracker.phase ?? "idle");
  setText(
    "last-sync",
    tracker.lastCompletedAt
      ? `Last sync ${formatDate(tracker.lastCompletedAt)}`
      : "Initial sync in progress",
  );

  const notice = $("notice");
  if (tracker.lastError) {
    notice.hidden = false;
    notice.textContent = `Latest sync error: ${tracker.lastError}`;
  } else if ((statuses.retry ?? 0) > 0) {
    notice.hidden = false;
    notice.textContent = `${statuses.retry} replay downloads are queued for automatic retry.`;
  } else {
    notice.hidden = true;
  }
}

function renderGames(records) {
  const body = $("games-body");
  body.replaceChildren();
  if (!records.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "No games stored yet.";
    row.append(cell);
    body.append(row);
    return;
  }

  for (const game of records) {
    const row = document.createElement("tr");
    const cells = [
      formatDate(game.playedAt),
      game.mode ?? game.stream ?? "—",
      game.opponentName ?? "—",
      game.won === null || game.won === undefined
        ? "—"
        : game.won
          ? "Win"
          : "Loss",
      formatNumber(game.apm, 2),
      formatNumber(game.pps, 3),
      formatNumber(game.vs, 2),
    ];

    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 3 && game.won !== null && game.won !== undefined) {
        cell.className = game.won ? "result-win" : "result-loss";
      }
      row.append(cell);
    });

    const replayCell = document.createElement("td");
    const replayLink = document.createElement("a");
    replayLink.href = `/api/games/${encodeURIComponent(game.id)}`;
    replayLink.textContent = game.replayStatus ?? "unknown";
    replayLink.className = `replay-${game.replayStatus ?? "unknown"}`;
    replayCell.append(replayLink);
    row.append(replayCell);
    body.append(row);
  }
}

async function refresh() {
  const [summaryResponse, gamesResponse] = await Promise.all([
    fetch("/api/summary"),
    fetch("/api/games?limit=100"),
  ]);
  if (!summaryResponse.ok || !gamesResponse.ok) {
    throw new Error("Tracker API request failed");
  }
  renderSummary(await summaryResponse.json());
  renderGames((await gamesResponse.json()).records ?? []);
}

$("sync-button").addEventListener("click", async () => {
  const button = $("sync-button");
  button.disabled = true;
  button.textContent = "Syncing…";
  try {
    const response = await fetch("/api/sync", { method: "POST" });
    if (!response.ok && response.status !== 409) throw new Error("Sync request failed");
    await new Promise((resolve) => setTimeout(resolve, 800));
    await refresh();
  } finally {
    button.disabled = false;
    button.textContent = "Sync now";
  }
});

refresh().catch((error) => {
  const notice = $("notice");
  notice.hidden = false;
  notice.textContent = error.message;
});
setInterval(() => void refresh().catch(() => undefined), 15_000);
