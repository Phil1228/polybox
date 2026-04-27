import { handleRequest } from "../server.mjs";

export default async function handler(req, res) {
  // Vercel rewrites change req.url to the destination (e.g. /api/index).
  // Restore the original URL so our router can match on it.
  const originalUrl =
    (req.headers && (req.headers["x-vercel-original-url"] || req.headers["x-now-original-url"])) ||
    null;
  if (typeof originalUrl === "string" && originalUrl.startsWith("/")) {
    req.url = originalUrl;
  }

  // Normalize trailing slashes for routes like /square-cube.html/
  if (typeof req.url === "string") {
    const u = req.url;
    const qIndex = u.indexOf("?");
    const path = qIndex === -1 ? u : u.slice(0, qIndex);
    const query = qIndex === -1 ? "" : u.slice(qIndex);
    if (path.length > 1 && path.endsWith("/")) {
      req.url = path.slice(0, -1) + query;
    }
  }
  return handleRequest(req, res);
}

