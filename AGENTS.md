# AGENTS.md — 给接手本项目的 AI Agent / 续做说明

本项目是「小满」(xiaoman)：一个纯前端 PWA，用于家庭**物品/库存管理 + 菜谱管理 + 营养管理**。

> 如果之前的对话记录已丢失，只需读这个文件 + README.md + 代码即可完全续上，无需从零了解。

## 快速上手（新 agent 从这里开始）
- 本地路径：`D:\myagent\xiaoman`（git 仓库，已配好远程）
- 在线地址：`https://vickylhx24-source.github.io/xiaoman/`
- GitHub 仓库：`https://github.com/vickylhx24-source/xiaoman`（公开，main 分支）
- 若本地没有这份代码：`git clone https://github.com/vickylhx24-source/xiaoman.git`

## 更新 / 发布流程
1. 在 `D:\myagent\xiaoman` 修改代码
2. `git add -A && git commit -m "中文简述"`
3. `git push`（首次会弹 GitHub 登录，授权一次即记住；或用细粒度 PAT，权限只需 `Contents: Read+Write`）
4. GitHub Pages 自动从 `main` 分支 `/ (root)` 发布，约 1 分钟生效，无需其他操作

## 架构要点
- **纯静态**：HTML / CSS / 原生 JavaScript，无框架、无后端、无数据库服务
- **零 token 依赖**：部署后免维护；代码里不含任何密钥
- **本地存储**：IndexedDB 保存库存 / 菜谱（含图片）/ 饮食记录 / 设置；运行时用户数据**不进 git**，靠 App 内「备份/恢复」(全量 JSON) 迁移
- **菜谱分类**：`js/recipes.js` 的 `RECIPE_GROUPS`（自动按食材推断 + 编辑时可手动 `category` 覆盖；肉荤拆为鸡肉类/牛肉类/羊肉类/猪肉类/其他肉荤）
- **营养**：基于 DRIs 2023 标准，`js/nutrition.js`；智能识别食材营养素，**水/汤也识别为食材**（不会误报缺水）
- **图标**：`icon.svg` 手写；用 `@resvg/resvg-js`（managed node workspace，NODE_PATH 指向它）渲染 `icon-192.png` / `icon-512.png`。**改图标后务必重新渲染 PNG 并更新 `manifest.webmanifest`**
- **PWA**：`manifest.webmanifest` + `sw.js`（网络优先缓存）；iOS 主屏图标在安装时固化，需删掉重加「添加到主屏幕」才更新

## 文件地图
- `index.html` / `styles.css` — 页面结构、样式
- `js/app.js` — 主逻辑、视图路由、各模块渲染（库存/菜谱/营养/备份）
- `js/db.js` — IndexedDB 封装
- `js/recipes.js` — 菜谱数据与分类逻辑
- `js/nutrition.js` — 营养与食材识别
- `js/knowledge.js` — 知识库
- `recipe-proxy/` — 可选的本地图片代理（非运行时必需，GitHub Pages 静态托管用不到）
- `README.md` — 给用户看的功能介绍
- `AGENTS.md` — 本文件（给 agent 的续做说明）

## 约定
- 所有资源用**相对路径**（部署到 GitHub Pages 子路径 `/xiaoman/` 也正常打开）
- 根目录有 `.nojekyll`（防止 GitHub Pages 忽略带下划线的文件）
- 提交信息用中文简述改动
- 用户 GitHub 账户：`vickylhx24-source`
