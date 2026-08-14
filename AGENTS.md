# Seek2Addy 项目规范（AGENTS.md）

> 面向开发者与 AI 助手的项目指南。使用者（含 AI）动手前必须通读本文档。

## 1. 项目是什么

Seek2Addy 是一个部署在 Cloudflare Workers 上的**协议翻译中间件**：
把 Bitwarden 的 **Addy.io** 协议请求（`POST /api/v1/aliases`）翻译成 **NodeSeek Mail API**（seek.li）的建邮箱调用（`POST /openapi/v1/mailboxes`），让 Bitwarden 能用 seek.li 生成别名邮箱。

仓库：`https://github.com/Yeqingky/Seek2Addy`（MIT）

## 2. 设计思路（为什么这么做）

1. **选 Addy.io 协议**：Bitwarden 的 Addy.io 集成允许自定义 API URL，且请求体带 `domain` 字段——与 seek.li "显式指定地址创建邮箱" 的模型严丝合缝。SimpleLogin 协议无 domain 字段，而 seek.li 又没有"随机分配域名"接口，故弃用。
2. **双环境变量隔离凭据**：`AUTH_TOKEN`（填进 Bitwarden）+ `SEEKLI_API_KEY`（只存 Worker secret）。seek.li 真实 Key 永不进入 Bitwarden vault，泄露 vault 不会失守 seek.li 账号。
3. **零状态设计**：v1 不需要 KV/D1，Worker 是无状态纯函数，免费额度足够。
4. **严格对齐 Bitwarden 契约**：Bitwarden 源码取 `json.data.email`（`integration/addy-io.ts`），响应必须带 `data` 包装，否则静默失败。

## 3. 核心实现原理

### 3.1 请求链路

```
Bitwarden ──POST /api/v1/aliases──▶ Worker ──POST /openapi/v1/mailboxes──▶ seek.li
  Bearer <AUTH_TOKEN>                  Bearer <SEEKLI_API_KEY>
  {"domain": "...",                    {"address": "{prefix}@{domain}"}
   "description": "..."}
◀── 200 {"data":{"email":"..."}} ◀── 200 {"data":{"address":"..."}}
```

### 3.2 关键实现点

- **地址生成**：`crypto.getRandomValues` 生成 8~12 位随机前缀，字符集 `abcdefghjkmnpqrstuvwxyz23456789`（去 `0/O/1/l/I`）。禁止 `Math.random`。
- **token 校验**：SHA-256 摘要 + 逐字节 XOR 恒定时间比较（Web Crypto 无 `timingSafeEqual`，手写实现见 `token-guard.ts`），401 不区分错误细节。
- **CORS 必做**：Bitwarden Web Vault 是浏览器直连 fetch，`Access-Control-Allow-Origin: *` + OPTIONS 预检响应。漏配的典型现象：桌面/CLI 正常、Web Vault 失败。
- **错误透传**：seek.li 的 `error.message` 原样透传，用户能在 Bitwarden 看到原始错误。

## 4. 目录结构

```
src/
├── index.ts               # Worker 入口：路由 + CORS + 全局错误处理
├── routes/aliases.ts      # POST /api/v1/aliases（Addy.io 兼容端点）
├── core/
│   ├── address.ts         # 随机前缀生成、地址组装校验
│   ├── seekli.ts          # seek.li 客户端（check/create）
│   └── translate.ts       # 响应/错误翻译（Mailbox → Addy.io 格式）
├── security/token-guard.ts# Bearer 校验
└── types.ts               # Env / 请求体 / 响应体类型
test/                      # 单元 + 集成 + e2e
docs/                      # DESIGN / ARCHITECTURE / RATE_LIMITING
```

## 5. 环境变量

| 变量 | 说明 |
|---|---|
| `AUTH_TOKEN` | 入站鉴权 token（用户填进 Bitwarden "API Access Token"） |
| `SEEKLI_API_KEY` | seek.li API Key（`sk_live_...`），出站使用 |

**配置方式**：生产环境在 Cloudflare 面板设置（Worker → 设置 → 变量和机密 → 添加机密；或等效的 `wrangler secret put`）；本地开发用 `.dev.vars`（已 gitignore，仅为 `wrangler dev` 模拟输入，不参与生产）。**禁止把 secret 写进 `wrangler.toml` 或提交仓库。**

## 6. 协议契约速查（详细版见 docs/DESIGN.md）

**入站（Addy.io）**：`POST {baseUrl}/api/v1/aliases`，`Authorization: Bearer`，body `{domain(必填), description}`，成功返回 `200/201 {"data":{"email":"..."}}`。

**出站（seek.li）**：`POST https://seek.li/openapi/v1/mailboxes`，`Authorization: Bearer`，body `{"address":"..."}`，成功返回 `{"data":{"address":...}}`。可选预检：`POST /mailboxes/check?address=...`。

**错误映射**：状态码透传，`error.message` 透传。seek.li 401 → 401；400 → 400；429 → 429。

## 7. 已知坑（务必先看）

1. **响应缺 `data` 包装** → Bitwarden 取 `json?.data?.email` 得 null，表现是"生成成功但无结果"，极难排查。
2. **CORS 漏配** → 仅 Web Vault 失败，桌面/CLI/移动端正常。
3. **seek.li 没有 domains 接口** → 域名只能靠用户在 Bitwarden 的 Domain 字段手填；不要试图在 Worker 里枚举域名。
4. **WAF 现状**：seek.li 的页面（`/manage/*`、`/assets/*`）被长亭 WAF 拦截（HTTP 468 + JS 挑战），但 **`/openapi/v1/*` API 路径放行**（已实测 curl 直连返回 401 JSON）。将来若 API 也上 WAF/来源 IP 限制，Worker 的 CF 出口 IP 可能被误伤，需回归验证。
5. **免费版 Worker**：出站 subrequest 上限 50/请求（本项目 1~2 次，安全）；CPU 时间预算足够（I/O 等待不占 CPU）。
6. **Bitwarden 客户端版本**：新老版本（web/桌面/移动/CLI/扩展）Addy.io 集成协议一致，一套 Worker 全覆盖；若 Bitwarden 变更契约，以 `integration/addy-io.ts` 源码为准。
7. **重试语义**：地址冲突概率极低但存在，create 失败换前缀重试 ≤3 次，避免无限循环。
8. **限流必须有**：Worker 公开可访问，无限流 = 任何人都能用你的 Key 建邮箱（垃圾邮件跳板）。Cloudflare Rate Limiting 规则：每 IP 10 分钟 ≤100 次。

## 8. 验证方法

```bash
# 本地开发
npm install
wrangler dev          # 本地起服务（.dev.vars 提供 secret）

# 模拟 Bitwarden 请求
curl -X POST http://localhost:8787/api/v1/aliases \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain":"mail.example.com","description":"test"}'

# 测试
npm test

# 真实联调（有真实 Key 时）
curl -X POST https://<worker>/api/v1/aliases -H "Authorization: Bearer $AUTH" -d '{"domain":"...","description":"e2e"}'

# 上线前必做
# 1. Web Vault 实测生成用户名（CORS 链路）
# 2. seek.li 后台确认邮箱已创建、可收信
# 3. wrangler tail 观察无未捕获异常
```

涉及前端 UI 类改动时，必须用无头浏览器实测（见全局规范），本项目的"UI 链路"即 Bitwarden Web Vault 生成流程。

## 9. 开发与提交规范

- 提交者：`Yeqingky <me@yeqingky.com>`；提交前必须确认，未经用户要求不主动 push。
- 提交信息：标题简短，正文写细节。
- 文档先行：改动协议/契约前，先更新 `docs/DESIGN.md` 再动代码。
- 类型安全：TypeScript strict 模式；不写 `any`（翻译器边界可用受控类型断言）。

## 10. 参考资料

- seek.li OpenAPI：开发者文档导出（`api-1.json`，29 paths，base `/openapi/v1`）
- Bitwarden 客户端源码：`libs/tools/generator/core/src/integration/addy-io.ts`（协议权威依据）
- 本机环境：WSL2 + Windows OpenSSH（git 走 Linux，SSH 走 Windows，见全局 AGENTS.md）
