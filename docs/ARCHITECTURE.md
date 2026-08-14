# Seek2Addy 架构文档（ARCHITECTURE）

> 版本：v1.0　状态：已完成（2026-08-14，与实现核对一致）

## 1. 总体拓扑

```
┌──────────────┐   Addy.io 协议（入站）    ┌──────────────────┐   NodeSeek Mail API（出站）  ┌──────────────┐
│   Bitwarden  │ ────────────────────────▶ │   Cloudflare     │ ──────────────────────────▶ │   seek.li    │
│ (Web/桌面/   │  POST /api/v1/aliases     │   Worker         │  POST /openapi/v1/mailboxes │ (NodeSeek 邮箱)│
│  移动/CLI)   │  Bearer <AUTH_TOKEN>      │   (Seek2Addy)    │  Bearer <SEEKLI_API_KEY>    │              │
│              │ ◀──────────────────────── │                  │ ◀────────────────────────── │              │
│              │  {"data":{"email":...}}   │                  │  {"data":{"address":...}}   │              │
└──────────────┘                           └──────────────────┘                              └──────────────┘
```

关键事实（已实测/源码验证）：

- seek.li API 基址 `https://seek.li/openapi/v1`，**不受 WAF 拦截**（curl 直连返回 401 JSON，到达应用层）；
- Bitwarden 所有客户端（web/桌面/移动/CLI/扩展）的 Addy.io 集成协议一致（源码 `integration/addy-io.ts` + 扩展元数据双重确认）；
- Bitwarden Web Vault 是**浏览器端直接 fetch** → Worker 必须处理 CORS。

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 | Cloudflare Workers（TypeScript） | 边缘部署、零运维、免费额度足够（10 万请求/天） |
| 框架 | 原生 fetch handler（已定，见 §7 D6） | 单端点服务，零运行时依赖 |
| 存储 | 无（v1 零状态） | 单用户双 token 方案不需要 KV/D1 |
| 构建 | wrangler + esbuild（默认） | 零配置 |
| 测试 | vitest + wrangler 本地模拟 | 见 §8 |

## 3. 目录结构

```
Seek2Addy/
├── README.md                  # 用户向：怎么用
├── AGENTS.md                  # 项目规范：开发指引（开发者/AI 必读）
├── LICENSE
├── docs/
│   ├── DESIGN.md              # 接口契约与数据流
│   ├── ARCHITECTURE.md        # 本文档
│   └── RATE_LIMITING.md       # Cloudflare 面板限流规则配置
├── src/
│   ├── index.ts               # Worker 入口：路由分发 + CORS + 全局错误处理
│   ├── cors.ts                # CORS 头（构造时传入，因 Response headers 不可变）
│   ├── routes/
│   │   └── aliases.ts         # POST /api/v1/aliases（Addy.io 兼容端点）
│   ├── core/
│   │   ├── address.ts         # 随机前缀生成、地址组装与校验
│   │   ├── seekli.ts          # seek.li 客户端（check / create）
│   │   └── translate.ts       # 响应/错误翻译（Mailbox → Addy.io 格式）
│   ├── security/
│   │   └── token-guard.ts     # Bearer 校验（SHA-256 + XOR 恒定时间比较）
│   └── types.ts               # 入站/出站类型定义（Env、请求体、响应体）
├── test/
│   ├── address.test.ts
│   ├── seekli.test.ts         # mock fetch 的 seek.li 客户端测试
│   └── e2e.test.ts            # 直接调用 worker handler，模拟 Bitwarden 全链路
├── wrangler.toml
├── tsconfig.json
└── package.json
```

## 4. 环境变量契约

| 变量 | 必填 | 存放 | 用途 |
|---|---|---|---|
| `AUTH_TOKEN` | 是 | Worker secret（`wrangler secret put`）| 校验入站请求，值填进 Bitwarden "API Access Token" |
| `SEEKLI_API_KEY` | 是 | Worker secret | 出站请求 seek.li 的 `sk_live_...`，**永不进 Bitwarden** |

- 本地开发：`.dev.vars`（gitignore），生产：`wrangler secret put`（不进仓库）；
- `wrangler.toml` 中可放 `[vars]` 非敏感默认值（如前缀长度、字符集开关），敏感项一律走 secrets。

## 5. 安全模型

### 5.1 双 token 隔离

```
Bitwarden vault 内: AUTH_TOKEN (bw_...)     ← 泄露只影响"能建邮箱"，无法读/删 seek.li 数据
Worker 环境变量:   SEEKLI_API_KEY (sk_...)  ← 唯一持有 seek.li 真实凭据
```

收益：

1. seek.li Key 不进 Bitwarden vault（vault 泄露 ≠ seek.li 账号失守）；
2. 吊销只需轮换 Worker secret，seek.li 侧零操作；
3. 可平滑演进为多用户（§6）。

### 5.2 校验与防护清单

| 措施 | 实现 |
|---|---|
| token 校验 | SHA-256 摘要 + 逐字节 XOR 恒定时间比较（Web Crypto 无 `timingSafeEqual`），失败返回 401 且不区分错误细节 |
| 限流 | Cloudflare Rate Limiting 规则：每 IP 10 分钟 ≤ 100 次（免费版额度内），防暴力枚举与滥用当跳板 |
| CORS | `Access-Control-Allow-Origin: *`（token 走 header 不走 cookie），响应 OPTIONS 预检 |
| 出站超时 | `AbortSignal.timeout(10_000)`，超时 504 |
| 前缀随机性 | Web Crypto `crypto.getRandomValues`，禁止 Math.random |
| 响应头 | 隐藏 Server 头等指纹 |

### 5.3 威胁模型

| 攻击者 | 能力假设 | 防线 |
|---|---|---|
| 匿名互联网 | 可访问 Worker 端点 | token 校验 + 限流 |
| 拿到 AUTH_TOKEN 者 | 可建邮箱（v1 无法细分） | 限流；轮换 token 即吊销 |
| Bitwarden vault 泄露 | 拿到 AUTH_TOKEN | seek.li Key 隔离，损失限于"邮箱数量被消耗" |

## 6. 扩展性设计

### 6.1 多用户（v2）

- `AUTH_TOKEN` 环境变量 → KV 表 `token → { seekliKey | 配额 }`；
- 每用户独立 seek.li Key 或共享 Key + 计数；
- 管理面：worker 内置管理端点或外部面板（不在 v1 范围）。

### 6.2 多协议入口（v2 可选）

路由层加 `POST /api/alias/random/new`（SimpleLogin 协议）→ 复用同一内部逻辑：

```
routes/aliases.ts (Addy.io)  ─┐
                              ├─▶ core/（地址生成 + seekli 客户端）─▶ seek.li
routes/simplelogin.ts (SL)   ─┘
```

### 6.3 协议中立

`core/translate.ts` 独立成层，任何新协议入口只需新增"翻译器"，不改动 seek.li 客户端。

## 7. 关键技术决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 选 Addy.io 协议 | domain 字段与 seek.li 模型契合（详见 DESIGN §1.3） |
| D2 | 双环境变量隔离凭据 | 密钥不进 vault，可独立吊销 |
| D3 | 响应保留 `data` 包装 | Bitwarden 源码取 `json.data.email`，平铺返回 = 功能失效 |
| D4 | 随机前缀由 Worker 生成 | Addy.io 协议只传 domain，前缀必须中间件生成；8~12 位去混淆字符集 |
| D5 | 先透传错误信息 | 用户可读 seek.li 原始错误，减少排查成本 |
| D6 | 框架：原生 fetch handler（已定） | 单端点 + OPTIONS + 错误处理原生手写 < 200 行，零运行时依赖；Hono 对单端点属多余依赖 |

## 8. 验证与测试方法

| 层 | 方法 |
|---|---|
| 单元 | vitest：地址生成（字符集/长度/冲突重试）、token 校验、错误翻译 |
| 集成 | mock fetch（`wrangler dev` 本地起服务），模拟 Bitwarden 完整请求 → 断言响应结构 |
| 真实联调 | `curl` 模拟 Bitwarden：`curl -X POST https://<worker>/api/v1/aliases -H "Authorization: Bearer $AUTH" -d '{"domain":"...","description":"test"}'` |
| 浏览器 | Web Vault 实测：配置 Addy.io forwarder → 点击生成用户名（必须，涉及 CORS/UI 链路） |
| 回归 | seek.li OpenAPI spec 有变更时，对照 `docs/DESIGN.md` §3.2 检查出站契约 |

已知坑速查（详见 AGENTS.md §已知坑）：

1. 忘加 `data` 包装 → Bitwarden 静默失败（null）；
2. 忘配 CORS → Web Vault 生成失败，桌面/CLI 正常，现象极具迷惑性；
3. seek.li 无 domains 接口 → 域名必须用户在 Bitwarden Domain 字段手填；
4. 免费版 Worker 出站 subrequest 数量上限 50/请求（本项目 1~2 次，安全）；
5. WAF 只拦页面不拦 `/openapi/v1/*`（已实测），但未来变化需回归确认。

## 9. 部署拓扑

```
GitHub (Yeqingky/Seek2Addy) ──wrangler deploy──▶ Cloudflare Workers
                                                    └─ https://seek2addy.<subdomain>.workers.dev
                                                          │
                                                          └─ https://seek.li/openapi/v1 (出站)
```

- 环境：`production`（默认）；后续可加 `staging` 分支；
- 部署命令：`wrangler deploy`；CI（可选，v2）：GitHub Actions + `wrangler-action`；
- 监控：Workers 自带日志/实时日志（`wrangler tail`）；告警可选 `workers-analytics`。

## 10. 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 骨架 | 仓库初始化、wrangler/tsconfig、路由空壳、CORS | ✅ 完成 |
| M2 核心 | 地址生成 + seek.li 客户端 + 翻译器（全链路通） | ✅ 完成（33/33 测试全绿） |
| M3 安全 | token 校验 + 限流规则 + 错误处理完善 | ✅ 代码完成（限流规则待面板配置，见 RATE_LIMITING.md） |
| M4 测试部署 | 单测/集成测试、真实联调、浏览器验证、上线 | 🟡 自动化测试完成；真实联调/上线待真实 seek.li Key |
| M5 文档收尾 | 文档评审、AGENTS.md 补充实测数据 | ✅ 完成（真实联调数据待 M4 后补充） |
