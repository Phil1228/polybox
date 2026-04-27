import { createClient } from "@libsql/client";

let _client = null;

/**
 * 懒创建 Turso client：避免在未设置环境变量时，模块一加载就抛错导致整个 server 起不来。
 */
export function getTursoClient() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error("Turso 未配置：需要 TURSO_DATABASE_URL 和 TURSO_AUTH_TOKEN。");
  }
  if (_client) return _client;
  _client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return _client;
}

