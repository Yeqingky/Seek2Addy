import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/types";

const ENV: Env = {
  AUTH_TOKEN: "bw_test_auth_token",
  SEEKLI_API_KEY: "sk_live_test",
};

const BODY = { domain: "mail.example.com", description: "test" };

function makeRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://seek2addy.test${path}`, init);
}

function authedRequest(path = "/api/v1/aliases", body: unknown = BODY, token = ENV.AUTH_TOKEN): Request {
  return makeRequest(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 模拟 seek.li：根据 URL 分派 check / create */
function stubSeekli(opts: {
  available?: boolean;
  createStatus?: number;
  createBody?: unknown;
  /** 前 n 次 create 调用失败（模拟冲突重试） */
  failCreates?: number;
} = {}) {
  const { available = true, createStatus = 200, createBody, failCreates = 0 } = opts;
  let createCalls = 0;
  const spy = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes("/mailboxes/check")) {
      return Response.json({ data: { available } });
    }
    createCalls++;
    if (createCalls <= failCreates) {
      return Response.json({ error: { code: "EMAIL_ADDRESS_UNAVAILABLE", message: "地址已被占用" } }, { status: 400 });
    }
    return Response.json(
      createBody ?? { data: { id: 1, address: "created@mail.example.com", domainId: 6, createdAt: "2026-08-14T00:00:00Z" } },
      { status: createStatus },
    );
  });
  vi.stubGlobal("fetch", spy);
  return { spy, getCreateCalls: () => createCalls };
}

async function call(req: Request): Promise<Response> {
  return worker.fetch(req, ENV, {} as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("e2e: POST /api/v1/aliases 全链路", () => {
  it("正确 token + seek.li 成功 → 200 data.email（CORS 头齐全）", async () => {
    const { spy } = stubSeekli();
    const res = await call(authedRequest());
    const body = (await res.json()) as { data: { email: string } };

    expect(res.status).toBe(200);
    expect(body.data.email).toBe("created@mail.example.com");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");

    // 出站请求：先 check 预检，再 create
    const urls = spy.mock.calls.map((c) => c[0] as string);
    expect(urls.length).toBe(2);
    expect(urls[0]).toContain("/mailboxes/check");
    expect(urls[1]).toBe("https://seek.li/openapi/v1/mailboxes");
    // 出站 Authorization 用 seek.li Key，而不是入站 token
    const createInit = spy.mock.calls[1]![1] as RequestInit;
    expect((createInit.headers as Record<string, string>).Authorization).toBe("Bearer sk_live_test");
    expect(JSON.parse(createInit.body as string)).toMatchObject({ address: expect.stringMatching(/^[a-z0-9]+@mail\.example\.com$/) });
  });

  it("预检不可用 → 跳过 create → 重试后成功（出站共 4 次：2 check + 2 create）", async () => {
    let checkCount = 0;
    let createCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/mailboxes/check")) {
          checkCount++;
          return Response.json({ data: { available: checkCount > 1 } }); // 第一次不可用
        }
        createCount++;
        return Response.json({ data: { id: 1, address: "retry@mail.example.com", domainId: 6, createdAt: "2026-08-14T00:00:00Z" } });
      }),
    );

    const res = await call(authedRequest());
    const body = (await res.json()) as { data: { email: string } };

    expect(res.status).toBe(200);
    expect(body.data.email).toBe("retry@mail.example.com");
    expect(checkCount).toBe(2);
    expect(createCount).toBe(1);
  });

  it("create 冲突（400 已占用）→ 换前缀重试 ≤3 次 → 409", async () => {
    stubSeekli({ failCreates: 5 }); // 永远冲突
    const res = await call(authedRequest());

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("seek.li 401 → 透传 401 + message", async () => {
    stubSeekli({ createStatus: 401, createBody: { error: { code: "UNAUTHORIZED", message: "缺少或格式错误的 API Key" } } });
    const res = await call(authedRequest());

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe("缺少或格式错误的 API Key");
  });

  it("seek.li 5xx → 包装为 502", async () => {
    stubSeekli({ createStatus: 500, createBody: { error: { code: "INTERNAL", message: "boom" } } });
    const res = await call(authedRequest());

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UPSTREAM_ERROR");
  });

  it("出站网络错误 → 504", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const res = await call(authedRequest());

    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UPSTREAM_TIMEOUT");
  });
});

describe("e2e: 鉴权与入站校验", () => {
  it("无 Authorization → 401", async () => {
    const res = await call(makeRequest("/api/v1/aliases", { method: "POST", body: JSON.stringify(BODY) }));
    expect(res.status).toBe(401);
  });

  it("错误 token → 401（不暴露细节）", async () => {
    const res = await call(authedRequest(undefined, undefined, "wrong-token"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).not.toContain("wrong");
  });

  it("非 Bearer 格式 → 401", async () => {
    const res = await call(makeRequest("/api/v1/aliases", { method: "POST", headers: { Authorization: "Basic abc" }, body: JSON.stringify(BODY) }));
    expect(res.status).toBe(401);
  });

  it("非法 JSON → 400", async () => {
    const res = await call(makeRequest("/api/v1/aliases", { method: "POST", headers: { Authorization: `Bearer ${ENV.AUTH_TOKEN}` }, body: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("缺 domain → 400", async () => {
    const res = await call(authedRequest(undefined, { description: "x" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("domain");
  });

  it("非法 domain（含 @）→ 400", async () => {
    const res = await call(authedRequest(undefined, { domain: "user@example.com" }));
    expect(res.status).toBe(400);
  });

  it("超长 domain → 400", async () => {
    const res = await call(authedRequest(undefined, { domain: `${"a".repeat(60)}.com` }));
    expect(res.status).toBe(400);
  });
});

describe("e2e: 路由与 CORS", () => {
  it("OPTIONS 预检 → 204 + CORS 头", async () => {
    const res = await call(makeRequest("/api/v1/aliases", { method: "OPTIONS" }));

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
  });

  it("未知路径 → 404", async () => {
    const res = await call(makeRequest("/"));
    expect(res.status).toBe(404);
  });

  it("GET /api/v1/aliases → 404（只接受 POST）", async () => {
    const res = await call(makeRequest("/api/v1/aliases", { method: "GET" }));
    expect(res.status).toBe(404);
  });
});
