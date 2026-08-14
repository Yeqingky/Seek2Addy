/**
 * 响应/错误翻译器（Mailbox → Addy.io 格式）。
 * 协议中立层：新协议入口只需新增翻译器，不改 seek.li 客户端（ARCHITECTURE §6.3）。
 */

import type { AddyIoSuccessResponse, SeekliMailbox } from "../types";

/** seek.li Mailbox → Addy.io 成功响应（必须保留 data 包装，见 AGENTS.md 已知坑 #1） */
export function mailboxToAddyIo(mailbox: SeekliMailbox): AddyIoSuccessResponse {
  return { data: { email: mailbox.address } };
}

/**
 * 出站错误 → 入站错误映射（DESIGN §3.3）：
 * - seek.li 业务错误（401/400/429...）：状态码透传，error.message 原样透传
 * - 出站 5xx：包装为 502（seek.li 服务端问题）
 * - 上游网络错误/超时：504（可重试）
 */
export function upstreamErrorToResponse(
  status: number,
  code: string,
  message: string,
): { status: number; code: string; message: string } {
  if (status >= 500) return { status: 502, code: "UPSTREAM_ERROR", message: `seek.li 服务端错误: ${message}` };
  return { status, code, message };
}

/** 冲突重试耗尽（DESIGN §4：换前缀重试 ≤3 次仍失败）→ 409 */
export const CONFLICT_RESPONSE = {
  status: 409,
  code: "CONFLICT",
  message: "地址创建冲突，重试后仍失败",
} as const;

/** 出站超时/网络失败 → 504 */
export const TIMEOUT_RESPONSE = {
  status: 504,
  code: "UPSTREAM_TIMEOUT",
  message: "seek.li 请求超时或网络不可达，请稍后重试",
} as const;
