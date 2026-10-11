# Next.js 纯静态导出（Static Export）重构设计

日期：2026-10-07
状态：已批准
范围：`client/`(Next.js 15 App Router）

## 背景与目标

`client` 目前是依赖 `next start`(Node 服务）运行的动态 SSR 应用。目标是改造为 `output: 'export'` 的纯静态产物，直接由 nginx serve，不再依赖 Next 服务进程。

已与需求方确认：

- **完全客户端渲染可接受**：所有页面为首屏空 HTML 壳 + 浏览器端 JS 拉数据（类 SPA)，无 SEO/SSR 要求。
- **无边界动态路由**采用「占位壳 + nginx 回退」方案。

## 当前阻碍（重构前）

1. `layout.tsx` 及约 30 个 `page.tsx` 调用 `headers()` / `cookies()`（服务端 i18n 检测），强制动态渲染。
2. 多个页面/组件在服务端 `fetch`(branding、站点统计、wiki、用户资料、邀请码），构建期无法执行。
3. 6 个动态路由依赖构建期未知的无边界参数。
4. `next/image` 默认优化需要服务端。
5. 2 个动态 `generateMetadata`(`latest-torrents`、`user/[username]`)。
6. `category` 页使用服务端 `searchParams`。

## 现有有利条件

- 详情/列表数据**已经**由客户端组件通过 SWR + `fetch(API_BASE_URL)` + `localStorage` bearer token 拉取。
- `useI18n`(`app/hooks/useI18n.ts`)**已经**支持纯客户端语言检测（cookie `i18nextLng` → `navigator.language` → 默认 `es`）并内置全部语言包，无需服务端喂资源。

## 设计方案

### 1. 配置层（`client/next.config.ts`)

- `output: 'export'`
- `images.unoptimized: true`（静态导出无法运行图片优化；`remotePatterns` 随之失效，保留无害）
- `trailingSlash: true`（导出为 `path/index.html` 目录结构，便于 nginx `try_files`)
- 构建期需注入 `NEXT_PUBLIC_API_URL`（公网 API 地址，现状已如此，值在 build 时固化进产物）

### 2. i18n 客户端化

- `layout.tsx` 移除 `headers()`/`getPreferredLanguage()`；`<html lang>` 由 client 组件挂载后通过 `document.documentElement.lang` 设置。
- 复用 `useI18n` 的客户端检测，不再经 `I18nProvider` 注入服务端资源。
- 移除 `app/lib/server-i18n.ts` 对 `next/headers` 的 `cookies()` 依赖（该文件改为纯函数或删除，视调用点迁移结果而定）。
- 已知代价：首屏可能短暂以默认语言渲染后切换。已确认接受。

### 3. 数据拉取客户端化

- `app/page.tsx`（站点统计、branding)、`DashboardWrapper`(branding）的 server `fetch` 移入对应 client 组件，用 SWR/fetch。
- `wiki/[slug]`、`user/[username]`、`auth/signup/[code]` 目前的 server 端 fetch + `notFound()` + `generateMetadata` 改为 client 组件内 SWR 拉取；用加载/错误/「未找到」UI 替代 `notFound()`。
- `category/[name]/torrents` 的 server `searchParams` 改为 client `useSearchParams()`。

### 4. 动态路由（占位壳 + nginx 回退）

对以下 6 个动态路由：

- `torrent/[id]`
- `user/[username]`
- `wiki/[slug]`
- `announcements/[id]`
- `auth/signup/[code]`
- `category/[name]/torrents`

处理方式：

- 每个新增 `generateStaticParams()` 返回单条占位参数（如 `{ id: '_placeholder' }`)，导出一份壳 HTML。
- 页面改为 client 组件，用 `useParams()` 读取真实参数（主），失败时用 `usePathname()` 解析兜底。
- 2 个 `generateMetadata` 改为静态 `metadata` 导出。
- nginx 用 `try_files` 将上述前缀回退到各自占位壳。

### 5. nginx 配置（示例，交付物之一）

- 静态资源直接 serve(`client/out/` 为 root)。
- 6 个动态前缀 `try_files` 回退到对应占位壳。
- 其余路径 `try_files $uri $uri/ =404`。
- **不再运行 `next start`。**

## 关键实现风险

动态路由壳在硬加载（hard load）时 `useParams()` 的参数还原：浏览器 URL 为真实路径（如 `/torrent/123`)，但 serve 的 HTML 由占位参数生成。Next 客户端路由在 hydration 时会基于真实 URL 匹配路由，预期 `useParams()` 返回真实参数；实现时先采用 `useParams()`，若不准确则改用 `usePathname()` 按前缀解析兜底。

## 范围与工作量

- 约 30 个使用 `headers()` 的页面 + 6 个动态路由 + 布局与配置。
- 改动量大但以机械式改造为主。
- 明确不做 SEO 优化。

## 验收标准

- `cd client && next build` 产出 `client/out/` 静态目录，构建期不发起任何请求上下文相关错误。
- nginx serve `client/out/` 后：静态页、6 个动态路由（任意真实 ID)、i18n 切换、登录态数据拉取均正常工作。
- 整个流程不依赖 `next start`。
