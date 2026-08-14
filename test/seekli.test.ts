import { afterEach, describe, expect, it, vi } from "vitest";

import { SeekliError, UpstreamError, createSeekliClient } from "../src/core/seekli";

const API_KEY = "sk_live_test";
const BASE = "https://seek.li/openapi/v1";

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(handler);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SeekliClient.check", () => {
  it("available=true 返回 true", async () => {
    const spy = mockFetch(() => jsonResponse({ data: { available: true } }));
    const client = createSeekliClient(API_KEY, BASE);

    await expect(client.check("abc@mail.example.com")).resolves.toBe(true);

    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(`${BASE}/mailboxes/check?address=abc%40mail.example.com`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect(init.method).toBe("POST");
  });

  it("available=false 返回 false", async () => {
    mockFetch(() => jsonResponse({ data: { available: false } }));
    const client = createSeekliClient(API_KEY, BASE);
    await expect(client.check("taken@mail.example.com")).resolves.toBe(false);
  });
});

describe("SeekliClient.create", () => {
  it("成功返回 Mailbox", async () => {
    const mailbox = { id: 123, address: "abc@mail.example.com", domainId: 6, createdAt: "2026-08-14T00:00:00Z" };
    const spy = mockFetch(() => jsonResponse({ data: mailbox }));
    const client = createSeekliClient(API_KEY, BASE);

    await expect(client.create("abc@mail.example.com")).resolves.toEqual(mailbox);

    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(`${BASE}/mailboxes`);
    expect(JSON.parse(init.body as string)).toEqual({ address: "abc@mail.example.com" });
  });

  it("业务错误抛出 SeekliError（透传 status/code/message）", async () => {
    mockFetch(() =>
      jsonResponse({ error: { code: "EMAIL_ADDRESS_UNAVAILABLE", message: "地址已被占用" } }, 400),
    );
    const client = createSeekliClient(API_KEY, BASE);

    const err = await client.create("taken@mail.example.com").catch((e) => e);
    expect(err).toBeInstanceOf(SeekliError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("EMAIL_ADDRESS_UNAVAILABLE");
    expect(err.message).toBe("地址已被占用");
  });

  it("401 错误透传", async () => {
    mockFetch(() => jsonResponse({ error: { code: "UNAUTHORIZED", message: "缺少或格式错误的 API Key" } }, 401));
    const client = createSeekliClient(API_KEY, BASE);

    const err = await client.create("a@b.com").catch((e) => e);
    expect(err).toBeInstanceOf(SeekliError);
    expect(err.status).toBe(401);
  });

  it("非 JSON 错误体使用兜底 message", async () => {
    mockFetch(() => new Response("Bad Gateway", { status: 502 }));
    const client = createSeekliClient(API_KEY, BASE);

    const err = await client.create("a@b.com").catch((e) => e);
    expect(err).toBeInstanceOf(SeekliError);
    expect(err.status).toBe(502);
    expect(err.code).toBe("HTTP_502");
  });

  it("超时抛出 UpstreamError", async () => {
    mockFetch(
      () =>
        new Promise<Response>((_, reject) => {
          setTimeout(() => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })), 10);
        }),
    );
    const client = createSeekliClient(API_KEY, BASE, 5); // 5ms 超时

    const err = await client.create("a@b.com").catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toContain("超时");
  });

  it("网络错误抛出 UpstreamError", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const client = createSeekliClient(API_KEY, BASE);

    const err = await client.create("a@b.com").catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
  });
});
