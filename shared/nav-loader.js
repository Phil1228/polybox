(function () {
  const script = document.currentScript;
  if (!script) return;
  const variant = script.dataset.navVariant || "index";

  const templates = {
    index: `
<section class="nav-page" id="nav-page">
  <div class="nav-header">
    <h2 class="nav-title">导航</h2>
    <button class="nav-user-btn" id="nav-user" aria-label="用户中心">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="4"></circle>
        <path d="M4 20c0-4 4-6 8-6s8 2 8 6"></path>
      </svg>
    </button>
  </div>
  <div class="nav-actions">
    <button class="nav-button" id="nav-minimaths">minimaths</button>
    <button class="nav-button" id="nav-square-cube">平方立方练习</button>
    <button class="nav-button" id="nav-mini-eng">miniEng</button>
    <button class="nav-button" id="nav-xiaoguwen">小古文</button>
    <button class="nav-button" id="nav-novel">novel</button>
    <button class="nav-button" id="nav-speed">加工速度</button>
    <button class="nav-button" id="nav-dungeon">迷宫寻宝</button>
    <button class="nav-button" id="nav-uno">UNO 四人对战</button>
    <button class="nav-button" id="nav-recharge">充值</button>
  </div>
  <div class="settings-actions">
    <button class="settings-action" id="nav-close">返回</button>
  </div>
</section>`,
    app: `
<section class="nav-page" id="nav-page">
  <div class="nav-header">
    <h2 class="header-title">导航</h2>
    <button class="btn nav-user-btn" id="nav-user-btn" aria-label="用户中心">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="4"></circle>
        <path d="M4 20c0-4 4-6 8-6s8 2 8 6"></path>
      </svg>
    </button>
  </div>
  <div class="nav-actions">
    <button class="btn nav-button" id="nav-minimaths-btn">minimaths</button>
    <button class="btn nav-button" id="nav-square-cube-btn">平方立方练习</button>
    <button class="btn nav-button" id="nav-mini-eng-btn">miniEng</button>
    <button class="btn nav-button" id="nav-xiaoguwen-btn">小古文</button>
    <button class="btn nav-button" id="nav-novel-btn">novel</button>
    <button class="btn nav-button" id="nav-speed-btn">加工速度</button>
    <button class="btn nav-button" id="nav-dungeon-btn">迷宫寻宝</button>
    <button class="btn nav-button" id="nav-uno-btn">UNO 四人对战</button>
    <button class="btn nav-button" id="nav-recharge-btn">充值</button>
  </div>
  <button class="btn" id="nav-close-btn">返回</button>
</section>`,
    novel: `
<section class="nav-page" id="nav-page">
  <div class="nav-header">
    <h2 class="settings-title">导航</h2>
    <button class="btn nav-user-btn" id="nav-user-btn" aria-label="用户中心">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="4"></circle>
        <path d="M4 20c0-4 4-6 8-6s8 2 8 6"></path>
      </svg>
    </button>
  </div>
  <div class="nav-actions">
    <button class="btn nav-button" id="nav-minimaths-btn">minimaths</button>
    <button class="btn nav-button" id="nav-square-cube-btn">平方立方练习</button>
    <button class="btn nav-button" id="nav-mini-eng-btn">miniEng</button>
    <button class="btn nav-button" id="nav-xiaoguwen-btn">小古文</button>
    <button class="btn nav-button" id="nav-novel-btn">novel</button>
    <button class="btn nav-button" id="nav-speed-btn">加工速度</button>
    <button class="btn nav-button" id="nav-dungeon-btn">迷宫寻宝</button>
    <button class="btn nav-button" id="nav-uno-btn">UNO 四人对战</button>
    <button class="btn nav-button" id="nav-recharge-btn">充值</button>
  </div>
  <button class="btn" id="nav-close-btn">返回</button>
</section>`,
  };

  script.insertAdjacentHTML("beforebegin", templates[variant] || templates.index);
  const squareCubeBtn = document.getElementById("nav-square-cube");
  if (squareCubeBtn) {
    squareCubeBtn.addEventListener("click", () => {
      window.location.href = "/square-cube.html";
    });
  }
  const squareCubeBtnAlt = document.getElementById("nav-square-cube-btn");
  if (squareCubeBtnAlt) {
    squareCubeBtnAlt.addEventListener("click", () => {
      window.location.href = "/square-cube.html";
    });
  }
  for (const id of ["nav-uno", "nav-uno-btn"]) {
    const unoBtn = document.getElementById(id);
    if (unoBtn) {
      unoBtn.addEventListener("click", () => {
        window.location.href = "/uno.html";
      });
    }
  }
})();
