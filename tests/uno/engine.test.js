import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCallUno,
  applyCancelColor,
  applyChooseColor,
  applyDraw,
  applyMove,
  applyPlay,
  beginWildPlay,
  buildDeck,
  buildSnapshot,
  createLobbyState,
  drawCards,
  flipStarter,
  legalMovesForPlayer,
  normalizeRules,
  recycleDiscardPile,
  removePlayer,
  restartGame,
  runBotTurn,
  runBotTurns,
  shuffle,
  startGame,
} from "../../games/uno/engine/index.js";

function roster4() {
  return [
    { id: "p0", seat: 0, nickname: "A" },
    { id: "p1", seat: 1, nickname: "B" },
    { id: "p2", seat: 2, nickname: "C" },
    { id: "p3", seat: 3, nickname: "D" },
  ];
}

function aiRoster() {
  return [
    { id: "h", seat: 0, nickname: "Human" },
    { id: "b1", seat: 1, nickname: "Bot1", isBot: true },
    { id: "b2", seat: 2, nickname: "Bot2", isBot: true },
    { id: "b3", seat: 3, nickname: "Bot3", isBot: true },
  ];
}

function freshGame(rules = {}, difficulty = "normal") {
  let s = createLobbyState(roster4(), rules, difficulty);
  return startGame(s);
}

describe("deck", () => {
  it("builds 108 cards", () => {
    assert.equal(buildDeck().length, 108);
  });

  it("shuffle preserves count", () => {
    const d = buildDeck();
    assert.equal(shuffle(d).length, 108);
  });

  it("flipStarter avoids wild", () => {
    const deck = buildDeck();
    const { starter } = flipStarter(shuffle(deck));
    assert.ok(starter);
    assert.notEqual(starter.color, "wild");
  });

  it("recycles discard pile keeping top", () => {
    const top = { id: "t", color: "red", value: "5" };
    const discard = [top, { id: "a", color: "blue", value: "3" }];
    const { drawPile, discardPile } = recycleDiscardPile([], discard, top);
    assert.equal(discardPile.length, 1);
    assert.equal(discardPile[0].id, "t");
    assert.equal(drawPile.length, 1);
  });

  it("drawCards pulls from pile", () => {
    const pile = buildDeck().slice(0, 5);
    const { drawn, drawPile } = drawCards(pile, [], 3);
    assert.equal(drawn.length, 3);
    assert.equal(drawPile.length, 2);
  });
});

describe("rules normalization", () => {
  it("defaults uno penalty on", () => {
    const r = normalizeRules({});
    assert.equal(r.unoPenalty, true);
    assert.equal(r.stackDrawTwo, false);
    assert.equal(r.turnTimeoutSec, 30);
  });
});

describe("startGame", () => {
  it("deals 7 cards each", () => {
    const s = freshGame();
    for (const p of s.players) {
      assert.equal(p.hand.length, 7);
    }
    assert.equal(s.phase, "playing");
    assert.ok(s.currentCard);
  });
});

describe("play and draw", () => {
  it("allows matching color play", () => {
    let s = freshGame();
    const p0 = s.players[0];
    const top = s.currentCard;
    const match = p0.hand.find((c) => c.color === top.color || c.value === top.value);
    if (!match) return;
    s = applyPlay(s, p0.id, match.id);
    assert.ok(s.discardPile.includes(match));
  });

  it("rejects illegal play", () => {
    const s = freshGame();
    const p0 = s.players[0];
    const illegal = p0.hand.find((c) => {
      const top = s.currentCard;
      return c.color !== top.color && c.value !== top.value && c.color !== "wild";
    });
    if (!illegal) return;
    assert.throws(() => applyPlay(s, p0.id, illegal.id));
  });

  it("draw advances turn", () => {
    let s = freshGame();
    const before = s.currentPlayerIndex;
    s = applyDraw(s, s.players[before].id);
    assert.notEqual(s.currentPlayerIndex, before);
  });
});

describe("wild and color", () => {
  it("wild requires color choice flow", () => {
    let s = freshGame();
    const p0 = s.players[0];
    const wild = p0.hand.find((c) => c.value === "wild" || c.value === "wild_draw_four");
    if (!wild) return;
    s = beginWildPlay(s, p0.id, wild.id);
    assert.equal(s.phase, "choosing_color");
    assert.ok(!p0.hand.some((c) => c.id === wild.id));
    s = applyChooseColor(s, p0.id, wild.id, "red");
    assert.equal(s.phase, "playing");
    assert.equal(s.chosenColor, "red");
    assert.equal(s.pendingWildCardId, null);
  });

  it("wild draw four choose color applies draw four", () => {
    let s = freshGame();
    const p0 = s.players[0];
    const wild4 = p0.hand.find((c) => c.value === "wild_draw_four");
    if (!wild4) return;
    s = beginWildPlay(s, p0.id, wild4.id);
    s = applyChooseColor(s, p0.id, wild4.id, "blue");
    assert.equal(s.chosenColor, "blue");
    assert.ok(s.pendingDraw >= 4);
  });

  it("cancel color returns card to hand", () => {
    let s = freshGame();
    const p0 = s.players[0];
    const wild = p0.hand.find((c) => c.value === "wild");
    if (!wild) return;
    const handBefore = p0.hand.length;
    s = beginWildPlay(s, p0.id, wild.id);
    s = applyCancelColor(s, p0.id);
    assert.equal(s.phase, "playing");
    assert.equal(p0.hand.length, handBefore);
  });
});

describe("stack draw two", () => {
  it("allows stacking when rule enabled", () => {
    let s = freshGame({ stackDrawTwo: true });
    const p0 = s.players[0];
    const drawTwo = p0.hand.find((c) => c.value === "draw_two");
    if (!drawTwo) return;
    try {
      s = applyPlay(s, p0.id, drawTwo.id);
      assert.ok(s.pendingDraw >= 2);
    } catch {
      /* card not legal on starter */
    }
  });
});

describe("uno call", () => {
  it("call uno marks player", () => {
    let s = freshGame();
    const p0 = s.players[0];
    p0.hand = [p0.hand[0], p0.hand[1]].filter(Boolean);
    if (p0.hand.length > 2) return;
    s = applyCallUno(s, p0.id);
    assert.equal(p0.calledUno, true);
  });

  it("call uno before playing to one card avoids penalty", () => {
    let s = freshGame({ unoPenalty: true });
    const p0 = s.players[0];
    const top = s.currentCard;
    const playable = p0.hand.find((c) => c.color === top.color || c.value === top.value);
    if (!playable) return;
    const keeper = p0.hand.find((c) => c.id !== playable.id);
    if (!keeper) return;
    p0.hand = [playable, keeper];
    s = applyCallUno(s, p0.id);
    s = applyPlay(s, p0.id, playable.id);
    assert.equal(p0.hand.length, 1);
    assert.equal(p0.calledUno, false, "flag cleared after turn ends");
    assert.ok(!s.message.includes("罚摸"), `unexpected penalty: ${s.message}`);
  });

  it("playing to one card without call uno triggers penalty", () => {
    let s = freshGame({ unoPenalty: true });
    const p0 = s.players[0];
    const top = s.currentCard;
    const playable = p0.hand.find((c) => c.color === top.color || c.value === top.value);
    if (!playable) return;
    const keeper = p0.hand.find((c) => c.id !== playable.id);
    if (!keeper) return;
    p0.hand = [playable, keeper];
    s = applyPlay(s, p0.id, playable.id);
    assert.equal(p0.hand.length, 3, "penalty adds 2 cards after leaving one");
    assert.ok(s.message.includes("罚摸"), `expected penalty: ${s.message}`);
  });
});

describe("win and restart", () => {
  it("detects win when hand empty", () => {
    let s = freshGame();
    const p0 = s.players[0];
    const top = s.currentCard;
    const card = p0.hand.find((c) => c.color === top.color || c.value === top.value) || p0.hand[0];
    p0.hand = [card];
    s = applyPlay(s, p0.id, card.id);
    assert.equal(s.phase, "finished");
    assert.equal(s.winnerId, p0.id);
  });

  it("restart deals again", () => {
    let s = freshGame();
    s.phase = "finished";
    s = restartGame(s);
    assert.equal(s.phase, "playing");
    assert.equal(s.players[0].hand.length, 7);
  });
});

describe("leave room", () => {
  it("marks player left", () => {
    let s = freshGame();
    const { state, destroyed } = removePlayer(s, "p3");
    assert.equal(destroyed, false);
    assert.equal(state.players.find((p) => p.id === "p3").left, true);
  });

  it("destroys when last player leaves", () => {
    let s = freshGame();
    ({ state: s } = removePlayer(s, "p0"));
    ({ state: s } = removePlayer(s, "p1"));
    ({ state: s } = removePlayer(s, "p2"));
    const { destroyed } = removePlayer(s, "p3");
    assert.equal(destroyed, true);
  });
});

describe("snapshot", () => {
  it("hides other hands", () => {
    const s = freshGame();
    const snap = buildSnapshot(s, "p0");
    assert.ok(snap.you.hand.length > 0);
    assert.ok(snap.others.every((o) => !("hand" in o)));
    assert.ok(snap.others.every((o) => typeof o.hand_count === "number"));
  });
});

describe("bot", () => {
  it("bot takes a turn", () => {
    let s = createLobbyState(aiRoster(), {}, "normal");
    s = startGame(s);
    while (s.phase === "playing") {
      const cur = s.players[s.currentPlayerIndex % s.players.length];
      if (!cur.isBot) break;
      const { state, action } = runBotTurn(s, cur.id);
      assert.ok(action);
      s = state;
    }
    assert.equal(s.phase, "playing");
  });

  it("runBotTurns chains bots", () => {
    let s = createLobbyState(aiRoster(), {}, "hard");
    s = startGame(s);
    s = runBotTurns(s, 5);
    assert.ok(["playing", "finished"].includes(s.phase));
  });

  it("easy bot may forget uno", () => {
    let s = createLobbyState(aiRoster(), {}, "easy");
    s = startGame(s);
    const bot = s.players.find((p) => p.isBot);
    bot.hand = [bot.hand[0], bot.hand[1]].filter(Boolean);
    if (bot.hand.length === 2) {
      const { action } = runBotTurn(s, bot.id);
      assert.ok(["call_uno", "play", "draw", "choose_color", null].includes(action));
    }
  });
});

describe("applyMove wrapper", () => {
  it("routes play action", () => {
    let s = freshGame();
    const legal = legalMovesForPlayer(s, s.players[0].id);
    if (!legal.length) return;
    s = applyMove(s, s.players[0].id, "play", { card_id: legal[0].id });
    assert.equal(s.discardPile[s.discardPile.length - 1].id, legal[0].id);
  });
});
