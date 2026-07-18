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
- **图标**：`icon.svg` 手写，渲染流程见下方「图标修改流程」一节。**改图标后务必重新渲染 PNG**（否则线上还是旧图标）
- **PWA**：`manifest.webmanifest` + `sw.js`（网络优先缓存）；iOS 主屏图标在安装时固化，需删掉重加「添加到主屏幕」才更新

## 文件地图
- `index.html` / `styles.css` — 页面结构、样式
- `js/app.js` — 主逻辑、视图路由、各模块渲染（库存/菜谱/营养/备份）
- `js/db.js` — IndexedDB 封装
- `js/recipes.js` — 菜谱数据与分类逻辑
- `js/nutrition.js` — 营养与食材识别
- `js/knowledge.js` — 知识库
- `recipe-proxy/` — 可选的本地图片代理（非运行时必需，GitHub Pages 静态托管用不到）
- `scripts/render-icon.cjs` — 图标渲染脚本（见「图标修改流程」）
- `.gitignore` — 忽略 `node_modules/`（仅本地工具依赖）
- `README.md` — 给用户看的功能介绍
- `AGENTS.md` — 本文件（给 agent 的续做说明）

## 常见修改点速查
改需求时，先定位到对应文件，再动手。以下按「想改什么 → 改哪个文件 / 函数」列出：

| 想改的东西 | 文件 | 关键位置 / 说明 |
|---|---|---|
| 整体页面结构、Tab、弹窗 | `index.html` | 各模块的容器 div、灯箱 `#img-viewer`、编辑表单字段 |
| 样式 / 配色 / 布局 | `styles.css` | 分段控件 `.seg`、进度条 `.nutri-dim`、灯箱 `.iv-sheet` 等 |
| 各模块渲染与交互逻辑 | `js/app.js` | `renderNutriManage()`（按月→日分组）、`openNutriDayDetail()`（当日进度）、`recipeGroup(r)`（分类推断 + 手动 `category` 覆盖）、`recMineCat`（收藏分类条）、`openRecipe()`（灯箱 + 来源链接补 https）、图标按钮（🔍/🖼️） |
| 菜谱数据 / 分类规则 | `js/recipes.js` | `RECIPE_GROUPS`（自动按食材推断；肉荤拆为鸡肉类/牛肉类/羊肉类/猪肉类/其他肉荤）；编辑时可写 `category` 覆盖 |
| 食材营养素 / 智能识别 / 营养算法 | `js/nutrition.js` | 食材库（含水/汤）、`DB`/`NUTRIENTS`/`DRIS`/`parseFoods`、`nutriScore(covered)` |
| 本地数据库读写 | `js/db.js` | IndexedDB 封装（库存/菜谱/饮食/设置） |
| 备份 / 恢复（全量 JSON） | `js/app.js` + `index.html` | 导出含库存/菜谱(含图片)/饮食/设置；导入还原 |
| 图标 | `icon.svg` → 见「图标修改流程」 | 改完必须重渲染 PNG |
| 应用名 / 标题 / 文案 | `index.html` + `manifest.webmanifest` + `README.md` | 全文搜索「小满」 |

> 注意：所有页面文案、分类名、按钮 emoji 都可能分散在 `index.html` / `js/*.js` / `styles.css`，改文案用全局搜索最快。

## 图标修改流程
图标是手写 SVG，部署用的 PNG 必须由 SVG 重新渲染（不能手改 PNG）。步骤：

1. 编辑 `icon.svg`（矢量图形）。
2. 安装一次渲染依赖（装在仓库本地，已被 `.gitignore` 忽略，不会提交）：
   ```bash
   cd D:\myagent\xiaoman
   npm install @resvg/resvg-js
   ```
   > 若网络受限、无法 `npm install`，也可把依赖装到任意 node 工作区的 `node_modules`，脚本会自动回退探测 `NODE_PATH`、用户目录 `node_modules`、`.workbuddy` 隔离工作区等位置。
3. 渲染 PNG（自动定位依赖、输出 `icon-192.png` / `icon-512.png`）：
   ```bash
   node scripts/render-icon.cjs
   ```
4. `manifest.webmanifest` 里 icons 路径不变，一般无需改；确认无误后 `git add -A && git commit && git push`。
5. **测试**：GitHub Pages 约 1 分钟生效。iOS 主屏图标在安装时固化，需删掉主屏图标、重新「添加到主屏幕」才会更新；Android/桌面端刷新即可。

> 排错：若报 `Cannot find module '@resvg/resvg-js'`，说明依赖没装到脚本能找到的位置——优先用第 2 步 `npm install` 装到仓库本地 `node_modules`。

## 约定
- 所有资源用**相对路径**（部署到 GitHub Pages 子路径 `/xiaoman/` 也正常打开）
- 根目录有 `.nojekyll`（防止 GitHub Pages 忽略带下划线的文件）
- 根目录有 `.gitignore`，忽略 `node_modules/`（仅图标渲染等本地工具依赖，运行时不需要）
- 提交信息用中文简述改动
- 用户 GitHub 账户：`vickylhx24-source`
