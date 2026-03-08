const backBtn = document.getElementById("back-btn");
const checkoutBtn = document.getElementById("checkout-btn");
const statusEl = document.getElementById("status");
const amountBtns = Array.from(document.querySelectorAll(".amount-btn"));

let selectedAmount = 6;

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.classList.remove("error", "success");
  if (type) statusEl.classList.add(type);
}

function setActiveAmount(amount) {
  selectedAmount = amount;
  amountBtns.forEach((btn) => {
    const value = Number(btn.dataset.amount);
    btn.classList.toggle("active", value === amount);
  });
}

amountBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const amount = Number(btn.dataset.amount);
    if (!Number.isInteger(amount) || amount <= 0) return;
    setActiveAmount(amount);
  });
});

backBtn.addEventListener("click", () => {
  window.history.length > 1 ? window.history.back() : (window.location.href = "/minimaths.html");
});

checkoutBtn.addEventListener("click", async () => {
  checkoutBtn.disabled = true;
  setStatus("正在创建支付会话...");
  try {
    const response = await fetch("/api/billing/checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountYuan: selectedAmount,
        origin: window.location.origin,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.url) {
      throw new Error(data?.error || "创建支付会话失败");
    }
    window.location.href = data.url;
  } catch (error) {
    setStatus(error.message || "支付请求失败，请稍后重试", "error");
    checkoutBtn.disabled = false;
  }
});

const query = new URLSearchParams(window.location.search);
if (query.get("status") === "success") {
  setStatus("支付完成（测试模式）。", "success");
} else if (query.get("status") === "cancel") {
  setStatus("你已取消本次支付。");
}
