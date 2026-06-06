const SOUNDS = window.UNO_SOUNDS || null;

const RUNTIME = window.UNO_RUNTIME || {
  isLocal: false,
  pollMsHuman: 2200,
  pollMsBot: 700,
  pollMsOnline: 1100,
  animMs: 520,
  pauseAfterPlayMs: 480,
};

const params = new URLSearchParams(window.location.search);
const roomId = params.get("room") || "";
let token = params.get("token") || localStorage.getItem(`uno_token_${roomId}`) || "";
const mode = params.get("mode") || "ai";

const els = {
  roomMeta: document.getElementById("room-meta"),
  gameMsg: document.getElementById("game-msg"),
  envBadge: document.getElementById("env-badge"),
  turnTimer: document.getElementById("turn-timer"),
  seatTop: document.getElementById("seat-top"),
  seatLeft: document.getElementById("seat-left"),
  seatRight: document.getElementById("seat-right"),
  seatBottom: document.getElementById("seat-bottom"),
  drawPile: document.getElementById("draw-pile"),
  colorDot: document.getElementById("color-dot"),
  currentCard: document.getElementById("current-card"),
  handLabel: document.getElementById("hand-label"),
  handDock: document.getElementById("hand-dock"),
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
  historyPanel: document.getElementById("history-panel"),
  historyToggle: document.getElementById("history-toggle"),
  historyList: document.getElementById("history-list"),
  historyEmpty: document.getElementById("history-empty"),
};

let pollTimer = null;
let turnTimer = null;
let lastState = null;
let prevSnapshot = null;
let lastAutoDrawAt = 0;
let actionInFlight = false;
let pollBusy = false;
let animating = false;
let pendingWildCardId = null;
let pendingUserPlayCardId = null;
let pendingUserCallUno = false;
let canRestart = false;
/** @type {Array<{ id: string, who: string, text: string, time: string, dotClass: string }>} */
const historyEntries = [];
const MAX_HISTORY = 100;
let lastRecordedMessage = "";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function raf() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function cardLabel(card) {
  if (!card) return "";
  if (NUMBER_PATTERN.test(card.value)) return card.value;
  return VALUE_LABELS[card.value] || card.value;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function playerName(snap, playerId) {
  if (!snap || !playerId) return "玩家";
  if (snap.you?.id === playerId) return snap.you.nickname || "你";
  const other = (snap.others || []).find((p) => p.id === playerId);
  if (other?.nickname) return other.nickname;
  const meta = (snap.players || []).find((p) => p.id === playerId);
  return meta?.nickname || "玩家";
}

function cardDotClass(card, chosenColor) {
  if (!card) return "";
  if (card.color === "wild" || card.value === "wild" || card.value === "wild_draw_four") {
    return chosenColor && chosenColor !== "wild" ? chosenColor : "wild";
  }
  return card.color || "";
}

function pushHistory(who, text, dotClass = "") {
  historyEntries.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    who: who || "玩家",
    text: text || "",
    time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    dotClass,
  });
  if (historyEntries.length > MAX_HISTORY) {
    historyEntries.length = MAX_HISTORY;
  }
  renderHistoryPanel();
}

function renderHistoryPanel() {
  if (!els.historyList) return;
  els.historyEmpty.hidden = historyEntries.length > 0;
  els.historyList.innerHTML = historyEntries
    .map(
      (item) => `
    <li class="uno-history-item">
      <span class="uno-history-dot ${escapeHtml(item.dotClass)}" aria-hidden="true"></span>
      <div class="uno-history-main">
        <div class="uno-history-who">${escapeHtml(item.who)}</div>
        <div class="uno-history-text">${escapeHtml(item.text)}</div>
      </div>
      <span class="uno-history-time">${escapeHtml(item.time)}</span>
    </li>`,
    )
    .join("");
}

function clearHistory() {
  historyEntries.length = 0;
  lastRecordedMessage = "";
  renderHistoryPanel();
}

function formatDrawDetail(count) {
  return count > 1 ? `摸了 ${count} 张` : "摸了 1 张";
}

function handCount(snap, playerId) {
  if (!snap || !playerId) return 0;
  if (snap.you?.id === playerId) return snap.you.hand?.length ?? 0;
  const other = (snap.others || []).find((p) => p.id === playerId);
  return other?.hand_count ?? 0;
}

function playedCards(snap, playerId) {
  if (!snap || !playerId) return [];
  if (snap.you?.id === playerId) return snap.you.played || [];
  return (snap.others || []).find((p) => p.id === playerId)?.played || [];
}

function detectNewPlayedCard(prev, next, playerId) {
  const before = playedCards(prev, playerId);
  const after = playedCards(next, playerId);
  if (!after.length || after.length < before.length) return null;
  const prevTopId = before[before.length - 1]?.id || null;
  const nextTopId = after[after.length - 1]?.id || null;
  if (!nextTopId || nextTopId === prevTopId) return null;
  return after[after.length - 1];
}

function playerMeta(snap, playerId) {
  if (snap.you?.id === playerId) {
    return { nickname: snap.you.nickname || "你", isYou: true };
  }
  const other = (snap.others || []).find((p) => p.id === playerId);
  return { nickname: other?.nickname || "玩家", isYou: false };
}

function recordHistory(prev, next, events) {
  if (!next) return;

  if (prev?.phase === "finished" && next.message === "游戏开始") {
    clearHistory();
    pushHistory("系统", "新一局开始");
    lastRecordedMessage = next.message;
    return;
  }

  if (!prev) {
    if (next.message && next.message !== "请选择颜色") {
      pushHistory("系统", next.message);
      lastRecordedMessage = next.message;
    }
    return;
  }

  const list = Array.isArray(events) ? events : events ? [events] : [];
  let recorded = false;

  for (const event of list) {
    if (event.type === "play") {
      const effColor = cardDotClass(event.card, next.chosen_color);
      const colorTag = { red: "红", yellow: "黄", green: "绿", blue: "蓝" }[effColor] || "";
      const label = cardLabel(event.card);
      pushHistory(event.nickname, `出牌 · ${colorTag}${label}`, effColor);
      recorded = true;
    } else if (event.type === "draw") {
      const name = playerName(next, event.playerId);
      pushHistory(name, formatDrawDetail(event.count));
      recorded = true;
    } else if (event.type === "penalty") {
      const name = playerName(next, event.playerId);
      pushHistory(name, event.text || "未喊 UNO，罚摸 2 张");
      recorded = true;
    }
  }

  if (recorded) {
    lastRecordedMessage = next.message || "";
    return;
  }

  if (!next.message || next.message === prev.message || next.message === lastRecordedMessage) {
    return;
  }
  if (next.message.endsWith("…") || next.message.includes("下家摸")) return;

  const actor = playerName(prev, prev.current_player_id);

  if (prev.phase === "choosing_color" && next.message.includes("选择")) {
    pushHistory(actor, next.message);
    lastRecordedMessage = next.message;
    return;
  }

  if (next.message.includes("UNO") || next.message.includes("取消选色") || next.message.includes("罚摸")) {
    pushHistory(actor, next.message);
    lastRecordedMessage = next.message;
    return;
  }

  if (next.phase === "finished" && prev.phase !== "finished") {
    pushHistory("系统", next.message);
    lastRecordedMessage = next.message;
    return;
  }

  const keywords = ["跳过", "反转", "方向", "叠", "+2", "+4"];
  if (keywords.some((k) => next.message.includes(k))) {
    pushHistory(actor, next.message);
    lastRecordedMessage = next.message;
  }
}

function renderCard(card, extraClass = "") {
  const div = document.createElement("div");
  const color = card.color === "wild" && lastState?.chosen_color ? lastState.chosen_color : card.color;
  div.className = `uno-card ${color} ${extraClass}`.trim();
  div.dataset.cardId = card.id;
  div.textContent = cardLabel(card);
  return div;
}

function renderCardBack(extraClass = "") {
  const div = document.createElement("div");
  div.className = `uno-card uno-card-back ${extraClass}`.trim();
  div.setAttribute("aria-hidden", "true");
  return div;
}

function drawTargetEl(snapshotBefore, playerId) {
  if (snapshotBefore?.you?.id === playerId) {
    return els.handScroll || els.handDock;
  }
  return seatElForPlayer(snapshotBefore, playerId);
}

function isBotTurn(snap) {
  if (!snap?.current_player_id) return false;
  const p = (snap.players || []).find((x) => x.id === snap.current_player_id);
  return Boolean(p?.is_bot);
}

function seatElForPlayer(snapshot, playerId) {
  const seats = mapSeats(snapshot);
  if (seats.bottom?.id === playerId) return els.seatBottom;
  if (seats.top?.id === playerId) return els.seatTop;
  if (seats.left?.id === playerId) return els.seatLeft;
  if (seats.right?.id === playerId) return els.seatRight;
  return null;
}

function detectEvents(prev, next) {
  if (!prev || !next) return [];

  /** @type {Array<{ type: string, playerId?: string, card?: object, nickname?: string, isYou?: boolean, count?: number }>} */
  const events = [];

  const playerIds = new Set(
    [prev.you?.id, next.you?.id, ...(prev.others || []).map((p) => p.id), ...(next.others || []).map((p) => p.id)].filter(
      Boolean,
    ),
  );
  const orderedIds = [
    prev.current_player_id,
    ...[...playerIds].filter((id) => id !== prev.current_player_id),
  ].filter(Boolean);

  const penaltyMsg = (next.message || "").includes("未喊 UNO") && (next.message || "").includes("罚摸");

  for (const id of orderedIds) {
    const card = detectNewPlayedCard(prev, next, id);
    if (!card) continue;
    const meta = playerMeta(next, id);
    events.push({
      type: "play",
      playerId: id,
      card,
      nickname: meta.nickname,
      isYou: meta.isYou,
    });
  }

  if ((next.message || "").includes("喊了 UNO") && next.message !== prev.message) {
    events.push({ type: "call_uno", playerId: prev.current_player_id });
  }

  for (const id of orderedIds) {
    const before = handCount(prev, id);
    const after = handCount(next, id);
    if (after > before) {
      if (penaltyMsg && id === prev.current_player_id) continue;
      events.push({ type: "draw", playerId: id, count: after - before });
    }
  }

  if (penaltyMsg && prev.current_player_id) {
    const match = (next.message || "").match(/罚摸\s*(\d+)\s*张/);
    const count = match ? Number(match[1]) : 2;
    events.push({ type: "penalty", playerId: prev.current_player_id, text: next.message, count });
  }

  return events;
}

function playAnimFromEl(event, snapshotBefore, fromElOverride) {
  if (fromElOverride) return fromElOverride;
  if (event.isYou && event.card?.id) {
    const cardEl = els.handScroll?.querySelector(`[data-card-id="${event.card.id}"]`);
    if (cardEl) return cardEl;
    return els.handScroll;
  }
  return seatElForPlayer(snapshotBefore, event.playerId);
}

async function animatePlay(event, snapshotBefore, fromElOverride) {
  const fromEl = playAnimFromEl(event, snapshotBefore, fromElOverride);
  const toEl = els.currentCard;
  if (!fromEl || !toEl || !event.card) return;

  const fromRect = fromEl.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();
  const fly = renderCard(event.card, "uno-fly-card");
  document.body.appendChild(fly);

  const w = 56;
  const h = 80;
  const sx = fromRect.left + fromRect.width / 2 - w / 2;
  const sy = fromRect.top + fromRect.height / 2 - h / 2;
  const ex = toRect.left + toRect.width / 2 - w / 2;
  const ey = toRect.top + toRect.height / 2 - h / 2;

  Object.assign(fly.style, {
    position: "fixed",
    left: `${sx}px`,
    top: `${sy}px`,
    width: `${w}px`,
    height: `${h}px`,
    zIndex: "250",
    margin: 0,
    transform: "translate(0, 0) scale(1)",
  });

  if (event.isYou) {
    els.handDock?.classList.add("hand-acting");
    els.gameMsg.textContent = "你出牌…";
  } else {
    seatElForPlayer(snapshotBefore, event.playerId)?.classList.add("seat-acting");
  }

  await raf();
  SOUNDS?.forCard?.(event.card);
  fly.style.transition = `transform ${RUNTIME.animMs}ms cubic-bezier(0.22, 0.85, 0.25, 1)`;
  fly.style.transform = `translate(${ex - sx}px, ${ey - sy}px) scale(1.08) rotate(${event.isYou ? 4 : -6}deg)`;

  if (!event.isYou) {
    els.gameMsg.textContent = `${event.nickname} 出牌…`;
  }

  await sleep(RUNTIME.animMs + 60);
  fly.remove();
  els.handDock?.classList.remove("hand-acting");
  document.querySelectorAll(".seat-acting").forEach((el) => el.classList.remove("seat-acting"));
}

async function animateDraw(event, snapshotBefore) {
  const fromEl = els.drawPile;
  const toEl = drawTargetEl(snapshotBefore, event.playerId);
  if (!fromEl || !toEl) return;

  const isYou = snapshotBefore?.you?.id === event.playerId;
  const meta = playerMeta(snapshotBefore, event.playerId);
  const count = Math.max(1, event.count || 1);
  const cardMs = Math.round(RUNTIME.animMs * 0.85);
  const stagger = Math.round(cardMs * 0.2);
  const w = 56;
  const h = 80;

  const fromRect = fromEl.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();
  const sx = fromRect.left + fromRect.width / 2 - w / 2;
  const sy = fromRect.top + fromRect.height / 2 - h / 2;
  const ex = toRect.left + toRect.width / 2 - w / 2;
  const ey = toRect.top + toRect.height / 2 - h / 2;

  if (isYou) {
    els.handDock?.classList.add("hand-acting");
    els.gameMsg.textContent = count > 1 ? `你摸了 ${count} 张…` : "你摸牌…";
  } else {
    seatElForPlayer(snapshotBefore, event.playerId)?.classList.add("seat-drawing");
    els.gameMsg.textContent = count > 1 ? `${meta.nickname} 摸了 ${count} 张…` : `${meta.nickname} 摸牌…`;
  }
  els.drawPile.classList.add("pile-shake");

  /** @type {HTMLElement[]} */
  const flies = [];

  for (let i = 0; i < count; i++) {
    if (i > 0) await sleep(stagger);

    SOUNDS?.draw?.(i);

    const spread = (i - (count - 1) / 2) * 8;
    const fly = renderCardBack("uno-fly-card uno-fly-back");
    flies.push(fly);
    document.body.appendChild(fly);

    Object.assign(fly.style, {
      position: "fixed",
      left: `${sx}px`,
      top: `${sy}px`,
      width: `${w}px`,
      height: `${h}px`,
      zIndex: String(250 + i),
      margin: 0,
      transform: `translate(${spread}px, 0) scale(1) rotate(0deg)`,
    });

    await raf();
    fly.style.transition = `transform ${cardMs}ms cubic-bezier(0.22, 0.85, 0.25, 1)`;
    const tx = ex - sx + spread * 0.25;
    const ty = ey - sy;
    const rot = isYou ? 6 + i * 3 : -8 + i * 5;
    fly.style.transform = `translate(${tx}px, ${ty}px) scale(${isYou ? 0.92 : 0.85}) rotate(${rot}deg)`;
  }

  await sleep(cardMs + 80);
  flies.forEach((fly) => fly.remove());
  els.handDock?.classList.remove("hand-acting");
  document.querySelectorAll(".seat-drawing").forEach((el) => el.classList.remove("seat-drawing"));
  els.drawPile.classList.remove("pile-shake");
}

function updateThinkingIndicator(snap) {
  document.querySelectorAll(".seat-area").forEach((el) => el.classList.remove("seat-thinking"));
  if (!snap || snap.phase !== "playing" && snap.phase !== "choosing_color") return;
  if (isBotTurn(snap)) {
    seatElForPlayer(snap, snap.current_player_id)?.classList.add("seat-thinking");
  }
}

function playedStripHtml(player) {
  const recent = (player.played || []).slice(-3);
  return Array.from({ length: 3 }, (_, i) => {
    const cardIndex = i - (3 - recent.length);
    if (cardIndex >= 0 && recent[cardIndex]) {
      const el = renderCard(recent[cardIndex], "mini-card");
      return `<div class="played-slot">${el.outerHTML}</div>`;
    }
    return '<div class="played-slot played-slot-empty" aria-hidden="true"></div>';
  }).join("");
}

function seatHtml(player, isYou, isActive) {
  const count = isYou ? (player.hand?.length || 0) : (player.hand_count ?? player.hand?.length ?? 0);
  const turnBadge = isActive
    ? `<div class="seat-turn-badge">${isYou ? "你的回合" : "出牌中"}</div>`
    : '<div class="seat-turn-badge seat-turn-badge--hold" aria-hidden="true"></div>';
  return `
    ${turnBadge}
    <div class="seat-name">${isYou ? "你" : player.nickname || "玩家"}</div>
    <div class="seat-count">${count} 张</div>
    <div class="played-strip" aria-label="出牌区">${playedStripHtml(player)}</div>
  `;
}

function mapSeats(snapshot) {
  const you = snapshot.you;
  const others = snapshot.others || [];
  const bySeat = Object.fromEntries([you, ...others].filter(Boolean).map((p) => [p.seat, p]));
  return {
    bottom: you,
    top: bySeat[(you?.seat + 2) % 4],
    left: bySeat[(you?.seat + 3) % 4],
    right: bySeat[(you?.seat + 1) % 4],
    curId: snapshot.current_player_id,
  };
}

function renderTable(data) {
  const snap = data.snapshot;
  if (!snap) return;
  lastState = snap;

  if (els.envBadge) {
    els.envBadge.hidden = false;
    els.envBadge.textContent = RUNTIME.isLocal ? "本地" : "云端";
    els.envBadge.title = RUNTIME.isLocal
      ? "本地 SQLite，Bot 逐步推进"
      : "Vercel + Turso，REST 轮询同步";
  }

  const diffLabel = { easy: "简单", normal: "普通", hard: "困难" }[data.ai_difficulty] || "";
  els.roomMeta.textContent = `房间 ${roomId}${diffLabel ? ` · 难度 ${diffLabel}` : ""}`;
  els.gameMsg.textContent = snap.message || "";
  if (snap.pending_draw > 0) {
    els.gameMsg.textContent += ` · 须摸 ${snap.pending_draw} 张${snap.rules?.stackDrawTwo ? "（可出 +2）" : ""}`;
  }

  const seats = mapSeats(snap);
  const setSeat = (el, player, isYou) => {
    if (!player) {
      el.innerHTML = "";
      return;
    }
    const active = snap.current_player_id === player.id;
    el.classList.toggle("active", active);
    el.innerHTML = seatHtml(player, isYou, active);
  };
  setSeat(els.seatBottom, seats.bottom, true);
  setSeat(els.seatTop, seats.top, false);
  setSeat(els.seatLeft, seats.left, false);
  setSeat(els.seatRight, seats.right, false);
  updateThinkingIndicator(snap);

  els.currentCard.innerHTML = "";
  if (snap.current_card) {
    const cardEl = renderCard(snap.current_card);
    cardEl.classList.add("current-top");
    els.currentCard.appendChild(cardEl);
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
    const playable = myTurn && legal.has(card.id) && snap.phase === "playing" && !animating;
    const el = renderCard(card, playable ? "playable" : "disabled");
    if (playable) {
      el.addEventListener("click", () => onPlayCard(card));
    }
    els.handScroll.appendChild(el);
  }

  const choosing = snap.choosing_color && snap.pending_wild_card_id && myTurn;
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

function mergePlayerFromFinal(staged, final, playerId) {
  const out = structuredClone(staged);
  if (!final || !playerId) return out;

  if (final.you?.id === playerId && out.you) {
    out.you.hand = structuredClone(final.you.hand);
    out.you.played = structuredClone(final.you.played);
    out.you.called_uno = final.you.called_uno;
    return out;
  }

  const src = (final.others || []).find((p) => p.id === playerId);
  if (!src) return out;
  const idx = (out.others || []).findIndex((p) => p.id === playerId);
  if (idx < 0) return out;
  out.others[idx] = {
    ...out.others[idx],
    hand_count: src.hand_count,
    played: structuredClone(src.played),
    called_uno: src.called_uno,
  };
  return out;
}

function buildAnimQueue(events) {
  const queue = [];
  for (const event of events) {
    if (event.type === "call_uno") {
      queue.push(event);
    } else if (event.type === "play") {
      const skipAnim = Boolean(event.isYou && event.card?.id === pendingUserPlayCardId);
      if (skipAnim) pendingUserPlayCardId = null;
      queue.push({ ...event, skipAnim });
    } else if (event.type === "draw" || event.type === "penalty") {
      queue.push(event);
    }
  }
  return queue;
}

async function runEventAnimations(events, snapshotBefore, data) {
  const queue = buildAnimQueue(events);
  if (!queue.length) return;

  const finalSnap = data.snapshot;
  let stagedSnap = structuredClone(snapshotBefore);
  const pauseMs = RUNTIME.pauseAfterPlayMs ?? 480;

  animating = true;
  try {
    for (let i = 0; i < queue.length; i++) {
      const event = queue[i];
      const hasMore = i < queue.length - 1;
      const nextEvent = queue[i + 1];

      if (event.type === "call_uno") {
        const skipCallSound = pendingUserCallUno && event.playerId === finalSnap.you?.id;
        pendingUserCallUno = false;
        if (!skipCallSound) SOUNDS?.callUno?.();
        stagedSnap = mergePlayerFromFinal(stagedSnap, finalSnap, event.playerId);
        stagedSnap.message = finalSnap.message;
        renderTable({ ...data, snapshot: stagedSnap });
        if (hasMore) await sleep(280);
        continue;
      }

      if (event.type === "play") {
        if (!event.skipAnim) {
          await animatePlay(event, snapshotBefore);
        }
        stagedSnap = mergePlayerFromFinal(stagedSnap, finalSnap, event.playerId);
        stagedSnap.current_card = structuredClone(event.card);
        stagedSnap.chosen_color = event.card.color === "wild" ? finalSnap.chosen_color : event.card.color;
        if (hasMore && nextEvent?.playerId) {
          stagedSnap.current_player_id = nextEvent.playerId;
        }
        renderTable({ ...data, snapshot: hasMore ? stagedSnap : finalSnap });
        if (hasMore) await sleep(pauseMs);
        continue;
      }

      if (event.type === "draw" || event.type === "penalty") {
        await animateDraw(event, snapshotBefore);
        stagedSnap = mergePlayerFromFinal(stagedSnap, finalSnap, event.playerId);
        if (hasMore && nextEvent?.playerId) {
          stagedSnap.current_player_id = nextEvent.playerId;
        }
        renderTable({ ...data, snapshot: hasMore ? stagedSnap : finalSnap });
        if (hasMore) await sleep(pauseMs);
      }
    }
  } finally {
    animating = false;
  }
}

async function applyStateUpdate(data, { skipAnimation = false } = {}) {
  const snap = data.snapshot;
  if (!snap) return;

  const events = !skipAnimation && prevSnapshot ? detectEvents(prevSnapshot, snap) : [];
  await runEventAnimations(events, prevSnapshot, data);

  recordHistory(prevSnapshot, snap, events);
  const justFinished = prevSnapshot?.phase !== "finished" && snap.phase === "finished";
  prevSnapshot = structuredClone(snap);
  renderTable(data);
  if (justFinished) {
    if (snap.winner_id === snap.you?.id) SOUNDS?.win?.();
    else SOUNDS?.lose?.();
  }
}

function pollDelayMs() {
  const snap = lastState;
  if (!snap || snap.phase === "finished" || dataStatusLobby(snap)) {
    return RUNTIME.pollMsHuman;
  }
  if (isBotTurn(snap)) return RUNTIME.pollMsBot;
  if (mode === "online" && snap.current_player_id !== snap.you?.id) return RUNTIME.pollMsOnline;
  return RUNTIME.pollMsHuman;
}

function dataStatusLobby(snap) {
  return snap.room_status === "lobby";
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    try {
      await fetchState();
    } catch {
      schedulePoll();
    }
  }, pollDelayMs());
}

async function fetchState() {
  if (pollBusy || actionInFlight || animating) {
    schedulePoll();
    return null;
  }
  pollBusy = true;
  try {
    const res = await fetch(`/api/uno/rooms/${roomId}/state?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "加载失败");
    await applyStateUpdate(data);
    schedulePoll();
    return data;
  } finally {
    pollBusy = false;
  }
}

async function sendAction(action, payload = {}) {
  if (actionInFlight || animating) return null;
  actionInFlight = true;
  try {
    const res = await fetch(`/api/uno/rooms/${roomId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action, ...payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "操作失败");
    await applyStateUpdate(data);
    schedulePoll();
    return data;
  } finally {
    actionInFlight = false;
  }
}

async function playThenSend(action, payload = {}) {
  if (animating || actionInFlight) return null;

  const cardId = payload.card_id;
  const card = cardId && lastState?.you?.hand?.find((c) => c.id === cardId);
  const cardEl = cardId && els.handScroll?.querySelector(`[data-card-id="${cardId}"]`);

  if (action === "play" && card && cardEl && lastState?.you) {
    animating = true;
    try {
      await animatePlay(
        {
          type: "play",
          isYou: true,
          card,
          nickname: lastState.you.nickname || "你",
          playerId: lastState.you.id,
        },
        lastState,
        cardEl,
      );
      pendingUserPlayCardId = cardId;
    } finally {
      animating = false;
    }
  }

  return sendAction(action, payload);
}

function onPlayCard(card) {
  if (animating || actionInFlight) return;
  if (card.color === "wild" || card.value === "wild" || card.value === "wild_draw_four") {
    pendingWildCardId = card.id;
  }
  playThenSend("play", { card_id: card.id }).catch((e) => {
    pendingUserPlayCardId = null;
    els.gameMsg.textContent = e.message;
  });
}

function startTurnTimer(snap) {
  if (turnTimer) clearInterval(turnTimer);
  const live = lastState || snap;
  const myTurn = live.current_player_id === live.you?.id;
  if (!live.turn_started_at || !myTurn || live.phase !== "playing" || animating) {
    els.turnTimer.textContent = "";
    return;
  }
  const timeout = (live.turn_timeout_sec || 30) * 1000;
  const tick = () => {
    const cur = lastState || live;
    if (cur.current_player_id !== cur.you?.id || cur.phase !== "playing" || animating) {
      els.turnTimer.textContent = "";
      return;
    }
    const left = Math.max(0, Math.ceil((cur.turn_started_at + timeout - Date.now()) / 1000));
    els.turnTimer.textContent = left > 0 ? `${left}s` : "";
    if (left <= 0 && cur.turn_started_at !== lastAutoDrawAt) {
      lastAutoDrawAt = cur.turn_started_at;
      sendAction("draw").catch((e) => { els.gameMsg.textContent = e.message; });
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

function tryDraw() {
  const snap = lastState;
  if (animating || actionInFlight) return;
  if (!snap || snap.current_player_id !== snap.you?.id || snap.phase !== "playing") {
    els.gameMsg.textContent = snap?.phase === "choosing_color" ? "请先选色或等待对手" : "还没轮到你";
    return;
  }
  sendAction("draw").catch((e) => { els.gameMsg.textContent = e.message; });
}

els.drawPile.addEventListener("click", tryDraw);
els.btnDraw.addEventListener("click", tryDraw);
els.btnUno.addEventListener("click", () => {
  SOUNDS?.callUno?.();
  pendingUserCallUno = true;
  sendAction("call_uno").catch((e) => {
    pendingUserCallUno = false;
    els.gameMsg.textContent = e.message;
  });
});
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

document.addEventListener(
  "pointerdown",
  () => {
    SOUNDS?.unlock?.();
  },
  { once: true, passive: true },
);

if (els.historyToggle && els.historyPanel) {
  els.historyToggle.addEventListener("click", () => {
    const collapsed = els.historyPanel.classList.toggle("is-collapsed");
    els.historyToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });
}

renderHistoryPanel();

if (!roomId || !token) {
  window.location.href = "/uno.html";
} else {
  localStorage.setItem(`uno_token_${roomId}`, token);
  fetch(`/api/uno/rooms/${roomId}/state?token=${encodeURIComponent(token)}`)
    .then((res) => res.json().then((data) => ({ res, data })))
    .then(async ({ res, data }) => {
      if (!res.ok) throw new Error(data.error || "加载失败");
      await applyStateUpdate(data, { skipAnimation: true });
      schedulePoll();
    })
    .catch(() => { window.location.href = "/uno.html"; });
}
