(() => {
  const cfg = window.SITE_CONFIG || {};
  const blurb = document.body?.dataset?.seoBlurb || "";
  if (!blurb) return;

  const footer = document.createElement("footer");
  footer.className = "site-seo-footer";
  const home = (cfg.origin || "").replace(/\/$/, "") + "/";
  footer.innerHTML = `<p>${blurb}</p><a href="${home}">返回 POLYBOX 首页</a>`;
  document.body.appendChild(footer);
})();
