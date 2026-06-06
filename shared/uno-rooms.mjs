import { randomBytes } from "node:crypto";
import {
  applyMove,
  buildSnapshot,
  createLobbyState,
  normalizeRules,
  removePlayer,
  restartGame,
  runBotTurns,
  startGame,
} from "../games/uno/engine/index.js";

/**
 * @typedef {object} UnoDeps
 * @property {(sql: string) => { all: (...args: unknown[]) => Promise<unknown[]>, get: (...args: unknown[]) => Promise<unknown|undefined>, run: (...args: unknown[]) => Promise<{ changes: number, lastInsertRowid?: number }> }} prepare
 */

const AI_BOT_NAMES = ["Bot·东", "Bot·北", "Bot·西"];

/**
 * @returns {string}
 */
function newToken() {
  return randomBytes(16).toString("hex");
}

/**
 * @param {UnoDeps} deps
 * @returns {Promise<string>}
 */
async function generateRoomId(deps) {
  for (let i = 0; i < 30; i += 1) {
    const id = String(1000 + Math.floor(Math.random() * 9000));
    const existing = await deps.prepare("SELECT id FROM uno_rooms WHERE id = ?").get(id);
    if (!existing) return id;
  }
  throw new Error("无法生成房间号");
}

/**
 * @param {unknown} row
 */
function parseRoomRow(row) {
  if (!row || typeof row !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (row);
  return {
    id: String(r.id),
    mode: String(r.mode),
    rules: normalizeRules(JSON.parse(String(r.rules_json || "{}"))),
    aiDifficulty: /** @type {import('../games/uno/engine/models.js').AiDifficulty} */ (
      r.ai_difficulty === "easy" || r.ai_difficulty === "hard" ? r.ai_difficulty : "normal"
    ),
    status: String(r.status),
    gameState: JSON.parse(String(r.game_state_json || "{}")),
    hostPlayerId: String(r.host_player_id),
    updatedAt: String(r.updated_at || ""),
  };
}

/**
 * @param {UnoDeps} deps
 * @param {string} roomId
 */
async function loadPlayers(deps, roomId) {
  const rows = await deps.prepare(`
    SELECT id, room_id AS roomId, seat, nickname, is_bot AS isBot
    FROM uno_players
    WHERE room_id = ?
    ORDER BY seat ASC
  `).all(roomId);
  return rows.map((row) => {
    const r = /** @type {Record<string, unknown>} */ (row);
    return {
      id: String(r.id),
      seat: Number(r.seat),
      nickname: String(r.nickname),
      isBot: Boolean(r.isBot),
    };
  });
}

/**
 * @param {UnoDeps} deps
 * @param {string} roomId
 */
async function loadRoomBundle(deps, roomId) {
  const row = await deps.prepare("SELECT * FROM uno_rooms WHERE id = ?").get(roomId);
  const room = parseRoomRow(row);
  if (!room) return null;
  const players = await loadPlayers(deps, roomId);
  return { room, players };
}

/**
 * @param {import('../games/uno/engine/models.js').GameState} gameState
 */
function serializeGameState(gameState) {
  return JSON.stringify(gameState);
}

/**
 * @param {object} stored
 * @param {Array<{ id: string, seat: number, nickname: string, isBot: boolean }>} players
 * @returns {import('../games/uno/engine/models.js').GameState}
 */
function hydrateGameState(stored, players) {
  if (stored && stored.players && stored.phase) {
    return /** @type {import('../games/uno/engine/models.js').GameState} */ (stored);
  }
  const roster = players.map((p) => ({
    id: p.id,
    seat: p.seat,
    nickname: p.nickname,
    isBot: p.isBot,
  }));
  return createLobbyState(roster, normalizeRules(stored?.rules || {}), stored?.aiDifficulty || "normal");
}

/**
 * @param {UnoDeps} deps
 * @param {string} roomId
 * @param {import('../games/uno/engine/models.js').GameState} gameState
 * @param {string} status
 */
async function saveRoomState(deps, roomId, gameState, status) {
  await deps.prepare(`
    UPDATE uno_rooms
    SET game_state_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(serializeGameState(gameState), status, roomId);
}

/**
 * @param {import('../games/uno/engine/models.js').GameState} state
 */
function roomStatusFromState(state) {
  if (state.phase === "lobby") return "lobby";
  if (state.phase === "finished") return "finished";
  return "playing";
}

/**
 * @param {import('../games/uno/engine/models.js').GameState} state
 */
function processBotChain(state) {
  return runBotTurns(state, 24);
}

/**
 * @param {UnoDeps} deps
 * @param {object} body
 */
export async function createUnoRoom(deps, body) {
  const mode = body.mode === "online" ? "online" : "ai";
  const rules = normalizeRules(body.rules || body);
  const aiDifficulty = body.ai_difficulty === "easy" || body.ai_difficulty === "hard" ? body.ai_difficulty : "normal";
  const nickname = typeof body.nickname === "string" && body.nickname.trim() ? body.nickname.trim().slice(0, 16) : "玩家";

  const roomId = await generateRoomId(deps);
  const hostToken = newToken();

  /** @type {Array<{ id: string, seat: number, nickname: string, isBot: boolean }>} */
  let roster = [{ id: hostToken, seat: 0, nickname, isBot: false }];

  if (mode === "ai") {
    for (let i = 0; i < 3; i += 1) {
      roster.push({ id: newToken(), seat: i + 1, nickname: AI_BOT_NAMES[i], isBot: true });
    }
  }

  let gameState = createLobbyState(roster, rules, aiDifficulty);
  let status = "lobby";

  if (mode === "ai") {
    gameState = startGame(gameState);
    gameState = processBotChain(gameState);
    status = roomStatusFromState(gameState);
  }

  await deps.prepare(`
    INSERT INTO uno_rooms (id, mode, rules_json, ai_difficulty, status, game_state_json, host_player_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(roomId, mode, JSON.stringify(rules), aiDifficulty, status, serializeGameState(gameState), hostToken);

  for (const p of roster) {
    await deps.prepare(`
      INSERT INTO uno_players (id, room_id, seat, nickname, is_bot)
      VALUES (?, ?, ?, ?, ?)
    `).run(p.id, roomId, p.seat, p.nickname, p.isBot ? 1 : 0);
  }

  return {
    room_id: roomId,
    player_token: hostToken,
    mode,
    status,
    snapshot: buildSnapshot(gameState, hostToken),
  };
}

/**
 * @param {UnoDeps} deps
 * @param {object} body
 */
export async function joinUnoRoom(deps, body) {
  const roomId = String(body.room_id || body.roomId || "").trim();
  const nickname = typeof body.nickname === "string" && body.nickname.trim() ? body.nickname.trim().slice(0, 16) : "玩家";
  if (!/^\d{4}$/.test(roomId)) throw new Error("房间号无效");

  const bundle = await loadRoomBundle(deps, roomId);
  if (!bundle) throw new Error("房间不存在");
  if (bundle.room.mode !== "online") throw new Error("该房间不是联机模式");

  const gameState = hydrateGameState(bundle.room.gameState, bundle.players);
  if (gameState.phase !== "lobby") throw new Error("游戏已开始，无法加入");

  const activeCount = bundle.players.length;
  if (activeCount >= 4) throw new Error("房间已满");

  const token = newToken();
  const seat = activeCount;
  await deps.prepare(`
    INSERT INTO uno_players (id, room_id, seat, nickname, is_bot)
    VALUES (?, ?, ?, ?, 0)
  `).run(token, roomId, seat, nickname);

  gameState.players.push({
    id: token,
    seat,
    nickname,
    isBot: false,
    hand: [],
    played: [],
    calledUno: false,
    left: false,
  });

  await saveRoomState(deps, roomId, gameState, "lobby");

  return {
    room_id: roomId,
    player_token: token,
    snapshot: buildSnapshot(gameState, token),
    lobby: buildLobby(bundle.room, bundle.players.concat([{ id: token, seat, nickname, isBot: false }]), token),
  };
}

/**
 * @param {object} room
 * @param {Array<{ id: string, seat: number, nickname: string, isBot: boolean }>} players
 * @param {string} viewerToken
 */
function buildLobby(room, players, viewerToken) {
  const isHost = room.hostPlayerId === viewerToken;
  return {
    room_id: room.id,
    mode: room.mode,
    players: players.map((p) => ({ seat: p.seat + 1, nickname: p.nickname, id: p.id })),
    is_host: isHost,
    can_start: isHost && players.length === 4,
    player_count: players.length,
    max_players: 4,
  };
}

/**
 * @param {UnoDeps} deps
 * @param {string} roomId
 * @param {string} token
 */
export async function getUnoState(deps, roomId, token) {
  const bundle = await loadRoomBundle(deps, roomId);
  if (!bundle) throw new Error("房间不存在");

  const gameState = hydrateGameState(bundle.room.gameState, bundle.players);
  const snapshot = buildSnapshot(gameState, token);
  const lobby = bundle.room.status === "lobby" ? buildLobby(bundle.room, bundle.players, token) : null;

  return {
    room_id: roomId,
    mode: bundle.room.mode,
    status: bundle.room.status,
    ai_difficulty: bundle.room.aiDifficulty,
    snapshot,
    lobby,
    can_restart: canRestart(bundle.room, bundle.players, token, gameState),
  };
}

/**
 * @param {object} room
 * @param {Array<{ id: string }>} players
 * @param {string} token
 * @param {import('../games/uno/engine/models.js').GameState} gameState
 */
function canRestart(room, players, token, gameState) {
  if (gameState.phase !== "finished") return false;
  if (room.mode === "ai") return players.some((p) => p.id === token && !/** @type {{isBot?:boolean}} */ (p).isBot);
  return room.hostPlayerId === token;
}

/**
 * @param {UnoDeps} deps
 * @param {string} roomId
 * @param {string} token
 * @param {string} action
 * @param {object} payload
 */
export async function applyUnoAction(deps, roomId, token, action, payload = {}) {
  const bundle = await loadRoomBundle(deps, roomId);
  if (!bundle) throw new Error("房间不存在");

  let gameState = hydrateGameState(bundle.room.gameState, bundle.players);

  if (action === "start") {
    if (bundle.room.mode !== "online") throw new Error("仅联机房间可开始");
    if (bundle.room.hostPlayerId !== token) throw new Error("仅房主可开始");
    if (gameState.phase !== "lobby") throw new Error("游戏已开始");
    if (bundle.players.length < 4) throw new Error("人数未满");
    gameState = startGame(gameState);
    gameState = processBotChain(gameState);
    const status = roomStatusFromState(gameState);
    await saveRoomState(deps, roomId, gameState, status);
    return {
      snapshot: buildSnapshot(gameState, token),
      status,
      mode: bundle.room.mode,
      ai_difficulty: bundle.room.aiDifficulty,
      can_restart: canRestart(bundle.room, bundle.players, token, gameState),
    };
  }

  if (action === "restart") {
    if (gameState.phase !== "finished") throw new Error("游戏未结束");
    if (!canRestart(bundle.room, bundle.players, token, gameState)) throw new Error("无权再来一局");
    gameState = restartGame(gameState);
    gameState = processBotChain(gameState);
    const status = roomStatusFromState(gameState);
    await saveRoomState(deps, roomId, gameState, status);
    return {
      snapshot: buildSnapshot(gameState, token),
      status,
      mode: bundle.room.mode,
      ai_difficulty: bundle.room.aiDifficulty,
      can_restart: false,
    };
  }

  if (action === "leave") {
    return leaveUnoRoom(deps, roomId, token);
  }

  if (gameState.phase === "lobby") throw new Error("游戏尚未开始");

  gameState = applyMove(gameState, token, action, payload);
  gameState = processBotChain(gameState);
  const status = roomStatusFromState(gameState);
  await saveRoomState(deps, roomId, gameState, status);
  return {
    snapshot: buildSnapshot(gameState, token),
    status,
    mode: bundle.room.mode,
    ai_difficulty: bundle.room.aiDifficulty,
    can_restart: canRestart(bundle.room, bundle.players, token, gameState),
    lobby: status === "lobby" ? buildLobby(bundle.room, bundle.players, token) : null,
  };
}

/**
 * @param {UnoDeps} deps
 * @param {string} roomId
 * @param {string} token
 */
export async function leaveUnoRoom(deps, roomId, token) {
  const bundle = await loadRoomBundle(deps, roomId);
  if (!bundle) throw new Error("房间不存在");

  let gameState = hydrateGameState(bundle.room.gameState, bundle.players);
  const { state, destroyed } = removePlayer(gameState, token);

  if (destroyed || state.players.every((p) => p.left)) {
    await deps.prepare("DELETE FROM uno_players WHERE room_id = ?").run(roomId);
    await deps.prepare("DELETE FROM uno_rooms WHERE id = ?").run(roomId);
    return { left: true, destroyed: true };
  }

  let hostPlayerId = bundle.room.hostPlayerId;
  let hostTransferred = false;
  if (hostPlayerId === token) {
    const remaining = state.players.filter((p) => !p.left);
    hostPlayerId = remaining[0]?.id || hostPlayerId;
    hostTransferred = true;
    await deps.prepare("UPDATE uno_rooms SET host_player_id = ? WHERE id = ?").run(hostPlayerId, roomId);
  }

  await deps.prepare("DELETE FROM uno_players WHERE id = ?").run(token);
  const status = roomStatusFromState(state);
  await saveRoomState(deps, roomId, state, status);

  if (bundle.room.mode === "ai") {
    await deps.prepare("DELETE FROM uno_players WHERE room_id = ?").run(roomId);
    await deps.prepare("DELETE FROM uno_rooms WHERE id = ?").run(roomId);
    return { left: true, destroyed: true };
  }

  return { left: true, destroyed: false, host_transferred: hostTransferred };
}

/**
 * @param {UnoDeps} deps
 * @param {import('node:http').IncomingMessage} req
 * @param {string} pathname
 * @param {() => Promise<string>} readBody
 */
export async function handleUnoApi(deps, req, res, pathname, readBody, json, badRequest) {
  if (req.method === "POST" && pathname === "/api/uno/rooms") {
    const body = JSON.parse((await readBody()) || "{}");
    try {
      const result = await createUnoRoom(deps, body);
      json(res, 200, result);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "创建房间失败" });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/uno/rooms/join") {
    const body = JSON.parse((await readBody()) || "{}");
    try {
      const result = await joinUnoRoom(deps, body);
      json(res, 200, result);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "加入失败" });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/uno/rooms/leave") {
    const body = JSON.parse((await readBody()) || "{}");
    try {
      const result = await leaveUnoRoom(deps, String(body.room_id || body.roomId || ""), String(body.token || ""));
      json(res, 200, result);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "离开失败" });
    }
    return true;
  }

  const stateMatch = pathname.match(/^\/api\/uno\/rooms\/(\d{4})\/state$/);
  if (req.method === "GET" && stateMatch) {
    const roomId = stateMatch[1];
    const url = new URL(req.url || "/", "http://localhost");
    const token = url.searchParams.get("token") || "";
    try {
      const result = await getUnoState(deps, roomId, token);
      json(res, 200, result);
    } catch (error) {
      json(res, 404, { error: error instanceof Error ? error.message : "房间不存在" });
    }
    return true;
  }

  const actionMatch = pathname.match(/^\/api\/uno\/rooms\/(\d{4})\/action$/);
  if (req.method === "POST" && actionMatch) {
    const roomId = actionMatch[1];
    const body = JSON.parse((await readBody()) || "{}");
    const token = String(body.token || "");
    const action = String(body.action || "");
    try {
      const result = await applyUnoAction(deps, roomId, token, action, body);
      json(res, 200, result);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "操作失败" });
    }
    return true;
  }

  return false;
}
