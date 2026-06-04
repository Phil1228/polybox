(() => {
  const cfg = window.SITE_CONFIG || {};
  const blurb = document.body?.dataset?.seoBlurb || "";
  if (!blurb) return;

  // Product app pages use `body { display: flex }` for centering; injecting a
  // footer sibling breaks mobile/desktop layout. Keep blurb in data-seo-blurb
  // for meta/JSON-LD only; skip visible footer.
  if (document.body.dataset.seoBlurb) return;

  const footer = document.createElement("footer");
  footer.className = "site-seo-footer";
  const home = (cfg.origin || "").replace(/\/$/, "") + "/";
  footer.innerHTML = `<p>${blurb}</p><a href="${home}">返回 POLYBOX 首页</a>`;
  document.body.appendChild(footer);
})();
