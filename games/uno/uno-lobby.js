const STORAGE_NICK = "uno_nickname";

const els = {
  nickname: document.getElementById("nickname"),
  difficulty: document.getElementById("difficulty"),
  btnAi: document.getElementById("btn-ai"),
  btnCreateOnline: document.getElementById("btn-create-online"),
  joinCode: document.getElementById("join-code"),
  btnJoin: document.getElementById("btn-join"),
  ruleUno: document.getElementById("rule-uno"),
  ruleStack: document.getElementById("rule-stack"),
  ruleTimeout: document.getElementById("rule-timeout"),
  msg: document.getElementById("msg"),
};

let aiDifficulty = "normal";

function showMsg(text, isError = false) {
  els.msg.textContent = text;
  els.msg.classList.toggle("error", isError);
}

function getRules() {
  return {
    unoPenalty: els.ruleUno.classList.contains("on"),
    stackDrawTwo: els.ruleStack.classList.contains("on"),
    turnTimeoutSec: Number(els.ruleTimeout.value) || 30,
  };
}

function getNickname() {
  return (els.nickname.value || "").trim() || "玩家";
}

async function loadProfileNickname() {
  const saved = localStorage.getItem(STORAGE_NICK);
  if (saved) els.nickname.value = saved;
  const token = localStorage.getItem("minimaths_user_token");
  if (!token) return;
  try {
    const res = await fetch("/api/users/me", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const data = await res.json();
    if (data.user?.nickname) els.nickname.value = data.user.nickname;
    else if (data.user?.username) els.nickname.value = data.user.username;
  } catch {
    /* ignore */
  }
}

function goTable(roomId, token, mode) {
  localStorage.setItem(STORAGE_NICK, getNickname());
  localStorage.setItem(`uno_token_${roomId}`, token);
  const q = new URLSearchParams({ room: roomId, token, mode });
  window.location.href = `/uno-table.html?${q}`;
}

async function createRoom(mode) {
  showMsg("创建中…");
  try {
    const res = await fetch("/api/uno/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        nickname: getNickname(),
        ai_difficulty: aiDifficulty,
        rules: getRules(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "创建失败");
    goTable(data.room_id, data.player_token, mode);
  } catch (error) {
    showMsg(error instanceof Error ? error.message : "创建失败", true);
  }
}

async function joinRoom() {
  const code = (els.joinCode.value || "").trim();
  if (!/^\d{4}$/.test(code)) {
    showMsg("请输入 4 位房间号", true);
    return;
  }
  showMsg("加入中…");
  try {
    const res = await fetch("/api/uno/rooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_id: code, nickname: getNickname() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "加入失败");
    goTable(data.room_id, data.player_token, "online");
  } catch (error) {
    showMsg(error instanceof Error ? error.message : "加入失败", true);
  }
}

els.difficulty.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-diff]");
  if (!btn) return;
  aiDifficulty = btn.dataset.diff || "normal";
  els.difficulty.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
});

[els.ruleUno, els.ruleStack].forEach((sw) => {
  sw.addEventListener("click", () => sw.classList.toggle("on"));
});

els.btnAi.addEventListener("click", () => createRoom("ai"));
els.btnCreateOnline.addEventListener("click", () => createRoom("online"));
els.btnJoin.addEventListener("click", joinRoom);

loadProfileNickname();
