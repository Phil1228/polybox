const settingsBtn = document.getElementById("settings-btn");
const historyBtn = document.getElementById("history-btn");
const leaderboardBtn = document.getElementById("leaderboard-btn");
const targetRow = document.getElementById("target-row");
const progressMeta = document.getElementById("progress-meta");
const timerMeta = document.getElementById("timer-meta");
const roundTotalMeta = document.getElementById("round-total-meta");
const board = document.getElementById("board");
const grid = document.getElementById("grid");
const canvas = document.getElementById("path-canvas");
const statusEl = document.getElementById("status");
const historyOverlay = document.getElementById("history-overlay");
const historyPanel = document.getElementById("history-panel");
const historyList = document.getElementById("history-list");
const settingsPopup = document.getElementById("settings-popup");
const usernameInput = document.getElementById("username-input");
const saveSettingsBtn = document.getElementById("save-settings-btn");
const closeSettingsBtn = document.getElementById("close-settings-btn");
const settingsMoreBtn = document.getElementById("settings-more-btn");
const levelBeginnerBtn = document.getElementById("level-beginner-btn");
const levelAdvancedBtn = document.getElementById("level-advanced-btn");
const leaderboardPopup = document.getElementById("leaderboard-popup");
const leaderboardList = document.getElementById("leaderboard-list");
const restartBtn = document.getElementById("restart-btn");
const closeLeaderboardBtn = document.getElementById("close-leaderboard-btn");
const rankBeginnerBtn = document.getElementById("rank-beginner-btn");
const rankAdvancedBtn = document.getElementById("rank-advanced-btn");

const USERNAME_COOKIE_KEY = "minimaths_username";
const SPEED_LEVEL_COOKIE_KEY = "processing_speed_level";
const CHAR_POOL = [
  "天",
  "地",
  "人",
  "山",
  "水",
  "风",
  "云",
  "海",
  "林",
  "光",
  "影",
  "星",
  "火",
  "月",
  "日",
  "心",
  "梦",
  "路",
  "城",
  "桥",
  "花",
  "草",
  "春",
  "夏",
  "秋",
  "冬",
  "远",
  "近",
  "高",
  "低",
  "快",
  "慢",
  "新",
  "旧",
  "明",
  "暗",
];

let gridChars = [];
let targetChars = [];
let expectedIndex = 0;
let isDrawing = false;
let completed = false;
let activePointerId = null;
let pathPoints = [];
let pointerPoint = null;
let roundStartMs = 0;
let timer = null;
let historyOpen = false;
let roundHistory = [];
let solvedCount = 0;
let roundTotalMs = 0;
let username = "";
let level = "beginner";
let leaderboardLevel = "beginner";
let levelDraft = "beginner";

function pickUnique(source, count) {
  const bag = [...source];
  const result = [];
  while (bag.length && result.length < count) {
    const idx = Math.floor(Math.random() * bag.length);
    result.push(bag[idx]);
    bag.splice(idx, 1);
  }
  return result;
}

function formatMs(ms) {
  return (ms / 1000).toFixed(2) + " 秒";
}

function getLevelLabel(value) {
  return value === "advanced" ? "高级" : "初级";
}

function setLevelUI(nextLevel) {
  levelBeginnerBtn.classList.toggle("active", nextLevel !== "advanced");
  levelAdvancedBtn.classList.toggle("active", nextLevel === "advanced");
}

function setLeaderboardLevelUI(nextLevel) {
  rankBeginnerBtn.classList.toggle("active", nextLevel !== "advanced");
  rankAdvancedBtn.classList.toggle("active", nextLevel === "advanced");
}

function getCookieValue(key) {
  const cookieText = document.cookie || "";
  const parts = cookieText.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(key + "=")) return decodeURIComponent(trimmed.slice(key.length + 1));
  }
  return "";
}

function setCookieValue(key, value, days) {
  const maxAge = Math.max(0, Math.floor(days * 24 * 60 * 60));
  document.cookie = key + "=" + encodeURIComponent(value) + "; Max-Age=" + maxAge + "; Path=/; SameSite=Lax";
}

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.style.color = type === "ok" ? "#167a45" : type === "warn" ? "#c23b1a" : "#52617a";
}

function renderHistory() {
  const list = roundHistory;
  historyList.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.textContent = "暂无记录";
    historyList.appendChild(li);
    return;
  }
  list.forEach((item) => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML =
      '<span class="history-seq">#' +
      item.order +
      " " +
      item.target +
      "</span><span class='history-time'>" +
      item.timeText +
      "</span>";
    historyList.appendChild(li);
  });
}

function setHistoryOpen(open) {
  historyOpen = open;
  historyPanel.classList.toggle("is-open", open);
  historyOverlay.classList.toggle("is-open", open);
}

function updateRoundMeta() {
  progressMeta.textContent = "进度：第 " + (Math.min(9, solvedCount + 1)) + " / 9 次";
  roundTotalMeta.textContent = "本轮累计：" + formatMs(roundTotalMs) + "（" + getLevelLabel(level) + "）";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function renderLeaderboard(items) {
  leaderboardList.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "rank-item";
    li.textContent = "暂无记录";
    leaderboardList.appendChild(li);
    return;
  }
  items.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "rank-item";
    li.innerHTML =
      '<div class="rank-left"><span class="rank-no">' +
      (index + 1) +
      "</span><span>" +
      (item.username || "匿名") +
      "</span></div><span>" +
      (item.totalTimeText || formatMs(item.totalMs || 0)) +
      "</span>";
    leaderboardList.appendChild(li);
  });
}

async function openLeaderboard() {
  try {
    const data = await api("/api/processing-speed/leaderboard?level=" + leaderboardLevel);
    renderLeaderboard(data.items || []);
    setLeaderboardLevelUI(leaderboardLevel);
    leaderboardPopup.classList.add("is-open");
  } catch (error) {
    setStatus(error.message || "排行榜加载失败", "warn");
  }
}

function closeLeaderboard() {
  leaderboardPopup.classList.remove("is-open");
}

function openSettings() {
  usernameInput.value = username;
  levelDraft = level;
  setLevelUI(levelDraft);
  settingsPopup.classList.add("is-open");
}

function closeSettings() {
  settingsPopup.classList.remove("is-open");
}

function resetGameState() {
  solvedCount = 0;
  roundTotalMs = 0;
  roundHistory = [];
  renderHistory();
  updateRoundMeta();
  generateRound();
}

async function finishNineRound() {
  const payload = {
    username: username || "匿名",
    level,
    totalMs: roundTotalMs,
    totalTimeText: formatMs(roundTotalMs),
    items: roundHistory.map((item) => ({
      target: item.target,
      timeMs: item.timeMs,
      timeText: item.timeText,
    })),
  };
  try {
    const data = await api("/api/processing-speed/round", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    renderLeaderboard(data.items || []);
    leaderboardPopup.classList.add("is-open");
  } catch (error) {
    setStatus(error.message || "成绩保存失败", "warn");
  }
}

function renderTargets() {
  targetRow.innerHTML = "";
  targetChars.forEach((char, idx) => {
    const span = document.createElement("span");
    span.className = "target-char" + (idx < expectedIndex ? " done" : "");
    span.textContent = char;
    targetRow.appendChild(span);
  });
}

function resizeCanvas() {
  const rect = board.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPath();
}

function getCellCenter(cell) {
  const cellRect = cell.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();
  return {
    x: cellRect.left - boardRect.left + cellRect.width / 2,
    y: cellRect.top - boardRect.top + cellRect.height / 2,
  };
}

function drawPath() {
  const ctx = canvas.getContext("2d");
  const w = board.clientWidth;
  const h = board.clientHeight;
  ctx.clearRect(0, 0, w, h);
  if (!pathPoints.length) return;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#3b73ff";
  ctx.beginPath();
  ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
  for (let i = 1; i < pathPoints.length; i += 1) ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
  if (isDrawing && pointerPoint) ctx.lineTo(pointerPoint.x, pointerPoint.y);
  ctx.stroke();
}

function resetProgress() {
  expectedIndex = 0;
  isDrawing = false;
  activePointerId = null;
  pathPoints = [];
  pointerPoint = null;
  renderTargets();
  drawPath();
}

function updateTimer() {
  timerMeta.textContent = "本次用时：" + formatMs(Date.now() - roundStartMs);
}

function startRoundTimer() {
  roundStartMs = Date.now();
  updateTimer();
  if (timer) clearInterval(timer);
  timer = setInterval(updateTimer, 50);
}

function completeRound() {
  completed = true;
  isDrawing = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const elapsed = Date.now() - roundStartMs;
  solvedCount += 1;
  roundTotalMs += elapsed;
  roundHistory.push({
    order: solvedCount,
    target: targetChars.join(""),
    timeMs: elapsed,
    timeText: formatMs(elapsed),
  });
  renderHistory();
  updateRoundMeta();
  renderTargets();
  if (solvedCount >= 9) {
    setStatus("九次完成！总用时 " + formatMs(roundTotalMs), "ok");
    finishNineRound();
    return;
  }
  setStatus("完成！本次用时 " + formatMs(elapsed), "ok");
  setTimeout(generateRound, 700);
}

function onPointerDown(event) {
  const target = event.target;
  const cell = target instanceof HTMLElement ? target.closest(".char-cell") : null;
  if (!cell || completed) return;
  const char = cell.dataset.char || "";
  if (char !== targetChars[0]) {
    setStatus("请按住第一个字开始连线", "warn");
    return;
  }
  event.preventDefault();
  isDrawing = true;
  activePointerId = event.pointerId;
  board.setPointerCapture(event.pointerId);
  expectedIndex = 1;
  pathPoints = [getCellCenter(cell)];
  pointerPoint = { ...pathPoints[0] };
  renderTargets();
  setStatus(targetChars[1] ? "继续连到：" + targetChars[1] : "继续连线");
  drawPath();
}

function onPointerMove(event) {
  if (!isDrawing || event.pointerId !== activePointerId || completed) return;
  const boardRect = board.getBoundingClientRect();
  pointerPoint = {
    x: event.clientX - boardRect.left,
    y: event.clientY - boardRect.top,
  };
  const found = document.elementFromPoint(event.clientX, event.clientY);
  const cell = found instanceof HTMLElement ? found.closest(".char-cell") : null;
  if (cell) {
    const char = cell.dataset.char || "";
    if (char === targetChars[expectedIndex]) {
      pathPoints.push(getCellCenter(cell));
      expectedIndex += 1;
      renderTargets();
      if (expectedIndex >= targetChars.length) {
        drawPath();
        completeRound();
        return;
      }
      setStatus("继续连到：" + targetChars[expectedIndex]);
    }
  }
  drawPath();
}

function onPointerEnd(event) {
  if (!isDrawing || event.pointerId !== activePointerId) return;
  if (!completed) {
    resetProgress();
    setStatus("已中断，请从第一个字重新开始");
  }
}

function renderGrid() {
  const cols = level === "advanced" ? 4 : 3;
  grid.style.setProperty("--grid-cols", String(cols));
  grid.innerHTML = "";
  gridChars.forEach((char) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "char-cell";
    btn.dataset.char = char;
    btn.textContent = char;
    grid.appendChild(btn);
  });
}

function generateRound() {
  completed = false;
  const cellCount = level === "advanced" ? 16 : 9;
  const targetCount = level === "advanced" ? 9 : 5;
  gridChars = pickUnique(CHAR_POOL, cellCount);
  targetChars = pickUnique(gridChars, targetCount);
  renderGrid();
  resetProgress();
  renderTargets();
  setStatus("按住第一个字开始连线");
  resizeCanvas();
  startRoundTimer();
}

settingsBtn.addEventListener("click", openSettings);
closeSettingsBtn.addEventListener("click", closeSettings);
settingsPopup.addEventListener("click", (e) => {
  if (e.target === settingsPopup) closeSettings();
});
saveSettingsBtn.addEventListener("click", () => {
  username = usernameInput.value.trim().slice(0, 10);
  level = levelDraft;
  setLevelUI(level);
  setCookieValue(USERNAME_COOKIE_KEY, username, 365);
  setCookieValue(SPEED_LEVEL_COOKIE_KEY, level, 365);
  closeSettings();
  resetGameState();
});
levelBeginnerBtn.addEventListener("click", () => {
  levelDraft = "beginner";
  setLevelUI(levelDraft);
});
levelAdvancedBtn.addEventListener("click", () => {
  levelDraft = "advanced";
  setLevelUI(levelDraft);
});
settingsMoreBtn.addEventListener("click", () => {
  window.location.href = "/minimaths.html?openNav=1";
});
historyBtn.addEventListener("click", () => setHistoryOpen(!historyOpen));
historyOverlay.addEventListener("click", () => setHistoryOpen(false));
leaderboardBtn.addEventListener("click", openLeaderboard);
rankBeginnerBtn.addEventListener("click", () => {
  leaderboardLevel = "beginner";
  openLeaderboard();
});
rankAdvancedBtn.addEventListener("click", () => {
  leaderboardLevel = "advanced";
  openLeaderboard();
});
closeLeaderboardBtn.addEventListener("click", closeLeaderboard);
leaderboardPopup.addEventListener("click", (e) => {
  if (e.target === leaderboardPopup) closeLeaderboard();
});
restartBtn.addEventListener("click", () => {
  closeLeaderboard();
  resetGameState();
});
board.addEventListener("pointerdown", onPointerDown);
board.addEventListener("pointermove", onPointerMove);
board.addEventListener("pointerup", onPointerEnd);
board.addEventListener("pointercancel", onPointerEnd);
board.addEventListener("lostpointercapture", onPointerEnd);
window.addEventListener("resize", resizeCanvas);

username = getCookieValue(USERNAME_COOKIE_KEY).slice(0, 10);
level = getCookieValue(SPEED_LEVEL_COOKIE_KEY) === "advanced" ? "advanced" : "beginner";
leaderboardLevel = level;
setLevelUI(level);
setLeaderboardLevelUI(leaderboardLevel);
renderHistory();
updateRoundMeta();
generateRound();
