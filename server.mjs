import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
`);

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

function heuristicMiniEngEvaluation(question, answer, recognitionConfidence) {
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
  };
}

async function aiMiniEngEvaluation(question, answer, recognitionConfidence) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const prompt =
    "You are an English speaking coach.\n" +
    "Given question + learner answer + ASR confidence, evaluate grammar, pronunciation, expression.\n" +
    "Return strict JSON with shape:\n" +
    "{scores:{grammar:number,pronunciation:number,expression:number,overall:number}," +
    "feedback:{grammar:string,pronunciation:string,expression:string,overall:string},improvedAnswer:string}\n" +
    "Score range: 0-10 with one decimal.\n" +
    "Keep feedback concise and practical in Chinese.\n";

  const payload = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: JSON.stringify({
          question,
          answer,
          recognitionConfidence,
        }),
      },
    ],
    response_format: { type: "json_object" },
  };

  const response = await fetch(baseUrl.replace(/\/$/, "") + "/chat/completions", {
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

  const parsed = JSON.parse(content);
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
    source: "ai",
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
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    const recognitionConfidence = Number(body.recognitionConfidence) || 0;
    if (!question || !answer) {
      badRequest(res, "Invalid evaluate payload");
      return true;
    }

    try {
      const aiResult = await aiMiniEngEvaluation(question, answer, recognitionConfidence);
      if (aiResult) {
        json(res, 200, aiResult);
        return true;
      }
    } catch {
      // Fallback to heuristic evaluation when AI call fails.
    }

    json(res, 200, heuristicMiniEngEvaluation(question, answer, recognitionConfidence));
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
      sendFile(res, "index.html");
      return;
    }
    if (pathname === "/mini-eng.html") {
      sendFile(res, "mini-eng.html");
      return;
    }
    if (pathname === "/app.js") {
      sendFile(res, "app.js");
      return;
    }
    if (pathname === "/mini-eng.js") {
      sendFile(res, "mini-eng.js");
      return;
    }
    if (pathname === "/minimaths-icon.svg") {
      sendFile(res, "minimaths-icon.svg");
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
      sendFile(res, "site.webmanifest");
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
});
