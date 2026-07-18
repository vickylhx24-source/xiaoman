// 把 icon.svg 渲染成 icon-192.png / icon-512.png
// 依赖 @resvg/resvg-js。优先本地 node_modules，找不到时回退常见全局位置。
const path = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
const { Resvg } = requireLoad('@resvg/resvg-js');

const svg = readFileSync('icon.svg', 'utf8');
for (const size of [192, 512]) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  writeFileSync(`icon-${size}.png`, r.render().asPng());
  console.log(`✓ icon-${size}.png`);
}

// 跨环境定位依赖：依次尝试 NODE_PATH、本地 node_modules、以及若干全局前缀
function requireLoad(name) {
  const candidates = [path.resolve('node_modules')];
  if (process.env.NODE_PATH) candidates.push(...process.env.NODE_PATH.split(path.delimiter));
  const homes = [process.env.USERPROFILE, process.env.HOME, process.env.APPDATA, 'C:\\Users\\Lenovo']
    .filter(Boolean);
  for (const h of homes) candidates.push(path.join(h, 'node_modules'), path.join(h, '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules'));
  for (const c of candidates) {
    try { return require(path.join(c, name)); } catch (_) {}
  }
  return require(name); // 兜底：默认解析
}
