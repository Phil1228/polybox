import { applyCallUno, applyDraw, applyMove } from "./engine.js";
import { COLORS, currentPlayer, isWildCard } from "./models.js";
import { legalMovesForPlayer } from "./rules.js";

/** @typedef {import('./models.js').AiDifficulty} AiDifficulty */
/** @typedef {import('./models.js').Card} Card */
/** @typedef {import('./models.js').CardColor} CardColor */
/** @typedef {import('./models.js').GameState} GameState */

/**
 * @param {AiDifficulty} difficulty
 * @returns {number}
 */
function randomness(difficulty) {
  if (difficulty === "easy") return 0.55;
  if (difficulty === "hard") return 0.08;
  return 0.25;
}

/**
 * @param {GameState} state
 * @returns {Array<{ id: string, hand_count: number }>}
 */
function opponents(state) {
  const cur = currentPlayer(state);
  if (!cur) return [];
  return state.players
    .filter((p) => !p.left && !p.isBot && p.id !== cur.id)
    .map((p) => ({ id: p.id, hand_count: p.hand.length }));
}

/**
 * @param {Card[]} legal
 * @param {GameState} state
 * @param {AiDifficulty} difficulty
 * @returns {Card|null}
 */
function pickCard(legal, state, difficulty) {
  if (!legal.length) return null;
  const r = Math.random();
  if (r < randomness(difficulty)) {
    return legal[Math.floor(Math.random() * legal.length)];
  }

  const ops = opponents(state);
  const minOpp = ops.length ? Math.min(...ops.map((o) => o.hand_count)) : 99;

  if (difficulty === "hard" && state.pendingDraw > 0 && state.rules.stackDrawTwo) {
    const plus2 = legal.filter((c) => c.value === "draw_two");
    if (plus2.length) return plus2[0];
  }

  if (difficulty !== "easy") {
    const wilds = legal.filter((c) => isWildCard(c));
    const nonWilds = legal.filter((c) => !isWildCard(c));
    if (wilds.length && nonWilds.length && Math.random() > 0.35) {
      legal = nonWilds;
    }
  }

  const scored = legal.map((card) => {
    let score = 0;
    if (card.value === "draw_two") score += difficulty === "hard" && minOpp <= 3 ? 8 : 3;
    if (card.value === "skip") score += difficulty === "hard" && minOpp <= 2 ? 7 : 2;
    if (card.value === "wild_draw_four") score += 5;
    if (card.value === "wild") score += difficulty === "hard" ? 1 : 2;
    if (card.value === "reverse") score += 1;
    if (!isWildCard(card)) score += 0.5;
    return { card, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.card || legal[0];
}

/**
 * @param {GameState} state
 * @param {Card[]} hand
 * @returns {CardColor}
 */
function pickColor(state, hand, difficulty) {
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const card of hand) {
    if (!isWildCard(card)) counts[card.color] += 1;
  }
  const sorted = COLORS.map((c) => ({ c, n: counts[c] })).sort((a, b) => b.n - a.n);
  if (difficulty === "easy" && Math.random() < 0.3) {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }
  return sorted[0]?.n > 0 ? sorted[0].c : COLORS[0];
}

/**
 * @param {GameState} state
 * @param {string} botId
 * @returns {{ state: GameState, action: string|null }}
 */
export function runBotTurn(state, botId) {
  const player = state.players.find((p) => p.id === botId);
  if (!player || !player.isBot || player.left) return { state, action: null };

  const cur = currentPlayer(state);
  if (!cur || cur.id !== botId) return { state, action: null };

  if (player.hand.length <= 2) {
    const forget = state.aiDifficulty === "easy" ? Math.random() < 0.45 : state.aiDifficulty === "normal" ? Math.random() < 0.12 : Math.random() < 0.03;
    if (!forget && !player.calledUno) {
      try {
        return { state: applyCallUno(state, botId), action: "call_uno" };
      } catch {
        /* continue */
      }
    }
  }

  if (state.phase === "choosing_color" && state.pendingWildCardId) {
    const color = pickColor(state, player.hand, state.aiDifficulty);
    try {
      return {
        state: applyMove(state, botId, "choose_color", { card_id: state.pendingWildCardId, color }),
        action: "choose_color",
      };
    } catch {
      try {
        return { state: applyMove(state, botId, "cancel_color"), action: "cancel_color" };
      } catch {
        return { state, action: null };
      }
    }
  }

  const legal = legalMovesForPlayer(state, botId);
  if (legal.length) {
    const card = pickCard(legal, state, state.aiDifficulty);
    if (card) {
      try {
        if (isWildCard(card)) {
          const color = pickColor(state, player.hand, state.aiDifficulty);
          if (state.aiDifficulty === "easy" && Math.random() < 0.2) {
            return { state: applyMove(state, botId, "play", { card_id: card.id }), action: "play" };
          }
          return { state: applyMove(state, botId, "play", { card_id: card.id, chosen_color: color }), action: "play" };
        }
        return { state: applyMove(state, botId, "play", { card_id: card.id }), action: "play" };
      } catch {
        /* fall through to draw */
      }
    }
  }

  try {
    return { state: applyDraw(state, botId), action: "draw" };
  } catch {
    return { state, action: null };
  }
}

/**
 * @param {GameState} state
 * @param {number} [maxSteps]
 * @returns {GameState}
 */
export function runBotTurns(state, maxSteps = 12) {
  let steps = 0;
  let current = state;
  while (steps < maxSteps && current.phase === "playing") {
    const cur = currentPlayer(current);
    if (!cur || !cur.isBot) break;
    const { state: next, action } = runBotTurn(current, cur.id);
    if (!action) break;
    current = next;
    steps += 1;
    if (current.phase === "finished") break;
  }
  return current;
}

/**
 * @param {GameState} state
 * @param {string} playerId
 * @returns {boolean}
 */
export function shouldBotPlay(state, playerId) {
  const cur = currentPlayer(state);
  return Boolean(cur && cur.id === playerId && cur.isBot && (state.phase === "playing" || state.phase === "choosing_color"));
}
