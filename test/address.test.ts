import { describe, expect, it } from "vitest";

import {
  MAX_ADDRESS_LEN,
  PREFIX_CHARSET,
  PREFIX_MAX_LEN,
  PREFIX_MIN_LEN,
  buildAddress,
  isValidDomain,
  randomPrefix,
} from "../src/core/address";

describe("randomPrefix", () => {
  it("长度在 8~12 之间", () => {
    for (let i = 0; i < 1000; i++) {
      const p = randomPrefix();
      expect(p.length).toBeGreaterThanOrEqual(PREFIX_MIN_LEN);
      expect(p.length).toBeLessThanOrEqual(PREFIX_MAX_LEN);
    }
  });

  it("字符全部来自去混淆字符集（无 0/O/1/l/I）", () => {
    for (let i = 0; i < 1000; i++) {
      const p = randomPrefix();
      for (const ch of p) {
        expect(PREFIX_CHARSET).toContain(ch);
      }
    }
    expect(PREFIX_CHARSET).not.toMatch(/[01lIoO]/);
  });

  it("长度可自定义", () => {
    const p = randomPrefix(10, 10);
    expect(p.length).toBe(10);
  });

  it("分布有随机性（100 次生成不全相同）", () => {
    const set = new Set(Array.from({ length: 100 }, () => randomPrefix()));
    expect(set.size).toBeGreaterThan(50);
  });
});

describe("buildAddress", () => {
  it("正常组装 {prefix}@{domain}", () => {
    expect(buildAddress("abc12345", "mail.example.com")).toBe("abc12345@mail.example.com");
  });

  it("domain 过长时截短前缀，仍 ≤64 字符", () => {
    const longDomain = "a".repeat(50) + ".com"; // 54 字符
    const addr = buildAddress("abcdefghijkl", longDomain);
    expect(addr).not.toBeNull();
    expect(addr!.length).toBeLessThanOrEqual(MAX_ADDRESS_LEN);
    expect(addr!.endsWith(`@${longDomain}`)).toBe(true);
  });

  it("domain 长到最短前缀都放不下时返回 null", () => {
    const tooLong = "a".repeat(60) + ".com"; // 64 字符，1 + 64 > 64
    expect(buildAddress("abcdefgh", tooLong)).toBeNull();
  });
});

describe("isValidDomain", () => {
  it("接受合法域名", () => {
    expect(isValidDomain("mail.example.com")).toBe(true);
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("a-b.example-domain.co")).toBe(true);
  });

  it("拒绝非法输入", () => {
    expect(isValidDomain("")).toBe(false);
    expect(isValidDomain("user@example.com")).toBe(false); // 含 @
    expect(isValidDomain("user name.com")).toBe(false); // 含空格
    expect(isValidDomain("example")).toBe(false); // 无顶级域
    expect(isValidDomain(".example.com")).toBe(false);
    expect(isValidDomain("example..com")).toBe(false);
    expect(isValidDomain("example.com.")).toBe(false);
    expect(isValidDomain("example.c")).toBe(false); // 顶级域过短
  });
});
