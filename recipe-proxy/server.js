/*
 * 菜谱抓取代理（可选后端）
 * ------------------------------------------------------------
 * 物品管家 App 的「我的 → 菜谱抓取代理」填写本服务的地址后，
 * 在 App 里粘贴小红书/抖音链接即可一键自动提取 标题 / 图片 / 食材 / 步骤。
 *
 * 运行：
 *   node server.js            # 默认端口 3000
 *   PORT=8080 XHS_ENDPOINT=... node server.js
 *
 * 说明（务必阅读）：
 *   - 纯前端浏览器受 CORS / 反爬限制，无法直接抓取小红书，所以必须有一个后端代理。
 *   - 本服务支持两种模式：
 *       1) 设置环境变量 XHS_ENDPOINT 指向你自己的小红书解析服务
 *          （例如自行部署的 xhs-read-mcp、media-crawler-mcp-service 等，
 *           需其提供 GET ?url=... 返回 {title, images, ingredients, steps} 的 HTTP 接口）。
 *           这是真正能解析小红书的方式。
 *       2) 未设置 XHS_ENDPOINT 时，退化为「通用网页 OG 元数据解析」，
 *          对普通博客/公开网页有效，但对小红书等强反爬站点通常取不到正文。
 *   - 合规提示：请仅用于保存你有权保存的内容（如自己的笔记、已授权内容），
 *     勿用于批量爬取或侵权用途；遵守目标平台服务条款。
 *
 * 接口：
 *   GET /parse?url=<分享链接>
 *   返回 JSON：{ title, images:[url...], ingredients:[...], steps:[...], text }
 */

const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const XHS_ENDPOINT = process.env.XHS_ENDPOINT || '';

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function cors(res) { res.setHeader('Access-Control-Allow-Origin', '*'); }

async function ogParse(targetUrl) {
  const r = await fetch(targetUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN' },
    redirect: 'follow'
  });
  const html = await r.text();
  const meta = (name) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'))
          || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i'));
    return m ? m[1] : '';
  };
  const title = meta('og:title') || ((html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '');
  const desc = meta('og:description');
  const image = meta('og:image');
  return { title: title.trim(), images: image ? [image] : [], text: desc, ingredients: [], steps: [] };
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/parse') {
    const target = u.searchParams.get('url');
    if (!target) return send(res, 400, { error: '缺少 url 参数' });
    try {
      if (XHS_ENDPOINT) {
        const r = await fetch(`${XHS_ENDPOINT}?url=${encodeURIComponent(target)}`, { cache: 'no-store' });
        if (!r.ok) return send(res, 502, { error: '上游解析服务返回 ' + r.status });
        const data = await r.json();
        return send(res, 200, {
          title: data.title || data.name || '',
          images: Array.isArray(data.images) ? data.images : (data.image ? [data.image] : []),
          ingredients: Array.isArray(data.ingredients) ? data.ingredients : (data.ingredientsText ? [data.ingredientsText] : []),
          steps: Array.isArray(data.steps) ? data.steps : (data.text ? data.text.split('\n').filter(Boolean) : []),
          text: data.text || ''
        });
      }
      const d = await ogParse(target);
      return send(res, 200, d);
    } catch (e) {
      return send(res, 502, { error: String((e && e.message) || e) });
    }
  }
  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`recipe-proxy on :${PORT}  XHS_ENDPOINT=${XHS_ENDPOINT || '(未设置，使用通用OG解析)'}`));
