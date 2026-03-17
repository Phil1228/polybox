import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import PDFDocument from "pdfkit";
import Stripe from "stripe";

const HOST = "0.0.0.0";
const PORT = 3000;
const ROOT = process.cwd();
const DATA_DIR = resolve(ROOT, "data");
const DB_PATH = resolve(DATA_DIR, "minimaths.db");

mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;

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
`);

const DEFAULT_NOVEL_ROOT_CONTENT =
  "这是一个众创故事，每个人都可以改变故事的走向，也可以随时开始创作。请从这里接力，让故事继续发生。";
const LEGACY_NOVEL_ROOT_CONTENT =
  "夜雨初停，街灯在水洼里晃动。我把伞收好，推开那扇旧书店的门，风铃轻轻响了一声。";

const readRootNovelStmt = db.prepare(`
  SELECT id, content, author
  FROM novel_contents
  WHERE seq = 1 AND parent_id IS NULL
  ORDER BY id ASC
  LIMIT 1
`);
const insertRootNovelStmt = db.prepare(`
  INSERT INTO novel_contents (seq, parent_id, content, votes, author)
  VALUES (?, ?, ?, ?, ?)
`);
const updateRootNovelContentStmt = db.prepare(`
  UPDATE novel_contents
  SET content = ?
  WHERE id = ?
`);

const rootNovel = readRootNovelStmt.get();
if (!rootNovel) {
  insertRootNovelStmt.run(1, null, DEFAULT_NOVEL_ROOT_CONTENT, 0, "系统");
} else if (rootNovel.author === "系统" && rootNovel.content === LEGACY_NOVEL_ROOT_CONTENT) {
  updateRootNovelContentStmt.run(DEFAULT_NOVEL_ROOT_CONTENT, rootNovel.id);
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

const getSettingsStmt = db.prepare(`
  SELECT
    username,
    problem_type AS problemType,
    digit_count AS digitCount,
    operand_count AS operandCount,
    question_count AS questionCount
  FROM app_settings
  WHERE id = 1
`);

const updateSettingsStmt = db.prepare(`
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

const insertHistoryStmt = db.prepare(`
  INSERT INTO history_records (equation, time_text, time_ms)
  VALUES (?, ?, ?)
`);

const readHistoryStmt = db.prepare(`
  SELECT
    equation,
    time_text AS time,
    time_ms AS timeMs
  FROM history_records
  ORDER BY id DESC
  LIMIT ?
`);

const readLeaderboardStmt = db.prepare(`
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

const insertLeaderboardStmt = db.prepare(`
  INSERT INTO leaderboard_entries (username, total_ms, total_time_text, config_key, config_label)
  VALUES (?, ?, ?, ?, ?)
`);

const insertLeaderboardItemStmt = db.prepare(`
  INSERT INTO leaderboard_items (entry_id, item_order, equation, time_text, time_ms)
  VALUES (?, ?, ?, ?, ?)
`);

const readLeaderboardItemsStmt = db.prepare(`
  SELECT
    equation,
    time_text AS time,
    time_ms AS timeMs
  FROM leaderboard_items
  WHERE entry_id = ?
  ORDER BY item_order ASC, id ASC
`);

const readProcessingSpeedLeaderboardStmt = db.prepare(`
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

const insertProcessingSpeedEntryStmt = db.prepare(`
  INSERT INTO processing_speed_entries (username, level, total_ms, total_time_text)
  VALUES (?, ?, ?, ?)
`);

const insertProcessingSpeedItemStmt = db.prepare(`
  INSERT INTO processing_speed_items (entry_id, item_order, target_text, time_ms, time_text)
  VALUES (?, ?, ?, ?, ?)
`);

const readNovelTopBySeqStmt = db.prepare(`
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

const readNovelListBySeqStmt = db.prepare(`
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

const insertNovelStmt = db.prepare(`
  INSERT INTO novel_contents (seq, parent_id, content, votes, author)
  VALUES (?, ?, ?, 0, ?)
`);

const updateNovelVoteStmt = db.prepare(`
  UPDATE novel_contents
  SET votes = votes + 1
  WHERE id = ?
`);

const readNovelByIdStmt = db.prepare(`
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

const readNovelChildrenTopStmt = db.prepare(`
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

const readNovelChildrenListStmt = db.prepare(`
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

const readNovelChildrenPagedStmt = db.prepare(`
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

const readNovelIntegratedStmt = db.prepare(`
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

const readNovelRecentLikeStmt = db.prepare(`
  SELECT liked_at AS likedAt
  FROM novel_like_logs
  WHERE content_id = ?
    AND (device_id = ? OR ip = ?)
  ORDER BY id DESC
  LIMIT 1
`);

const insertNovelLikeLogStmt = db.prepare(`
  INSERT INTO novel_like_logs (content_id, device_id, ip, liked_at)
  VALUES (?, ?, ?, ?)
`);

const readUserByUsernameStmt = db.prepare(`
  SELECT id, username, password_hash AS passwordHash, nickname, avatar
  FROM users
  WHERE username = ?
  LIMIT 1
`);

const readUserByIdStmt = db.prepare(`
  SELECT id, username, nickname, avatar
  FROM users
  WHERE id = ?
  LIMIT 1
`);

const insertUserStmt = db.prepare(`
  INSERT INTO users (username, password_hash)
  VALUES (?, ?)
`);

const updateUserPasswordStmt = db.prepare(`
  UPDATE users
  SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateUserProfileStmt = db.prepare(`
  UPDATE users
  SET nickname = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const insertSessionStmt = db.prepare(`
  INSERT INTO user_sessions (user_id, token, expires_at)
  VALUES (?, ?, ?)
`);

const readSessionStmt = db.prepare(`
  SELECT id, user_id AS userId, expires_at AS expiresAt
  FROM user_sessions
  WHERE token = ?
  LIMIT 1
`);

const deleteSessionStmt = db.prepare(`
  DELETE FROM user_sessions
  WHERE token = ?
`);

const deleteExpiredSessionsStmt = db.prepare(`
  DELETE FROM user_sessions
  WHERE expires_at <= ?
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

function getSettings() {
  const settings = getSettingsStmt.get();
  return sanitizeSettings(settings);
}

function getHistory(limit) {
  return readHistoryStmt.all(limit);
}

function getLeaderboard() {
  const rows = readLeaderboardStmt.all();
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
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".svg"
            ? "image/svg+xml"
            : ext === ".png"
              ? "image/png"
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

function createSession(userId) {
  deleteExpiredSessionsStmt.run(new Date().toISOString());
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  insertSessionStmt.run(userId, token, expiresAt);
  return { token, expiresAt };
}

function getSessionUser(token) {
  if (!token) return null;
  const session = readSessionStmt.get(token);
  if (!session) return null;
  const expiresAt = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    deleteSessionStmt.run(token);
    return null;
  }
  const user = readUserByIdStmt.get(session.userId);
  if (!user) {
    deleteSessionStmt.run(token);
    return null;
  }
  return { user, session };
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
      settings: getSettings(),
      history: getHistory(100),
      leaderboard: getLeaderboard(),
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

    const existing = readUserByUsernameStmt.get(username);
    if (existing) {
      json(res, 409, { error: "用户名已被占用" });
      return true;
    }

    let userId = 0;
    try {
      const passwordHash = hashPassword(password);
      const result = insertUserStmt.run(username, passwordHash);
      userId = Number(result.lastInsertRowid);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNIQUE")) {
        json(res, 409, { error: "用户名已被占用" });
        return true;
      }
      throw error;
    }
    const session = createSession(userId);
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

    const user = readUserByUsernameStmt.get(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      json(res, 401, { error: "用户名或密码不正确" });
      return true;
    }

    const session = createSession(user.id);
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
    deleteSessionStmt.run(token);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/users/me") {
    const token = getAuthToken(req, null);
    const sessionUser = getSessionUser(token);
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

    const sessionUser = getSessionUser(token);
    if (!sessionUser) {
      json(res, 401, { error: "未登录或登录已过期" });
      return true;
    }

    const fullUser = readUserByUsernameStmt.get(sessionUser.user.username);
    if (!fullUser || !verifyPassword(oldPassword, fullUser.passwordHash)) {
      json(res, 401, { error: "原密码不正确" });
      return true;
    }

    updateUserPasswordStmt.run(hashPassword(newPassword), fullUser.id);
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
    const sessionUser = getSessionUser(token);
    if (!sessionUser) {
      json(res, 401, { error: "未登录或登录已过期" });
      return true;
    }
    const nickname = normalizeNickname(body.nickname);
    const avatar = normalizeAvatar(body.avatar);
    updateUserProfileStmt.run(nickname, avatar, sessionUser.user.id);
    json(res, 200, { ok: true, user: { ...sessionUser.user, nickname, avatar } });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/leaderboard") {
    json(res, 200, { groups: getLeaderboard() });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/leaderboard\/(\d+)\/items$/);
  if (req.method === "GET" && detailMatch) {
    const entryId = Number(detailMatch[1]);
    json(res, 200, { items: readLeaderboardItemsStmt.all(entryId) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/processing-speed/leaderboard") {
    const query = new URL(req.url || "/", `http://${HOST}:${PORT}`).searchParams;
    const level = query.get("level") === "advanced" ? "advanced" : "beginner";
    json(res, 200, { level, items: readProcessingSpeedLeaderboardStmt.all(level) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/settings") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const nextSettings = sanitizeSettings(body);
    updateSettingsStmt.run(
      nextSettings.username,
      nextSettings.problemType,
      nextSettings.digitCount,
      nextSettings.operandCount,
      nextSettings.questionCount,
    );
    json(res, 200, {
      settings: getSettings(),
      history: getHistory(nextSettings.questionCount),
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
      insertHistoryStmt.run(body.equation, body.time, Number(body.timeMs) || 0);
    }
    json(res, 200, { history: getHistory(normalizedLimit) });
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
      const result = insertLeaderboardStmt.run(username, totalMs, totalTimeText, configKey, configLabel);
      const entryId = Number(result.lastInsertRowid);
      items.forEach((item, index) => {
        insertLeaderboardItemStmt.run(
          entryId,
          index,
          String(item.equation || ""),
          String(item.time || "0s"),
          Number(item.timeMs) || 0,
        );
      });
      db.exec("COMMIT");
      json(res, 200, { ok: true, groups: getLeaderboard() });
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
      const result = insertProcessingSpeedEntryStmt.run(
        username,
        level,
        Math.round(totalMs),
        totalTimeText || "0.00 秒",
      );
      const entryId = Number(result.lastInsertRowid);
      items.forEach((item, index) => {
        insertProcessingSpeedItemStmt.run(
          entryId,
          index,
          String(item.target || ""),
          Number(item.timeMs) || 0,
          String(item.timeText || "0.00 秒"),
        );
      });
      db.exec("COMMIT");
      json(res, 200, { ok: true, level, items: readProcessingSpeedLeaderboardStmt.all(level) });
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
      item = readNovelByIdStmt.get(id) || null;
    } else {
      const targetSeq = Number.isInteger(seq) && seq > 0 ? seq : 1;
      item = readNovelTopBySeqStmt.get(targetSeq) || null;
    }

    const nextTopItem = item ? readNovelChildrenTopStmt.get(item.id) || null : null;
    const items = item ? readNovelChildrenListStmt.all(item.id) : [];
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

    const rows = readNovelChildrenPagedStmt.all(parentId, safeLimit + 1, safeOffset);
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
    const items = readNovelIntegratedStmt.all(id, safeLimit);
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
    const items = readNovelIntegratedStmt.all(id, safeLimit);
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
    const recent = readNovelRecentLikeStmt.get(id, deviceId, ip);
    if (recent && now - Number(recent.likedAt) < cooldownMs) {
      json(res, 429, {
        error: "Like too frequent",
        retryAfterMs: cooldownMs - (now - Number(recent.likedAt)),
      });
      return true;
    }

    db.exec("BEGIN");
    try {
      updateNovelVoteStmt.run(id);
      insertNovelLikeLogStmt.run(id, deviceId, ip, now);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const item = readNovelByIdStmt.get(id) || null;
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
    const parent = readNovelByIdStmt.get(parentId);
    if (!parent) {
      badRequest(res, "Parent content not found");
      return true;
    }
    const seq = Number(parent.seq) + 1;
    insertNovelStmt.run(seq, parentId, content, author);
    const item = readNovelChildrenTopStmt.get(parentId) || null;
    json(res, 200, { ok: true, item });
    return true;
  }

  return false;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    const pathname = url.pathname;

    if (await handleApi(req, res, pathname)) return;

    if (pathname === "/") {
      sendFile(res, "pages/polybox/index.html");
      return;
    }
    if (pathname === "/polybox.html") {
      sendFile(res, "pages/polybox/index.html");
      return;
    }
    if (pathname === "/minimaths.html") {
      sendFile(res, "games/minimaths/index.html");
      return;
    }
    if (pathname === "/mini-eng.html") {
      sendFile(res, "games/mini-eng/index.html");
      return;
    }
    if (pathname === "/xiaoguwen.html") {
      sendFile(res, "games/xiaoguwen/index.html");
      return;
    }
    if (pathname === "/novel.html") {
      sendFile(res, "games/novel/index.html");
      return;
    }
    if (pathname === "/processing-speed.html") {
      sendFile(res, "games/processing-speed/index.html");
      return;
    }
    if (pathname === "/recharge.html") {
      sendFile(res, "pages/recharge/index.html");
      return;
    }
    if (pathname === "/user.html") {
      sendFile(res, "pages/user/index.html");
      return;
    }
    if (pathname === "/app.js") {
      sendFile(res, "games/minimaths/app.js");
      return;
    }
    if (pathname === "/mini-eng.js") {
      sendFile(res, "games/mini-eng/mini-eng.js");
      return;
    }
    if (pathname === "/novel.js") {
      sendFile(res, "games/novel/novel.js");
      return;
    }
    if (pathname === "/processing-speed.js") {
      sendFile(res, "games/processing-speed/processing-speed.js");
      return;
    }
    if (pathname === "/recharge.js") {
      sendFile(res, "pages/recharge/recharge.js");
      return;
    }
    if (pathname === "/user.js") {
      sendFile(res, "pages/user/user.js");
      return;
    }
    if (pathname === "/nav-loader.js") {
      sendFile(res, "shared/nav-loader.js");
      return;
    }
    if (pathname === "/xiaoguwen.js") {
      sendFile(res, "games/xiaoguwen/xiaoguwen.js");
      return;
    }
    if (pathname === "/minimaths-icon.svg") {
      sendFile(res, "games/minimaths/assets/minimaths-icon.svg");
      return;
    }
    if (pathname === "/novel-icon.svg") {
      sendFile(res, "games/novel/assets/novel-icon.svg");
      return;
    }
    if (pathname === "/novel-icon-192.png") {
      sendFile(res, "novel-icon-192.png");
      return;
    }
    if (pathname === "/novel-icon-512.png") {
      sendFile(res, "novel-icon-512.png");
      return;
    }
    if (pathname === "/novel-apple-touch-icon.png") {
      sendFile(res, "novel-apple-touch-icon.png");
      return;
    }
    if (pathname === "/icon-192.png") {
      sendFile(res, "icon-192.png");
      return;
    }
    if (pathname === "/icon-512.png") {
      sendFile(res, "icon-512.png");
      return;
    }
    if (pathname === "/apple-touch-icon.png") {
      sendFile(res, "apple-touch-icon.png");
      return;
    }
    if (pathname === "/site.webmanifest") {
      sendFile(res, "games/minimaths/assets/site.webmanifest");
      return;
    }
    if (pathname === "/novel.webmanifest") {
      sendFile(res, "games/novel/assets/novel.webmanifest");
      return;
    }
    if (pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    notFound(res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : "Internal error" });
  }
}).listen(PORT, HOST, () => {
  console.log(`MiniMaths running: http://${HOST}:${PORT}`);
  console.log(`SQLite file: ${join("data", "minimaths.db")}`);
  console.log("[pdf] Startup PDF_CJK_FONT_PATH =", JSON.stringify(process.env.PDF_CJK_FONT_PATH || ""));
});
