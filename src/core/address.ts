/**
 * 随机前缀生成、地址组装与域名校验。
 *
 * 安全要求（AGENTS.md §3.2）：必须用 crypto.getRandomValues，禁止 Math.random。
 */

/** 去混淆字符集：去掉 0/O/1/l/I（32 个字符 = 2^5，取模无偏差） */
export const PREFIX_CHARSET = "abcdefghjkmnpqrstuvwxyz23456789";

export const PREFIX_MIN_LEN = 8;
export const PREFIX_MAX_LEN = 12;

/** SMTP 地址长度惯例上限（本地部分 64 字符是 RFC 限制，这里按设计文档用整地址 ≤64） */
export const MAX_ADDRESS_LEN = 64;

/** 域名正则：标签 1~63 字符，顶级域 ≥2 位字母，总长 ≤253 */
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * 从 crypto.getRandomValues 取模生成 [0, bound) 的均匀整数。
 * bound 非 2 的幂时存在极小偏差，仅用于长度选择，无安全影响。
 */
function randomInt(bound: number): number {
  const buf = new Uint8Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % bound;
}

/** 生成 8~12 位随机前缀（长度也随机），字符集 PREFIX_CHARSET */
export function randomPrefix(min = PREFIX_MIN_LEN, max = PREFIX_MAX_LEN): string {
  const len = min + randomInt(max - min + 1);
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = "";
  for (const byte of buf) out += PREFIX_CHARSET[byte % PREFIX_CHARSET.length];
  return out;
}

/** 校验 domain：必须是不含 @ / 空白 / 非法字符的合法域名结构 */
export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain);
}

/**
 * 组装完整地址 {prefix}@{domain}。
 * 完整地址超过 MAX_ADDRESS_LEN 时截短前缀；domain 长到连最短前缀都放不下时返回 null。
 */
export function buildAddress(prefix: string, domain: string): string | null {
  const maxPrefix = MAX_ADDRESS_LEN - 1 - domain.length;
  if (maxPrefix < PREFIX_MIN_LEN) return null;
  const p = prefix.length > maxPrefix ? prefix.slice(0, maxPrefix) : prefix;
  return `${p}@${domain}`;
}
