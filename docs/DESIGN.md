# Seek2Addy 设计文档（DESIGN）

> 版本：v1.0　状态：已完成（2026-08-14，与实现核对一致）

## 1. 背景与目标

### 1.1 问题

- Bitwarden 用户名生成器内置 Addy.io / SimpleLogin 等别名提供商，**不支持 seek.li**；
- seek.li（NodeSeek 邮箱）提供 OpenAPI，但没有现成的 Bitwarden 集成；
- 希望 Bitwarden 生成用户名时，能直接创建 seek.li 邮箱（别名）。

### 1.2 方案

部署一个 Cloudflare Worker 作为中间件：

- **入站**：实现 Bitwarden 的 **Addy.io** 协议（经源码确认的精确契约，见 §3）；
- **出站**：调用 seek.li 的 **NodeSeek Mail API** 创建邮箱；
- **翻译**：把 seek.li 的"创建邮箱"翻译成 Addy.io 的"创建转发别名"，双向映射错误码。

### 1.3 为什么选 Addy.io 协议（而不是 SimpleLogin）

| 维度 | Addy.io（选用） | SimpleLogin（弃用） |
|---|---|---|
| 请求体含 domain | ✅ `{"domain": ...}`，用户在 Bitwarden 里直接填 seek.li 收件域名 | ❌ 请求体无 domain（`/api/alias/random/new`），seek.li 又没有"随机分配域名"接口，域名只能中间件硬编码 |
| 认证头 | `Authorization: Bearer`，与 seek.li 同构 | `Authentication`，非标准头，需转换 |
| 响应结构 | `{data:{email}}` 与 seek.li `{data:{address}}` 同构，一行转换 | `{alias}` 平铺结构 |
| 设置字段 | token + baseUrl + domain 三个输入框，恰好与配置面一一对应 | 字段不齐 |

结论：**Addy.io 协议的 domain 字段与 seek.li "显式指定地址建 mailbox" 的模型严丝合缝**。

## 2. 术语

| 术语 | 含义 |
|---|---|
| 入站请求 | Bitwarden → Worker 的请求（Addy.io 协议） |
| 出站请求 | Worker → seek.li 的请求（NodeSeek Mail API） |
| AUTH_TOKEN | Worker 鉴权 token，填在 Bitwarden "API Access Token" 字段 |
| SEEKLI_API_KEY | seek.li 签发的 `sk_live_...` Key，仅存于 Worker 环境变量 |
| 别名 | 本项目中指 seek.li 的"邮箱（mailbox）"，即 `xxx@domain` |

## 3. 接口契约

### 3.1 入站：Bitwarden → Worker（Addy.io 协议）

依据：Bitwarden clients 仓库 `libs/tools/generator/core/src/integration/addy-io.ts`（master）。

```
POST {workerBaseUrl}/api/v1/aliases
Authorization: Bearer <AUTH_TOKEN>
Content-Type: application/json
```

请求体：

```json
{
  "domain": "mail.example.com",
  "description": "site.com"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `domain` | 是 | Bitwarden 设置里配置的 Domain 字段，原样透传 |
| `description` | 否 | Bitwarden 生成原因（站点 hostname 截取，≤200 字符），当前版本忽略不落库 |

**成功响应（200/201）**——严格按 Bitwarden 源码 `processJson` 取 `json.data.email`：

```json
{
  "data": {
    "email": "a1b2c3d4e5@mail.example.com"
  }
}
```

> ⚠️ 必须保留 `data` 包装。Bitwarden 取的是 `json?.data?.email`，平铺返回会导致 null。

**失败响应**：

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "缺少或格式错误的 API Key"
  }
}
```

### 3.2 出站：Worker → seek.li（NodeSeek Mail API）

依据：seek.li 开发者文档导出的 OpenAPI（`api-1.json`，29 paths）。

```
POST https://seek.li/openapi/v1/mailboxes
Authorization: Bearer <SEEKLI_API_KEY>
Content-Type: application/json
```

请求体：

```json
{
  "address": "a1b2c3d4e5@mail.example.com"
}
```

成功响应（200）：

```json
{
  "data": {
    "id": 12345,
    "address": "a1b2c3d4e5@mail.example.com",
    "domainId": 6,
    "createdAt": "2026-08-14T12:00:00Z"
    // ... 其余 Mailbox 字段
  }
}
```

**可用性预检（可选，推荐）**：

```
POST https://seek.li/openapi/v1/mailboxes/check?address=a1b2c3d4e5@mail.example.com
→ 200 {"data": {"available": true}}
```

### 3.3 错误映射

| seek.li 状态码 | seek.li error.code | Worker 返回 | Bitwarden 表现 |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | 401，透传 message | 提示检查 token |
| 400 | 参数错误 / 地址不可用 | 400，透传 message | 显示错误详情 |
| 429 | 限流/配额 | 429 | 提示稍后重试 |
| 5xx | 服务端错误 | 502（Worker 包装） | 显示失败 |

映射规则：**状态码透传，`error.message` 原样透传**，便于 Bitwarden 界面直接展示 seek.li 的原始错误。

### 3.4 主流程时序

```
Bitwarden                    Worker                         seek.li
    │ POST /api/v1/aliases      │                              │
    │ Authorization: Bearer bw_ │                              │
    ├──────────────────────────▶│                              │
    │                           │ ① 校验 token（恒定时间比较）    │
    │                           │ ② 生成随机前缀 p（去混淆字符集） │
    │                           │ ③ address = p@domain         │
    │                           │ ④ [可选] POST /mailboxes/check│
    │                           │─────────────────────────────▶│
    │                           │ ◀────── {"available": true}  │
    │                           │ ⑤ POST /mailboxes            │
    │                           │─────────────────────────────▶│
    │                           │ ◀── 200 {"data":{"address"}}  │
    │ ◀── 200 {"data":{"email"}} │                              │
    │                           │ ⑥ email = data.address        │
```

## 4. 地址生成规则

- **前缀**：`crypto.getRandomValues` 生成 8~12 位随机串，字符集 `abcdefghjkmnpqrstuvwxyz23456789`（去除易混淆的 `0/O/1/l/I`）；
- **地址**：`{prefix}@{domain}`，domain 来自入站请求体；
- **冲突处理**：可选调用 `check` 预检；若 `create` 返回"地址已存在"类错误，重试（换前缀）最多 3 次，仍失败则返回 409；
- **长度限制**：完整地址 ≤ 64 字符（SMTP 惯例），超限时缩短前缀。

## 5. 边界情况

| 场景 | 行为 |
|---|---|
| 无 Authorization 头 / token 错误 | 401，不区分细节（防探测） |
| domain 缺失或格式非法（无 `@` 结构校验、含非法字符） | 400 |
| 随机前缀与已有邮箱冲突 | 重试换前缀，最多 3 次 |
| seek.li 配额用尽（4xx） | 透传状态码与 message |
| 出站超时（≥ 10s） | 504，可重试 |
| CORS 预检（OPTIONS） | 200 + 允许头（Web Vault 浏览器直连必须） |

## 6. 非目标（v1 不做）

- 删除/管理已有别名（Bitwarden Addy.io 集成只调创建接口）；
- SimpleLogin 协议入口（预留架构扩展点，见架构文档 §6）；
- 多用户 token 映射（KV 表）；
- 自定义前缀（Domain 字段填 `前缀@域名` 的增强语法，v2 讨论）；
- seek.li 域名列表发现（seek.li API 无 domains 接口，域名只能用户在 Bitwarden 手动配置）。
