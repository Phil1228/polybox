const INSTAGRAM_PAGE_RE =
  /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/i;

const CDN_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:cdninstagram\.com|fbcdn\.net)$/i;

/** display_uri / display_url（同义字段）在 JSON 里的常见写法 */
const DISPLAY_URI_RES = [
  /"display_uri"\s*:\s*"((?:\\.|[^"\\])*)"/g,
  /"display_url"\s*:\s*"((?:\\.|[^"\\])*)"/g,
  /display_uri\\":\\"((?:\\.|[^"\\])*?)\\"/g,
  /display_url\\":\\"((?:\\.|[^"\\])*?)\\"/g,
];

const FETCH_UAS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0",
  "Instagram 219.0.0.12.117 Android",
];

const DOWNLOAD_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * @param {string} rawUrl
 */
export function parseInstagramPageUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) throw new Error("请输入 Instagram 链接");

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("链接格式无效");
  }

  if (parsed.protocol !== "https:") throw new Error("仅支持 https 链接");
  if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) {
    throw new Error("仅支持 Instagram 帖子或 Reels 链接");
  }

  const match = parsed.href.match(INSTAGRAM_PAGE_RE);
  if (!match) throw new Error("仅支持 instagram.com/p/ 或 instagram.com/reel/ 链接");

  const imgIndexRaw = parsed.searchParams.get("img_index");
  let imgIndex = 1;
  if (imgIndexRaw != null && imgIndexRaw !== "") {
    imgIndex = Number(imgIndexRaw);
    if (!Number.isInteger(imgIndex) || imgIndex < 1) {
      throw new Error("img_index 必须是大于 0 的整数");
    }
  }

  parsed.searchParams.delete("img_index");
  parsed.hash = "";
  const normalizedUrl = parsed.toString().replace(/\/$/, "") + "/";

  return {
    shortcode: match[1],
    imgIndex,
    normalizedUrl,
  };
}

/**
 * 将 JSON 里的 display_uri 反转义为可访问的 https URL。
 * @param {string} url
 */
export function normalizeCdnUrl(url) {
  return String(url)
    .replace(/\\u0026/gi, "&")
    .replace(/\\u00253D/gi, "=")
    .replace(/\\u00253d/gi, "=")
    .replace(/\\=/g, "=")
    .replace(/\\\\\//g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\\"/g, "")
    .trim();
}

/**
 * @param {string} url
 */
function isCdnImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (!CDN_HOST_RE.test(parsed.hostname)) return false;
    return /\.(?:jpg|jpeg|webp)(?:\?|$)/i.test(parsed.pathname + parsed.search);
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 */
function mediaKey(url) {
  const named = url.match(/\/(\d+_\d+_\d+_(?:n|s))\.(?:jpg|jpeg|webp)/i);
  if (named) return named[1].replace(/_(n|s)$/i, "");
  return url;
}

/**
 * 从 response 提取 display_uri（及同义 display_url），反转义后去重。
 * @param {string} responseText
 * @returns {string[]}
 */
export function extractInstagramImageUrls(responseText) {
  /** @type {Map<string, { url: string, order: number }>} */
  const byMedia = new Map();
  let seq = 0;

  for (const re of DISPLAY_URI_RES) {
    re.lastIndex = 0;
    for (const m of responseText.matchAll(re)) {
      const url = normalizeCdnUrl(m[1]);
      if (!url || !isCdnImageUrl(url)) continue;

      seq += 1;
      const key = mediaKey(url);
      if (!byMedia.has(key)) {
        byMedia.set(key, { url, order: seq });
      }
    }
  }

  return [...byMedia.values()]
    .sort((a, b) => a.order - b.order)
    .map((item) => item.url);
}

/**
 * @param {string[]} urls
 * @param {number} imgIndex
 */
export function pickImageByIndex(urls, imgIndex) {
  if (!urls.length) return { imageUrl: null, total: 0 };
  if (imgIndex > urls.length) {
    return { imageUrl: urls[0], total: urls.length };
  }
  return { imageUrl: urls[imgIndex - 1], total: urls.length };
}

/**
 * @param {string} shortcode
 * @param {number} index
 * @param {string} imageUrl
 */
export function imageFilename(shortcode, index, imageUrl) {
  const extMatch = imageUrl.match(/\.(jpg|jpeg|webp)(?:\?|$)/i);
  const ext = extMatch ? extMatch[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
  return `instagram-${shortcode}-${index}.${ext}`;
}

/**
 * @param {string} normalizedUrl
 * @param {number} imgIndex
 */
function embedPageUrl(normalizedUrl, imgIndex) {
  const base = normalizedUrl.replace(/\/?$/, "/");
  const params = imgIndex > 1 ? `?img_index=${imgIndex}` : "";
  return `${base}embed/captioned/${params}`;
}

const CLOUD_EMPTY_HINT =
  "未找到可下载的公开图片。私密帖会跳过。若本地可用、线上不行，通常是 Instagram 拦截了云端服务器 IP（Vercel/AWS 等）；可在本地运行 node server.mjs，或在 Vercel 将函数区域设为香港/新加坡后重试。";

/**
 * 依次尝试多种爬虫 UA，返回含 display_uri 最多的 HTML。
 * @param {string} pageUrl
 * @param {{ fetch?: typeof fetch, userAgents?: string[] }} [deps]
 */
export async function fetchInstagramHtml(pageUrl, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const userAgents = deps.userAgents || FETCH_UAS;
  let bestHtml = "";
  let bestCount = -1;

  for (const userAgent of userAgents) {
    try {
      const res = await doFetch(pageUrl, {
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();
      const count = extractInstagramImageUrls(html).length;
      if (count > bestCount) {
        bestCount = count;
        bestHtml = html;
        if (count > 0) break;
      }
    } catch {
      // try next UA
    }
  }

  return bestHtml;
}

/**
 * 兜底：/media/?size=l 302 到 CDN 直链（通常只有首图）。
 * @param {string} shortcode
 * @param {{ fetch?: typeof fetch, userAgents?: string[] }} [deps]
 */
export async function fetchMediaImageUrl(shortcode, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const userAgents = deps.userAgents || FETCH_UAS;
  const pageUrl = `https://www.instagram.com/p/${shortcode}/media/?size=l`;

  for (const userAgent of userAgents) {
    try {
      const res = await doFetch(pageUrl, {
        headers: {
          "User-Agent": userAgent,
          Accept: "*/*",
          Referer: "https://www.instagram.com/",
        },
        redirect: "manual",
      });
      if (res.status < 300 || res.status >= 400) continue;
      const location = res.headers.get("location");
      if (location && isCdnImageUrl(location)) return location;
    } catch {
      // try next UA
    }
  }

  return null;
}

/**
 * @param {string} pageUrl
 * @param {{ fetchHtml?: (url: string) => Promise<string> }} [deps]
 */
export async function resolveInstagramImages(pageUrl, deps = {}) {
  const { shortcode, imgIndex, normalizedUrl } = parseInstagramPageUrl(pageUrl);
  const fetchOpts = {
    fetch: deps.fetch,
    userAgents: deps.userAgents,
  };
  const fetchHtml =
    deps.fetchHtml ||
    ((url) => fetchInstagramHtml(url, fetchOpts));

  const embedHtml = await fetchHtml(embedPageUrl(normalizedUrl, imgIndex));
  let urls = embedHtml ? extractInstagramImageUrls(embedHtml) : [];

  if (!urls.length) {
    const mainHtml = await fetchHtml(normalizedUrl);
    urls = mainHtml ? extractInstagramImageUrls(mainHtml) : [];
  }

  if (!urls.length) {
    const mediaUrl = await fetchMediaImageUrl(shortcode, fetchOpts);
    if (mediaUrl) urls = [mediaUrl];
  }

  const images = urls.map((imageUrl, i) => ({
    index: i + 1,
    imageUrl,
    filename: imageFilename(shortcode, i + 1, imageUrl),
  }));

  const defaultIndex = imgIndex > images.length ? 1 : imgIndex;
  const hint = images.length === 0 ? CLOUD_EMPTY_HINT : "";

  return {
    shortcode,
    total: images.length,
    defaultIndex,
    images,
    hint,
  };
}

/**
 * @param {string} pageUrl
 * @param {{ fetchHtml?: (url: string) => Promise<string> }} [deps]
 */
export async function resolveInstagramImage(pageUrl, deps = {}) {
  const { imgIndex } = parseInstagramPageUrl(pageUrl);
  const result = await resolveInstagramImages(pageUrl, deps);
  const picked = result.images[imgIndex - 1] || result.images[0] || null;
  return {
    ...result,
    imageUrl: picked?.imageUrl || null,
    filename: picked?.filename || null,
    imgIndex: picked ? imgIndex : 0,
  };
}

/**
 * @param {string} imageUrl
 */
export function assertAllowedCdnUrl(imageUrl) {
  let parsed;
  try {
    parsed = new URL(String(imageUrl || "").trim());
  } catch {
    throw new Error("图片链接无效");
  }
  if (parsed.protocol !== "https:") throw new Error("图片链接无效");
  if (!CDN_HOST_RE.test(parsed.hostname)) throw new Error("不允许的图片来源");
  return parsed.toString();
}

/**
 * @param {string} imageUrl
 * @param {string} [filename]
 * @param {{ fetchBinary?: (url: string) => Promise<Response> }} [deps]
 */
export async function proxyInstagramImage(imageUrl, filename = "instagram.jpg", deps = {}) {
  const safeUrl = assertAllowedCdnUrl(imageUrl);
  const fetchBinary =
    deps.fetchBinary ||
    ((url) =>
      fetch(url, {
        headers: { "User-Agent": DOWNLOAD_UA, Referer: "https://www.instagram.com/" },
        redirect: "follow",
      }));

  const res = await fetchBinary(safeUrl);
  if (!res.ok) throw new Error("下载图片失败，请重新解析后再试");

  const contentType = res.headers.get("content-type") || "image/jpeg";
  const safeName = String(filename || "instagram.jpg").replace(/[^\w.\-]+/g, "_");

  return {
    body: res.body,
    contentType,
    filename: safeName,
  };
}
