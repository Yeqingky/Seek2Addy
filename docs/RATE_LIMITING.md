# Rate Limiting 规则（Cloudflare 面板配置）

> Worker 是公开可访问的，无限流 = 任何人都能用你的 SEEKLI_API_KEY 建邮箱（垃圾邮件跳板）。
> 本规则在 **Cloudflare 面板**配置，不随代码部署（免费版 Workers 不含 rate limiting API，只能在控制台设置）。

## 规则内容

| 项 | 值 |
|---|---|
| 匹配请求 | `POST https://seek2addy.<你的子域>.workers.dev/api/v1/aliases` |
| 阈值 | 每 10 分钟 ≤ 100 次（单 IP） |
| 动作 | Block |
| 时段 | 10 秒 |

## 配置路径

Cloudflare 控制台 → 选择域名（或 workers.dev 子域）→ **安全性 → WAF → 速率限制规则 → 创建规则**：

1. **名称**：`seek2addy-aliases`；
2. **传入请求匹配**：`URI 路径` 等于 `/api/v1/aliases` 且 `请求方法` 等于 `POST`；
3. **速率限制**：10 次 / 10 秒（宽松版：100 次 / 10 分钟，与 AGENTS.md 一致）；
4. **操作**：Block。

> 说明：`workers.dev` 域名的 WAF 规则在 CF 控制台的"速率限制规则"页配置；
> 若绑定了自定义域，规则作用域选该域名即可。免费额度下 10 分钟 100 次足以覆盖个人使用。
