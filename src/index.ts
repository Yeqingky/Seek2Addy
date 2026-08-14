/**
 * Worker 入口：路由分发 + CORS + 全局错误处理。
 * 零状态纯函数，无 KV/D1（AGENTS.md §2）。
 */

import { handleCreateAlias } from "./routes/aliases";
import { CORS_HEADERS } from "./cors";
import type { Env, ErrorResponse } from "./types";

/** 所有响应统一带 CORS 头（Response 构造后再 set 无效，必须构造时传入） */
function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS 预检（Bitwarden Web Vault 浏览器直连）
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // 路由：目前只有 Addy.io 创建端点
      if (request.method === "POST" && url.pathname === "/api/v1/aliases") {
        return await handleCreateAlias(request, env);
      }
      return json({ error: { code: "NOT_FOUND", message: "Not Found" } } satisfies ErrorResponse, 404);
    } catch (e) {
      // 全局兜底：不向调用方泄露内部细节
      console.error("[Seek2Addy] unhandled error:", e);
      return json({ error: { code: "INTERNAL", message: "Internal Server Error" } } satisfies ErrorResponse, 500);
    }
  },
};
