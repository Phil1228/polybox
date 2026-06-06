import { buildDeck, drawCards, flipStarter, shuffle } from "./deck.js";
import {
  activePlayers,
  createEmptyGameState,
  createPlayer,
  currentPlayer,
  isWildCard,
  normalizeRules,
} from "./models.js";
import { canPlayCard, legalMovesForPlayer } from "./rules.js";

/** @typedef {import('./models.js').AiDifficulty} AiDifficulty */
/** @typedef {import('./models.js').Card} Card */
/** @typedef {import('./models.js').CardColor} CardColor */
/** @typedef {import('./models.js').GameState} GameState */
/** @typedef {import('./models.js').PlayerState} PlayerState */
/** @typedef {import('./models.js').RoomRules} RoomRules */

/**
 * @param {Array<{ id: string, seat: number, nickname: string, isBot?: boolean }>} roster
 * @param {RoomRules} rules
 * @param {AiDifficulty} [aiDifficulty]
 * @returns {GameState}
 */
export function createLobbyState(roster, rules, aiDifficulty = "normal") {
  const players = roster.map((r) => createPlayer(r.id, r.seat, r.nickname, Boolean(r.isBot)));
  return createEmptyGameState(players, rules, aiDifficulty);
}

/**
 * @param {GameState} state
 * @returns {GameState}
 */
export function startGame(state) {
  const active = activePlayers(state);
  if (active.length < 2) {
    throw new Error("至少需要 2 名玩家");
  }

  const deck = shuffle(buildDeck());
  const { drawPile, starter } = flipStarter(deck);
  if (!starter) throw new Error("无法翻开起始牌");

  /** @type {PlayerState[]} */
  const players = state.players.map((p) => ({
    ...p,
    hand: [],
    played: [],
    calledUno: false,
    left: p.left,
  }));

  let pile = [...drawPile];
  for (const player of players.filter((p) => !p.left)) {
    const drawn = drawCards(pile, [starter], 7);
    pile = drawn.drawPile;
    player.hand = drawn.drawn;
  }

  return {
    ...state,
    players,
    drawPile: pile,
    discardPile: [starter],
    currentCard: starter,
    chosenColor: starter.color === "wild" ? null : starter.color,
    pendingDraw: 0,
    phase: "playing",
    winnerId: null,
    message: "游戏开始",
    currentPlayerIndex: 0,
    direction: 1,
    turnStartedAt: Date.now(),
    pendingWildCardId: null,
  };
}

/**
 * @param {GameState} state
 * @returns {GameState}
 */
export function restartGame(state) {
  const roster = state.players.filter((p) => !p.left).map((p) => ({
    id: p.id,
    seat: p.seat,
    nickname: p.nickname,
    isBot: p.isBot,
  }));
  const lobby = createLobbyState(roster, state.rules, state.aiDifficulty);
  return startGame({ ...lobby, players: state.players.filter((p) => !p.left) });
}

/**
 * @param {GameState} state
 */
function applyUnoPenaltyAtTurnEnd(state) {
  if (!state.rules.unoPenalty) return;
  const player = currentPlayer(state);
  if (!player) return;
  if (player.hand.length === 1 && !player.calledUno) {
    const drawn = drawCards(state.drawPile, state.discardPile, 2);
    player.hand.push(...drawn.drawn);
    state.drawPile = drawn.drawPile;
    state.message = `${player.nickname} 未喊 UNO，罚摸 2 张`;
  }
  player.calledUno = false;
}

/**
 * @param {GameState} state
 */
function advanceTurn(state) {
  applyUnoPenaltyAtTurnEnd(state);
  const active = activePlayers(state);
  if (!active.length) return;
  state.currentPlayerIndex = (state.currentPlayerIndex + state.direction + active.length) % active.length;
  state.turnStartedAt = Date.now();
}

/**
 * @param {GameState} state
 * @param {Card} card
 */
function applyCardEffect(state, card) {
  const active = activePlayers(state);
  if (card.value === "skip") {
    state.currentPlayerIndex = (state.currentPlayerIndex + state.direction + active.length) % active.length;
    state.message = "跳过下家";
  } else if (card.value === "reverse") {
    if (active.length === 2) {
      state.currentPlayerIndex = (state.currentPlayerIndex + state.direction + active.length) % active.length;
      state.message = "反转（两人局视为跳过）";
    } else {
      state.direction = /** @type {1|-1} */ (state.direction * -1);
      state.message = "方向反转";
    }
  } else if (card.value === "draw_two") {
    state.pendingDraw += 2;
    state.message = state.rules.stackDrawTwo ? "+2 可叠加" : "下家摸 2 张";
  } else if (card.value === "wild_draw_four") {
    state.pendingDraw += 4;
    state.message = "下家摸 4 张";
  }
}

/**
 * @param {GameState} state
 * @param {string} playerId
 * @param {string} cardId
 * @param {CardColor} [chosenColor]
 */
export function applyPlay(state, playerId, cardId, chosenColor) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.left) throw new Error("玩家不存在");
  const cur = currentPlayer(state);
  if (!cur || cur.id !== playerId) throw new Error("还没轮到你");
  if (state.phase !== "playing") throw new Error("当前不能出牌");

  const idx = player.hand.findIndex((c) => c.id === cardId);
  if (idx < 0) throw new Error("手牌中没有这张牌");
  const card = player.hand[idx];
  if (!canPlayCard(card, player.hand, state)) throw new Error("不能出这张牌");

  player.hand.splice(idx, 1);
  player.played.push(card);
  state.discardPile.push(card);
  state.currentCard = card;

  if (isWildCard(card)) {
    if (!chosenColor || chosenColor === "wild") throw new Error("请选择颜色");
    state.chosenColor = chosenColor;
    state.pendingWildCardId = null;
    state.phase = "playing";
  } else {
    state.chosenColor = card.color;
  }

  if (player.hand.length === 0) {
    state.phase = "finished";
    state.winnerId = playerId;
    state.message = `${player.nickname} 获胜！`;
    return state;
  }

  applyCardEffect(state, card);
  advanceTurn(state);
  return state;
}

/**
 * @param {GameState} state
 * @param {string} playerId
 */
export function applyDraw(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.left) throw new Error("玩家不存在");
  const cur = currentPlayer(state);
  if (!cur || cur.id !== playerId) throw new Error("还没轮到你");
  if (state.phase !== "playing") throw new Error("当前不能摸牌");

  const count = state.pendingDraw > 0 ? state.pendingDraw : 1;
  const drawn = drawCards(state.drawPile, state.discardPile, count);
  player.hand.push(...drawn.drawn);
  state.drawPile = drawn.drawPile;
  state.pendingDraw = 0;
  state.message = count > 1 ? `摸了 ${count} 张` : "摸了 1 张";
  if (player.hand.length > 1) {
    player.calledUno = false;
  }
  advanceTurn(state);
  return state;
}

/**
 * @param {GameState} state
 * @param {string} playerId
 */
export function applyCallUno(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.left) throw new Error("玩家不存在");
  if (player.hand.length > 2) throw new Error("手牌过多，不能喊 UNO");
  player.calledUno = true;
  state.message = `${player.nickname} 喊了 UNO!`;
  return state;
}

/**
 * @param {GameState} state
 * @param {string} playerId
 * @param {string} cardId
 * @param {CardColor} color
 */
export function applyChooseColor(state, playerId, cardId, color) {
  if (state.phase !== "choosing_color") throw new Error("当前不需要选色");
  if (state.pendingWildCardId !== cardId) throw new Error("选色状态无效");

  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.left) throw new Error("玩家不存在");
  const cur = currentPlayer(state);
  if (!cur || cur.id !== playerId) throw new Error("还没轮到你");
  if (!color || color === "wild") throw new Error("请选择颜色");

  const card = state.currentCard;
  if (!card || card.id !== cardId || !isWildCard(card)) throw new Error("选色状态无效");

  state.chosenColor = color;
  state.pendingWildCardId = null;
  state.phase = "playing";

  const colorLabel = { red: "红色", yellow: "黄色", green: "绿色", blue: "蓝色" }[color] || color;
  state.message = `选择了${colorLabel}`;

  if (player.hand.length === 0) {
    state.phase = "finished";
    state.winnerId = playerId;
    state.message = `${player.nickname} 获胜！`;
    return state;
  }

  applyCardEffect(state, card);
  advanceTurn(state);
  return state;
}

/**
 * @param {GameState} state
 * @param {string} playerId
 */
export function applyCancelColor(state, playerId) {
  if (state.phase !== "choosing_color") throw new Error("当前没有待选色的牌");
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在");
  const cardId = state.pendingWildCardId;
  if (!cardId) throw new Error("没有待取消的牌");

  const playedIdx = player.played.findIndex((c) => c.id === cardId);
  if (playedIdx < 0) throw new Error("牌不在已出区");
  const card = player.played.splice(playedIdx, 1)[0];
  player.hand.push(card);
  state.discardPile.pop();
  const prev = state.discardPile[state.discardPile.length - 1] || null;
  state.currentCard = prev;
  state.chosenColor = prev && prev.color !== "wild" ? prev.color : state.chosenColor;
  state.phase = "playing";
  state.pendingWildCardId = null;
  state.message = "已取消选色，牌收回手牌";
  return state;
}

/**
 * @param {GameState} state
 * @param {string} playerId
 * @param {string} cardId
 * @param {CardColor} [chosenColor]
 */
export function beginWildPlay(state, playerId, cardId, chosenColor) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在");
  const idx = player.hand.findIndex((c) => c.id === cardId);
  if (idx < 0) throw new Error("手牌中没有这张牌");
  const card = player.hand[idx];
  if (!isWildCard(card)) throw new Error("不是 Wild 牌");

  if (chosenColor && chosenColor !== "wild") {
    return applyPlay(state, playerId, cardId, chosenColor);
  }

  player.hand.splice(idx, 1);
  player.played.push(card);
  state.discardPile.push(card);
  state.currentCard = card;
  state.phase = "choosing_color";
  state.pendingWildCardId = cardId;
  state.message = "请选择颜色";
  return state;
}

/**
 * @param {GameState} state
 * @param {string} playerId
 * @param {string} action
 * @param {object} [payload]
 */
export function applyMove(state, playerId, action, payload = {}) {
  switch (action) {
    case "play": {
      const cardId = String(payload.card_id || payload.cardId || "");
      const color = /** @type {CardColor|undefined} */ (payload.chosen_color || payload.chosenColor);
      const player = state.players.find((p) => p.id === playerId);
      const card = player?.hand.find((c) => c.id === cardId);
      if (card && isWildCard(card) && !color) {
        return beginWildPlay(state, playerId, cardId);
      }
      return applyPlay(state, playerId, cardId, color);
    }
    case "draw":
      return applyDraw(state, playerId);
    case "call_uno":
      return applyCallUno(state, playerId);
    case "choose_color":
      return applyChooseColor(state, playerId, String(payload.card_id || payload.cardId || ""), payload.color);
    case "cancel_color":
      return applyCancelColor(state, playerId);
    default:
      throw new Error(`未知 action: ${action}`);
  }
}

/**
 * @param {GameState} state
 * @param {string} viewerId
 */
export function buildSnapshot(state, viewerId) {
  const active = activePlayers(state);
  const viewer = state.players.find((p) => p.id === viewerId);
  const seatOffset = viewer ? viewer.seat : 0;

  const ordered = [...active].sort((a, b) => a.seat - b.seat);
  const you = viewer && !viewer.left ? viewer : null;
  const others = ordered
    .filter((p) => p.id !== viewerId)
    .map((p) => ({
      id: p.id,
      seat: p.seat,
      nickname: p.nickname,
      isBot: p.isBot,
      hand_count: p.hand.length,
      called_uno: p.calledUno,
      played: p.played.slice(-3),
      left: p.left,
    }));

  const cur = currentPlayer(state);
  const legal = you ? legalMovesForPlayer(state, viewerId).map((c) => c.id) : [];

  return {
    room_status: state.phase === "lobby" ? "lobby" : state.phase === "finished" ? "finished" : "playing",
    phase: state.phase,
    message: state.message,
    direction: state.direction,
    current_player_id: cur?.id || null,
    current_card: state.currentCard,
    chosen_color: state.chosenColor,
    pending_draw: state.pendingDraw,
    draw_pile_count: state.drawPile.length,
    winner_id: state.winnerId,
    rules: state.rules,
    ai_difficulty: state.aiDifficulty,
    turn_started_at: state.turnStartedAt,
    turn_timeout_sec: state.rules.turnTimeoutSec,
    you: you
      ? {
          id: you.id,
          seat: you.seat,
          nickname: you.nickname,
          hand: you.hand,
          played: you.played.slice(-3),
          called_uno: you.calledUno,
        }
      : null,
    others,
    legal_moves: legal,
    can_call_uno: Boolean(you && you.hand.length <= 2 && !you.calledUno),
    choosing_color: state.phase === "choosing_color",
    pending_wild_card_id: state.pendingWildCardId,
    seat_offset: seatOffset,
    players: ordered.map((p) => ({
      id: p.id,
      seat: p.seat,
      nickname: p.nickname,
      is_bot: p.isBot,
      left: p.left,
    })),
  };
}

/**
 * @param {GameState} state
 * @param {string} playerId
 */
export function removePlayer(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { state, destroyed: false, hostTransferred: false };

  const wasCurrent = currentPlayer(state)?.id === playerId;
  if (wasCurrent && state.phase === "playing") {
    try {
      applyDraw(state, playerId);
    } catch {
      /* still remove player */
    }
  }
  player.left = true;

  const remaining = activePlayers(state);
  if (!remaining.length) {
    return { state, destroyed: true, hostTransferred: false };
  }

  const activeIdx = activePlayers(state).findIndex((p) => p.id === playerId);
  if (activeIdx >= 0 && activeIdx < state.currentPlayerIndex) {
    state.currentPlayerIndex = Math.max(0, state.currentPlayerIndex - 1);
  }

  return { state, destroyed: false, hostTransferred: true };
}
