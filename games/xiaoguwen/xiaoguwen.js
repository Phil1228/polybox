const poemTitle = document.getElementById("poem-title");
const poemAuthor = document.getElementById("poem-author");
const poemContent = document.getElementById("poem-content");
const nextPoemBtn = document.getElementById("next-poem-btn");
const popup = document.getElementById("congrats-popup");
const analysisText = document.getElementById("analysis-text");
const nextInPopupBtn = document.getElementById("next-in-popup-btn");
const openSettingsBtn = document.getElementById("open-settings-btn");
const settingsPopup = document.getElementById("settings-popup");
const closeSettingsBtn = document.getElementById("close-settings-btn");
const settingsMoreBtn = document.getElementById("settings-more-btn");
const settingUsernameInput = document.getElementById("setting-username");
const USER_TOKEN_KEY = "minimaths_user_token";

const POEMS = [
  {
    title: "静夜思",
    dynasty: "唐",
    author: "李白",
    analysis: "借月抒怀，寥寥数句把漂泊游子的思乡之情写得真切动人。",
    parts: ["床前", null, "，疑是", null, "。", null, "望", null, "，低头思", null, "。"],
    answers: ["明月光", "地上霜", "举头", "明月", "故乡"],
  },
  {
    title: "春晓",
    dynasty: "唐",
    author: "孟浩然",
    analysis: "以听觉与视觉交织春晨景象，末句点出惜春情绪，清新自然。",
    parts: [null, "不觉晓，", null, "闻啼鸟。", null, "，", null, "。", null, "知多少。"],
    answers: ["春眠", "处处", "夜来风雨声", "花落", "知"],
  },
  {
    title: "登鹳雀楼",
    dynasty: "唐",
    author: "王之涣",
    analysis: "前两句写景壮阔，后两句寓意深远，鼓励人不断登高望远。",
    parts: [null, "依山尽，", null, "入海流。", null, null, "，", null, "。"],
    answers: ["白日", "黄河", "欲穷", "千里目", "更上一层楼"],
  },
  {
    title: "江雪",
    dynasty: "唐",
    author: "柳宗元",
    analysis: "通过极静极寒的雪景，刻画出孤高清冷的精神境界。",
    parts: [null, "鸟飞绝，", null, "人踪灭。", null, null, "，独钓", null, "。"],
    answers: ["千山", "万径", "孤舟", "蓑笠翁", "寒江雪"],
  },
  {
    title: "悯农·其二",
    dynasty: "唐",
    author: "李绅",
    analysis: "从劳作到餐桌形成对照，提醒人珍惜粮食、体恤农人艰辛。",
    parts: [null, "日当午，", null, "禾下", null, "。", null, "盘中餐，", null, "。"],
    answers: ["锄禾", "汗滴", "土", "谁知", "粒粒皆辛苦"],
  },
];

let currentPoem = null;
let lastIndex = -1;

function pickPoem() {
  if (POEMS.length === 1) return POEMS[0];
  let idx = Math.floor(Math.random() * POEMS.length);
  if (idx === lastIndex) idx = (idx + 1) % POEMS.length;
  lastIndex = idx;
  return POEMS[idx];
}

function normalizeInput(value) {
  return value.trim().replace(/\s+/g, "");
}

function checkAllCorrect() {
  const blanks = poemContent.querySelectorAll("input.blank");
  let ok = blanks.length > 0;
  blanks.forEach((input) => {
    const expected = input.dataset.answer || "";
    const typed = normalizeInput(input.value);
    input.classList.remove("correct", "wrong");
    if (!typed) {
      ok = false;
      return;
    }
    if (typed === expected) input.classList.add("correct");
    else {
      input.classList.add("wrong");
      ok = false;
    }
  });
  if (ok) {
    analysisText.textContent = "赏析：" + currentPoem.analysis;
    popup.classList.add("is-open");
  }
}

function renderPoem(poem) {
  currentPoem = poem;
  poemTitle.textContent = poem.title;
  poemAuthor.textContent = (poem.dynasty ? poem.dynasty + "·" : "") + poem.author;
  poemContent.innerHTML = "";
  popup.classList.remove("is-open");

  let answerIndex = 0;
  poem.parts.forEach((part) => {
    if (part !== null) {
      const span = document.createElement("span");
      span.textContent = part;
      poemContent.appendChild(span);
      return;
    }

    const answer = poem.answers[answerIndex];
    answerIndex += 1;
    const input = document.createElement("input");
    input.className = "blank";
    input.type = "text";
    input.setAttribute("aria-label", "填空");
    input.dataset.answer = answer;
    input.style.setProperty("--w", String(Math.max(2, answer.length)));
    input.addEventListener("input", checkAllCorrect);
    poemContent.appendChild(input);
  });
}

nextPoemBtn.addEventListener("click", () => {
  renderPoem(pickPoem());
});

nextInPopupBtn.addEventListener("click", () => {
  popup.classList.remove("is-open");
  renderPoem(pickPoem());
});

popup.addEventListener("click", (event) => {
  if (event.target === popup) popup.classList.remove("is-open");
});

async function loadUserNickname() {
  if (!settingUsernameInput) return;
  const token = localStorage.getItem(USER_TOKEN_KEY) || "";
  if (!token) {
    settingUsernameInput.value = "";
    return;
  }
  try {
    const res = await fetch("/api/users/me", {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await res.json();
    const nickname = data?.user?.nickname || "";
    settingUsernameInput.value = nickname;
  } catch {
    settingUsernameInput.value = "";
  }
}

function openSettings() {
  settingsPopup.classList.add("is-open");
  loadUserNickname();
}

function closeSettings() {
  settingsPopup.classList.remove("is-open");
}

openSettingsBtn.addEventListener("click", openSettings);
closeSettingsBtn.addEventListener("click", closeSettings);
settingsPopup.addEventListener("click", (event) => {
  if (event.target === settingsPopup) closeSettings();
});
settingsMoreBtn.addEventListener("click", () => {
  window.location.href = "/";
});

renderPoem(pickPoem());
