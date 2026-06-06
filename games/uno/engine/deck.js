import { ACTION_VALUES, COLORS, NUMBER_VALUES, WILD_VALUES } from "./models.js";

/** @typedef {import('./models.js').Card} Card */

let cardSeq = 0;

/**
 * @returns {string}
 */
function nextCardId() {
  cardSeq += 1;
  return `c${cardSeq}`;
}

/**
 * @param {typeof COLORS[number]} color
 * @param {string} value
 * @returns {Card}
 */
function makeCard(color, value) {
  return { id: nextCardId(), color, value: /** @type {Card['value']} */ (value) };
}

/**
 * @returns {Card[]}
 */
export function buildDeck() {
  cardSeq = 0;
  /** @type {Card[]} */
  const cards = [];

  for (const color of COLORS) {
    cards.push(makeCard(color, "0"));
    for (const value of NUMBER_VALUES.slice(1)) {
      cards.push(makeCard(color, value));
      cards.push(makeCard(color, value));
    }
    for (const value of ACTION_VALUES) {
      cards.push(makeCard(color, value));
      cards.push(makeCard(color, value));
    }
  }

  for (let i = 0; i < 4; i += 1) {
    for (const value of WILD_VALUES) {
      cards.push(makeCard("wild", value));
    }
  }

  return cards;
}

/**
 * @param {Card[]} cards
 * @returns {Card[]}
 */
export function shuffle(cards) {
  const arr = [...cards];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * @param {Card[]} drawPile
 * @param {Card[]} discardPile
 * @param {Card} keepTop
 * @returns {{ drawPile: Card[], discardPile: Card[] }}
 */
export function recycleDiscardPile(drawPile, discardPile, keepTop) {
  const rest = discardPile.filter((c) => c.id !== keepTop.id);
  return {
    drawPile: shuffle([...drawPile, ...rest]),
    discardPile: [keepTop],
  };
}

/**
 * @param {Card[]} drawPile
 * @param {Card[]} discardPile
 * @param {number} count
 * @returns {{ drawPile: Card[], drawn: Card[] }}
 */
export function drawCards(drawPile, discardPile, count) {
  let pile = [...drawPile];
  const drawn = [];
  let disc = [...discardPile];

  for (let i = 0; i < count; i += 1) {
    if (!pile.length) {
      const top = disc[disc.length - 1];
      if (!top || disc.length <= 1) break;
      const recycled = recycleDiscardPile(pile, disc, top);
      pile = recycled.drawPile;
      disc = recycled.discardPile;
    }
    const card = pile.shift();
    if (card) drawn.push(card);
  }

  return { drawPile: pile, drawn };
}

/**
 * @param {Card[]} deck
 * @returns {{ drawPile: Card[], starter: Card|null, reshuffles: number }}
 */
export function flipStarter(deck) {
  let pile = [...deck];
  let reshuffles = 0;
  let starter = null;

  while (pile.length) {
    const card = pile.shift();
    if (!card) break;
    if (card.color === "wild") {
      pile.push(card);
      pile = shuffle(pile);
      reshuffles += 1;
      continue;
    }
    starter = card;
    break;
  }

  return { drawPile: pile, starter, reshuffles };
}
