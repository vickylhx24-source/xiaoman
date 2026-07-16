# 菜谱抓取代理（可选后端）

物品管家 App 支持「从链接一键保存菜谱」。由于浏览器安全限制（CORS / 反爬），
**纯前端无法直接抓取小红书等站点的内容**，需要一个后端代理来中转。

本目录提供一个可直接运行的 Node 代理服务，App 的「我的 → 菜谱抓取代理」填写其地址后即可开启自动抓取。

## 运行

```bash
cd recipe-proxy
node server.js                 # 默认 http://localhost:3000
PORT=8080 node server.js      # 自定义端口
```

部署到服务器后（如 CloudStudio / 任意 Node 主机），把对外地址填进 App：
`https://你的域名:端口/parse`（App 会自动拼接 `?url=`）。

## 两种解析模式

| 模式 | 如何启用 | 能否解析小红书 |
|------|----------|----------------|
| 上游解析服务 | 设置环境变量 `XHS_ENDPOINT` 指向你的小红书解析 HTTP 接口 | ✅（取决于该服务） |
| 通用 OG 解析（默认退化） | 不设置 `XHS_ENDPOINT` | ❌ 仅对普通公开网页有效 |

### 接入真正的小红书解析

设置 `XHS_ENDPOINT` 指向一个提供 `GET ?url=...` 并返回如下 JSON 的服务：

```json
{ "title": "菜名", "images": ["https://...jpg"], "ingredients": ["鸡蛋 2个"], "steps": ["1. ...", "2. ..."] }
```

可选方案（均为社区项目，需自行评估合规性与可用性）：
- `xhs-read-mcp`：小红书链接解析 MCP 服务
- `media-crawler-mcp-service`：多平台媒体爬虫服务
- 任何返回上述结构的自建服务

```bash
XHS_ENDPOINT="https://你的解析服务/parse" PORT=3000 node server.js
```

## 合规提示

- 请仅保存你**有权保存**的内容（自己的笔记、已授权内容）。
- 勿用于批量爬取、商业转售或侵犯他人版权。
- 遵守目标平台的服务条款；小红书等平台对未授权抓取有明确限制。

## 接口

`GET /parse?url=<分享链接>`

返回（已规整）：

```json
{ "title": "...", "images": ["..."], "ingredients": ["..."], "steps": ["..."], "text": "..." }
```
