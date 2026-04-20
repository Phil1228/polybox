const USER_TOKEN_KEY = "minimaths_user_token";
const SC_SETTINGS_KEY = "square_cube_settings";
const SC_USERNAME_KEY = "square_cube_username";
const SC_LB_TYPE_KEY = "square_cube_leaderboard_type";

const powerTextEl = document.getElementById("power-text");
const targetTextEl = document.getElementById("target-text");
const answerDisplayEl = document.getElementById("answer-display");
const keyboardEl = document.getElementById("keyboard");
const historyListEl = document.getElementById("history-list");
const historyCardEl = document.getElementById("history-card");
const historyToggleEl = document.getElementById("history-toggle");
const historyOverlayEl = document.getElementById("history-overlay");

const settingsToggleEl = document.getElementById("settings-toggle");
const settingsModalEl = document.getElementById("settings-modal");
const settingUsernameEl = document.getElementById("setting-username");
const practiceTypeOptionsEl = document.getElementById("practice-type-options");
const settingsMoreEl = document.getElementById("settings-more");
const settingsConfirmEl = document.getElementById("settings-confirm");
const settingsCancelEl = document.getElementById("settings-cancel");

const leaderboardToggleEl = document.getElementById("leaderboard-toggle");
const leaderboardModalEl = document.getElementById("leaderboard-modal");
const leaderboardTypeOptionsEl = document.getElementById("leaderboard-type-options");
const leaderboardListEl = document.getElementById("leaderboard-list");
const leaderboardCloseEl = document.getElementById("leaderboard-close");

const detailModalEl = document.getElementById("detail-modal");
const detailTitleEl = document.getElementById("detail-title");
const detailHistoryListEl = document.getElementById("detail-history-list");
const detailCloseEl = document.getElementById("detail-close");

const mobileQuery = window.matchMedia("(max-width: 760px)");

let input = "";
let currentQuestion = null;
let questionStartMs = 0;
let isSaving = false;
let isHistoryOpen = false;
let roundSolved = 0;
let roundTotalMs = 0;
const roundHistory = [];
let leaderboardGroups = [];

let settings = {
  username: "",
  practiceType: "square",
};
let draftSettings = { ...settings };
let selectedLeaderboardType = "square";

function getCookieValue(key) {
  const parts = (document.cookie || "").split(";");
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
  document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(path);
  return response.json();
}

async function fetchUserNickname() {
  const token = localStorage.getItem(USER_TOKEN_KEY) || "";
  if (!token) return "";
  try {
    const res = await fetch("/api/users/me", {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await res.json();
    return typeof data?.user?.nickname === "string" ? data.user.nickname.trim() : "";
  } catch {
    return "";
  }
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPracticeType(baseType) {
  if (baseType !== "mixed") return baseType;
  return Math.random() < 0.5 ? "square" : "cube";
}

function generateQuestion() {
  const type = randomPracticeType(settings.practiceType);
  const base = type === "square" ? randomInt(1, 99) : randomInt(1, 30);
  const power = type === "square" ? 2 : 3;
  const target = power === 2 ? base * base : base * base * base;
  return { type, power, base, target };
}

function formatDuration(ms) {
  return `${Math.max(0, Math.round(ms / 100) / 10)}s`;
}

function typeLabel(type) {
  if (type === "square") return "平方";
  if (type === "cube") return "立方";
  return "混合";
}

function powerToSuperscript(power) {
  if (power === 2) return "²";
  if (power === 3) return "³";
  return String(power);
}

function renderQuestion() {
  if (!currentQuestion) return;
  powerTextEl.textContent = powerToSuperscript(currentQuestion.power);
  targetTextEl.textContent = String(currentQuestion.target);
  answerDisplayEl.textContent = input || "\u00A0";
}

function renderRoundHistory() {
  historyListEl.innerHTML = "";
  for (const item of roundHistory) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML = `<span>${item.equation}</span><span>${item.time}</span>`;
    historyListEl.appendChild(li);
  }
}

function setOptionGroupValue(container, value) {
  if (!container) return;
  const buttons = container.querySelectorAll(".option-btn");
  for (const btn of buttons) {
    btn.classList.toggle("is-active", btn.dataset.value === String(value));
  }
}

function openOverlay(modalEl) {
  modalEl?.classList.add("is-open");
}

function closeOverlay(modalEl) {
  modalEl?.classList.remove("is-open");
}

function setHistoryOpen(open) {
  if (!mobileQuery.matches) {
    isHistoryOpen = false;
    historyCardEl.classList.remove("is-open");
    historyOverlayEl.classList.remove("is-open");
    return;
  }
  isHistoryOpen = Boolean(open);
  historyCardEl.classList.toggle("is-open", isHistoryOpen);
  historyOverlayEl.classList.toggle("is-open", isHistoryOpen);
}

function nextQuestion() {
  currentQuestion = generateQuestion();
  input = "";
  questionStartMs = Date.now();
  renderQuestion();
}

function resetRound() {
  roundSolved = 0;
  roundTotalMs = 0;
  roundHistory.length = 0;
  renderRoundHistory();
}

async function refreshLeaderboard() {
  const data = await apiRequest("/api/square-cube/leaderboard");
  leaderboardGroups = Array.isArray(data.groups) ? data.groups : [];
}

function renderLeaderboard() {
  leaderboardListEl.innerHTML = "";
  const group = leaderboardGroups.find((item) => item.type === selectedLeaderboardType);
  if (!group || !Array.isArray(group.items) || !group.items.length) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.textContent = "暂无记录";
    leaderboardListEl.appendChild(li);
    return;
  }
  for (const entry of group.items) {
    const li = document.createElement("li");
    li.className = "leaderboard-item";
    li.innerHTML = `
      <span>#${entry.rank}</span>
      <span>${entry.username || "匿名"}</span>
      <span>${entry.totalTimeText || "0s"}</span>
      <button class="btn" data-entry-id="${entry.id}" data-user="${entry.username || "匿名"}" data-time="${entry.totalTimeText || "0s"}">记录</button>
    `;
    leaderboardListEl.appendChild(li);
  }
}

async function openDetail(entryId, username, totalTimeText) {
  const data = await apiRequest(`/api/square-cube/leaderboard/${entryId}/items`);
  detailTitleEl.textContent = `${username} · ${totalTimeText}`;
  detailHistoryListEl.innerHTML = "";
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML = `<span>${item.equation}</span><span>${item.time || "0s"}</span>`;
    detailHistoryListEl.appendChild(li);
  }
  openOverlay(detailModalEl);
}

async function finishRoundAndRecord() {
  const username = (settings.username || "").trim() || "匿名";
  await apiRequest("/api/square-cube/round", {
    method: "POST",
    body: JSON.stringify({
      username,
      type: settings.practiceType,
      totalMs: roundTotalMs,
      totalTimeText: formatDuration(roundTotalMs),
      items: roundHistory,
    }),
  });
  await refreshLeaderboard();
  selectedLeaderboardType = settings.practiceType === "mixed" ? "square" : settings.practiceType;
  setCookieValue(SC_LB_TYPE_KEY, selectedLeaderboardType, 365);
  setOptionGroupValue(leaderboardTypeOptionsEl, selectedLeaderboardType);
  renderLeaderboard();
  openOverlay(leaderboardModalEl);
  resetRound();
}

async function checkAnswerAndAdvance() {
  if (!currentQuestion || isSaving || input.length === 0) return;
  if (Number(input) !== currentQuestion.base) return;
  isSaving = true;
  try {
    const elapsedMs = Date.now() - questionStartMs;
    const equation = `${currentQuestion.base}${powerToSuperscript(currentQuestion.power)}=${currentQuestion.target}`;
    const item = { equation, time: formatDuration(elapsedMs), timeMs: elapsedMs };
    roundHistory.push(item);
    roundSolved += 1;
    roundTotalMs += elapsedMs;
    try {
      await apiRequest("/api/square-cube/history", {
        method: "POST",
        body: JSON.stringify(item),
      });
    } catch {
      // Ignore history insert failures to avoid blocking gameplay.
    }
    renderRoundHistory();
    if (roundSolved >= 10) {
      await finishRoundAndRecord();
    }
    nextQuestion();
  } finally {
    isSaving = false;
  }
}

function applySettings(next) {
  settings = {
    username: (next.username || "").slice(0, 10),
    practiceType: ["square", "cube", "mixed"].includes(next.practiceType) ? next.practiceType : "square",
  };
  setCookieValue(SC_USERNAME_KEY, settings.username, 365);
  setCookieValue(SC_SETTINGS_KEY, JSON.stringify({ practiceType: settings.practiceType }), 365);
}

function openSettings() {
  draftSettings = { ...settings };
  settingUsernameEl.value = settings.username;
  setOptionGroupValue(practiceTypeOptionsEl, settings.practiceType);
  openOverlay(settingsModalEl);
}

async function bootstrap() {
  try {
    const data = await apiRequest("/api/square-cube/bootstrap");
    leaderboardGroups = Array.isArray(data.groups) ? data.groups : [];
  } catch {
    // Keep running even if bootstrap fails.
  }

  const typeCookieRaw = getCookieValue(SC_SETTINGS_KEY);
  let typeFromCookie = "square";
  if (typeCookieRaw) {
    try {
      const parsed = JSON.parse(typeCookieRaw);
      if (["square", "cube", "mixed"].includes(parsed.practiceType)) {
        typeFromCookie = parsed.practiceType;
      }
    } catch {
      typeFromCookie = "square";
    }
  }
  settings.practiceType = typeFromCookie;

  const usernameCookie = getCookieValue(SC_USERNAME_KEY).trim().slice(0, 10);
  if (usernameCookie) {
    settings.username = usernameCookie;
  } else {
    const nickname = await fetchUserNickname();
    settings.username = nickname ? nickname.slice(0, 10) : "匿名";
  }

  selectedLeaderboardType = getCookieValue(SC_LB_TYPE_KEY) || "square";
  if (!["square", "cube", "mixed"].includes(selectedLeaderboardType)) selectedLeaderboardType = "square";
}

keyboardEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const action = target.dataset.action;
  const digit = target.dataset.num;
  if (action === "backspace") {
    input = input.slice(0, -1);
    renderQuestion();
    return;
  }
  if (!digit || input.length >= 3) return;
  input += digit;
  renderQuestion();
  await checkAnswerAndAdvance();
});

settingsToggleEl.addEventListener("click", openSettings);
settingsMoreEl.addEventListener("click", () => {
  window.location.href = "/";
});
settingsCancelEl.addEventListener("click", () => closeOverlay(settingsModalEl));
settingsModalEl.addEventListener("click", (event) => {
  if (event.target === settingsModalEl) closeOverlay(settingsModalEl);
});
practiceTypeOptionsEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const value = target.dataset.value;
  if (!value) return;
  draftSettings.practiceType = value;
  setOptionGroupValue(practiceTypeOptionsEl, value);
});
settingsConfirmEl.addEventListener("click", () => {
  applySettings({
    username: settingUsernameEl.value || "匿名",
    practiceType: draftSettings.practiceType || "square",
  });
  closeOverlay(settingsModalEl);
  resetRound();
  nextQuestion();
});

leaderboardToggleEl.addEventListener("click", async () => {
  await refreshLeaderboard();
  setOptionGroupValue(leaderboardTypeOptionsEl, selectedLeaderboardType);
  renderLeaderboard();
  openOverlay(leaderboardModalEl);
});
leaderboardCloseEl.addEventListener("click", () => closeOverlay(leaderboardModalEl));
leaderboardModalEl.addEventListener("click", (event) => {
  if (event.target === leaderboardModalEl) closeOverlay(leaderboardModalEl);
});
leaderboardTypeOptionsEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const value = target.dataset.value;
  if (!value) return;
  selectedLeaderboardType = value;
  setCookieValue(SC_LB_TYPE_KEY, selectedLeaderboardType, 365);
  setOptionGroupValue(leaderboardTypeOptionsEl, selectedLeaderboardType);
  renderLeaderboard();
});
leaderboardListEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const entryId = Number(target.dataset.entryId);
  if (!Number.isInteger(entryId)) return;
  await openDetail(entryId, target.dataset.user || "匿名", target.dataset.time || "0s");
});

detailCloseEl.addEventListener("click", () => closeOverlay(detailModalEl));
detailModalEl.addEventListener("click", (event) => {
  if (event.target === detailModalEl) closeOverlay(detailModalEl);
});

historyToggleEl.addEventListener("click", () => setHistoryOpen(!isHistoryOpen));
historyOverlayEl.addEventListener("click", () => setHistoryOpen(false));
mobileQuery.addEventListener("change", () => {
  if (!mobileQuery.matches) setHistoryOpen(false);
});

await bootstrap();
resetRound();
nextQuestion();
