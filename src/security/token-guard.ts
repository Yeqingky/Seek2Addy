/**
 * Bearer token 校验：先 SHA-256 再恒定时间比较。
 * 注意：Web Crypto（Workers 运行时）没有 timingSafeEqual，
 * 用逐字节 XOR 累加实现（无基于数据的提前返回分支）。
 * 失败返回 false，由调用方统一返回 401 且不区分错误细节（防探测，AGENTS.md §3.2）。
 */

const encoder = new TextEncoder();

/** 提取 Authorization: Bearer <token> 中的 token，格式错误返回 null */
export function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

/** 恒定时间比较两个字节数组（长度不等直接 false，相等时无数据依赖分支） */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** 恒定时间比较两个字符串（SHA-256 摘要定长后逐字节比较） */
export async function verifyToken(provided: string | null, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqualBytes(new Uint8Array(a), new Uint8Array(b));
}
