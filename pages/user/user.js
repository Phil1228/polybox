const TOKEN_KEY = "minimaths_user_token";

const authView = document.getElementById("auth-view");
const profileView = document.getElementById("profile-view");

const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const loginPanel = document.getElementById("login-panel");
const registerPanel = document.getElementById("register-panel");
const toRegisterBtn = document.getElementById("to-register-btn");

const loginUsernameEl = document.getElementById("login-username");
const loginPasswordEl = document.getElementById("login-password");
const loginMessageEl = document.getElementById("login-message");

const regUsernameEl = document.getElementById("reg-username");
const regPasswordEl = document.getElementById("reg-password");
const registerMessageEl = document.getElementById("register-message");

const profileUsernameEl = document.getElementById("profile-username");
const profileNicknameEl = document.getElementById("profile-nickname");
const themeSelectEl = document.getElementById("theme-select");
const avatarPreviewEl = document.getElementById("avatar-preview");
const avatarGridEl = document.getElementById("avatar-grid");
const profileMessageEl = document.getElementById("profile-message");

const loginBtn = document.getElementById("login-btn");
const registerBtn = document.getElementById("register-btn");
const logoutBtn = document.getElementById("logout-btn");
const saveProfileBtn = document.getElementById("save-profile-btn");
const goHomeBtn = document.getElementById("go-home-btn");
const THEME_KEY = "minimaths_theme";
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const AVATAR_OPTIONS = [
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='24' fill='%2351b7ff'/><circle cx='48' cy='40' r='18' fill='white'/><path d='M20 78c6-16 18-24 28-24s22 8 28 24' fill='white'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='24' fill='%235dd19c'/><circle cx='36' cy='38' r='14' fill='white'/><circle cx='60' cy='38' r='14' fill='white'/><path d='M18 78c8-14 20-20 30-20s22 6 30 20' fill='white'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='24' fill='%23ffb347'/><circle cx='48' cy='36' r='16' fill='white'/><rect x='24' y='54' width='48' height='20' rx='10' fill='white'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='24' fill='%23ff6b6b'/><circle cx='48' cy='38' r='16' fill='white'/><path d='M24 76c4-10 14-18 24-18s20 8 24 18' fill='white'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='24' fill='%237c89aa'/><circle cx='48' cy='36' r='16' fill='white'/><path d='M20 78c6-14 18-22 28-22s22 8 28 22' fill='white'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='24' fill='%238b7bff'/><circle cx='48' cy='36' r='16' fill='white'/><path d='M18 76c8-12 20-18 30-18s22 6 30 18' fill='white'/></svg>",
];

let selectedAvatar = "";

function setMessage(el, text, type) {
  el.textContent = text || "";
  el.classList.remove("success", "error");
  if (type) el.classList.add(type);
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

function showAuthView() {
  authView.classList.add("is-open");
  profileView.classList.remove("is-open");
}

function showProfileView() {
  authView.classList.remove("is-open");
  profileView.classList.add("is-open");
}

function activateTab(tab) {
  const isLogin = tab === "login";
  tabLogin.classList.toggle("is-active", isLogin);
  tabRegister.classList.toggle("is-active", !isLogin);
  loginPanel.style.display = isLogin ? "block" : "none";
  registerPanel.style.display = isLogin ? "none" : "block";
}

async function apiRequest(path, payload, auth) {
  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = "Bearer " + auth;
  const res = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  const res = await fetch("/api/users/me", {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await res.json().catch(() => ({}));
  return data && data.user ? data.user : null;
}

function applyProfile(user) {
  profileUsernameEl.value = user.username || "";
  profileNicknameEl.value = user.nickname || "";
  selectedAvatar = user.avatar || AVATAR_OPTIONS[0];
  avatarPreviewEl.src = selectedAvatar || TRANSPARENT_PIXEL;
  renderAvatarOptions();
  syncThemeSelect();
}

async function handleLogin() {
  setMessage(loginMessageEl, "", "");
  const username = loginUsernameEl.value.trim();
  const password = loginPasswordEl.value;
  const { ok, data } = await apiRequest("/api/users/login", { username, password });
  if (!ok) {
    setMessage(loginMessageEl, data.error || "登录失败", "error");
    return;
  }
  setToken(data.token || "");
  window.location.href = "/";
}

async function handleRegister() {
  setMessage(registerMessageEl, "", "");
  const username = regUsernameEl.value.trim();
  const password = regPasswordEl.value;
  const { ok, data } = await apiRequest("/api/users/register", { username, password });
  if (!ok) {
    setMessage(registerMessageEl, data.error || "注册失败", "error");
    return;
  }
  setToken(data.token || "");
  applyProfile(data.user || { username });
  showProfileView();
  setMessage(profileMessageEl, "注册成功，完善资料吧", "success");
}

async function handleLogout() {
  const token = getToken();
  if (token) {
    await apiRequest("/api/users/logout", { token }, token);
  }
  setToken("");
  showAuthView();
  activateTab("login");
}

async function handleSaveProfile() {
  setMessage(profileMessageEl, "", "");
  const token = getToken();
  if (!token) {
    showAuthView();
    activateTab("login");
    return;
  }
  const nickname = profileNicknameEl.value.trim();
  const avatar = selectedAvatar || "";
  const { ok, data } = await apiRequest("/api/users/profile", { nickname, avatar }, token);
  if (!ok) {
    setMessage(profileMessageEl, data.error || "保存失败", "error");
    return;
  }
  applyProfile(data.user || {});
  setMessage(profileMessageEl, "资料已保存", "success");
}

function renderAvatarOptions() {
  if (!avatarGridEl) return;
  avatarGridEl.innerHTML = "";
  const options = AVATAR_OPTIONS.includes(selectedAvatar) || !selectedAvatar
    ? AVATAR_OPTIONS
    : [selectedAvatar, ...AVATAR_OPTIONS];
  options.forEach((src) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "avatar-option" + (src === selectedAvatar ? " is-active" : "");
    const img = document.createElement("img");
    img.src = src;
    img.alt = "avatar";
    btn.appendChild(img);
    btn.addEventListener("click", () => {
      selectedAvatar = src;
      avatarPreviewEl.src = src;
      renderAvatarOptions();
    });
    avatarGridEl.appendChild(btn);
  });
}

function applyTheme(value) {
  const root = document.documentElement;
  if (value === "light" || value === "dark") {
    root.setAttribute("data-theme", value);
    localStorage.setItem(THEME_KEY, value);
    return;
  }
  root.removeAttribute("data-theme");
  localStorage.removeItem(THEME_KEY);
}

function syncThemeSelect() {
  if (!themeSelectEl) return;
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    themeSelectEl.value = saved;
  } else {
    themeSelectEl.value = "system";
  }
}

tabLogin.addEventListener("click", () => activateTab("login"));
tabRegister.addEventListener("click", () => activateTab("register"));
toRegisterBtn.addEventListener("click", () => activateTab("register"));
loginBtn.addEventListener("click", handleLogin);
registerBtn.addEventListener("click", handleRegister);
logoutBtn.addEventListener("click", handleLogout);
saveProfileBtn.addEventListener("click", handleSaveProfile);
themeSelectEl.addEventListener("change", () => applyTheme(themeSelectEl.value));
goHomeBtn.addEventListener("click", () => {
  window.location.href = "/";
});

async function init() {
  activateTab("login");
  syncThemeSelect();
  const user = await fetchMe();
  if (user) {
    applyProfile(user);
    showProfileView();
  } else {
    showAuthView();
  }
}

init();
