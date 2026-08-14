# Seek2Addy

> 把 seek.li（NodeSeek 邮箱）的邮箱创建能力，翻译成 Addy.io 兼容 API，让 Bitwarden 等支持 Addy.io 协议的工具可以直接生成 seek.li 别名邮箱。

## 这是什么

Bitwarden 的"用户名生成器"内置了对 Addy.io 等别名提供商的集成，但**不支持 seek.li**。
Seek2Addy 是一个部署在 **Cloudflare Workers** 上的中间件：

- 对外（面向 Bitwarden）实现 **Addy.io 协议**（`POST /api/v1/aliases`）；
- 对内（面向 seek.li）调用 **NodeSeek Mail API**（`POST /openapi/v1/mailboxes`）创建邮箱。

Bitwarden 只需要把 Forwarder 类型选为 **Addy.io**、API URL 指向本 Worker，即可在生成密码时一键创建 seek.li 别名邮箱。

![效果演示](https://cdn.nodeimage.com/i/ARHMywsIS4kLgUeSkF5me5eDW6JJoAxW.gif)

![效果截图](https://cdn.nodeimage.com/i/60Uzjyj7eol2PiwDJi8HZaKiYUFXgOjT.webp)

## 部署教程

### Fork仓库

https://github.com/Yeqingky/Seek2Addy

### 部署在Cloudflare Works

![image](https://cdn.nodeimage.com/i/oQVzVBbqWpjW2HjKsrXfXQf80wnG9Gow.webp)

![image](https://cdn.nodeimage.com/i/FXdCmFUm00tiXcl593IPU5UGAcWlXSzA.webp)

绑定你的Github账户 选择你刚刚Fork后创建的仓库

![image](https://cdn.nodeimage.com/i/acD1JnqHomZkmw0QGubfAXQINlfE5IAO.webp)

保持默认即可

![image](https://cdn.nodeimage.com/i/tnp3k8WO4ar8W68aOEXDmMNc1vOmtmDA.webp)

添加两个环境变量 别忘了勾选右小角的密钥

`AUTH_TOKEN` 任意随机字符 用命令`openssl rand -base64 32`生成 或者直接复用下面的值也行

`SEEKLI_API_KEY` Seek.li的开发者API密钥 只需要`mailbox:write`权限 如下图

![image](https://cdn.nodeimage.com/i/tvqpJBRgR5EEUJLfYwBgPoVms0JplAMG.webp)

然后去重新部署一下

Bitwarden侧的设置如下图填写 服务选 `Addy.io` 电子邮箱域名填写`seek.li`或`nodeseek.org` API密钥是上面设置的`AUTH_TOKEN` 自托管服务器Url填Works域名(如下下图)

![image](https://cdn.nodeimage.com/i/bh8qRiwEpiqQ2FP2swiGCcT7DGUKlDiO.webp)

![image](https://cdn.nodeimage.com/i/YVvgwMBUOiGjgMnl3mt9jYsCQB2p9O1H.png)

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
