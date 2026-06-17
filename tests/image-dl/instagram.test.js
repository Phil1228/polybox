import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAllowedCdnUrl,
  extractInstagramImageUrls,
  normalizeCdnUrl,
  parseInstagramPageUrl,
  pickImageByIndex,
  resolveInstagramImage,
  resolveInstagramImages,
} from "../../shared/image-dl.mjs";

const IMG1 =
  "https://scontent-hkg1-2.cdninstagram.com/v/t51.82787-15/722163199_18593174398049130_6391871391645089031_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=1";
const IMG2 =
  "https://scontent-hkg4-2.cdninstagram.com/v/t51.82787-15/823163199_18593174398049130_7391871391645089032_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=2";
const IMG3 =
  "https://scontent-hkg4-2.cdninstagram.com/v/t51.82787-15/924163199_18593174398049130_8391871391645089033_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=3";

describe("normalizeCdnUrl", () => {
  it("unescapes json display_uri to https url", () => {
    const raw =
      "https:\\/\\/scontent-hkg1-2.cdninstagram.com\\/v\\/t51.82787-15\\/722163199_18593174398049130_6391871391645089031_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=102";
    const url = normalizeCdnUrl(raw);
    assert.equal(
      url,
      "https://scontent-hkg1-2.cdninstagram.com/v/t51.82787-15/722163199_18593174398049130_6391871391645089031_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=102",
    );
  });
});

describe("parseInstagramPageUrl", () => {
  it("parses post url and img_index", () => {
    const parsed = parseInstagramPageUrl(
      "https://www.instagram.com/p/DZpRorVEv4T/?igsh=abc&img_index=2",
    );
    assert.equal(parsed.shortcode, "DZpRorVEv4T");
    assert.equal(parsed.imgIndex, 2);
    assert.ok(parsed.normalizedUrl.includes("/p/DZpRorVEv4T/"));
    assert.ok(!parsed.normalizedUrl.includes("img_index"));
  });

  it("defaults img_index to 1", () => {
    const parsed = parseInstagramPageUrl("https://instagram.com/reel/AbCdEf/");
    assert.equal(parsed.imgIndex, 1);
    assert.equal(parsed.shortcode, "AbCdEf");
  });

  it("rejects non-instagram urls", () => {
    assert.throws(() => parseInstagramPageUrl("https://example.com/p/abc/"), /Instagram/);
  });
});

describe("extractInstagramImageUrls", () => {
  it("extracts display_uri from json payload", () => {
    const html = `"display_uri": "https:\\/\\/scontent-hkg1-2.cdninstagram.com\\/v\\/t51.82787-15\\/722163199_18593174398049130_6391871391645089031_n.jpg?stp=dst-jpg_e35_s640x640_tt6&_nc_cat=102&oe=6A37B345"`;
    const urls = extractInstagramImageUrls(html);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].startsWith("https://scontent-hkg1-2.cdninstagram.com/"));
    assert.ok(urls[0].includes("722163199_18593174398049130_6391871391645089031_n.jpg"));
  });

  it("extracts multiple display_uri in order", () => {
    const html = `
      "display_uri": "https:\\/\\/scontent-hkg1-2.cdninstagram.com\\/v\\/t51.82787-15\\/722163199_18593174398049130_6391871391645089031_n.jpg?stp=dst-jpg_e35_tt6"
      "display_uri": "https:\\/\\/scontent-hkg4-2.cdninstagram.com\\/v\\/t51.82787-15\\/823163199_18593174398049130_7391871391645089032_n.jpg?stp=dst-jpg_e35_tt6"
    `;
    const urls = extractInstagramImageUrls(html);
    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes("722163199"));
    assert.ok(urls[1].includes("823163199"));
  });

  it("accepts display_url as alias", () => {
    const html = `"display_url":"${IMG2}"`;
    const urls = extractInstagramImageUrls(html);
    assert.deepEqual(urls, [IMG2]);
  });

  it("dedupes same media id", () => {
    const html = `"display_uri":"${IMG1}" "display_uri":"${IMG1}"`;
    const urls = extractInstagramImageUrls(html);
    assert.equal(urls.length, 1);
    assert.equal(urls[0], IMG1);
  });

  it("ignores bare urls without display_uri field", () => {
    const html = `noise ${IMG1} ${IMG3}`;
    const urls = extractInstagramImageUrls(html);
    assert.deepEqual(urls, []);
  });

  it("extracts escaped display_url from embed payload", () => {
    const html = `"display_url\\":\\"https:\\\\\\/\\\\\\/scontent-hkg1-2.cdninstagram.com\\\\\\/v\\\\\\/t51.82787-15\\\\\\/722163199_18593174398049130_6391871391645089031_n.jpg?stp=dst-jpg_e35_tt6\\"`;
    const urls = extractInstagramImageUrls(html);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].includes("722163199"));
    assert.ok(urls[0].startsWith("https://"));
  });
});

describe("pickImageByIndex", () => {
  it("selects nth image", () => {
    const picked = pickImageByIndex([IMG1, IMG2, IMG3], 2);
    assert.equal(picked.imageUrl, IMG2);
    assert.equal(picked.total, 3);
  });

  it("returns empty when no urls", () => {
    const picked = pickImageByIndex([], 2);
    assert.equal(picked.imageUrl, null);
    assert.equal(picked.total, 0);
  });

  it("clamps when index out of range", () => {
    const picked = pickImageByIndex([IMG1], 5);
    assert.equal(picked.imageUrl, IMG1);
  });
});

describe("resolveInstagramImage", () => {
  it("resolves carousel with img_index", async () => {
    const carouselHtml = `
      "display_uri":"${IMG1}"
      "display_uri":"${IMG2}"
    `;
    const result = await resolveInstagramImage(
      "https://www.instagram.com/p/DZpRorVEv4T/?img_index=2",
      { fetchHtml: async () => carouselHtml },
    );
    assert.equal(result.imageUrl, IMG2);
    assert.equal(result.imgIndex, 2);
    assert.equal(result.total, 2);
    assert.equal(result.filename, "instagram-DZpRorVEv4T-2.jpg");
  });
});

describe("resolveInstagramImages", () => {
  it("returns all carousel images", async () => {
    const carouselHtml = `
      "display_uri":"${IMG1}"
      "display_uri":"${IMG2}"
      "display_uri":"${IMG3}"
    `;
    const result = await resolveInstagramImages(
      "https://www.instagram.com/p/DZpRorVEv4T/?img_index=2",
      { fetchHtml: async () => carouselHtml },
    );
    assert.equal(result.total, 3);
    assert.equal(result.defaultIndex, 2);
    assert.equal(result.images[1].imageUrl, IMG2);
  });

  it("returns empty hint for login page without throwing", async () => {
    const loginHtml = `<a href="https://www.instagram.com/accounts/login/">Log in</a>`;
    const result = await resolveInstagramImages(
      "https://www.instagram.com/p/AbCdEf/",
      {
        fetchHtml: async () => loginHtml,
        fetch: async () => ({ ok: false, status: 404, text: async () => "" }),
      },
    );
    assert.equal(result.total, 0);
    assert.ok(result.hint.includes("云端"));
    assert.equal(result.images.length, 0);
  });

  it("falls back to media redirect when display_uri missing", async () => {
    const mediaUrl =
      "https://instagram.fhkg2-1.fna.fbcdn.net/v/t51.82787-15/723162271_18593174404049130_6804782840679651555_n.jpg?stp=dst-jpg_e35_tt6";
    const result = await resolveInstagramImages("https://www.instagram.com/p/DZpRorVEv4T/", {
      fetchHtml: async () => "",
      fetch: async (url, init) => {
        if (String(url).includes("/media/?size=l")) {
          return {
            status: 302,
            headers: { get: (k) => (k === "location" ? mediaUrl : null) },
          };
        }
        return { ok: false, status: 404, text: async () => "" };
      },
    });
    assert.equal(result.total, 1);
    assert.equal(result.images[0].imageUrl, mediaUrl);
  });

  it("fetches embed page first, then main page as fallback", async () => {
    const fetched = [];
    const result = await resolveInstagramImages("https://www.instagram.com/p/AbCdEf/?img_index=2", {
      fetchHtml: async (url) => {
        fetched.push(url);
        if (url.includes("/embed/")) return "";
        return `"display_uri":"${IMG1}"`;
      },
    });
    assert.equal(fetched.length, 2);
    assert.ok(fetched[0].includes("/embed/captioned/"));
    assert.ok(fetched[1].includes("/p/AbCdEf/"));
    assert.equal(result.total, 1);
  });
});

describe("assertAllowedCdnUrl", () => {
  it("allows instagram cdn", () => {
    assert.equal(assertAllowedCdnUrl(IMG1), IMG1);
  });

  it("allows fbcdn image hosts", () => {
    const fbcdn =
      "https://instagram.fhkg2-1.fna.fbcdn.net/v/t51.82787-15/723162271_18593174404049130_6804782840679651555_n.jpg?stp=dst-jpg_e35_tt6";
    assert.equal(assertAllowedCdnUrl(fbcdn), fbcdn);
  });

  it("blocks other hosts", () => {
    assert.throws(() => assertAllowedCdnUrl("https://example.com/a.jpg"), /不允许/);
  });
});
