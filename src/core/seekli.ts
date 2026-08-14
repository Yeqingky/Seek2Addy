/**
 * seek.li 客户端（NodeSeek Mail API）：check 预检 / create 建邮箱。
 * 出站基址 https://seek.li/openapi/v1（WAF 放行，见 AGENTS.md 已知坑 #4）。
 */

import type { SeekliCheckResponse, SeekliCreateRequest, SeekliErrorBody, SeekliMailbox } from "../types";

export const SEEKLI_BASE_URL = "https://seek.li/openapi/v1";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_RETRY = 3;

/** seek.li 返回的业务错误：status + code 透传入站侧 */
export class SeekliError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "SeekliError";
    this.status = status;
    this.code = code;
  }
}

/** 出站请求超时/网络失败（非 seek.li 业务响应） */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** 解析错误响应体，尽力提取 code/message（结构不完整时兜底） */
function parseErrorBody(body: unknown, status: number): SeekliError {
  const err = (body as SeekliErrorBody | undefined)?.error;
  const code = typeof err?.code === "string" ? err.code : `HTTP_${status}`;
  const message = typeof err?.message === "string" ? err.message : `seek.li 请求失败（HTTP ${status}）`;
  return new SeekliError(status, code, message);
}

export interface SeekliClient {
  /** 预检地址可用性（"available": true 表示可创建） */
  check(address: string): Promise<boolean>;
  /** 创建邮箱，成功返回 Mailbox */
  create(address: string): Promise<SeekliMailbox>;
}

export function createSeekliClient(
  apiKey: string,
  baseUrl = SEEKLI_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): SeekliClient {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new UpstreamError(`seek.li 请求超时（>${timeoutMs}ms）`);
      }
      throw new UpstreamError(`seek.li 网络错误: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* 非 JSON 错误体，用兜底信息 */
      }
      throw parseErrorBody(body, res.status);
    }
    return (await res.json()) as T;
  }

  return {
    async check(address: string): Promise<boolean> {
      const res = await request<SeekliCheckResponse>(
        `/mailboxes/check?address=${encodeURIComponent(address)}`,
        { method: "POST" },
      );
      return res.data?.available === true;
    },

    async create(address: string): Promise<SeekliMailbox> {
      const res = await request<{ data: SeekliMailbox }>(`/mailboxes`, {
        method: "POST",
        body: JSON.stringify({ address } satisfies SeekliCreateRequest),
      });
      return res.data;
    },
  };
}
