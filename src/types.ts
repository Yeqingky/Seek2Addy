/**
 * 全局类型定义：Env / 入站（Addy.io） / 出站（seek.li） / 响应体
 */

/** Worker 环境变量（双 token 隔离模型，见 AGENTS.md §2） */
export interface Env {
  /** 入站鉴权 token，填进 Bitwarden "API Access Token" */
  AUTH_TOKEN: string;
  /** seek.li API Key（sk_live_...），仅存 Worker secret */
  SEEKLI_API_KEY: string;
}

/** 入站：Bitwarden Addy.io 协议请求体（POST /api/v1/aliases） */
export interface AddyIoCreateRequest {
  /** seek.li 收件域名（如 mail.example.com），必填 */
  domain?: unknown;
  /** Bitwarden 生成原因，当前版本忽略不落库 */
  description?: unknown;
}

/** 出站：seek.li 建邮箱请求体（POST /openapi/v1/mailboxes） */
export interface SeekliCreateRequest {
  address: string;
}

/** 出站：seek.li Mailbox 对象（只取用到的字段） */
export interface SeekliMailbox {
  id: number;
  address: string;
  domainId: number;
  createdAt: string;
}

/** 出站：seek.li check 预检响应 */
export interface SeekliCheckResponse {
  data: { available: boolean };
}

/** 入站成功响应：必须带 data 包装，Bitwarden 取 json.data.email（AGENTS.md 已知坑 #1） */
export interface AddyIoSuccessResponse {
  data: { email: string };
}

/** 统一错误响应结构（入站侧） */
export interface ErrorResponse {
  error: { code: string; message: string };
}

/** seek.li API 错误响应（message 原样透传入站侧） */
export interface SeekliErrorBody {
  error?: { code?: unknown; message?: unknown };
}
