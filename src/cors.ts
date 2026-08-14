/**
 * CORS 配置：Bitwarden Web Vault 浏览器直连必须（AGENTS.md 已知坑 #2）。
 * token 走 Authorization 头不走 cookie，故 Allow-Origin: * 安全。
 * 注意：Response 构造后再改 headers 无效（immutable guard），必须构造时传入。
 */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;
