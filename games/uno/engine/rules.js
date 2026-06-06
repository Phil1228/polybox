import { activePlayers, currentPlayer, isWildCard } from "./models.js";

/** @typedef {import('./models.js').Card} Card */
/** @typedef {import('./models.js').CardColor} CardColor */
/** @typedef {import('./models.js').GameState} GameState */
/** @typedef {import('./models.js').RoomRules} RoomRules */

/**
 * @param {Card} card
 * @param {Card} top
 * @param {CardColor|null} chosenColor
 * @returns {boolean}
 */
export function cardMatches(card, top, chosenColor) {
  if (isWildCard(card)) return true;
  const effectiveColor = top.color === "wild" ? chosenColor : top.color;
  if (!effectiveColor) return false;
  if (card.color === effectiveColor) return true;
  if (card.value === top.value) return true;
  return false;
}

/**
 * @param {Card[]} hand
 * @param {Card} top
 * @param {CardColor|null} chosenColor
 * @param {number} pendingDraw
 * @param {RoomRules} rules
 * @returns {Card[]}
 */
export function legalCardsToPlay(hand, top, chosenColor, pendingDraw, rules) {
  if (!top) return [];
  if (pendingDraw > 0) {
    if (rules.stackDrawTwo) {
      return hand.filter((c) => c.value === "draw_two");
    }
    return [];
  }
  return hand.filter((c) => cardMatches(c, top, chosenColor));
}

/**
 * @param {Card[]} hand
 * @param {CardColor} color
 * @returns {boolean}
 */
export function hasColorInHand(hand, color) {
  return hand.some((c) => !isWildCard(c) && c.color === color);
}

/**
 * @param {Card} card
 * @param {Card[]} hand
 * @param {GameState} state
 * @returns {boolean}
 */
export function canPlayCard(card, hand, state) {
  if (!state.currentCard) return false;
  if (state.phase === "choosing_color") return false;
  if (!hand.some((c) => c.id === card.id)) return false;

  if (state.pendingDraw > 0) {
    if (!state.rules.stackDrawTwo) return false;
    return card.value === "draw_two";
  }

  if (card.value === "wild_draw_four") {
    const effectiveColor = state.currentCard.color === "wild" ? state.chosenColor : state.currentCard.color;
    if (effectiveColor && hasColorInHand(hand.filter((c) => c.id !== card.id), effectiveColor)) {
      return false;
    }
  }

  return cardMatches(card, state.currentCard, state.chosenColor);
}

/**
 * @param {GameState} state
 * @param {string} playerId
 * @returns {Card[]}
 */
export function legalMovesForPlayer(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.left) return [];
  if (state.phase !== "playing" && state.phase !== "choosing_color") return [];
  const current = currentPlayer(state);
  if (!current || current.id !== playerId) return [];
  if (!state.currentCard) return [];
  if (state.phase === "choosing_color") return [];
  return legalCardsToPlay(player.hand, state.currentCard, state.chosenColor, state.pendingDraw, state.rules);
}
