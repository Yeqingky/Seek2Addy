# Seek2Addy

> 把 seek.li（NodeSeek 邮箱）的邮箱创建能力，翻译成 Addy.io 兼容 API，让 Bitwarden 等支持 Addy.io 协议的工具可以直接生成 seek.li 别名邮箱。

## 这是什么

Bitwarden 的"用户名生成器"内置了对 Addy.io 等别名提供商的集成，但**不支持 seek.li**。
Seek2Addy 是一个部署在 **Cloudflare Workers** 上的中间件：

- 对外（面向 Bitwarden）实现 **Addy.io 协议**（`POST /api/v1/aliases`）；
- 对内（面向 seek.li）调用 **NodeSeek Mail API**（`POST /openapi/v1/mailboxes`）创建邮箱。

Bitwarden 只需要把 Forwarder 类型选为 **Addy.io**、API URL 指向本 Worker，即可在生成密码时一键创建 seek.li 别名邮箱。

## 快速开始

### 1. 部署 Worker

```bash
npm install -g wrangler        # 或使用 npx wrangler
wrangler login
wrangler deploy
```

### 2. 配置环境变量（secrets）

在 **Cloudflare 面板**上配置（不要写入任何文件）：

Workers → 选择 seek2addy → 设置 → 变量和机密 → 添加机密：

| 变量 | 值 |
| --- | --- |
| `AUTH_TOKEN` | 任意强随机串（如 `openssl rand -base64 32` 生成），稍后填进 Bitwarden |
| `SEEKLI_API_KEY` | seek.li 控制台签发的 API Key（`sk_live_...`） |

> ⚠️ 机密只存在 Cloudflare 面板/密钥系统中，`wrangler.toml`、仓库文件、`.dev.vars` 里**一律不写真实值**。
> 本地调试时 `.dev.vars` 仅作 `wrangler dev` 的模拟输入（已 gitignore），生产环境不经过它。

### 3. 在 Bitwarden 中配置

打开 Bitwarden → 工具 → 生成器 → 用户名，Forwarder 类型选择 **Addy.io**：

| 字段             | 值                                             |
| ---------------- | ---------------------------------------------- |
| API Access Token | `AUTH_TOKEN` 的值（`bw_...`）                  |
| API URL          | `https://<你的worker>.workers.dev`             |
| Domain           | 你的 seek.li 收件域名（如 `mail.example.com`） |

之后点击"生成用户名"即可创建 seek.li 邮箱。

## 工作原理（30 秒版）

```
Bitwarden ── Addy.io 协议 ──▶ Seek2Addy (Worker) ── NodeSeek Mail API ──▶ seek.li
  POST /api/v1/aliases         ① 校验 AUTH_TOKEN                     POST /mailboxes
  {"domain": "...",            ② 生成随机前缀，拼出完整地址             {"address": "a1b2...@domain"}
   "description": "..."}       ③ 调用 seek.li 创建邮箱
  ◀── {"data":{"email":...}} ◀─ ④ 翻译成 Addy.io 响应格式 ◀─────────── {"data":{"address":...}}
```

## 设计文档

- [设计文档（接口契约）](docs/DESIGN.md)
- [架构文档（模块 / 安全 / 部署）](docs/ARCHITECTURE.md)
- [限流规则配置（Cloudflare 面板）](docs/RATE_LIMITING.md)

## 许可证

[MIT](LICENSE)
