const expressionText = document.getElementById("expression-text");
const answerDisplay = document.getElementById("answer-display");
const keyboard = document.getElementById("keyboard");
const historyList = document.getElementById("history-list");
const historyCard = document.querySelector(".history-card");
const historyToggle = document.getElementById("history-toggle");
const historyOverlay = document.getElementById("history-overlay");
const settingsToggle = document.getElementById("settings-toggle");
const leaderboardToggle = document.getElementById("leaderboard-toggle");
const settingsPage = document.getElementById("settings-page");
const settingsMore = document.getElementById("settings-more");
const leaderboardPage = document.getElementById("leaderboard-page");
const leaderboardList = document.getElementById("leaderboard-list");
const leaderboardConfigSelect = document.getElementById("leaderboard-config-select");
const leaderboardClose = document.getElementById("leaderboard-close");
const detailPage = document.getElementById("detail-page");
const detailTitle = document.getElementById("detail-title");
const detailHistoryList = document.getElementById("detail-history-list");
const detailClose = document.getElementById("detail-close");
const navPage = document.getElementById("nav-page");
const navClose = document.getElementById("nav-close");
const navMinimaths = document.getElementById("nav-minimaths");
const navMiniEng = document.getElementById("nav-mini-eng");
const navXiaoguwen = document.getElementById("nav-xiaoguwen");
const navNovel = document.getElementById("nav-novel");
const navSpeed = document.getElementById("nav-speed");
const navRecharge = document.getElementById("nav-recharge");
const congratsOverlay = document.getElementById("congrats-overlay");
const settingUsername = document.getElementById("setting-username");
const settingOptionGroups = document.querySelectorAll("[data-setting-group]");
const settingsConfirm = document.getElementById("settings-confirm");
const settingsCancel = document.getElementById("settings-cancel");
const mobileQuery = window.matchMedia("(max-width: 760px)");
const USERNAME_COOKIE_KEY = "minimaths_username";
const SETTINGS_COOKIE_KEY = "minimaths_settings";
const LEADERBOARD_FILTER_COOKIE_KEY = "minimaths_leaderboard_filter";

let correct = 0;
let input = "";
let maxInputLength = 3;
const history = [];
let questionStartMs = 0;
let isHistoryOpen = false;
let currentExpression = "";
let draftSettings = null;
let solvedInRound = 0;
let totalMsInRound = 0;
const roundHistory = [];
const leaderboardGroups = [];
let isRoundTransitioning = false;
let leaderboardJumpTimer = null;
let isSavingAnswer = false;
let selectedLeaderboardConfigKey = "";
let settings = {
  username: "",
  problemType: "add",
  digitCount: 2,
  operandCount: 2,
  questionCount: 10,
};

function getCookieValue(key) {
  const cookieText = document.cookie || "";
  const parts = cookieText.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(key + "=")) {
      return decodeURIComponent(trimmed.slice(key.length + 1));
    }
  }
  return "";
}

function setCookieValue(key, value, days) {
  const maxAge = Math.max(0, Math.floor(days * 24 * 60 * 60));
  document.cookie =
    key + "=" + encodeURIComponent(value) + "; Max-Age=" + maxAge + "; Path=/; SameSite=Lax";
}

function loadSettingsFromCookie() {
  const raw = getCookieValue(SETTINGS_COOKIE_KEY);
  if (!raw) return null;
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveSettingsToCookie(nextSettings) {
  const localSettings = {
    problemType: nextSettings.problemType,
    digitCount: nextSettings.digitCount,
    operandCount: nextSettings.operandCount,
    questionCount: nextSettings.questionCount,
  };
  setCookieValue(SETTINGS_COOKIE_KEY, JSON.stringify(localSettings), 365);
}

function normalizeSettings(raw) {
  const next = {
    username: typeof raw?.username === "string" ? raw.username.slice(0, 10) : "",
    problemType: typeof raw?.problemType === "string" ? raw.problemType : "add",
    digitCount: Number(raw?.digitCount) || 2,
    operandCount: Number(raw?.operandCount) || 2,
    questionCount: Number(raw?.questionCount) || 10,
  };
  if (next.problemType === "divide") next.operandCount = 2;
  return next;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    throw new Error("API request failed: " + path);
  }
  return response.json();
}

function randomByDigits(maxDigits, exactDigits) {
  const upper = Math.pow(10, maxDigits) - 1;
  if (!exactDigits) return Math.floor(Math.random() * upper) + 1;
  const min = maxDigits === 1 ? 1 : Math.pow(10, maxDigits - 1);
  return Math.floor(Math.random() * (upper - min + 1)) + min;
}

function randomFromArray(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function displayOperator(op) {
  if (op === "*") return "×";
  if (op === "/") return "÷";
  return op;
}

function buildOperators(problemType, count) {
  const operators = [];
  for (let i = 0; i < count - 1; i += 1) {
    if (problemType === "add") operators.push("+");
    else if (problemType === "subtract") operators.push("-");
    else if (problemType === "multiply") operators.push("*");
    else if (problemType === "divide") operators.push("/");
    else if (problemType === "addsubtract") operators.push(randomFromArray(["+", "-"]));
    else operators.push(randomFromArray(["+", "-", "*", "/"]));
  }
  return operators;
}

function evaluateExpression(operands, operators) {
  const nums = operands.slice();
  const ops = operators.slice();

  for (let i = 0; i < ops.length; ) {
    const op = ops[i];
    if (op !== "*" && op !== "/") {
      i += 1;
      continue;
    }
    const left = nums[i];
    const right = nums[i + 1];
    if (op === "/" && (right === 0 || left % right !== 0)) return null;
    const merged = op === "*" ? left * right : left / right;
    nums.splice(i, 2, merged);
    ops.splice(i, 1);
  }

  let result = nums[0];
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i] === "+") result += nums[i + 1];
    else result -= nums[i + 1];
  }
  return result;
}

function generateQuestion() {
  const hasDivision = settings.problemType === "divide" || settings.problemType === "all";
  const exactDigits = !hasDivision;

  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const operators = buildOperators(settings.problemType, settings.operandCount);
    const operands = [];
    for (let i = 0; i < settings.operandCount; i += 1) {
      operands.push(randomByDigits(settings.digitCount, exactDigits));
    }
    const result = evaluateExpression(operands, operators);
    if (result === null || !Number.isInteger(result) || result < 0) continue;

    const expression = operands
      .map((num, i) => (i === 0 ? String(num) : displayOperator(operators[i - 1]) + " " + num))
      .join(" ");
    return { expression, answer: result };
  }

  const fallbackA = randomByDigits(settings.digitCount, true);
  const fallbackB = randomByDigits(settings.digitCount, true);
  return { expression: fallbackA + " + " + fallbackB, answer: fallbackA + fallbackB };
}

function render() {
  expressionText.textContent = currentExpression;
  answerDisplay.textContent = input || "\u00A0";
}

function nextQuestion() {
  const question = generateQuestion();
  currentExpression = question.expression;
  correct = question.answer;
  input = "";
  maxInputLength = Math.max(3, String(correct).length);
  questionStartMs = Date.now();
  render();
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 100) / 10);
  return totalSeconds + "s";
}

function problemTypeLabel(problemType) {
  if (problemType === "add") return "加";
  if (problemType === "subtract") return "减";
  if (problemType === "multiply") return "乘";
  if (problemType === "divide") return "除";
  if (problemType === "addsubtract") return "加减";
  if (problemType === "all") return "四则";
  return "未知";
}

function getConfigLabel() {
  return (
    problemTypeLabel(settings.problemType) +
    "-" +
    settings.digitCount +
    "-" +
    settings.operandCount +
    "-" +
    settings.questionCount
  );
}

function renderHistory() {
  historyList.innerHTML = "";
  for (const item of history) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML =
      '<div class="history-equation">' +
      item.equation +
      '</div><div class="history-time">' +
      item.time +
      "</div>";
    historyList.appendChild(li);
  }
}

function renderLeaderboard() {
  leaderboardList.innerHTML = "";
  const selectedGroup = leaderboardGroups.find((group) => group.configKey === selectedLeaderboardConfigKey) || null;
  if (!selectedGroup) {
    const empty = document.createElement("li");
    empty.className = "leaderboard-empty";
    empty.textContent = "暂无记录";
    leaderboardList.appendChild(empty);
    return;
  }

  const groupLi = document.createElement("li");
  groupLi.className = "leaderboard-group";

  const groupTitle = document.createElement("div");
  groupTitle.className = "leaderboard-group-title";
  groupTitle.textContent = selectedGroup.configLabel;
  groupLi.appendChild(groupTitle);

  selectedGroup.items.forEach((entry) => {
    const li = document.createElement("div");
    li.className = "leaderboard-item";

    const rank = document.createElement("div");
    rank.className = "leaderboard-rank";
    rank.textContent = "#" + entry.rankInConfig;

    const user = document.createElement("div");
    user.className = "leaderboard-user";
    user.textContent = entry.username;

    const time = document.createElement("div");
    time.className = "leaderboard-time";
    time.textContent = entry.totalTimeText;

    const detailBtn = document.createElement("button");
    detailBtn.className = "leaderboard-detail-btn";
    detailBtn.textContent = "详细";
    detailBtn.dataset.id = String(entry.id);
    detailBtn.dataset.username = entry.username;
    detailBtn.dataset.time = entry.totalTimeText;

    li.appendChild(rank);
    li.appendChild(user);
    li.appendChild(time);
    li.appendChild(detailBtn);
    groupLi.appendChild(li);
  });
  leaderboardList.appendChild(groupLi);
}

function getDefaultLeaderboardConfigKey() {
  const preferLabel = "加-2-2-10";
  const preferred = leaderboardGroups.find((group) => group.configLabel === preferLabel);
  if (preferred) return preferred.configKey;
  return leaderboardGroups[0]?.configKey || "";
}

function syncLeaderboardConfigSelection() {
  const valid = leaderboardGroups.some((group) => group.configKey === selectedLeaderboardConfigKey);
  if (!valid) {
    const cookieValue = getCookieValue(LEADERBOARD_FILTER_COOKIE_KEY);
    if (cookieValue && leaderboardGroups.some((group) => group.configKey === cookieValue)) {
      selectedLeaderboardConfigKey = cookieValue;
    } else {
      selectedLeaderboardConfigKey = getDefaultLeaderboardConfigKey();
    }
  }

  leaderboardConfigSelect.innerHTML = "";
  if (!leaderboardGroups.length) return;
  leaderboardGroups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.configKey;
    option.textContent = group.configLabel;
    option.selected = group.configKey === selectedLeaderboardConfigKey;
    leaderboardConfigSelect.appendChild(option);
  });
}

function setHistoryOpen(open) {
  if (!mobileQuery.matches) {
    isHistoryOpen = false;
    historyCard.classList.remove("is-open");
    historyOverlay.classList.remove("is-open");
    historyToggle.setAttribute("aria-expanded", "false");
    return;
  }
  isHistoryOpen = open;
  historyCard.classList.toggle("is-open", isHistoryOpen);
  historyOverlay.classList.toggle("is-open", isHistoryOpen);
  historyToggle.setAttribute("aria-expanded", String(isHistoryOpen));
}

function setGroupValue(groupName, value) {
  const group = document.querySelector('[data-setting-group="' + groupName + '"]');
  if (!group) return;
  const buttons = group.querySelectorAll(".setting-option-btn");
  for (const button of buttons) {
    button.classList.toggle("is-active", button.dataset.value === String(value));
  }
}

function updateOperandOptionsVisibility(problemTypeValue) {
  const operandGroup = document.querySelector('[data-setting-group="operandCount"]');
  if (!operandGroup) return;
  const buttons = operandGroup.querySelectorAll(".setting-option-btn");
  const isDivideOnly = problemTypeValue === "divide";

  for (const button of buttons) {
    const shouldShow = !isDivideOnly || button.dataset.value === "2";
    button.style.display = shouldShow ? "" : "none";
  }

  if (isDivideOnly) {
    setGroupValue("operandCount", 2);
    if (!draftSettings) draftSettings = { ...settings };
    draftSettings.operandCount = 2;
  }
}

function openSettings() {
  draftSettings = { ...settings };
  settingUsername.value = settings.username;
  setGroupValue("problemType", settings.problemType);
  setGroupValue("digitCount", settings.digitCount);
  setGroupValue("operandCount", settings.operandCount);
  setGroupValue("questionCount", settings.questionCount);
  updateOperandOptionsVisibility(settings.problemType);
  settingsPage.classList.add("is-open");
}

function closeSettings() {
  settingsPage.classList.remove("is-open");
}

function openNavPage() {
  navPage.classList.add("is-open");
}

function closeNavPage() {
  navPage.classList.remove("is-open");
}

async function refreshLeaderboardFromDb() {
  const data = await apiRequest("/api/leaderboard");
  leaderboardGroups.length = 0;
  for (const group of data.groups || []) {
    leaderboardGroups.push(group);
  }
}

async function openLeaderboard() {
  await refreshLeaderboardFromDb();
  syncLeaderboardConfigSelection();
  renderLeaderboard();
  leaderboardPage.classList.add("is-open");
}

function closeLeaderboard() {
  leaderboardPage.classList.remove("is-open");
}

async function openDetail(entryId, username, totalTimeText) {
  const data = await apiRequest("/api/leaderboard/" + entryId + "/items");
  detailTitle.textContent = username + " · " + totalTimeText;
  detailHistoryList.innerHTML = "";
  for (const item of data.items || []) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML =
      '<div class="history-equation">' +
      item.equation +
      '</div><div class="history-time">' +
      item.time +
      "</div>";
    detailHistoryList.appendChild(li);
  }
  detailPage.classList.add("is-open");
}

function closeDetail() {
  detailPage.classList.remove("is-open");
}

function resetRoundProgress(clearVisibleHistory) {
  solvedInRound = 0;
  totalMsInRound = 0;
  roundHistory.length = 0;
  if (clearVisibleHistory) {
    history.length = 0;
    renderHistory();
  }
}

async function saveHistoryToDb(item) {
  const data = await apiRequest("/api/history", {
    method: "POST",
    body: JSON.stringify({
      equation: item.equation,
      time: item.time,
      timeMs: item.timeMs,
      limit: settings.questionCount,
    }),
  });
  history.length = 0;
  for (const historyItem of data.history || []) {
    history.push(historyItem);
  }
  renderHistory();
}

async function finishRoundAndRecord() {
  const username = settings.username.trim() === "" ? "匿名" : settings.username.trim();
  await apiRequest("/api/round", {
    method: "POST",
    body: JSON.stringify({
      username,
      totalMs: totalMsInRound,
      totalTimeText: formatDuration(totalMsInRound),
      configKey: getConfigLabel(),
      configLabel: getConfigLabel(),
      items: roundHistory.map((item) => ({
        equation: item.equation,
        time: item.time,
        timeMs: item.timeMs,
      })),
    }),
  });

  await refreshLeaderboardFromDb();
  selectedLeaderboardConfigKey = getConfigLabel();
  setCookieValue(LEADERBOARD_FILTER_COOKIE_KEY, selectedLeaderboardConfigKey, 365);
  resetRoundProgress(true);
  isRoundTransitioning = true;
  congratsOverlay.classList.add("is-open");
  if (leaderboardJumpTimer) clearTimeout(leaderboardJumpTimer);
  leaderboardJumpTimer = setTimeout(async () => {
    congratsOverlay.classList.remove("is-open");
    await openLeaderboard();
    isRoundTransitioning = false;
    leaderboardJumpTimer = null;
  }, 2000);
}

async function checkAnswerAndAdvance() {
  if (input.length === 0 || isSavingAnswer) return;
  if (Number(input) !== correct) return;

  isSavingAnswer = true;
  try {
    const elapsedMs = Date.now() - questionStartMs;
    const solvedItem = {
      equation: currentExpression,
      time: formatDuration(elapsedMs),
      timeMs: elapsedMs,
    };

    roundHistory.push(solvedItem);
    solvedInRound += 1;
    totalMsInRound += elapsedMs;

    await saveHistoryToDb(solvedItem);

    if (solvedInRound >= settings.questionCount) {
      await finishRoundAndRecord();
    }
    nextQuestion();
  } finally {
    isSavingAnswer = false;
  }
}

async function refreshHistoryFromDb(limit) {
  const data = await apiRequest("/api/history", {
    method: "POST",
    body: JSON.stringify({
      equation: "",
      time: "",
      timeMs: 0,
      skipInsert: true,
      limit,
    }),
  });
  history.length = 0;
  for (const item of data.history || []) {
    history.push(item);
  }
  renderHistory();
}

async function bootstrapFromDb() {
  try {
    const data = await apiRequest("/api/bootstrap");
    const cookieSettings = loadSettingsFromCookie();
    settings = cookieSettings ? cookieSettings : normalizeSettings(settings);
    settings.username = getCookieValue(USERNAME_COOKIE_KEY).slice(0, 10);
    history.length = 0;
    const initialHistory = (data.history || []).slice(0, settings.questionCount);
    for (const item of initialHistory) {
      history.push(item);
    }
    leaderboardGroups.length = 0;
    for (const group of data.leaderboard || []) {
      leaderboardGroups.push(group);
    }
    renderHistory();
  } catch (error) {
    console.error("Failed to bootstrap from sqlite api:", error);
  }
}

keyboard.addEventListener("click", async (event) => {
  if (isRoundTransitioning || isSavingAnswer) return;
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const action = target.dataset.action;
  const digit = target.dataset.num;

  if (action === "backspace") {
    input = input.slice(0, -1);
    render();
    return;
  }

  if (!digit || input.length >= maxInputLength) return;
  input += digit;
  render();
  await checkAnswerAndAdvance();
});

historyToggle.addEventListener("click", () => {
  setHistoryOpen(!isHistoryOpen);
});

historyOverlay.addEventListener("click", () => {
  setHistoryOpen(false);
});

mobileQuery.addEventListener("change", () => {
  if (!mobileQuery.matches) setHistoryOpen(false);
});

settingsToggle.addEventListener("click", () => {
  openSettings();
});

settingsCancel.addEventListener("click", () => {
  closeSettings();
});

settingsMore.addEventListener("click", () => {
  openNavPage();
});

for (const group of settingOptionGroups) {
  group.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const groupName = group.dataset.settingGroup;
    const value = target.dataset.value;
    if (!groupName || !value) return;

    setGroupValue(groupName, value);
    if (!draftSettings) draftSettings = { ...settings };

    if (groupName === "problemType") {
      draftSettings.problemType = value;
      updateOperandOptionsVisibility(value);
    } else if (groupName === "digitCount") draftSettings.digitCount = Number(value);
    else if (groupName === "operandCount") draftSettings.operandCount = Number(value);
    else if (groupName === "questionCount") draftSettings.questionCount = Number(value);
  });
}

settingsConfirm.addEventListener("click", async () => {
  if (!draftSettings) draftSettings = { ...settings };
  const nextSettings = {
    username: settingUsername.value.slice(0, 10),
    problemType: draftSettings.problemType,
    digitCount: draftSettings.digitCount,
    operandCount: draftSettings.problemType === "divide" ? 2 : draftSettings.operandCount,
    questionCount: draftSettings.questionCount,
  };
  setCookieValue(USERNAME_COOKIE_KEY, nextSettings.username, 365);
  saveSettingsToCookie(nextSettings);
  settings = normalizeSettings(nextSettings);
  settings.username = nextSettings.username;
  await refreshHistoryFromDb(settings.questionCount);
  closeSettings();
  resetRoundProgress(true);
  nextQuestion();
});

leaderboardToggle.addEventListener("click", async () => {
  await openLeaderboard();
});

leaderboardConfigSelect.addEventListener("change", () => {
  selectedLeaderboardConfigKey = leaderboardConfigSelect.value || "";
  setCookieValue(LEADERBOARD_FILTER_COOKIE_KEY, selectedLeaderboardConfigKey, 365);
  renderLeaderboard();
});

leaderboardClose.addEventListener("click", () => {
  closeLeaderboard();
  closeDetail();
});

leaderboardList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const entryId = Number(target.dataset.id);
  if (!Number.isInteger(entryId)) return;
  await openDetail(entryId, target.dataset.username || "匿名", target.dataset.time || "");
});

detailClose.addEventListener("click", () => {
  closeDetail();
});

navClose.addEventListener("click", () => {
  closeNavPage();
});

navMinimaths.addEventListener("click", () => {
  closeNavPage();
  closeSettings();
  closeLeaderboard();
  closeDetail();
});

navMiniEng.addEventListener("click", () => {
  window.location.href = "/mini-eng.html";
});

navXiaoguwen.addEventListener("click", () => {
  window.location.href = "/xiaoguwen.html";
});

navNovel.addEventListener("click", () => {
  window.location.href = "/novel.html";
});

navSpeed.addEventListener("click", () => {
  window.location.href = "/processing-speed.html";
});

navRecharge.addEventListener("click", () => {
  window.location.href = "/recharge.html";
});

const initParams = new URLSearchParams(window.location.search);
if (initParams.get("openNav") === "1") {
  openNavPage();
}
document.documentElement.classList.remove("open-nav-init");

await bootstrapFromDb();
selectedLeaderboardConfigKey = getCookieValue(LEADERBOARD_FILTER_COOKIE_KEY) || "";
nextQuestion();
