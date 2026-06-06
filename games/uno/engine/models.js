/** @typedef {'red'|'yellow'|'green'|'blue'|'wild'} CardColor */
/** @typedef {'0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'skip'|'reverse'|'draw_two'|'wild'|'wild_draw_four'} CardValue */

/**
 * @typedef {object} Card
 * @property {string} id
 * @property {CardColor} color
 * @property {CardValue} value
 */

/**
 * @typedef {object} RoomRules
 * @property {boolean} unoPenalty
 * @property {boolean} stackDrawTwo
 * @property {number} turnTimeoutSec
 */

/**
 * @typedef {'easy'|'normal'|'hard'} AiDifficulty
 */

/**
 * @typedef {object} PlayerState
 * @property {string} id
 * @property {number} seat
 * @property {string} nickname
 * @property {boolean} isBot
 * @property {Card[]} hand
 * @property {Card[]} played
 * @property {boolean} calledUno
 * @property {boolean} left
 */

/**
 * @typedef {'lobby'|'playing'|'choosing_color'|'finished'} GamePhase
 */

/**
 * @typedef {object} GameState
 * @property {PlayerState[]} players
 * @property {number} currentPlayerIndex
 * @property {1|-1} direction
 * @property {Card[]} drawPile
 * @property {Card[]} discardPile
 * @property {Card|null} currentCard
 * @property {CardColor|null} chosenColor
 * @property {number} pendingDraw
 * @property {GamePhase} phase
 * @property {string|null} winnerId
 * @property {string} message
 * @property {RoomRules} rules
 * @property {AiDifficulty} aiDifficulty
 * @property {number} turnStartedAt
 * @property {string|null} pendingWildCardId
 */

export const COLORS = /** @type {const} */ (["red", "yellow", "green", "blue"]);
export const NUMBER_VALUES = /** @type {const} */ (["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
export const ACTION_VALUES = /** @type {const} */ (["skip", "reverse", "draw_two"]);
export const WILD_VALUES = /** @type {const} */ (["wild", "wild_draw_four"]);

export const DEFAULT_RULES = /** @type {RoomRules} */ ({
  unoPenalty: true,
  stackDrawTwo: false,
  turnTimeoutSec: 30,
});

/**
 * @param {Partial<RoomRules>} [partial]
 * @returns {RoomRules}
 */
export function normalizeRules(partial = {}) {
  const turnTimeoutSec = Number(partial.turnTimeoutSec);
  return {
    unoPenalty: partial.unoPenalty !== false,
    stackDrawTwo: Boolean(partial.stackDrawTwo),
    turnTimeoutSec: Number.isFinite(turnTimeoutSec) && turnTimeoutSec > 0 ? Math.min(turnTimeoutSec, 120) : 30,
  };
}

/**
 * @param {string} id
 * @param {number} seat
 * @param {string} nickname
 * @param {boolean} [isBot]
 * @returns {PlayerState}
 */
export function createPlayer(id, seat, nickname, isBot = false) {
  return {
    id,
    seat,
    nickname: nickname.slice(0, 16) || (isBot ? `Bot${seat}` : "玩家"),
    isBot,
    hand: [],
    played: [],
    calledUno: false,
    left: false,
  };
}

/**
 * @param {PlayerState[]} players
 * @param {RoomRules} rules
 * @param {AiDifficulty} [aiDifficulty]
 * @returns {GameState}
 */
export function createEmptyGameState(players, rules, aiDifficulty = "normal") {
  return {
    players,
    currentPlayerIndex: 0,
    direction: 1,
    drawPile: [],
    discardPile: [],
    currentCard: null,
    chosenColor: null,
    pendingDraw: 0,
    phase: "lobby",
    winnerId: null,
    message: "",
    rules: normalizeRules(rules),
    aiDifficulty,
    turnStartedAt: Date.now(),
    pendingWildCardId: null,
  };
}

/**
 * @param {GameState} state
 * @returns {PlayerState[]}
 */
export function activePlayers(state) {
  return state.players.filter((p) => !p.left);
}

/**
 * @param {GameState} state
 * @returns {PlayerState|undefined}
 */
export function currentPlayer(state) {
  const active = activePlayers(state);
  if (!active.length) return undefined;
  const idx = state.currentPlayerIndex % active.length;
  return active[idx];
}

/**
 * @param {Card} card
 * @returns {boolean}
 */
export function isWildCard(card) {
  return card.color === "wild" || card.value === "wild" || card.value === "wild_draw_four";
}
