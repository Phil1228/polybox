const params = new URLSearchParams(window.location.search);
const roomId = params.get("room") || "";
let token = params.get("token") || localStorage.getItem(`uno_token_${roomId}`) || "";
const mode = params.get("mode") || "ai";

const els = {
  roomMeta: document.getElementById("room-meta"),
  gameMsg: document.getElementById("game-msg"),
  turnTimer: document.getElementById("turn-timer"),
  seatTop: document.getElementById("seat-top"),
  seatLeft: document.getElementById("seat-left"),
  seatRight: document.getElementById("seat-right"),
  seatBottom: document.getElementById("seat-bottom"),
  drawPile: document.getElementById("draw-pile"),
  colorDot: document.getElementById("color-dot"),
  currentCard: document.getElementById("current-card"),
  handLabel: document.getElementById("hand-label"),
  handScroll: document.getElementById("hand-scroll"),
  btnUno: document.getElementById("btn-uno"),
  btnDraw: document.getElementById("btn-draw"),
  btnLeave: document.getElementById("btn-leave"),
  lobbyOverlay: document.getElementById("lobby-overlay"),
  lobbyRoom: document.getElementById("lobby-room"),
  lobbyList: document.getElementById("lobby-list"),
  btnStart: document.getElementById("btn-start"),
  btnLobbyCancel: document.getElementById("btn-lobby-cancel"),
  colorOverlay: document.getElementById("color-overlay"),
  btnCancelColor: document.getElementById("btn-cancel-color"),
  endOverlay: document.getElementById("end-overlay"),
  endTitle: document.getElementById("end-title"),
  endMsg: document.getElementById("end-msg"),
  btnRestart: document.getElementById("btn-restart"),
  waitRestart: document.getElementById("wait-restart"),
  btnHome: document.getElementById("btn-home"),
};

let pollTimer = null;
let turnTimer = null;
let lastState = null;
let pendingWildCardId = null;
let canRestart = false;

const NUMBER_PATTERN = /^[0-9]$/;

const VALUE_LABELS = {
  skip: "跳过",
  reverse: "反转",
  draw_two: "+2",
  wild: "变色",
  wild_draw_four: "+4",
};

const COLOR_MAP = {
  red: "#e53935",
  yellow: "#fdd835",
  green: "#43a047",
  blue: "#1e88e5",
};

function cardLabel(card) {
  if (!card) return "";
  if (NUMBER_PATTERN.test(card.value)) return card.value;
  return VALUE_LABELS[card.value] || card.value;
}

function renderCard(card, extraClass = "") {
  const div = document.createElement("div");
  const color = card.color === "wild" && lastState?.chosen_color ? lastState.chosen_color : card.color;
  div.className = `uno-card ${color} ${extraClass}`.trim();
  div.dataset.cardId = card.id;
  div.textContent = cardLabel(card);
  return div;
}

function seatHtml(player, isYou, isActive) {
  const played = (player.played || []).map((c) => {
    const el = renderCard(c, "mini-card");
    return el.outerHTML;
  }).join("");
  const count = isYou ? (player.hand?.length || 0) : (player.hand_count ?? player.hand?.length ?? 0);
  return `
    <div class="seat-name">${isYou ? "你" : player.nickname || "玩家"}${isActive ? " ◀" : ""}</div>
    <div class="seat-count">${count} 张</div>
    <div class="played-strip">${played}</div>
  `;
}

function mapSeats(snapshot) {
  const you = snapshot.you;
  const others = snapshot.others || [];
  const all = you ? [you, ...others] : others;
  const bySeat = Object.fromEntries(all.map((p) => [p.seat, p]));
  const curId = snapshot.current_player_id;
  return {
    bottom: you,
    top: bySeat[(you?.seat + 2) % 4] || others[0],
    left: bySeat[(you?.seat + 3) % 4] || others[1],
    right: bySeat[(you?.seat + 1) % 4] || others[2],
    curId,
  };
}

function renderTable(data) {
  const snap = data.snapshot;
  if (!snap) return;
  lastState = snap;

  const diffLabel = { easy: "简单", normal: "普通", hard: "困难" }[data.ai_difficulty] || "";
  els.roomMeta.textContent = `房间 ${roomId}${diffLabel ? ` · 难度 ${diffLabel}` : ""}`;
  els.gameMsg.textContent = snap.message || "";
  if (snap.pending_draw > 0) {
    els.gameMsg.textContent += ` · 须摸 ${snap.pending_draw} 张${snap.rules?.stackDrawTwo ? "（可出 +2）" : ""}`;
  }

  const seats = mapSeats(snap);
  const setSeat = (el, player, isYou) => {
    if (!player) { el.innerHTML = ""; return; }
    const active = snap.current_player_id === player.id;
    el.classList.toggle("active", active);
    el.innerHTML = seatHtml(player, isYou, active);
  };
  setSeat(els.seatBottom, seats.bottom, true);
  setSeat(els.seatTop, seats.top, false);
  setSeat(els.seatLeft, seats.left, false);
  setSeat(els.seatRight, seats.right, false);

  els.currentCard.innerHTML = "";
  if (snap.current_card) {
    els.currentCard.appendChild(renderCard(snap.current_card));
  }
  const dotColor = snap.chosen_color || snap.current_card?.color;
  els.colorDot.style.background = COLOR_MAP[dotColor] || "transparent";

  const hand = snap.you?.hand || [];
  els.handLabel.textContent = `我的手牌 ${hand.length} 张`;
  els.handScroll.classList.toggle("many", hand.length >= 8);
  els.handScroll.classList.toggle("tiny", hand.length >= 12);
  els.handScroll.innerHTML = "";
  const legal = new Set(snap.legal_moves || []);
  const myTurn = snap.current_player_id === snap.you?.id;
  for (const card of hand) {
    const playable = myTurn && legal.has(card.id) && snap.phase === "playing";
    const el = renderCard(card, playable ? "playable" : "disabled");
    if (playable) {
      el.addEventListener("click", () => onPlayCard(card));
    }
    els.handScroll.appendChild(el);
  }

  const choosing = snap.choosing_color && snap.pending_wild_card_id;
  els.colorOverlay.classList.toggle("hidden", !choosing);
  pendingWildCardId = snap.pending_wild_card_id;

  els.lobbyOverlay.classList.toggle("hidden", data.status !== "lobby");
  if (data.lobby) {
    els.lobbyRoom.textContent = data.lobby.room_id;
    els.lobbyList.innerHTML = data.lobby.players
      .map((p) => `<div>座位 ${p.seat}: ${p.nickname}</div>`)
      .join("");
    els.btnStart.classList.toggle("hidden", !data.lobby.can_start);
  }

  els.endOverlay.classList.toggle("hidden", data.status !== "finished");
  if (data.status === "finished") {
    const winner = snap.players?.find((p) => p.id === snap.winner_id);
    els.endMsg.textContent = winner ? `${winner.nickname} 获胜！` : "对局结束";
    canRestart = Boolean(data.can_restart);
    els.btnRestart.classList.toggle("hidden", !canRestart);
    els.waitRestart.classList.toggle("hidden", canRestart || mode === "ai");
  }

  startTurnTimer(snap);
}

async function fetchState() {
  const res = await fetch(`/api/uno/rooms/${roomId}/state?token=${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "加载失败");
  renderTable(data);
  return data;
}

async function sendAction(action, payload = {}) {
  const res = await fetch(`/api/uno/rooms/${roomId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "操作失败");
  renderTable(data);
  return data;
}

function onPlayCard(card) {
  if (card.color === "wild" || card.value === "wild" || card.value === "wild_draw_four") {
    pendingWildCardId = card.id;
    sendAction("play", { card_id: card.id }).catch((e) => { els.gameMsg.textContent = e.message; });
    return;
  }
  sendAction("play", { card_id: card.id }).catch((e) => { els.gameMsg.textContent = e.message; });
}

function startPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    fetchState().catch(() => {});
  }, 1500);
}

function startTurnTimer(snap) {
  if (turnTimer) clearInterval(turnTimer);
  if (!snap.turn_started_at || snap.current_player_id !== snap.you?.id) {
    els.turnTimer.textContent = "";
    return;
  }
  const timeout = (snap.turn_timeout_sec || 30) * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((snap.turn_started_at + timeout - Date.now()) / 1000));
    els.turnTimer.textContent = left > 0 ? `${left}s` : "";
    if (left <= 0 && snap.current_player_id === snap.you?.id) {
      sendAction("draw").catch(() => {});
    }
  };
  tick();
  turnTimer = setInterval(tick, 1000);
}

async function leaveRoom() {
  if (!confirm("确定退出房间？")) return;
  try {
    await fetch("/api/uno/rooms/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_id: roomId, token }),
    });
  } catch { /* ignore */ }
  localStorage.removeItem(`uno_token_${roomId}`);
  window.location.href = "/uno.html";
}

els.drawPile.addEventListener("click", () => sendAction("draw").catch((e) => { els.gameMsg.textContent = e.message; }));
els.btnDraw.addEventListener("click", () => sendAction("draw").catch((e) => { els.gameMsg.textContent = e.message; }));
els.btnUno.addEventListener("click", () => sendAction("call_uno").catch((e) => { els.gameMsg.textContent = e.message; }));
els.btnLeave.addEventListener("click", leaveRoom);
els.btnLobbyCancel.addEventListener("click", () => {
  if (!confirm("确定取消并返回大厅？")) return;
  leaveRoom();
});
els.btnStart.addEventListener("click", () => sendAction("start").catch((e) => { els.gameMsg.textContent = e.message; }));
els.btnRestart.addEventListener("click", () => sendAction("restart").catch((e) => { els.gameMsg.textContent = e.message; }));
els.btnHome.addEventListener("click", () => { window.location.href = "/uno.html"; });

els.colorOverlay.querySelectorAll("[data-color]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const color = btn.dataset.color;
    sendAction("choose_color", { card_id: pendingWildCardId, color }).catch((e) => { els.gameMsg.textContent = e.message; });
  });
});
els.btnCancelColor.addEventListener("click", () => {
  sendAction("cancel_color").catch((e) => { els.gameMsg.textContent = e.message; });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.colorOverlay.classList.contains("hidden")) {
    sendAction("cancel_color").catch(() => {});
  }
});

if (!roomId || !token) {
  window.location.href = "/uno.html";
} else {
  localStorage.setItem(`uno_token_${roomId}`, token);
  fetchState()
    .then(() => startPoll())
    .catch(() => { window.location.href = "/uno.html"; });
}
