const els = {
  urlInput: document.getElementById("url-input"),
  btnResolve: document.getElementById("btn-resolve"),
  btnHome: document.getElementById("btn-home"),
  status: document.getElementById("status"),
  imageGrid: document.getElementById("image-grid"),
  gridTitle: document.getElementById("grid-title"),
};

let busy = false;

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = `status ${kind}`.trim();
}

function setBusy(next) {
  busy = next;
  els.btnResolve.disabled = next;
  els.urlInput.disabled = next;
}

async function resolveUrl(url) {
  const res = await fetch("/api/image-dl/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "解析失败");
  return data;
}

function buildFileUrl(imageUrl, filename, { inline = false } = {}) {
  const params = new URLSearchParams({ url: imageUrl, filename });
  if (inline) params.set("inline", "1");
  return `/api/image-dl/file?${params.toString()}`;
}

function triggerDownload(imageUrl, filename) {
  const a = document.createElement("a");
  a.href = buildFileUrl(imageUrl, filename);
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function renderImageGrid(result) {
  els.imageGrid.innerHTML = "";
  const { images, defaultIndex, total } = result;

  if (!images?.length) {
    els.gridTitle.hidden = true;
    return;
  }

  els.gridTitle.hidden = false;
  els.gridTitle.textContent =
    total > 1 ? `共 ${total} 张图片，点击下载` : "1 张图片，点击下载";

  for (const item of images) {
    const card = document.createElement("article");
    card.className = "image-card";
    if (item.index === defaultIndex) card.classList.add("is-default");

    const img = document.createElement("img");
    img.src = buildFileUrl(item.imageUrl, item.filename, { inline: true });
    img.alt = `第 ${item.index} 张`;
    img.loading = "lazy";

    const meta = document.createElement("div");
    meta.className = "image-card-meta";
    meta.textContent =
      item.index === defaultIndex && total > 1
        ? `第 ${item.index} 张（链接默认）`
        : `第 ${item.index} 张`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary btn-sm";
    btn.textContent = "下载";
    btn.addEventListener("click", () => {
      triggerDownload(item.imageUrl, item.filename);
      setStatus(`正在下载：${item.filename}`, "ok");
    });

    card.append(img, meta, btn);
    els.imageGrid.appendChild(card);
  }
}

async function onResolve() {
  const url = els.urlInput.value.trim();
  if (!url || busy) return;

  setBusy(true);
  setStatus("正在解析链接…");
  els.imageGrid.innerHTML = "";
  els.gridTitle.hidden = true;

  try {
    const result = await resolveUrl(url);
    renderImageGrid(result);
    if (result.total === 0) {
      setStatus(result.hint || "未找到可下载的公开图片", "");
    } else {
      setStatus(`解析成功，共 ${result.total} 张图片`, "ok");
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "解析失败", "err");
  } finally {
    setBusy(false);
  }
}

els.btnResolve.addEventListener("click", () => {
  void onResolve();
});

els.urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void onResolve();
});

els.btnHome.addEventListener("click", () => {
  window.location.href = "/";
});
