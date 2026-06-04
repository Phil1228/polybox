(() => {
  const cfg = window.SITE_CONFIG || {};
  const gaId = String(cfg.gaMeasurementId || "").trim();
  const baiduId = String(cfg.baiduTongjiId || "").trim();

  if (gaId) {
    const g = document.createElement("script");
    g.async = true;
    g.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    document.head.appendChild(g);
    window.dataLayer = window.dataLayer || [];
    function gtag() {
      window.dataLayer.push(arguments);
    }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", gaId, { anonymize_ip: true });
  }

  if (baiduId) {
    window._hmt = window._hmt || [];
    const h = document.createElement("script");
    h.async = true;
    h.src = `https://hm.baidu.com/hm.js?${encodeURIComponent(baiduId)}`;
    document.head.appendChild(h);
  }
})();
