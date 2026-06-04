import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import PDFDocument from "pdfkit";
import Stripe from "stripe";
import { getTursoClient } from "./shared/turso-client.mjs";

const HOST = "0.0.0.0";
const PORT = 3000;
const ROOT = process.cwd();
const USE_TURSO = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
const IS_VERCEL = Boolean(process.env.VERCEL);

// Vercel's filesystem is read-only; this project is expected to use Turso there.
if (IS_VERCEL && !USE_TURSO) {
  throw new Error(
    "Turso is not configured. On Vercel set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables."
  );
}

const DATA_DIR = resolve(ROOT, "data");
const DB_PATH = resolve(DATA_DIR, "minimaths.db");

// Local dev: file-based SQLite. Vercel: in-memory SQLite to avoid filesystem writes.
const SQLITE_PATH = IS_VERCEL ? ":memory:" : DB_PATH;
if (!IS_VERCEL) mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(SQLITE_PATH);
const SCHEMA_SQL = `

  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL DEFAULT '',
    problem_type TEXT NOT NULL DEFAULT 'add',
    digit_count INTEGER NOT NULL DEFAULT 2,
    operand_count INTEGER NOT NULL DEFAULT 2,
    question_count INTEGER NOT NULL DEFAULT 10,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  INSERT INTO app_settings (id) VALUES (1)
  ON CONFLICT(id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS history_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equation TEXT NOT NULL,
    time_text TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS leaderboard_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    total_ms INTEGER NOT NULL,
    total_time_text TEXT NOT NULL,
    config_key TEXT NOT NULL DEFAULT '未知-2-2-10',
    config_label TEXT NOT NULL DEFAULT '未知-2-2-10',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS leaderboard_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    item_order INTEGER NOT NULL,
    equation TEXT NOT NULL,
    time_text TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(entry_id) REFERENCES leaderboard_entries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS square_cube_history_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equation TEXT NOT NULL,
    time_text TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS square_cube_leaderboard_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    practice_type TEXT NOT NULL DEFAULT 'square',
    total_ms INTEGER NOT NULL,
    total_time_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS square_cube_leaderboard_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    item_order INTEGER NOT NULL,
    equation TEXT NOT NULL,
    time_text TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(entry_id) REFERENCES square_cube_leaderboard_entries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS processing_speed_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'beginner',
    total_ms INTEGER NOT NULL,
    total_time_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS processing_speed_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    item_order INTEGER NOT NULL,
    target_text TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    time_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(entry_id) REFERENCES processing_speed_entries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS novel_contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seq INTEGER NOT NULL,
    parent_id INTEGER,
    content TEXT NOT NULL,
    votes INTEGER NOT NULL DEFAULT 0,
    author TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS novel_like_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    ip TEXT NOT NULL,
    liked_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS dungeon_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    placements_json TEXT NOT NULL,
    mask_colors_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS published_dungeon_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL,
    placements_json TEXT NOT NULL,
    mask_colors_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS dungeon_hunt_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_uuid TEXT NOT NULL,
    player_user_id INTEGER NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    result TEXT NOT NULL DEFAULT 'lose',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(map_uuid, player_user_id),
    FOREIGN KEY(player_user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`;

db.exec(`PRAGMA journal_mode = ${IS_VERCEL ? "MEMORY" : "WAL"};`);
db.exec(SCHEMA_SQL);

let _tursoSchemaReady = false;
async function ensureTursoSchema() {
  if (!IS_VERCEL) return;
  if (_tursoSchemaReady) return;
  if (!USE_TURSO) return;

  const client = getTursoClient();
  // Split on ';' to execute statements one-by-one for Turso.
  const parts = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of parts) {
    // Turso doesn't support PRAGMA in the same way; schema SQL is DDL/DML only.
    await client.execute(stmt);
  }
  _tursoSchemaReady = true;
}

function prepare(sql) {
  if (IS_VERCEL) {
    return {
      async all(...args) {
        await ensureTursoSchema();
        const client = getTursoClient();
        const r = await client.execute({ sql, args });
        return r.rows || [];
      },
      async get(...args) {
        const rows = await this.all(...args);
        return rows[0] || undefined;
      },
      async run(...args) {
        await ensureTursoSchema();
        const client = getTursoClient();
        const r = await client.execute({ sql, args });
        return {
          changes: Number(r.rowsAffected || 0),
          lastInsertRowid: r.lastInsertRowid ?? undefined,
        };
      },
    };
  }
  return db.prepare(sql);
}

const DEFAULT_NOVEL_ROOT_CONTENT =
  "这是一个众创故事，每个人都可以改变故事的走向，也可以随时开始创作。请从这里接力，让故事继续发生。";
const LEGACY_NOVEL_ROOT_CONTENT =
  "夜雨初停，街灯在水洼里晃动。我把伞收好，推开那扇旧书店的门，风铃轻轻响了一声。";

const readRootNovelStmt = prepare(`
  SELECT id, content, author
  FROM novel_contents
  WHERE seq = 1 AND parent_id IS NULL
  ORDER BY id ASC
  LIMIT 1
`);
const insertRootNovelStmt = prepare(`
  INSERT INTO novel_contents (seq, parent_id, content, votes, author)
  VALUES (?, ?, ?, ?, ?)
`);
const updateRootNovelContentStmt = prepare(`
  UPDATE novel_contents
  SET content = ?
  WHERE id = ?
`);

// Local-only SQLite migrations / seed data.
// On Vercel we use Turso and avoid mutating the ephemeral in-memory SQLite.
if (!IS_VERCEL) {
  const rootNovel = await readRootNovelStmt.get();
  if (!rootNovel) {
    await insertRootNovelStmt.run(1, null, DEFAULT_NOVEL_ROOT_CONTENT, 0, "系统");
  } else if (rootNovel.author === "系统" && rootNovel.content === LEGACY_NOVEL_ROOT_CONTENT) {
    await updateRootNovelContentStmt.run(DEFAULT_NOVEL_ROOT_CONTENT, rootNovel.id);
  }

  function hasColumn(tableName, columnName) {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return rows.some((row) => row.name === columnName);
  }

  if (!hasColumn("leaderboard_entries", "config_key")) {
    db.exec("ALTER TABLE leaderboard_entries ADD COLUMN config_key TEXT NOT NULL DEFAULT '未知-2-2-10'");
  }
  if (!hasColumn("leaderboard_entries", "config_label")) {
    db.exec("ALTER TABLE leaderboard_entries ADD COLUMN config_label TEXT NOT NULL DEFAULT '未知-2-2-10'");
  }

  if (!hasColumn("novel_contents", "parent_id")) {
    db.exec("ALTER TABLE novel_contents ADD COLUMN parent_id INTEGER");
  }
  if (!hasColumn("processing_speed_entries", "level")) {
    db.exec("ALTER TABLE processing_speed_entries ADD COLUMN level TEXT NOT NULL DEFAULT 'beginner'");
  }
  if (!hasColumn("users", "nickname")) {
    db.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn("users", "avatar")) {
    db.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn("dungeon_maps", "mask_colors_json")) {
    db.exec("ALTER TABLE dungeon_maps ADD COLUMN mask_colors_json TEXT NOT NULL DEFAULT '[]'");
  }
}

const getSettingsStmt = prepare(`
  SELECT
    username,
    problem_type AS problemType,
    digit_count AS digitCount,
    operand_count AS operandCount,
    question_count AS questionCount
  FROM app_settings
  WHERE id = 1
`);

const updateSettingsStmt = prepare(`
  UPDATE app_settings
  SET
    username = ?,
    problem_type = ?,
    digit_count = ?,
    operand_count = ?,
    question_count = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = 1
`);

const insertHistoryStmt = prepare(`
  INSERT INTO history_records (equation, time_text, time_ms)
  VALUES (?, ?, ?)
`);

const readHistoryStmt = prepare(`
  SELECT
    equation,
    time_text AS time,
    time_ms AS timeMs
  FROM history_records
  ORDER BY id DESC
  LIMIT ?
`);

const readLeaderboardStmt = prepare(`
  SELECT * FROM (
    SELECT
      id,
      username,
      total_ms AS totalMs,
      total_time_text AS totalTimeText,
      config_key AS configKey,
      config_label AS configLabel,
      ROW_NUMBER() OVER (
        PARTITION BY config_key
        ORDER BY total_ms ASC, id ASC
      ) AS rankInConfig
    FROM leaderboard_entries
  )
  WHERE rankInConfig <= 10
  ORDER BY configKey ASC, rankInConfig ASC, id ASC
`);

const insertLeaderboardStmt = prepare(`
  INSERT INTO leaderboard_entries (username, total_ms, total_time_text, config_key, config_label)
  VALUES (?, ?, ?, ?, ?)
`);

const insertLeaderboardItemStmt = prepare(`
  INSERT INTO leaderboard_items (entry_id, item_order, equation, time_text, time_ms)
  VALUES (?, ?, ?, ?, ?)
`);

const readLeaderboardItemsStmt = prepare(`
  SELECT
    equation,
    time_text AS time,
    time_ms AS timeMs
  FROM leaderboard_items
  WHERE entry_id = ?
  ORDER BY item_order ASC, id ASC
`);

const insertSquareCubeHistoryStmt = prepare(`
  INSERT INTO square_cube_history_records (equation, time_text, time_ms)
  VALUES (?, ?, ?)
`);

const readSquareCubeHistoryStmt = prepare(`
  SELECT
    equation,
    time_text AS time,
    time_ms AS timeMs
  FROM square_cube_history_records
  ORDER BY id DESC
  LIMIT ?
`);

const readSquareCubeLeaderboardStmt = prepare(`
  SELECT * FROM (
    SELECT
      id,
      username,
      practice_type AS type,
      total_ms AS totalMs,
      total_time_text AS totalTimeText,
      ROW_NUMBER() OVER (
        PARTITION BY practice_type
        ORDER BY total_ms ASC, id ASC
      ) AS rankInType
    FROM square_cube_leaderboard_entries
  )
  WHERE rankInType <= 20
  ORDER BY type ASC, rankInType ASC, id ASC
`);

const insertSquareCubeLeaderboardStmt = prepare(`
  INSERT INTO square_cube_leaderboard_entries (username, practice_type, total_ms, total_time_text)
  VALUES (?, ?, ?, ?)
`);

const insertSquareCubeLeaderboardItemStmt = prepare(`
  INSERT INTO square_cube_leaderboard_items (entry_id, item_order, equation, time_text, time_ms)
  VALUES (?, ?, ?, ?, ?)
`);

const readSquareCubeLeaderboardItemsStmt = prepare(`
  SELECT
    equation,
    time_text AS time,
    time_ms AS timeMs
  FROM square_cube_leaderboard_items
  WHERE entry_id = ?
  ORDER BY item_order ASC, id ASC
`);

const readProcessingSpeedLeaderboardStmt = prepare(`
  SELECT
    id,
    username,
    level,
    total_ms AS totalMs,
    total_time_text AS totalTimeText,
    created_at AS createdAt
  FROM processing_speed_entries
  WHERE level = ?
  ORDER BY total_ms ASC, id ASC
  LIMIT 10
`);

const insertProcessingSpeedEntryStmt = prepare(`
  INSERT INTO processing_speed_entries (username, level, total_ms, total_time_text)
  VALUES (?, ?, ?, ?)
`);

const insertProcessingSpeedItemStmt = prepare(`
  INSERT INTO processing_speed_items (entry_id, item_order, target_text, time_ms, time_text)
  VALUES (?, ?, ?, ?, ?)
`);

const readNovelTopBySeqStmt = prepare(`
  SELECT
    id,
    seq,
    parent_id AS parentId,
    content,
    votes,
    author,
    created_at AS createdAt
  FROM novel_contents
  WHERE seq = ?
  ORDER BY votes DESC, id ASC
  LIMIT 1
`);

const readNovelListBySeqStmt = prepare(`
  SELECT
    id,
    seq,
    parent_id AS parentId,
    content,
    votes,
    author,
    created_at AS createdAt
  FROM novel_contents
  WHERE seq = ?
  ORDER BY votes DESC, id ASC
`);

const insertNovelStmt = prepare(`
  INSERT INTO novel_contents (seq, parent_id, content, votes, author)
  VALUES (?, ?, ?, 0, ?)
`);

const updateNovelVoteStmt = prepare(`
  UPDATE novel_contents
  SET votes = votes + 1
  WHERE id = ?
`);

const readNovelByIdStmt = prepare(`
  SELECT
    id,
    seq,
    parent_id AS parentId,
    content,
    votes,
    author,
    created_at AS createdAt
  FROM novel_contents
  WHERE id = ?
`);

const readNovelChildrenTopStmt = prepare(`
  SELECT
    id,
    seq,
    parent_id AS parentId,
    content,
    votes,
    author,
    created_at AS createdAt
  FROM novel_contents
  WHERE parent_id = ?
  ORDER BY votes DESC, id ASC
  LIMIT 1
`);

const readNovelChildrenListStmt = prepare(`
  SELECT
    id,
    seq,
    parent_id AS parentId,
    content,
    votes,
    author,
    created_at AS createdAt
  FROM novel_contents
  WHERE parent_id = ?
  ORDER BY votes DESC, id ASC
`);

const readNovelChildrenPagedStmt = prepare(`
  SELECT
    id,
    seq,
    parent_id AS parentId,
    content,
    votes,
    author,
    created_at AS createdAt
  FROM novel_contents
  WHERE parent_id = ?
  ORDER BY votes DESC, id ASC
  LIMIT ?
  OFFSET ?
`);

const readNovelIntegratedStmt = prepare(`
  WITH RECURSIVE chain(
    id, seq, parent_id, content, votes, author, created_at, depth
  ) AS (
    SELECT
      id, seq, parent_id, content, votes, author, created_at, 0
    FROM novel_contents
    WHERE id = ?
    UNION ALL
    SELECT
      n.id, n.seq, n.parent_id, n.content, n.votes, n.author, n.created_at, c.depth + 1
    FROM novel_contents n
    JOIN chain c ON c.parent_id = n.id
    WHERE c.depth + 1 < ?
  )
  SELECT
    id,
    seq,
    parent_id AS parentId,
    content,
    votes,
    author,
    created_at AS createdAt
  FROM chain
  ORDER BY depth DESC
`);

const readNovelRecentLikeStmt = prepare(`
  SELECT liked_at AS likedAt
  FROM novel_like_logs
  WHERE content_id = ?
    AND (device_id = ? OR ip = ?)
  ORDER BY id DESC
  LIMIT 1
`);

const insertNovelLikeLogStmt = prepare(`
  INSERT INTO novel_like_logs (content_id, device_id, ip, liked_at)
  VALUES (?, ?, ?, ?)
`);

const readUserByUsernameStmt = prepare(`
  SELECT id, username, password_hash AS passwordHash, nickname, avatar
  FROM users
  WHERE username = ?
  LIMIT 1
`);

const readUserByIdStmt = prepare(`
  SELECT id, username, nickname, avatar
  FROM users
  WHERE id = ?
  LIMIT 1
`);

const insertUserStmt = prepare(`
  INSERT INTO users (username, password_hash)
  VALUES (?, ?)
`);

const updateUserPasswordStmt = prepare(`
  UPDATE users
  SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateUserProfileStmt = prepare(`
  UPDATE users
  SET nickname = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const insertSessionStmt = prepare(`
  INSERT INTO user_sessions (user_id, token, expires_at)
  VALUES (?, ?, ?)
`);

const readSessionStmt = prepare(`
  SELECT id, user_id AS userId, expires_at AS expiresAt
  FROM user_sessions
  WHERE token = ?
  LIMIT 1
`);

const deleteSessionStmt = prepare(`
  DELETE FROM user_sessions
  WHERE token = ?
`);

const deleteExpiredSessionsStmt = prepare(`
  DELETE FROM user_sessions
  WHERE expires_at <= ?
`);

const readDungeonMapByUserStmt = prepare(`
  SELECT
    placements_json AS placementsJson,
    mask_colors_json AS maskColorsJson,
    updated_at AS updatedAt
  FROM dungeon_maps
  WHERE user_id = ?
  LIMIT 1
`);

const upsertDungeonMapStmt = prepare(`
  INSERT INTO dungeon_maps (user_id, placements_json, mask_colors_json)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    placements_json = excluded.placements_json,
    mask_colors_json = excluded.mask_colors_json,
    updated_at = CURRENT_TIMESTAMP
`);

const insertPublishedDungeonMapStmt = prepare(`
  INSERT INTO published_dungeon_maps (uuid, owner_user_id, placements_json, mask_colors_json)
  VALUES (?, ?, ?, ?)
`);

const readPublishedDungeonMapByUuidStmt = prepare(`
  SELECT
    uuid,
    owner_user_id AS ownerUserId,
    placements_json AS placementsJson,
    mask_colors_json AS maskColorsJson,
    created_at AS createdAt
  FROM published_dungeon_maps
  WHERE uuid = ?
  LIMIT 1
`);

const readPublishedDungeonMapsByOwnerStmt = prepare(`
  SELECT
    p.uuid,
    p.placements_json AS placementsJson,
    p.mask_colors_json AS maskColorsJson,
    p.created_at AS createdAt,
    COUNT(r.id) AS playCount,
    SUM(CASE WHEN r.result = 'win' THEN 1 ELSE 0 END) AS winCount
  FROM published_dungeon_maps p
  LEFT JOIN dungeon_hunt_records r ON r.map_uuid = p.uuid
  WHERE p.owner_user_id = ?
  GROUP BY p.id
  ORDER BY p.id DESC
`);

const readDungeonHuntRecordStmt = prepare(`
  SELECT
    map_uuid AS mapUuid,
    player_user_id AS playerUserId,
    score,
    result,
    created_at AS createdAt
  FROM dungeon_hunt_records
  WHERE map_uuid = ? AND player_user_id = ?
  LIMIT 1
`);

const insertDungeonHuntRecordStmt = prepare(`
  INSERT INTO dungeon_hunt_records (map_uuid, player_user_id, score, result)
  VALUES (?, ?, ?, ?)
`);

const readDungeonHuntHistoryStmt = prepare(`
  SELECT
    r.map_uuid AS mapUuid,
    r.score,
    r.result,
    r.created_at AS createdAt,
    u.username
  FROM dungeon_hunt_records r
  JOIN users u ON u.id = r.player_user_id
  WHERE r.map_uuid = ?
  ORDER BY r.created_at DESC, r.id DESC
`);

const readDungeonLeaderboardStmt = prepare(`
  SELECT
    u.id,
    u.username,
    COALESCE(SUM(r.score), 0) AS totalScore,
    COUNT(r.id) AS playCount
  FROM users u
  LEFT JOIN dungeon_hunt_records r ON r.player_user_id = u.id
  GROUP BY u.id, u.username
  HAVING totalScore > 0
  ORDER BY totalScore DESC, playCount DESC, u.id ASC
  LIMIT 100
`);

const readRandomUnplayedDungeonMapStmt = prepare(`
  SELECT
    p.uuid,
    p.owner_user_id AS ownerUserId,
    p.placements_json AS placementsJson,
    p.mask_colors_json AS maskColorsJson,
    p.created_at AS createdAt
  FROM published_dungeon_maps p
  WHERE p.owner_user_id != ?
    AND NOT EXISTS (
      SELECT 1
      FROM dungeon_hunt_records r
      WHERE r.player_user_id = ?
        AND r.map_uuid = p.uuid
    )
  ORDER BY RANDOM()
  LIMIT 1
`);

const readMyDungeonHuntHistoryStmt = prepare(`
  SELECT
    r.map_uuid AS mapUuid,
    r.score,
    r.result,
    r.created_at AS createdAt
  FROM dungeon_hunt_records r
  WHERE r.player_user_id = ?
  ORDER BY r.created_at DESC, r.id DESC
`);

function sanitizeSettings(input) {
  const questionCountCandidates = [10, 20, 30, 40];
  const problemTypeCandidates = ["add", "subtract", "multiply", "divide", "addsubtract", "all"];
  const digitCountCandidates = [1, 2, 3, 4, 5];
  const operandCountCandidates = [2, 3, 4];

  const username = typeof input.username === "string" ? input.username.slice(0, 10) : "";
  const problemType = problemTypeCandidates.includes(input.problemType) ? input.problemType : "add";
  const digitCount = digitCountCandidates.includes(Number(input.digitCount)) ? Number(input.digitCount) : 2;
  const requestedOperandCount = operandCountCandidates.includes(Number(input.operandCount))
    ? Number(input.operandCount)
    : 2;
  const operandCount = problemType === "divide" ? 2 : requestedOperandCount;
  const questionCount = questionCountCandidates.includes(Number(input.questionCount))
    ? Number(input.questionCount)
    : 10;

  return { username, problemType, digitCount, operandCount, questionCount };
}

async function getSettings() {
  const settings = await getSettingsStmt.get();
  return sanitizeSettings(settings);
}

async function getHistory(limit) {
  return await readHistoryStmt.all(limit);
}

async function getLeaderboard() {
  const rows = await readLeaderboardStmt.all();
  const grouped = new Map();

  for (const row of rows) {
    if (!grouped.has(row.configKey)) {
      grouped.set(row.configKey, {
        configKey: row.configKey,
        configLabel: row.configLabel,
        items: [],
      });
    }
    grouped.get(row.configKey).items.push({
      id: row.id,
      username: row.username,
      totalMs: row.totalMs,
      totalTimeText: row.totalTimeText,
      rankInConfig: row.rankInConfig,
      configKey: row.configKey,
      configLabel: row.configLabel,
    });
  }

  return Array.from(grouped.values());
}

async function getSquareCubeHistory(limit) {
  return await readSquareCubeHistoryStmt.all(limit);
}

async function getSquareCubeLeaderboard() {
  const rows = await readSquareCubeLeaderboardStmt.all();
  const labels = { square: "平方", cube: "立方", mixed: "混合" };
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.type)) {
      grouped.set(row.type, {
        type: row.type,
        typeLabel: labels[row.type] || "平方",
        items: [],
      });
    }
    grouped.get(row.type).items.push({
      id: row.id,
      username: row.username,
      totalMs: row.totalMs,
      totalTimeText: row.totalTimeText,
      rank: row.rankInType,
      type: row.type,
    });
  }
  for (const type of ["square", "cube", "mixed"]) {
    if (!grouped.has(type)) {
      grouped.set(type, { type, typeLabel: labels[type], items: [] });
    }
  }
  return ["square", "cube", "mixed"].map((type) => grouped.get(type));
}

async function tursoAll(sql, args = []) {
  const client = getTursoClient();
  const result = await client.execute({ sql, args });
  return Array.isArray(result.rows) ? result.rows : [];
}

let tursoSquareCubeSchemaReady = false;
async function ensureSquareCubeSchemaTurso() {
  if (tursoSquareCubeSchemaReady) return;
  const client = getTursoClient();
  await client.batch(
    [
      {
        sql: `
          CREATE TABLE IF NOT EXISTS square_cube_history_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            equation TEXT NOT NULL,
            time_text TEXT NOT NULL,
            time_ms INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
        args: [],
      },
      {
        sql: `
          CREATE TABLE IF NOT EXISTS square_cube_leaderboard_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            practice_type TEXT NOT NULL DEFAULT 'square',
            total_ms INTEGER NOT NULL,
            total_time_text TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
        args: [],
      },
      {
        sql: `
          CREATE TABLE IF NOT EXISTS square_cube_leaderboard_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL,
            item_order INTEGER NOT NULL,
            equation TEXT NOT NULL,
            time_text TEXT NOT NULL,
            time_ms INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(entry_id) REFERENCES square_cube_leaderboard_entries(id) ON DELETE CASCADE
          )
        `,
        args: [],
      },
    ],
    "write",
  );
  tursoSquareCubeSchemaReady = true;
}

async function getSquareCubeHistoryTurso(limit) {
  await ensureSquareCubeSchemaTurso();
  const rows = await tursoAll(
    `
    SELECT
      equation,
      time_text AS time,
      time_ms AS timeMs
    FROM square_cube_history_records
    ORDER BY id DESC
    LIMIT ?
  `,
    [limit],
  );
  return rows.map((r) => ({ equation: String(r.equation || ""), time: String(r.time || "0s"), timeMs: Number(r.timeMs) || 0 }));
}

async function getSquareCubeLeaderboardTurso() {
  await ensureSquareCubeSchemaTurso();
  const rows = await tursoAll(
    `
    SELECT * FROM (
      SELECT
        id,
        username,
        practice_type AS type,
        total_ms AS totalMs,
        total_time_text AS totalTimeText,
        ROW_NUMBER() OVER (
          PARTITION BY practice_type
          ORDER BY total_ms ASC, id ASC
        ) AS rankInType
      FROM square_cube_leaderboard_entries
    )
    WHERE rankInType <= 20
    ORDER BY type ASC, rankInType ASC, id ASC
  `,
    [],
  );
  const labels = { square: "平方", cube: "立方", mixed: "混合" };
  const grouped = new Map();
  for (const row of rows) {
    const type = row.type === "cube" || row.type === "mixed" ? row.type : "square";
    if (!grouped.has(type)) grouped.set(type, { type, typeLabel: labels[type], items: [] });
    grouped.get(type).items.push({
      id: Number(row.id),
      username: String(row.username || "匿名"),
      totalMs: Number(row.totalMs) || 0,
      totalTimeText: String(row.totalTimeText || "0s"),
      rank: Number(row.rankInType) || 0,
      type,
    });
  }
  for (const type of ["square", "cube", "mixed"]) {
    if (!grouped.has(type)) grouped.set(type, { type, typeLabel: labels[type], items: [] });
  }
  return ["square", "cube", "mixed"].map((type) => grouped.get(type));
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function badRequest(res, message) {
  json(res, 400, { error: message });
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

function safePdfTitle(rawTitle) {
  if (typeof rawTitle !== "string") return "novel";
  const title = rawTitle.trim().slice(0, 40);
  if (!title) return "novel";
  return title.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function findPdfFontPath() {
  const envPath = process.env.PDF_CJK_FONT_PATH;
  if (typeof envPath === "string" && envPath.trim()) {
    const normalized = envPath.trim();
    console.log("[pdf] PDF_CJK_FONT_PATH set to:", JSON.stringify(normalized));
    try {
      statSync(normalized);
      console.log("[pdf] Using font from PDF_CJK_FONT_PATH:", normalized);
      return normalized;
    } catch (error) {
      console.error(
        "[pdf] PDF_CJK_FONT_PATH exists check failed:",
        normalized,
        "-",
        error instanceof Error ? error.message : String(error),
      );
    }
  } else {
    console.log("[pdf] PDF_CJK_FONT_PATH is empty");
  }
  const candidates = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Hiragino Sans GB W3.ttc",
    "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/wenquanyi/wqy-zenhei/wqy-zenhei.ttc",
    "/System/Library/Fonts/PingFang.ttc",
  ];
  for (const path of candidates) {
    if (fileExists(path)) {
      console.log("[pdf] Using fallback font path:", path);
      return path;
    }
  }
  console.error("[pdf] No available CJK font path found. Candidates checked:", candidates);
  return "";
}

function sendIntegratedPdf(res, title, items) {
  const filename = safePdfTitle(title) + ".pdf";
  const chunks = [];
  console.log("[pdf] Generating integrated PDF. Title:", JSON.stringify(title), "Items:", items.length);
  const fontPath = findPdfFontPath();
  if (!fontPath) {
    json(res, 500, {
      error:
        "Missing CJK font on server. Please install Noto CJK fonts or set PDF_CJK_FONT_PATH.",
    });
    return;
  }
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 48, bottom: 48, left: 48, right: 48 },
  });

  doc.on("data", (chunk) => chunks.push(chunk));
  doc.on("end", () => {
    const pdf = Buffer.concat(chunks);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": pdf.length,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "no-store",
    });
    res.end(pdf);
  });

  try {
    doc.font(fontPath);
    console.log("[pdf] Font loaded successfully:", fontPath);
  } catch (error) {
    console.error(
      "[pdf] doc.font(...) failed. fontPath:",
      fontPath,
      "error:",
      error instanceof Error ? error.stack || error.message : String(error),
    );
    json(res, 500, {
      error:
        "CJK font load failed. Please install another CJK font and set PDF_CJK_FONT_PATH.",
    });
    return;
  }
  doc.fontSize(18).text(title || "Novel", { align: "center" });
  doc.moveDown(1);
  doc.fontSize(12);
  for (const item of items) {
    const content = String(item?.content || "").trim();
    if (!content) continue;
    doc.text(content, { align: "left" });
    doc.moveDown(1);
  }
  doc.end();
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) rejectBody(new Error("Body too large"));
    });
    req.on("end", () => resolveBody(data));
    req.on("error", rejectBody);
  });
}

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY || "";
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

function sendFile(res, filePath) {
  try {
    const fullPath = resolve(ROOT, filePath);
    const file = readFileSync(fullPath);
    statSync(fullPath);
    const ext = extname(fullPath);
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".svg"
            ? "image/svg+xml"
            : ext === ".png"
              ? "image/png"
              : ext === ".apk"
                ? "application/vnd.android.package-archive"
              : ext === ".ico"
                ? "image/x-icon"
              : ext === ".webmanifest"
                ? "application/manifest+json; charset=utf-8"
                : "text/plain; charset=utf-8";

    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": file.length,
      "Cache-Control": "no-store",
    });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

function normalizeMiniEngText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const USERNAME_REGEX = /^[A-Za-z0-9_]{4,16}$/;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const DUNGEON_SIZE = 5;
const DUNGEON_CELL_COUNT = DUNGEON_SIZE * DUNGEON_SIZE;
const DUNGEON_PIECE_ORDER = ["single-bomb", "l-bomb", "line-bomb", "treasure-2x2"];
const DUNGEON_ROTATIONS = [0, 90, 180, 270];
const DUNGEON_MASK_COLORS = ["#f6dd8a", "#e58f7b", "#8fc8a6", "#8db6d5", "#f0a423"];
const DUNGEON_UUID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DUNGEON_UUID_LENGTH = 10;
const DUNGEON_PIECES = {
  "single-bomb": [{ dr: 0, dc: 0 }],
  "l-bomb": [
    { dr: 0, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 1, dc: 1 },
  ],
  "line-bomb": [
    { dr: 0, dc: 0 },
    { dr: 0, dc: 1 },
    { dr: 0, dc: 2 },
  ],
  "treasure-2x2": [
    { dr: 0, dc: 0 },
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
    { dr: 1, dc: 1 },
  ],
};

function normalizeDungeonRotation(rawRotation) {
  const value = Number(rawRotation);
  if (!Number.isInteger(value)) return null;
  const mod = ((value % 360) + 360) % 360;
  return DUNGEON_ROTATIONS.includes(mod) ? mod : null;
}

function rotateDungeonShapeOnce(shape) {
  return shape.map((cell) => ({ dr: cell.dc, dc: -cell.dr }));
}

function normalizeDungeonShape(shape) {
  const minRow = Math.min(...shape.map((cell) => cell.dr));
  const minCol = Math.min(...shape.map((cell) => cell.dc));
  return shape.map((cell) => ({ dr: cell.dr - minRow, dc: cell.dc - minCol }));
}

function getDungeonShape(pieceId, rotation) {
  const base = DUNGEON_PIECES[pieceId] || [];
  let shape = base.map((cell) => ({ ...cell }));
  const steps = Math.floor((rotation || 0) / 90);
  for (let i = 0; i < steps; i += 1) {
    shape = rotateDungeonShapeOnce(shape);
  }
  return normalizeDungeonShape(shape);
}

function normalizeUsername(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

function isValidUsername(username) {
  return USERNAME_REGEX.test(username);
}

function isValidPassword(password) {
  return typeof password === "string" && password.length >= 1 && password.length <= 64;
}

function normalizeNickname(raw) {
  return typeof raw === "string" ? raw.trim().slice(0, 20) : "";
}

function normalizeAvatar(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.length > 300000) return "";
  return trimmed;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [_, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

function getAuthToken(req, body) {
  const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  if (body && typeof body.token === "string") {
    return body.token.trim();
  }
  return "";
}

async function createSession(userId) {
  await deleteExpiredSessionsStmt.run(new Date().toISOString());
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await insertSessionStmt.run(userId, token, expiresAt);
  return { token, expiresAt };
}

async function getSessionUser(token) {
  if (!token) return null;
  const session = await readSessionStmt.get(token);
  if (!session) return null;
  const expiresAt = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await deleteSessionStmt.run(token);
    return null;
  }
  const user = await readUserByIdStmt.get(session.userId);
  if (!user) {
    await deleteSessionStmt.run(token);
    return null;
  }
  return { user, session };
}

function normalizeDungeonPlacements(rawPlacements) {
  if (!Array.isArray(rawPlacements)) {
    return { ok: false, error: "placements must be an array" };
  }
  if (rawPlacements.length !== DUNGEON_PIECE_ORDER.length) {
    return { ok: false, error: "placements count is invalid" };
  }

  const normalized = [];
  const seen = new Set();
  for (const item of rawPlacements) {
    const pieceId = typeof item?.pieceId === "string" ? item.pieceId : "";
    const row = Number(item?.row);
    const col = Number(item?.col);
    const rotation = normalizeDungeonRotation(item?.rotation ?? 0);
    if (!DUNGEON_PIECE_ORDER.includes(pieceId)) {
      return { ok: false, error: "invalid pieceId" };
    }
    if (seen.has(pieceId)) {
      return { ok: false, error: "duplicate pieceId" };
    }
    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      return { ok: false, error: "row/col must be integers" };
    }
    if (rotation === null) {
      return { ok: false, error: "rotation must be one of 0/90/180/270" };
    }
    seen.add(pieceId);
    normalized.push({ pieceId, row, col, rotation });
  }

  for (const pieceId of DUNGEON_PIECE_ORDER) {
    if (!seen.has(pieceId)) {
      return { ok: false, error: "missing piece" };
    }
  }

  const occupied = new Set();
  for (const placement of normalized) {
    const shape = getDungeonShape(placement.pieceId, placement.rotation);
    for (const cell of shape) {
      const row = placement.row + cell.dr;
      const col = placement.col + cell.dc;
      if (row < 0 || col < 0 || row >= DUNGEON_SIZE || col >= DUNGEON_SIZE) {
        return { ok: false, error: "piece out of board" };
      }
      const key = `${row},${col}`;
      if (occupied.has(key)) {
        return { ok: false, error: "pieces overlap" };
      }
      occupied.add(key);
    }
  }

  const ordered = DUNGEON_PIECE_ORDER.map((pieceId) => normalized.find((item) => item.pieceId === pieceId));
  return { ok: true, placements: ordered };
}

function normalizeDungeonMaskColors(rawMaskColors) {
  if (!Array.isArray(rawMaskColors)) {
    return { ok: false, error: "maskColors must be an array" };
  }
  if (rawMaskColors.length !== DUNGEON_CELL_COUNT) {
    return { ok: false, error: "maskColors length is invalid" };
  }
  const counts = new Map(DUNGEON_MASK_COLORS.map((color) => [color, 0]));
  const normalized = [];
  for (const item of rawMaskColors) {
    const color = typeof item === "string" ? item : "";
    if (!counts.has(color)) {
      return { ok: false, error: "maskColors contains invalid color" };
    }
    counts.set(color, (counts.get(color) || 0) + 1);
    normalized.push(color);
  }
  for (const color of DUNGEON_MASK_COLORS) {
    if ((counts.get(color) || 0) !== 5) {
      return { ok: false, error: "each mask color must appear exactly 5 times" };
    }
  }
  return { ok: true, maskColors: normalized };
}

function randomDungeonUuid() {
  let out = "";
  for (let i = 0; i < DUNGEON_UUID_LENGTH; i += 1) {
    const idx = Math.floor(Math.random() * DUNGEON_UUID_ALPHABET.length);
    out += DUNGEON_UUID_ALPHABET[idx];
  }
  return out;
}

async function createUniqueDungeonUuid() {
  for (let i = 0; i < 200; i += 1) {
    const uuid = randomDungeonUuid();
    const existing = await readPublishedDungeonMapByUuidStmt.get(uuid);
    if (!existing) return uuid;
  }
  throw new Error("Failed to generate unique dungeon uuid");
}

function normalizeDungeonUuid(raw) {
  const uuid = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{10}$/.test(uuid)) return "";
  return uuid;
}

function parsePublishedDungeonMapRow(row) {
  if (!row) return null;
  try {
    const placementsParsed = JSON.parse(row.placementsJson);
    const maskParsed = JSON.parse(row.maskColorsJson);
    const placements = normalizeDungeonPlacements(placementsParsed);
    const maskColors = normalizeDungeonMaskColors(maskParsed);
    if (!placements.ok || !maskColors.ok) return null;
    return {
      uuid: row.uuid,
      ownerUserId: Number(row.ownerUserId),
      placements: placements.placements,
      maskColors: maskColors.maskColors,
      createdAt: row.createdAt,
    };
  } catch {
    return null;
  }
}

async function getPublishedDungeonMap(uuid) {
  const row = await readPublishedDungeonMapByUuidStmt.get(uuid);
  return parsePublishedDungeonMapRow(row);
}

async function getMyPublishedDungeonMaps(ownerUserId) {
  const rows = await readPublishedDungeonMapsByOwnerStmt.all(ownerUserId);
  return rows
    .map((row) => {
      const parsed = parsePublishedDungeonMapRow({ ...row, ownerUserId });
      if (!parsed) return null;
      return {
        uuid: parsed.uuid,
        placements: parsed.placements,
        maskColors: parsed.maskColors,
        createdAt: parsed.createdAt,
        playCount: row.playCount || 0,
        winCount: row.winCount || 0,
      };
    })
    .filter(Boolean);
}

async function getDungeonMapByUser(userId) {
  const row = await readDungeonMapByUserStmt.get(userId);
  if (!row || typeof row.placementsJson !== "string") return null;
  try {
    const parsed = JSON.parse(row.placementsJson);
    const normalized = normalizeDungeonPlacements(parsed);
    if (!normalized.ok) return null;
    let maskColors = [];
    try {
      const parsedMask = JSON.parse(typeof row.maskColorsJson === "string" ? row.maskColorsJson : "[]");
      const normalizedMask = normalizeDungeonMaskColors(parsedMask);
      if (normalizedMask.ok) {
        maskColors = normalizedMask.maskColors;
      }
    } catch {
      maskColors = [];
    }
    return {
      placements: normalized.placements,
      maskColors,
      updatedAt: row.updatedAt,
    };
  } catch {
    return null;
  }
}

function heuristicMiniEngEvaluation(question, answer, recognitionConfidence, meta) {
  const mode = meta?.mode === "spoken_expression" ? "spoken_expression" : "qa";
  const expectedAnswer = typeof meta?.expectedAnswer === "string" ? meta.expectedAnswer.trim() : "";

  if (mode === "spoken_expression") {
    const a = normalizeMiniEngText(answer);
    const e = normalizeMiniEngText(expectedAnswer);
    const isCorrect = e ? a === e || a.includes(e) : a.length > 0;
    const hasExtra = e ? a.replace(e, "").trim().length > 0 : false;

    const correctness = clampScore(isCorrect ? 9.2 : a.length >= 3 ? 4.8 : 2.5);
    const naturalness = clampScore(isCorrect && !hasExtra ? 9.0 : isCorrect ? 7.8 : 4.2);
    const pronunciation = clampScore(5 + (Number(recognitionConfidence) || 0) * 4.5);
    const overall = clampScore((correctness + naturalness + pronunciation) / 3);

    return {
      scores: { grammar: correctness, pronunciation, expression: naturalness, overall },
      feedback: {
        grammar: isCorrect ? "表达含义匹配场景，答案基本正确。" : "含义可能不匹配场景，建议更贴近参考表达。",
        pronunciation: "本次为兜底评分，发音分仅参考识别置信度。",
        expression: isCorrect
          ? "用法比较地道。注意在真实对话里也可以加一句 \"I'm calling it a night.\""
          : "可以尝试更口语、更地道的固定搭配表达。",
        overall: "目标：既要意思对，也要像母语者那样简短自然。",
      },
      improvedAnswer: expectedAnswer || "",
      source: "heuristic",
      model: "local-heuristic",
    };
  }

  const words = answer.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const hasEndPunc = /[.!?]$/.test(answer.trim());
  const hasSubject = /\b(i|we|he|she|they|it)\b/i.test(answer);
  const hasTense = /\b(am|is|are|was|were|did|went|have|has|had|will)\b/i.test(answer);
  const connectors = /\b(because|so|but|and|then|however|also)\b/i.test(answer);

  let grammar = 4.5;
  grammar += wordCount >= 8 ? 2 : wordCount >= 5 ? 1 : 0;
  grammar += hasSubject ? 1 : 0;
  grammar += hasTense ? 1 : 0;
  grammar += hasEndPunc ? 0.5 : 0;

  let expression = 4.5;
  expression += wordCount >= 10 ? 2 : wordCount >= 6 ? 1 : 0;
  expression += connectors ? 1.5 : 0;
  expression += /\b(my|in|at|on|with|for|to)\b/i.test(answer) ? 1 : 0;

  const conf = Number(recognitionConfidence) || 0;
  let pronunciation = 5 + conf * 4.5;
  if (wordCount < 4) pronunciation -= 1;

  grammar = clampScore(grammar);
  expression = clampScore(expression);
  pronunciation = clampScore(pronunciation);
  const overall = clampScore((grammar + expression + pronunciation) / 3);

  return {
    scores: { grammar, pronunciation, expression, overall },
    feedback: {
      grammar:
        grammar >= 8
          ? "语法结构整体不错，时态和句子完整性较好。"
          : "尝试用完整句回答，并注意主谓一致与时态。可多用 \"I ... because ...\"。",
      pronunciation:
        pronunciation >= 8
          ? "发音识别稳定，语速和清晰度较好。"
          : "建议放慢语速并清晰发音，重读关键词，句尾收音更完整。",
      expression:
        expression >= 8
          ? "表达较自然，有细节与连接词。"
          : "可以增加细节（时间、地点、原因）并使用连接词提升流畅度。",
      overall: "继续围绕题目扩展到2-3句，会更容易拿高分。",
    },
    improvedAnswer:
      "For \"" +
      question +
      "\", you can say: " +
      "\"" +
      (answer.endsWith(".") ? answer : answer + ".") +
      " Because it is important to me.\"",
    source: "heuristic",
    model: "local-heuristic",
  };
}

function getProviderConfig(provider) {
  if (provider === "openai") {
    return { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" };
  }
  if (provider === "deepseek") {
    return { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" };
  }
  if (provider === "qwen") {
    return { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" };
  }
  return null;
}

function parseJsonFromText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("No JSON found in AI response");
  }
}

async function aiMiniEngEvaluation(question, answer, recognitionConfidence, aiConfig, meta) {
  const mode = meta?.mode === "spoken_expression" ? "spoken_expression" : "qa";
  const expectedAnswer = typeof meta?.expectedAnswer === "string" ? meta.expectedAnswer.trim() : "";
  const provider = typeof aiConfig?.provider === "string" ? aiConfig.provider : "";
  const keyFromRequest = typeof aiConfig?.key === "string" ? aiConfig.key.trim() : "";
  const providerPreset = getProviderConfig(provider);

  let apiKey = keyFromRequest;
  let baseUrl = providerPreset?.baseUrl;
  let model = providerPreset?.model;

  // Backward compatibility: if request has no config, still support env-based OpenAI.
  if (!apiKey) {
    apiKey = process.env.OPENAI_API_KEY || "";
    baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  }

  if (!apiKey) return null;

  const prompt =
    "You are an English speaking coach.\n" +
    "You will receive JSON input.\n" +
    "Return strict JSON with shape:\n" +
    "{scores:{grammar:number,pronunciation:number,expression:number,overall:number}," +
    "feedback:{grammar:string,pronunciation:string,expression:string,overall:string},improvedAnswer:string}\n" +
    "Score range: 0-10 with one decimal.\n" +
    "Keep feedback concise and practical in Chinese.\n" +
    "Rules:\n" +
    "- If mode is 'spoken_expression': the user answers with an English phrase for the given Chinese scenario.\n" +
    "  * 'grammar' should represent correctness/meaning match.\n" +
    "  * 'expression' should represent idiomatic/naturalness.\n" +
    "  * pronunciation should consider recognitionConfidence but do not over-penalize.\n" +
    "  * Use expectedAnswer as reference; accept close variants.\n";

  const payload = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: JSON.stringify({
          mode,
          question,
          expectedAnswer,
          answer,
          recognitionConfidence,
        }),
      },
    ],
  };

  const response = await fetch(String(baseUrl).replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("AI request failed: " + response.status);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") throw new Error("Empty AI content");

  const parsed = parseJsonFromText(content);
  const grammar = clampScore(parsed?.scores?.grammar);
  const pronunciation = clampScore(parsed?.scores?.pronunciation);
  const expression = clampScore(parsed?.scores?.expression);
  const overall = clampScore(parsed?.scores?.overall || (grammar + pronunciation + expression) / 3);

  return {
    scores: { grammar, pronunciation, expression, overall },
    feedback: {
      grammar: String(parsed?.feedback?.grammar || ""),
      pronunciation: String(parsed?.feedback?.pronunciation || ""),
      expression: String(parsed?.feedback?.expression || ""),
      overall: String(parsed?.feedback?.overall || ""),
    },
    improvedAnswer: String(parsed?.improvedAnswer || ""),
    source: provider || "openai_env",
    model: String(model || ""),
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/bootstrap") {
    json(res, 200, {
      settings: await getSettings(),
      history: await getHistory(100),
      leaderboard: await getLeaderboard(),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/users/register") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";

    if (!isValidUsername(username)) {
      badRequest(res, "用户名需为 4-16 位字母/数字/下划线");
      return true;
    }
    if (!isValidPassword(password)) {
      badRequest(res, "密码不能为空且长度不超过 64");
      return true;
    }

    const existing = await readUserByUsernameStmt.get(username);
    if (existing) {
      json(res, 409, { error: "用户名已被占用" });
      return true;
    }

    let userId = 0;
    try {
      const passwordHash = hashPassword(password);
      const result = await insertUserStmt.run(username, passwordHash);
      userId = Number(result.lastInsertRowid);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNIQUE")) {
        json(res, 409, { error: "用户名已被占用" });
        return true;
      }
      throw error;
    }
    const session = await createSession(userId);
    json(res, 200, {
      ok: true,
      user: { id: userId, username, nickname: "", avatar: "" },
      token: session.token,
      expiresAt: session.expiresAt,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/users/login") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";

    if (!isValidUsername(username) || !isValidPassword(password)) {
      badRequest(res, "用户名或密码不正确");
      return true;
    }

    const user = await readUserByUsernameStmt.get(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      json(res, 401, { error: "用户名或密码不正确" });
      return true;
    }

    const session = await createSession(user.id);
    json(res, 200, {
      ok: true,
      user: { id: user.id, username: user.username, nickname: user.nickname || "", avatar: user.avatar || "" },
      token: session.token,
      expiresAt: session.expiresAt,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/users/logout") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const token = getAuthToken(req, body);
    if (!token) {
      badRequest(res, "Missing token");
      return true;
    }
    await deleteSessionStmt.run(token);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/users/me") {
    const token = getAuthToken(req, null);
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) {
      json(res, 200, { user: null });
      return true;
    }
    json(res, 200, {
      user: {
        id: sessionUser.user.id,
        username: sessionUser.user.username,
        nickname: sessionUser.user.nickname || "",
        avatar: sessionUser.user.avatar || "",
      },
      expiresAt: sessionUser.session.expiresAt,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/users/password") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const token = getAuthToken(req, body);
    const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (!token) {
      badRequest(res, "Missing token");
      return true;
    }
    if (!isValidPassword(oldPassword) || !isValidPassword(newPassword)) {
      badRequest(res, "密码不能为空且长度不超过 64");
      return true;
    }

    const sessionUser = await getSessionUser(token);
    if (!sessionUser) {
      json(res, 401, { error: "未登录或登录已过期" });
      return true;
    }

    const fullUser = await readUserByUsernameStmt.get(sessionUser.user.username);
    if (!fullUser || !verifyPassword(oldPassword, fullUser.passwordHash)) {
      json(res, 401, { error: "原密码不正确" });
      return true;
    }

    await updateUserPasswordStmt.run(hashPassword(newPassword), fullUser.id);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/users/profile") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const token = getAuthToken(req, body);
    if (!token) {
      badRequest(res, "Missing token");
      return true;
    }
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) {
      json(res, 401, { error: "未登录或登录已过期" });
      return true;
    }
    const nickname = normalizeNickname(body.nickname);
    const avatar = normalizeAvatar(body.avatar);
    await updateUserProfileStmt.run(nickname, avatar, sessionUser.user.id);
    json(res, 200, { ok: true, user: { ...sessionUser.user, nickname, avatar } });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/dungeon/map") {
    const token = getAuthToken(req, null);
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) {
      json(res, 401, { error: "未登录或登录已过期" });
      return true;
    }
    json(res, 200, { map: await getDungeonMapByUser(sessionUser.user.id) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/dungeon/map") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const token = getAuthToken(req, body);
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) {
      json(res, 401, { error: "未登录或登录已过期" });
      return true;
    }

    const normalized = normalizeDungeonPlacements(body.placements);
    if (!normalized.ok) {
      badRequest(res, "Invalid dungeon map: " + normalized.error);
      return true;
    }
    const normalizedMask = normalizeDungeonMaskColors(body.maskColors);
    if (!normalizedMask.ok) {
      badRequest(res, "Invalid dungeon map colors: " + normalizedMask.error);
      return true;
    }

    await upsertDungeonMapStmt.run(
      sessionUser.user.id,
      JSON.stringify(normalized.placements),
      JSON.stringify(normalizedMask.maskColors),
    );
    json(res, 200, { ok: true, map: await getDungeonMapByUser(sessionUser.user.id) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/dungeon/map/publish") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const token = getAuthToken(req, body);
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) {
      json(res, 401, { error: "未登录或登录已过期" });
      return true;
    }
    const baseMap = await getDungeonMapByUser(sessionUser.user.id);
    if (!baseMap || !Array.isArray(baseMap.placements) || !Array.isArray(baseMap.maskColors)) {
      badRequest(res, "请先保存有效藏宝图后再发布");
      return true;
    }
    const uuid = await createUniqueDungeonUuid();
    await insertPublishedDungeonMapStmt.run(
      uuid,
      sessionUser.user.id,
      JSON.stringify(baseMap.placements),
      JSON.stringify(baseMap.maskColors),
    );
    const published = await getPublishedDungeonMap(uuid);
    json(res, 200, { ok: true, map: published });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/dungeon/maps/mine") {
    const token = getAuthToken(req, null);
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) {
      json(res, 401, { error: "未登录或登录已过期" });
      return true;
    }
    json(res, 200, { items: await getMyPublishedDungeonMaps(sessionUser.user.id) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/dungeon/map/random") {
    const token = getAuthToken(req, null);
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) {
      json(res, 401, { error: "未登录或登录已过期" });
      return true;
    }
    const userId = sessionUser.user.id;
    const row = await readRandomUnplayedDungeonMapStmt.get(userId, userId);
    if (!row) {
      json(res, 200, { map: null });
      return true;
    }
    const parsed = parsePublishedDungeonMapRow(row);
    if (!parsed) {
      json(res, 200, { map: null });
      return true;
    }
    json(res, 200, {
      map: {
        uuid: parsed.uuid,
        ownerUserId: parsed.ownerUserId,
        placements: parsed.placements,
        maskColors: parsed.maskColors,
        createdAt: parsed.createdAt,
      },
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/dungeon/map/public") {
    const query = new URL(req.url || "/", `http://${HOST}:${PORT}`).searchParams;
    const uuid = normalizeDungeonUuid(query.get("uuid"));
    if (!uuid) {
      badRequest(res, "Invalid uuid");
      return true;
    }
    const map = await getPublishedDungeonMap(uuid);
    if (!map) {
      notFound(res);
      return true;
    }
    const token = getAuthToken(req, null);
    const sessionUser = await getSessionUser(token);
    const alreadyPlayed = sessionUser
      ? Boolean(await readDungeonHuntRecordStmt.get(uuid, sessionUser.user.id))
      : false;
    json(res, 200, {
      map: {
        uuid: map.uuid,
        ownerUserId: map.ownerUserId,
        placements: map.placements,
        maskColors: map.maskColors,
        createdAt: map.createdAt,
      },
      alreadyPlayed,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/dungeon/hunt/submit") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const token = getAuthToken(req, body);
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) {
      json(res, 401, { error: "未登录或登录已过期" });
      return true;
    }
    const uuid = normalizeDungeonUuid(body.uuid);
    if (!uuid) {
      badRequest(res, "Invalid uuid");
      return true;
    }
    const map = await getPublishedDungeonMap(uuid);
    if (!map) {
      notFound(res);
      return true;
    }
    const score = Number(body.score);
    const safeScore = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
    const result = body.result === "win" ? "win" : "lose";
    const existing = await readDungeonHuntRecordStmt.get(uuid, sessionUser.user.id);
    if (existing) {
      json(res, 409, { error: "你已经挑战过这张藏宝图" });
      return true;
    }
    await insertDungeonHuntRecordStmt.run(uuid, sessionUser.user.id, safeScore, result);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/dungeon/hunt/history") {
    const query = new URL(req.url || "/", `http://${HOST}:${PORT}`).searchParams;
    const uuid = normalizeDungeonUuid(query.get("uuid"));
    if (!uuid) {
      badRequest(res, "Invalid uuid");
      return true;
    }
    const map = await getPublishedDungeonMap(uuid);
    if (!map) {
      notFound(res);
      return true;
    }
    json(res, 200, { items: await readDungeonHuntHistoryStmt.all(uuid) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/dungeon/hunt/my-history") {
    const token = getAuthToken(req, null);
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) {
      json(res, 401, { error: "未登录或登录已过期" });
      return true;
    }
    json(res, 200, { items: await readMyDungeonHuntHistoryStmt.all(sessionUser.user.id) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/dungeon/leaderboard-total") {
    json(res, 200, { items: await readDungeonLeaderboardStmt.all() });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/square-cube/bootstrap") {
    if (USE_TURSO) {
      try {
        const [history, groups] = await Promise.all([getSquareCubeHistoryTurso(10), getSquareCubeLeaderboardTurso()]);
        json(res, 200, { history, groups });
      } catch {
        json(res, 200, { history: [], groups: await getSquareCubeLeaderboardTurso().catch(() => []) });
      }
      return true;
    }
    json(res, 200, { history: getSquareCubeHistory(10), groups: getSquareCubeLeaderboard() });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/square-cube/history") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const skipInsert = Boolean(body.skipInsert);
    const limit = Number(body.limit);
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 10;

    if (!skipInsert && (typeof body.equation !== "string" || typeof body.time !== "string")) {
      badRequest(res, "Invalid square cube history payload");
      return true;
    }
    if (USE_TURSO) {
      try {
        await ensureSquareCubeSchemaTurso();
        if (!skipInsert) {
          const client = getTursoClient();
          await client.execute({
            sql: `INSERT INTO square_cube_history_records (equation, time_text, time_ms) VALUES (?, ?, ?)`,
            args: [body.equation, body.time, Number(body.timeMs) || 0],
          });
        }
        const history = await getSquareCubeHistoryTurso(normalizedLimit);
        json(res, 200, { history });
      } catch {
        json(res, 200, { history: [] });
      }
      return true;
    }
    if (!skipInsert) {
      await insertSquareCubeHistoryStmt.run(body.equation, body.time, Number(body.timeMs) || 0);
    }
    json(res, 200, { history: getSquareCubeHistory(normalizedLimit) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/square-cube/leaderboard") {
    if (USE_TURSO) {
      try {
        json(res, 200, { groups: await getSquareCubeLeaderboardTurso() });
      } catch {
        json(res, 200, { groups: [] });
      }
      return true;
    }
    json(res, 200, { groups: getSquareCubeLeaderboard() });
    return true;
  }

  const squareCubeDetailMatch = pathname.match(/^\/api\/square-cube\/leaderboard\/(\d+)\/items$/);
  if (req.method === "GET" && squareCubeDetailMatch) {
    const entryId = Number(squareCubeDetailMatch[1]);
    if (USE_TURSO) {
      try {
        const rows = await tursoAll(
          `
          SELECT
            equation,
            time_text AS time,
            time_ms AS timeMs
          FROM square_cube_leaderboard_items
          WHERE entry_id = ?
          ORDER BY item_order ASC, id ASC
        `,
          [entryId],
        );
        const items = rows.map((r) => ({
          equation: String(r.equation || ""),
          time: String(r.time || "0s"),
          timeMs: Number(r.timeMs) || 0,
        }));
        json(res, 200, { items });
      } catch {
        json(res, 200, { items: [] });
      }
      return true;
    }
    json(res, 200, { items: await readSquareCubeLeaderboardItemsStmt.all(entryId) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/square-cube/round") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const username = typeof body.username === "string" && body.username.trim() ? body.username.trim().slice(0, 10) : "匿名";
    const type = body.type === "cube" || body.type === "mixed" ? body.type : "square";
    const totalMs = Number(body.totalMs) || 0;
    const totalTimeText = typeof body.totalTimeText === "string" ? body.totalTimeText : "0s";
    const items = Array.isArray(body.items) ? body.items : [];

    if (USE_TURSO) {
      try {
        await ensureSquareCubeSchemaTurso();
        const client = getTursoClient();
        const entryResult = await client.execute({
          sql: `
            INSERT INTO square_cube_leaderboard_entries (username, practice_type, total_ms, total_time_text)
            VALUES (?, ?, ?, ?)
          `,
          args: [username, type, totalMs, totalTimeText],
        });
        const entryId = Number(entryResult.lastInsertRowid);
        const statements = items.map((item, index) => ({
          sql: `
            INSERT INTO square_cube_leaderboard_items (entry_id, item_order, equation, time_text, time_ms)
            VALUES (?, ?, ?, ?, ?)
          `,
          args: [
            entryId,
            index,
            String(item.equation || ""),
            String(item.time || "0s"),
            Number(item.timeMs) || 0,
          ],
        }));
        if (statements.length) {
          await client.batch(statements, "write");
        }
        json(res, 200, { ok: true, groups: await getSquareCubeLeaderboardTurso() });
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : "square-cube round write failed" });
      }
      return true;
    }

    db.exec("BEGIN");
    try {
      const result = await insertSquareCubeLeaderboardStmt.run(username, type, totalMs, totalTimeText);
      const entryId = Number(result.lastInsertRowid);
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        await insertSquareCubeLeaderboardItemStmt.run(
          entryId,
          index,
          String(item.equation || ""),
          String(item.time || "0s"),
          Number(item.timeMs) || 0,
        );
      }
      db.exec("COMMIT");
      json(res, 200, { ok: true, groups: await getSquareCubeLeaderboard() });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/leaderboard") {
    json(res, 200, { groups: await getLeaderboard() });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/leaderboard\/(\d+)\/items$/);
  if (req.method === "GET" && detailMatch) {
    const entryId = Number(detailMatch[1]);
    json(res, 200, { items: await readLeaderboardItemsStmt.all(entryId) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/processing-speed/leaderboard") {
    const query = new URL(req.url || "/", `http://${HOST}:${PORT}`).searchParams;
    const level = query.get("level") === "advanced" ? "advanced" : "beginner";
    json(res, 200, { level, items: await readProcessingSpeedLeaderboardStmt.all(level) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/settings") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const nextSettings = sanitizeSettings(body);
    await updateSettingsStmt.run(
      nextSettings.username,
      nextSettings.problemType,
      nextSettings.digitCount,
      nextSettings.operandCount,
      nextSettings.questionCount,
    );
    json(res, 200, {
      settings: await getSettings(),
      history: await getHistory(nextSettings.questionCount),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/history") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const skipInsert = Boolean(body.skipInsert);
    const limit = Number(body.limit);
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 10;

    if (!skipInsert && (typeof body.equation !== "string" || typeof body.time !== "string")) {
      badRequest(res, "Invalid history payload");
      return true;
    }
    if (!skipInsert) {
      await insertHistoryStmt.run(body.equation, body.time, Number(body.timeMs) || 0);
    }
    json(res, 200, { history: await getHistory(normalizedLimit) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/round") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const username = typeof body.username === "string" && body.username.trim() ? body.username.trim() : "匿名";
    const totalMs = Number(body.totalMs) || 0;
    const totalTimeText = typeof body.totalTimeText === "string" ? body.totalTimeText : "0s";
    const configLabel = typeof body.configLabel === "string" && body.configLabel.trim() ? body.configLabel : "未知-2-2-10";
    const configKey = typeof body.configKey === "string" && body.configKey.trim() ? body.configKey : configLabel;
    const items = Array.isArray(body.items) ? body.items : [];

    db.exec("BEGIN");
    try {
      const result = await insertLeaderboardStmt.run(username, totalMs, totalTimeText, configKey, configLabel);
      const entryId = Number(result.lastInsertRowid);
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        await insertLeaderboardItemStmt.run(
          entryId,
          index,
          String(item.equation || ""),
          String(item.time || "0s"),
          Number(item.timeMs) || 0,
        );
      }
      db.exec("COMMIT");
      json(res, 200, { ok: true, groups: await getLeaderboard() });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/mini-eng/evaluate") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const mode = body.mode === "spoken_expression" ? "spoken_expression" : "qa";
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const expectedAnswer = typeof body.expectedAnswer === "string" ? body.expectedAnswer.trim() : "";
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    const recognitionConfidence = Number(body.recognitionConfidence) || 0;
    if (!question || !answer) {
      badRequest(res, "Invalid evaluate payload");
      return true;
    }

    try {
      const aiResult = await aiMiniEngEvaluation(question, answer, recognitionConfidence, body.aiConfig, {
        mode,
        expectedAnswer,
      });
      if (aiResult) {
        json(res, 200, aiResult);
        return true;
      }
    } catch {
      // Fallback to heuristic evaluation when AI call fails.
    }

    json(
      res,
      200,
      heuristicMiniEngEvaluation(question, answer, recognitionConfidence, {
        mode,
        expectedAnswer,
      }),
    );
    return true;
  }

  if (req.method === "POST" && pathname === "/api/processing-speed/round") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const username =
      typeof body.username === "string" && body.username.trim() ? body.username.trim().slice(0, 10) : "匿名";
    const level = body.level === "advanced" ? "advanced" : "beginner";
    const totalMs = Number(body.totalMs);
    const totalTimeText = typeof body.totalTimeText === "string" ? body.totalTimeText : "";
    const items = Array.isArray(body.items) ? body.items : [];
    if (!Number.isFinite(totalMs) || totalMs <= 0) {
      badRequest(res, "Invalid totalMs");
      return true;
    }
    if (items.length !== 9) {
      badRequest(res, "Round must contain exactly 9 items");
      return true;
    }

    db.exec("BEGIN");
    try {
      const result = await insertProcessingSpeedEntryStmt.run(
        username,
        level,
        Math.round(totalMs),
        totalTimeText || "0.00 秒",
      );
      const entryId = Number(result.lastInsertRowid);
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        await insertProcessingSpeedItemStmt.run(
          entryId,
          index,
          String(item.target || ""),
          Number(item.timeMs) || 0,
          String(item.timeText || "0.00 秒"),
        );
      }
      db.exec("COMMIT");
      json(res, 200, { ok: true, level, items: await readProcessingSpeedLeaderboardStmt.all(level) });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/billing/checkout-session") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const amountYuan = Number(body.amountYuan);
    const origin = typeof body.origin === "string" && /^https?:\/\//.test(body.origin) ? body.origin : "";
    const stripe = getStripeClient();
    if (!stripe) {
      json(res, 500, {
        error: "Stripe 未配置：请在服务环境中设置 STRIPE_SECRET_KEY",
      });
      return true;
    }
    if (!origin) {
      badRequest(res, "Invalid origin");
      return true;
    }
    if (!Number.isInteger(amountYuan) || amountYuan <= 0) {
      badRequest(res, "Invalid amount");
      return true;
    }
    const amountFen = amountYuan * 100;
    const successUrl = origin + "/recharge.html?status=success";
    const cancelUrl = origin + "/recharge.html?status=cancel";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price_data: {
            currency: "cny",
            unit_amount: amountFen,
            product_data: {
              name: "Novel 充值",
              description: "众创小说模块测试充值",
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        module: "novel",
        amountYuan: String(amountYuan),
      },
    });
    json(res, 200, { url: session.url || "" });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/novel/content") {
    const query = new URL(req.url || "/", `http://${HOST}:${PORT}`).searchParams;
    const id = Number(query.get("id"));
    const seq = Number(query.get("seq"));

    let item = null;
    if (Number.isInteger(id) && id > 0) {
      item = (await readNovelByIdStmt.get(id)) || null;
    } else {
      const targetSeq = Number.isInteger(seq) && seq > 0 ? seq : 1;
      item = (await readNovelTopBySeqStmt.get(targetSeq)) || null;
    }

    const nextTopItem = item ? ((await readNovelChildrenTopStmt.get(item.id)) || null) : null;
    const items = item ? await readNovelChildrenListStmt.all(item.id) : [];
    json(res, 200, { item, nextTopItem, items });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/novel/candidates") {
    const query = new URL(req.url || "/", `http://${HOST}:${PORT}`).searchParams;
    const parentId = Number(query.get("parentId"));
    const offset = Number(query.get("offset"));
    const limit = Number(query.get("limit"));
    const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20;

    if (!Number.isInteger(parentId) || parentId <= 0) {
      badRequest(res, "Invalid parentId");
      return true;
    }

    const rows = await readNovelChildrenPagedStmt.all(parentId, safeLimit + 1, safeOffset);
    const hasMore = rows.length > safeLimit;
    const items = hasMore ? rows.slice(0, safeLimit) : rows;
    json(res, 200, { items, hasMore });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/novel/integrated") {
    const query = new URL(req.url || "/", `http://${HOST}:${PORT}`).searchParams;
    const id = Number(query.get("id"));
    const limit = Number(query.get("limit"));
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100;
    if (!Number.isInteger(id) || id <= 0) {
      badRequest(res, "Invalid novel id");
      return true;
    }
    const items = await readNovelIntegratedStmt.all(id, safeLimit);
    json(res, 200, { items });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/novel/integrated.pdf") {
    const query = new URL(req.url || "/", `http://${HOST}:${PORT}`).searchParams;
    const id = Number(query.get("id"));
    const limit = Number(query.get("limit"));
    const title = query.get("title") || "Novel";
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100;
    if (!Number.isInteger(id) || id <= 0) {
      badRequest(res, "Invalid novel id");
      return true;
    }
    const items = await readNovelIntegratedStmt.all(id, safeLimit);
    sendIntegratedPdf(res, title, items);
    return true;
  }

  if (req.method === "POST" && pathname === "/api/novel/like") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const id = Number(body.id);
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 64) : "";
    const ip = getClientIp(req);
    if (!Number.isInteger(id) || id <= 0) {
      badRequest(res, "Invalid novel id");
      return true;
    }
    if (!deviceId) {
      badRequest(res, "Missing deviceId");
      return true;
    }

    const now = Date.now();
    const cooldownMs = 30 * 1000;
    const recent = await readNovelRecentLikeStmt.get(id, deviceId, ip);
    if (recent && now - Number(recent.likedAt) < cooldownMs) {
      json(res, 429, {
        error: "Like too frequent",
        retryAfterMs: cooldownMs - (now - Number(recent.likedAt)),
      });
      return true;
    }

    db.exec("BEGIN");
    try {
      await updateNovelVoteStmt.run(id);
      await insertNovelLikeLogStmt.run(id, deviceId, ip, now);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const item = (await readNovelByIdStmt.get(id)) || null;
    json(res, 200, { item });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/novel/submit") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const parentId = Number(body.parentId);
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const author = typeof body.author === "string" ? body.author.trim().slice(0, 10) : "";
    if (!Number.isInteger(parentId) || parentId <= 0) {
      badRequest(res, "Invalid parentId");
      return true;
    }
    if (!content || content.length > 400) {
      badRequest(res, "Content length must be 1-400");
      return true;
    }
    if (!author) {
      badRequest(res, "Author is required");
      return true;
    }
    const parent = await readNovelByIdStmt.get(parentId);
    if (!parent) {
      badRequest(res, "Parent content not found");
      return true;
    }
    const seq = Number(parent.seq) + 1;
    await insertNovelStmt.run(seq, parentId, content, author);
    const item = (await readNovelChildrenTopStmt.get(parentId)) || null;
    json(res, 200, { ok: true, item });
    return true;
  }

  return false;
}

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    const pathname = url.pathname;

    if (await handleApi(req, res, pathname)) return;

    if (pathname === "/") return void sendFile(res, "pages/polybox/index.html");
    if (pathname === "/polybox.html") return void sendFile(res, "pages/polybox/index.html");
    if (pathname === "/minimaths.html") return void sendFile(res, "games/minimaths/index.html");
    if (pathname === "/square-cube.html") return void sendFile(res, "games/square-cube/index.html");
    if (pathname === "/mini-eng.html") return void sendFile(res, "games/mini-eng/index.html");
    if (pathname === "/xiaoguwen.html") return void sendFile(res, "games/xiaoguwen/index.html");
    if (pathname === "/novel.html") return void sendFile(res, "games/novel/index.html");
    if (pathname === "/processing-speed.html") return void sendFile(res, "games/processing-speed/index.html");
    if (pathname === "/dungeon.html") return void sendFile(res, "games/dungeon/index.html");
    if (pathname === "/dungeon-play.html") return void sendFile(res, "games/dungeon/play.html");
    if (pathname === "/dungeon-build.html") return void sendFile(res, "games/dungeon/build.html");
    if (pathname === "/dungeon-hunt.html") return void sendFile(res, "games/dungeon/hunt.html");
    if (pathname === "/recharge.html") return void sendFile(res, "pages/recharge/index.html");
    if (pathname === "/user.html") return void sendFile(res, "pages/user/index.html");

    if (pathname === "/app.js") return void sendFile(res, "games/minimaths/app.js");
    if (pathname === "/square-cube.js") return void sendFile(res, "games/square-cube/app.js");
    if (pathname === "/mini-eng.js") return void sendFile(res, "games/mini-eng/mini-eng.js");
    if (pathname === "/novel.js") return void sendFile(res, "games/novel/novel.js");
    if (pathname === "/processing-speed.js") return void sendFile(res, "games/processing-speed/processing-speed.js");
    if (pathname === "/dungeon.js") return void sendFile(res, "games/dungeon/dungeon.js");
    if (pathname === "/recharge.js") return void sendFile(res, "pages/recharge/recharge.js");
    if (pathname === "/user.js") return void sendFile(res, "pages/user/user.js");
    if (pathname === "/user.css") return void sendFile(res, "pages/user/user.css");
    if (pathname === "/nav-loader.js") return void sendFile(res, "shared/nav-loader.js");
    if (pathname === "/theme.css") return void sendFile(res, "shared/theme.css");
    if (pathname === "/theme.js") return void sendFile(res, "shared/theme.js");
    if (pathname === "/polybox.css") return void sendFile(res, "pages/polybox/polybox.css");
    if (pathname === "/polybox.js") return void sendFile(res, "pages/polybox/polybox.js");
    if (pathname === "/assets/polybox/banner-brand.png") return void sendFile(res, "assets/polybox/banner-brand.png");
    if (pathname === "/assets/polybox/banner-edu.png") return void sendFile(res, "assets/polybox/banner-edu.png");
    if (pathname === "/assets/polybox/banner-services.png") return void sendFile(res, "assets/polybox/banner-services.png");
    if (pathname === "/assets/polybox/banner-products.png") return void sendFile(res, "assets/polybox/banner-products.png");
    if (pathname === "/assets/polybox/card-dev.png") return void sendFile(res, "assets/polybox/card-dev.png");
    if (pathname === "/assets/polybox/card-commerce.png") return void sendFile(res, "assets/polybox/card-commerce.png");
    if (pathname === "/assets/polybox/card-product-minimaths.png") return void sendFile(res, "assets/polybox/card-product-minimaths.png");
    if (pathname === "/assets/polybox/card-product-square-cube.png") return void sendFile(res, "assets/polybox/card-product-square-cube.png");
    if (pathname === "/assets/polybox/card-product-mini-eng.png") return void sendFile(res, "assets/polybox/card-product-mini-eng.png");
    if (pathname === "/assets/polybox/card-product-xiaoguwen.png") return void sendFile(res, "assets/polybox/card-product-xiaoguwen.png");
    if (pathname === "/assets/polybox/card-product-novel.png") return void sendFile(res, "assets/polybox/card-product-novel.png");
    if (pathname === "/assets/polybox/card-product-processing-speed.png") return void sendFile(res, "assets/polybox/card-product-processing-speed.png");
    if (pathname === "/assets/polybox/card-product-dungeon.png") return void sendFile(res, "assets/polybox/card-product-dungeon.png");
    if (pathname === "/xiaoguwen.js") return void sendFile(res, "games/xiaoguwen/xiaoguwen.js");

    if (pathname === "/minimaths-icon.svg") return void sendFile(res, "games/minimaths/assets/minimaths-icon.svg");
    if (pathname === "/novel-icon.svg") return void sendFile(res, "games/novel/assets/novel-icon.svg");
    if (pathname === "/novel-icon-192.png") return void sendFile(res, "novel-icon-192.png");
    if (pathname === "/novel-icon-512.png") return void sendFile(res, "novel-icon-512.png");
    if (pathname === "/novel-apple-touch-icon.png") return void sendFile(res, "novel-apple-touch-icon.png");
    if (pathname === "/icon-192.png") return void sendFile(res, "icon-192.png");
    if (pathname === "/icon-512.png") return void sendFile(res, "icon-512.png");
    if (pathname === "/apple-touch-icon.png") return void sendFile(res, "apple-touch-icon.png");
    if (pathname === "/site.webmanifest") return void sendFile(res, "games/minimaths/assets/site.webmanifest");
    if (pathname === "/novel.webmanifest") return void sendFile(res, "games/novel/assets/novel.webmanifest");
    if (pathname === "/upload/app-release.apk") return void sendFile(res, "upload/app-release.apk");
    if (pathname === "/favicon.ico") return void sendFile(res, "favicon.ico");

    notFound(res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : "Internal error" });
  }
}

if (!process.env.VERCEL) {
  createServer(handleRequest).listen(PORT, HOST, () => {
    console.log(`MiniMaths running: http://${HOST}:${PORT}`);
    console.log("[pdf] Startup PDF_CJK_FONT_PATH =", JSON.stringify(process.env.PDF_CJK_FONT_PATH || ""));
  });
}

// Some Vercel runtimes validate the default export of the module they execute.
// Exporting the request handler as default keeps compatibility.
export default function handler(req, res) {
  return handleRequest(req, res);
}
