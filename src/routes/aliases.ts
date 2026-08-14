/**
 * POST /api/v1/aliases —— Addy.io 兼容端点（核心链路）。
 * 入站 Addy.io 协议 → 出站 seek.li 建邮箱 → 翻译响应。
 */

import { buildAddress, isValidDomain, randomPrefix } from "../core/address";
import { MAX_RETRY, SeekliError, UpstreamError, createSeekliClient } from "../core/seekli";
import { CORS_HEADERS } from "../cors";
import {
  CONFLICT_RESPONSE,
  TIMEOUT_RESPONSE,
  mailboxToAddyIo,
  upstreamErrorToResponse,
} from "../core/translate";
import { extractBearerToken, verifyToken } from "../security/token-guard";
import type { AddyIoCreateRequest, Env, ErrorResponse } from "../types";

/** "地址已存在/不可用"类错误的关键词（seek.li 错误 message 为中文，含英文兜底） */
const CONFLICT_RE = /已存在|已被|占用|重复|不可用|already|exists|taken|unavailable/i;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function errorResponse(code: string, message: string, status: number): Response {
  return json({ error: { code, message } } satisfies ErrorResponse, status);
}

export async function handleCreateAlias(request: Request, env: Env): Promise<Response> {
  // ① 校验 AUTH_TOKEN：失败统一 401，不暴露细节
  const token = extractBearerToken(request.headers.get("Authorization"));
  const ok = await verifyToken(token, env.AUTH_TOKEN);
  if (!ok) return errorResponse("UNAUTHORIZED", "Unauthorized", 401);

  // ② 解析请求体
  let body: AddyIoCreateRequest;
  try {
    body = (await request.json()) as AddyIoCreateRequest;
  } catch {
    return errorResponse("BAD_REQUEST", "请求体不是合法 JSON", 400);
  }
  if (typeof body.domain !== "string") {
    return errorResponse("BAD_REQUEST", "缺少必填字段 domain", 400);
  }
  const domain = body.domain.trim();
  if (!isValidDomain(domain)) {
    return errorResponse("BAD_REQUEST", "domain 不是合法域名", 400);
  }

  const client = createSeekliClient(env.SEEKLI_API_KEY);

  // ③ 生成地址并创建，冲突换前缀重试 ≤ MAX_RETRY 次
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const address = buildAddress(randomPrefix(), domain);
    if (!address) {
      return errorResponse("BAD_REQUEST", `domain 过长（完整地址须 ≤ 64 字符）`, 400);
    }

    // 预检只是优化（减少冲突概率），预检自身失败不应阻断创建流程
    try {
      const available = await client.check(address);
      if (!available) continue;
    } catch {
      /* 预检失败 → 直接尝试 create */
    }

    try {
      const mailbox = await client.create(address);
      return json(mailboxToAddyIo(mailbox), 200);
    } catch (e) {
      if (e instanceof SeekliError) {
        if (e.status === 400 && CONFLICT_RE.test(e.message)) continue; // 换前缀重试
        const mapped = upstreamErrorToResponse(e.status, e.code, e.message);
        return errorResponse(mapped.code, mapped.message, mapped.status);
      }
      if (e instanceof UpstreamError) {
        return errorResponse(TIMEOUT_RESPONSE.code, TIMEOUT_RESPONSE.message, TIMEOUT_RESPONSE.status);
      }
      throw e; // 未知异常交给全局兜底（500）
    }
  }

  return errorResponse(CONFLICT_RESPONSE.code, CONFLICT_RESPONSE.message, CONFLICT_RESPONSE.status);
}
