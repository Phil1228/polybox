const seqMeta = document.getElementById("seq-meta");
const contentEl = document.getElementById("novel-content");
const submissionsList = document.getElementById("submissions-list");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const detailBtn = document.getElementById("detail-btn");
const continueInput = document.getElementById("continue-input");
const textCount = document.getElementById("text-count");
const authorInput = document.getElementById("author-input");
const submitBtn = document.getElementById("submit-btn");
const submitStatus = document.getElementById("submit-status");

const detailPopup = document.getElementById("detail-popup");
const detailId = document.getElementById("detail-id");
const detailVotes = document.getElementById("detail-votes");
const detailAuthor = document.getElementById("detail-author");
const detailTime = document.getElementById("detail-time");
const shareBtn = document.getElementById("share-btn");
const shareStatus = document.getElementById("share-status");
const integrateBtn = document.getElementById("integrate-btn");
const likeBtn = document.getElementById("like-btn");
const closePopupBtn = document.getElementById("close-popup-btn");
const jumpBtn = document.getElementById("jump-btn");
const jumpPopup = document.getElementById("jump-popup");
const jumpSeqInput = document.getElementById("jump-seq-input");
const jumpIdInput = document.getElementById("jump-id-input");
const jumpSeqGoBtn = document.getElementById("jump-seq-go-btn");
const jumpIdGoBtn = document.getElementById("jump-id-go-btn");
const closeJumpPopupBtn = document.getElementById("close-jump-popup-btn");
const jumpCurrentId = document.getElementById("jump-current-id");
const jumpCurrentSeq = document.getElementById("jump-current-seq");
const jumpStatus = document.getElementById("jump-status");
const integratePopup = document.getElementById("integrate-popup");
const integratedContent = document.getElementById("integrated-content");
const integrateStatus = document.getElementById("integrate-status");
const downloadPdfBtn = document.getElementById("download-pdf-btn");
const closeIntegratePopupBtn = document.getElementById("close-integrate-popup-btn");
const candidatesPopup = document.getElementById("candidates-popup");
const candidateScroll = document.getElementById("candidate-scroll");
const candidateLoad = document.getElementById("candidate-load");
const closeCandidatesBtn = document.getElementById("close-candidates-btn");
const openSettingsBtn = document.getElementById("open-settings-btn");
const settingsPage = document.getElementById("settings-page");
const settingAuthor = document.getElementById("setting-author");
const settingNovelName = document.getElementById("setting-novel-name");
const settingIsAuthor = document.getElementById("setting-is-author");
const saveSettingsBtn = document.getElementById("save-settings-btn");
const closeSettingsBtn = document.getElementById("close-settings-btn");
const settingsMoreBtn = document.getElementById("settings-more-btn");
const novelName = document.getElementById("novel-name");
const toggleWriteBtn = document.getElementById("toggle-write-btn");
const writeSection = document.getElementById("write-section");
const navPage = document.getElementById("nav-page");
const navCloseBtn = document.getElementById("nav-close-btn");
const navMinimathsBtn = document.getElementById("nav-minimaths-btn");
const navMiniEngBtn = document.getElementById("nav-mini-eng-btn");
const navXiaoguwenBtn = document.getElementById("nav-xiaoguwen-btn");
const navNovelBtn = document.getElementById("nav-novel-btn");

let currentSeq = 1;
let currentItem = null;
let currentItems = [];
let nextTopItem = null;
const DEVICE_KEY = "novel_device_id";
let candidateOffset = 0;
let candidateHasMore = true;
let candidateLoading = false;
const NOVEL_LOCAL_SETTINGS_KEY = "novel_local_settings";
const NOVEL_CURRENT_ID_COOKIE = "novel_current_id";
let localSettings = {
  author: "",
  novelName: "Novel",
  isAuthor: false,
};
let writeVisible = false;
let integratedLines = [];

async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }
  if (!resp.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = resp.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function updateInputPlaceholder() {
  continueInput.placeholder = "开始续写第" + currentSeq + "页";
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
  document.cookie =
    key + "=" + encodeURIComponent(value) + "; Max-Age=" + maxAge + "; Path=/; SameSite=Lax";
}

function loadLocalSettings() {
  try {
    const raw = localStorage.getItem(NOVEL_LOCAL_SETTINGS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.author === "string") localSettings.author = parsed.author.slice(0, 10);
    if (typeof parsed?.novelName === "string" && parsed.novelName.trim()) {
      localSettings.novelName = parsed.novelName.slice(0, 20);
    }
    if (typeof parsed?.isAuthor === "boolean") localSettings.isAuthor = parsed.isAuthor;
  } catch {
    // ignore invalid local settings
  }
}

function saveLocalSettings() {
  localStorage.setItem(NOVEL_LOCAL_SETTINGS_KEY, JSON.stringify(localSettings));
}

function applyLocalSettingsToView() {
  novelName.textContent = localSettings.novelName || "Novel";
  authorInput.value = localSettings.author || "";
  settingAuthor.value = localSettings.author || "";
  settingNovelName.value = localSettings.novelName || "";
  settingIsAuthor.checked = Boolean(localSettings.isAuthor);
}

function syncWriteToggle() {
  writeSection.style.display = writeVisible ? "" : "none";
  toggleWriteBtn.textContent = writeVisible ? "我不要写" : "我要续写";
}

function openSettings() {
  applyLocalSettingsToView();
  settingsPage.classList.add("is-open");
}

function closeSettings() {
  settingsPage.classList.remove("is-open");
}

function openNav() {
  navPage.classList.add("is-open");
}

function closeNav() {
  navPage.classList.remove("is-open");
}

function openJumpPopup() {
  jumpCurrentId.textContent = "当前阅读ID：" + (currentItem?.id ?? "-");
  jumpCurrentSeq.textContent = "当前页序号：" + (currentItem?.seq ?? "-");
  jumpStatus.textContent = "";
  jumpPopup.classList.add("is-open");
}

function closeJumpPopup() {
  jumpPopup.classList.remove("is-open");
}

function openIntegratePopup() {
  integratePopup.classList.add("is-open");
}

function closeIntegratePopup() {
  integratePopup.classList.remove("is-open");
}

function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = "dev_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function renderSubmissions(items) {
  currentItems = items || [];
  submissionsList.innerHTML = "";
  if (currentItems.length === 0) {
    const li = document.createElement("li");
    li.className = "submission-item";
    li.textContent = "暂无投稿";
    submissionsList.appendChild(li);
    return;
  }

  const first = currentItems[0];
  const li = document.createElement("li");
  li.className = "submission-item top";
  li.innerHTML =
    '<div class="submission-meta">#1 · 票数 ' +
    first.votes +
    " · " +
    first.author +
    '</div><button class="more-inline-btn" id="more-candidates-btn">more</button>';
  submissionsList.appendChild(li);

  const moreBtn = document.getElementById("more-candidates-btn");
  if (moreBtn) moreBtn.addEventListener("click", openCandidatesPopup);
}

function renderContent(item) {
  currentSeq = item ? Number(item.seq) : 1;
  currentItem = item;
  seqMeta.textContent = "第 " + currentSeq + " 页";
  updateInputPlaceholder();

  if (!item) {
    contentEl.textContent = "这一页还没有内容，欢迎你来续写第一条。";
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    submitBtn.disabled = true;
    return;
  }
  contentEl.textContent = item.content;
  prevBtn.disabled = !item.parentId;
  nextBtn.disabled = !nextTopItem;
  submitBtn.disabled = false;
}

function renderCandidateItems(items, append) {
  if (!append) candidateScroll.innerHTML = "";
  if (items.length === 0 && !append) {
    const empty = document.createElement("div");
    empty.className = "candidate-load";
    empty.textContent = "暂无候选内容";
    candidateScroll.appendChild(empty);
    return;
  }

  items.forEach((item, idx) => {
    const div = document.createElement("button");
    div.className = "candidate-item";
    div.style.width = "100%";
    div.style.textAlign = "left";
    div.dataset.id = String(item.id);
    div.innerHTML =
      '<div class="meta">票数 ' +
      item.votes +
      " · " +
      item.author +
      " · #" +
      (candidateOffset + idx + 1) +
      '</div><div style="line-height:1.5">' +
      item.content +
      "</div>";
    candidateScroll.appendChild(div);
  });
}

async function loadCandidatePage(reset) {
  if (!currentItem || candidateLoading) return;
  if (reset) {
    candidateOffset = 0;
    candidateHasMore = true;
  }
  if (!candidateHasMore) return;

  candidateLoading = true;
  candidateLoad.textContent = "加载中...";
  try {
    const data = await api(
      "/api/novel/candidates?parentId=" + currentItem.id + "&offset=" + candidateOffset + "&limit=20",
    );
    const items = data.items || [];
    renderCandidateItems(items, !reset);
    candidateOffset += items.length;
    candidateHasMore = Boolean(data.hasMore);
    candidateLoad.textContent = candidateHasMore ? "向下滚动加载更多" : "已加载全部";
  } catch {
    candidateLoad.textContent = "加载失败";
  } finally {
    candidateLoading = false;
  }
}

function openCandidatesPopup() {
  if (!currentItem) {
    submitStatus.textContent = "当前页暂无候选可查看";
    return;
  }
  candidatesPopup.classList.add("is-open");
  loadCandidatePage(true);
}

function closeCandidatesPopup() {
  candidatesPopup.classList.remove("is-open");
}

async function loadByQuery(query, options = {}) {
  const preserveOnNotFound = Boolean(options.preserveOnNotFound);
  const data = await api("/api/novel/content?" + query);
  if (!data.item && preserveOnNotFound) {
    return false;
  }
  nextTopItem = data.nextTopItem || null;
  renderContent(data.item || null);
  renderSubmissions(data.items || []);
  if (currentItem && currentItem.id) {
    setCookieValue(NOVEL_CURRENT_ID_COOKIE, String(currentItem.id), 365);
  }
  return Boolean(data.item);
}

function openDetail() {
  if (!currentItem) {
    submitStatus.textContent = "当前页暂无内容可查看详情";
    return;
  }
  detailId.textContent = "内容ID：" + currentItem.id;
  detailVotes.textContent = "票数：" + currentItem.votes;
  detailAuthor.textContent = "作者：" + currentItem.author;
  detailTime.textContent = "创建时间：" + currentItem.createdAt;
  shareStatus.textContent = "";
  detailPopup.classList.add("is-open");
}

function closeDetail() {
  detailPopup.classList.remove("is-open");
}

function buildShareLink() {
  if (!currentItem?.id) return "";
  const url = new URL(window.location.href);
  url.pathname = "/novel.html";
  url.search = "";
  url.searchParams.set("id", String(currentItem.id));
  return url.toString();
}

async function shareCurrent() {
  if (!currentItem?.id) return;
  const shareUrl = buildShareLink();
  if (!shareUrl) return;

  try {
    if (navigator.share) {
      await navigator.share({
        title: localSettings.novelName || "Novel",
        text: "来看看我正在创作的内容：",
        url: shareUrl,
      });
      shareStatus.textContent = "已打开分享面板";
      return;
    }
  } catch {
    // Fall through to clipboard copy.
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    shareStatus.textContent = "分享链接已复制";
  } catch {
    shareStatus.textContent = "分享链接：" + shareUrl;
  }
}

async function integrateCurrent() {
  if (!currentItem?.id) return;
  integrateStatus.textContent = "整合中...";
  integratedContent.textContent = "";
  integratedLines = [];

  try {
    const data = await api("/api/novel/integrated?id=" + currentItem.id + "&limit=100");
    const items = data.items || [];
    integratedLines = items.map((item) => item.content);
    integratedContent.textContent = integratedLines.join("\n\n");
    integrateStatus.textContent = "共整合 " + items.length + " 段内容";
    openIntegratePopup();
  } catch {
    integrateStatus.textContent = "整合失败，请稍后重试";
    openIntegratePopup();
  }
}

function downloadAsPdf() {
  if (!currentItem?.id) {
    integrateStatus.textContent = "当前内容不存在";
    return;
  }
  if (!integratedLines.length) {
    integrateStatus.textContent = "暂无可导出的内容";
    return;
  }
  const title = localSettings.novelName || "Novel";
  const url =
    "/api/novel/integrated.pdf?id=" +
    currentItem.id +
    "&limit=100&title=" +
    encodeURIComponent(title);
  integrateStatus.textContent = "正在下载PDF...";
  fetch(url)
    .then((resp) => {
      if (!resp.ok) {
        return resp
          .json()
          .then((data) => {
            throw new Error(data?.error || "PDF下载失败");
          })
          .catch(() => {
            throw new Error("PDF下载失败");
          });
      }
      return resp.blob();
    })
    .then((blob) => {
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = title + ".pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      integrateStatus.textContent = "PDF已下载";
    })
    .catch((error) => {
      integrateStatus.textContent = error?.message || "PDF下载失败，请稍后重试";
    });
}

async function likeCurrent() {
  if (!currentItem) return;
  try {
    const data = await api("/api/novel/like", {
      method: "POST",
      body: JSON.stringify({
        id: currentItem.id,
        deviceId: getOrCreateDeviceId(),
      }),
    });
    if (data.item) {
      currentItem = data.item;
      detailVotes.textContent = "票数：" + currentItem.votes;
      await loadByQuery("id=" + currentItem.id);
    }
  } catch (error) {
    if (error.status === 429) {
      const remain = Math.ceil((Number(error.payload?.retryAfterMs) || 0) / 1000);
      submitStatus.textContent = "点赞太快，请" + Math.max(1, remain) + "秒后再试";
    } else {
      submitStatus.textContent = "点赞失败，请稍后重试";
    }
  }
}

async function submitContinuation() {
  const content = continueInput.value.trim();
  const author = authorInput.value.trim();
  if (!currentItem) {
    submitStatus.textContent = "当前页没有可续写的父内容";
    return;
  }
  if (!content) {
    submitStatus.textContent = "请先输入续写内容";
    return;
  }
  if (content.length > 400) {
    submitStatus.textContent = "内容不能超过400字";
    return;
  }
  if (!author) {
    submitStatus.textContent = "请输入作者名";
    return;
  }
  if (author.length > 10) {
    submitStatus.textContent = "作者名最多10个字符";
    return;
  }

  submitBtn.disabled = true;
  try {
    await api("/api/novel/submit", {
      method: "POST",
      body: JSON.stringify({
        parentId: currentItem ? currentItem.id : null,
        content,
        author,
      }),
    });
    submitStatus.textContent = "提交成功";
    continueInput.value = "";
    textCount.textContent = "0/400";
    if (currentItem) {
      await loadByQuery("id=" + currentItem.id);
    } else {
      await loadByQuery("seq=1");
    }
  } catch {
    submitStatus.textContent = "提交失败，请稍后重试";
  } finally {
    submitBtn.disabled = false;
  }
}

continueInput.addEventListener("input", () => {
  textCount.textContent = continueInput.value.length + "/400";
});

detailBtn.addEventListener("click", openDetail);
closePopupBtn.addEventListener("click", closeDetail);
detailPopup.addEventListener("click", (e) => {
  if (e.target === detailPopup) closeDetail();
});
likeBtn.addEventListener("click", likeCurrent);
shareBtn.addEventListener("click", shareCurrent);
integrateBtn.addEventListener("click", integrateCurrent);
submitBtn.addEventListener("click", submitContinuation);
prevBtn.addEventListener("click", () => {
  if (!currentItem || !currentItem.parentId) return;
  loadByQuery("id=" + currentItem.parentId);
});
nextBtn.addEventListener("click", () => {
  if (!nextTopItem) return;
  loadByQuery("id=" + nextTopItem.id);
});
candidatesPopup.addEventListener("click", (e) => {
  if (e.target === candidatesPopup) closeCandidatesPopup();
});
closeCandidatesBtn.addEventListener("click", closeCandidatesPopup);
candidateScroll.addEventListener("scroll", () => {
  const nearBottom = candidateScroll.scrollTop + candidateScroll.clientHeight >= candidateScroll.scrollHeight - 32;
  if (nearBottom) loadCandidatePage(false);
});
candidateScroll.addEventListener("click", (event) => {
  const target = event.target;
  const btn = target instanceof HTMLElement ? target.closest(".candidate-item") : null;
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (!Number.isInteger(id)) return;
  closeCandidatesPopup();
  loadByQuery("id=" + id);
});
jumpBtn.addEventListener("click", openJumpPopup);
jumpSeqGoBtn.addEventListener("click", () => {
  const seq = Number(jumpSeqInput.value);
  if (!Number.isInteger(seq) || seq <= 0) {
    jumpStatus.textContent = "请输入正确页数";
    return;
  }
  loadByQuery("seq=" + seq, { preserveOnNotFound: true }).then((ok) => {
    if (ok) {
      jumpStatus.textContent = "";
      closeJumpPopup();
    } else {
      jumpStatus.textContent = "该内容不存在";
    }
  });
});
jumpIdGoBtn.addEventListener("click", () => {
  const id = Number(jumpIdInput.value);
  if (!Number.isInteger(id) || id <= 0) {
    jumpStatus.textContent = "请输入正确内容ID";
    return;
  }
  loadByQuery("id=" + id, { preserveOnNotFound: true }).then((ok) => {
    if (ok) {
      jumpStatus.textContent = "";
      closeJumpPopup();
    } else {
      jumpStatus.textContent = "该内容不存在";
    }
  });
});
closeJumpPopupBtn.addEventListener("click", closeJumpPopup);
jumpPopup.addEventListener("click", (e) => {
  if (e.target === jumpPopup) closeJumpPopup();
});
downloadPdfBtn.addEventListener("click", downloadAsPdf);
closeIntegratePopupBtn.addEventListener("click", closeIntegratePopup);
integratePopup.addEventListener("click", (e) => {
  if (e.target === integratePopup) closeIntegratePopup();
});

toggleWriteBtn.addEventListener("click", () => {
  writeVisible = !writeVisible;
  syncWriteToggle();
});

openSettingsBtn.addEventListener("click", openSettings);
closeSettingsBtn.addEventListener("click", closeSettings);
settingsMoreBtn.addEventListener("click", openNav);
saveSettingsBtn.addEventListener("click", () => {
  localSettings = {
    author: settingAuthor.value.trim().slice(0, 10),
    novelName: (settingNovelName.value.trim().slice(0, 20) || "Novel"),
    isAuthor: Boolean(settingIsAuthor.checked),
  };
  saveLocalSettings();
  writeVisible = localSettings.isAuthor;
  applyLocalSettingsToView();
  syncWriteToggle();
  closeSettings();
});
navCloseBtn.addEventListener("click", closeNav);
navMinimathsBtn.addEventListener("click", () => {
  window.location.href = "/";
});
navMiniEngBtn.addEventListener("click", () => {
  window.location.href = "/mini-eng.html";
});
navXiaoguwenBtn.addEventListener("click", () => {
  window.location.href = "/xiaoguwen.html";
});
navNovelBtn.addEventListener("click", () => {
  closeNav();
  closeSettings();
});

loadLocalSettings();
writeVisible = Boolean(localSettings.isAuthor);
applyLocalSettingsToView();
syncWriteToggle();
const initParams = new URLSearchParams(window.location.search);
const idFromUrl = Number(initParams.get("id"));
if (Number.isInteger(idFromUrl) && idFromUrl > 0) {
  loadByQuery("id=" + idFromUrl)
    .then(() => {
      if (!currentItem) return loadByQuery("seq=1");
      return null;
    })
    .catch(() => loadByQuery("seq=1"));
} else {
  const savedId = Number(getCookieValue(NOVEL_CURRENT_ID_COOKIE));
  if (Number.isInteger(savedId) && savedId > 0) {
    loadByQuery("id=" + savedId)
      .then(() => {
        if (!currentItem) return loadByQuery("seq=1");
        return null;
      })
      .catch(() => loadByQuery("seq=1"));
  } else {
    loadByQuery("seq=1");
  }
}
