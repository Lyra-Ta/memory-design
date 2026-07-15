# 托管 & 自动更新（酒馆里只写一行 import）

目标：酒馆助手脚本里永远只写一行
```js
import 'https://cdn.jsdelivr.net/gh/Lyra-Ta/memory-design@main/dist/index.js';
```
之后我只推源码、CI 自动构建，你在酒馆里刷新就拿到新版——不再手动搬 `dist/index.js`。

## 关键约束（先懂这个）

浏览器 `import` 那个 URL **必须公开可取**，且响应头要带
- `Access-Control-Allow-Origin`（CORS），
- `Content-Type: application/javascript`（正确 MIME）。

**源码可以私有，但被 import 的那个 `index.js` 天然是公开可取的**（浏览器要能下载它）。所以下面两条路都做到「源码私有 / 或只暴露编译产物」。

---

## 当前采用：公开 GitHub 仓库 + jsDelivr

- 仓库：`https://github.com/Lyra-Ta/memory-design`
- 发布文件：`https://cdn.jsdelivr.net/gh/Lyra-Ta/memory-design@main/dist/index.js`
- 酒馆助手脚本：

```js
import 'https://cdn.jsdelivr.net/gh/Lyra-Ta/memory-design@main/dist/index.js';
```

GitHub Actions 会在推送源码后执行测试、类型检查并重建 `dist/index.js`；若产物有变化，会自动提交回 `main`。

## 备选路线 A：源码私有 + Cloudflare Pages

最贴近你看到的那种（自定义域名、源码不公开、推送即更新）。

1. 在 GitHub 建 **私有** 仓库，把本目录（`实现/`）整个推上去（见下方命令）。
2. 到 Cloudflare → **Workers & Pages → 创建 → Pages → 连接 Git**，授权选这个私有仓库。
3. 构建设置：
   - Build command: `npm install && npm run build:plugin`
   - Build output directory: `dist`
4. 部署完成后得到 `https://<项目名>.pages.dev/`，你的地址就是
   `https://<项目名>.pages.dev/index.js`（Cloudflare 自动带 CORS + 正确 MIME）。
5. 以后我推源码 → Cloudflare 自动重建 → 你酒馆刷新即最新。

> 源码全程私有，只有编译后的 `index.js` 通过 Pages 公开。可再绑自定义域名。

---

## 路线 B（当前路线 · 源码公开）：公开 GitHub 仓库 + jsDelivr

1. 建 **公开** 仓库并推送。仓库里 `.github/workflows/build.yml` 会在每次推送后自动构建并回提交 `dist/index.js`。
2. 你的地址（jsDelivr）：
   - 跟最新：`https://cdn.jsdelivr.net/gh/Lyra-Ta/memory-design@main/dist/index.js`
   - 钉版本（更新更即时、可控）：`https://cdn.jsdelivr.net/gh/<用户名>/<仓库名>@<commit哈希或tag>/dist/index.js`

> jsDelivr 读不了私有仓，所以这条路源码是公开的。`@main` 有缓存（最长约 7 天），要秒更就用 `@commit哈希`，或用 [jsDelivr purge](https://www.jsdelivr.com/tools/purge) 手动刷。

---

## 首次推送命令（在 `实现/` 目录里跑）

```bash
git init -b main
git add -A
git commit -m "init: 记忆归档插件"
# 私有仓库（路线 A）：
gh repo create <仓库名> --private --source=. --push
# 或公开仓库（路线 B）：
gh repo create <仓库名> --public --source=. --push
# 没装 gh 就先在网页建空仓库，再：
# git remote add origin git@github.com:<用户名>/<仓库名>.git && git push -u origin main
```

## 之后每次更新

我改完源码 → 你 `git add -A && git commit -m "..." && git push` → CI 构建 →（路线 A）Cloudflare 自动部署 /（路线 B）dist 自动回提交 → 酒馆刷新。
（若你把仓库给我一个细粒度 token，我也能直接替你 push。）
