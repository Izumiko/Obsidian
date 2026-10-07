# Next.js 纯静态导出（Static Export）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `client/` 改造为 `output: 'export'` 的纯静态产物，由 nginx 直接 serve，不再依赖 `next start`。

**Architecture:** 所有服务端职责（i18n 检测、数据拉取、路由/查询参数读取）下放到浏览器；页面变为静态壳或客户端组件；6 个无边界动态路由用「占位壳 + nginx 回退」。

**Tech Stack:** Next.js 15 App Router、React 19、SWR、Tailwind 4、nginx。

**参考设计文档:** `docs/superpowers/specs/2026-10-07-static-export-design.md`

---

## 关键背景（实现者必读）

- 客户端 i18n Hook `useI18n()`（`app/hooks/useI18n.ts`）**已支持纯客户端语言检测**(cookie `i18nextLng` → `navigator.language` → 默认 `es`）并内置全部语言包。`t(key, fallback?)` 在缺失时返回 `fallback ?? key`，与 `serverT(key, language)` 行为等价。
- 详情/列表数据**已经**由客户端组件用 SWR + `fetch(API_BASE_URL)` + `localStorage` 的 bearer token 拉取（`lib/api.ts` 的 `API_BASE_URL = process.env.NEXT_PUBLIC_API_URL`)。
- 服务端组件中统一的反面模式（需移除）:
  ```tsx
  const headersList = await headers();
  const language = await getPreferredLanguage(headersList);
  const translations = { title: serverT('x.y', language), ... };
  ```
- 支持语言：`'en' | 'es' | 'zh'`，默认 `'es'`。

---

## 全局改造配方（Recipes)

### Recipe A —— 标准静态页面（serverT → useI18n)

适用：非动态路由、不含服务端数据 fetch 的 `page.tsx`。

**Before(``app/latest-torrents/page.tsx`` 片段）:**
```tsx
import { headers } from 'next/headers';
import { serverT, getPreferredLanguage } from '@/app/lib/server-i18n';

export default async function LatestTorrentsPage() {
  const headersList = await headers();
  const language = await getPreferredLanguage(headersList);
  const translations = { title: serverT('latestTorrents.title', language), /* ... */ };
  return <LatestTorrentsClient translations={translations} />;
}
```

**After:**
```tsx
'use client';
import { useI18n } from '@/app/hooks/useI18n';

export default function LatestTorrentsPage() {
  const { t } = useI18n();
  const translations = { title: t('latestTorrents.title'), /* ... 每个 serverT(k, language) 改成 t(k) ... */ };
  return <LatestTorrentsClient translations={translations} />;
}
```

要点：
1. 文件顶部加 `'use client';`。
2. 删除 `next/headers`、`server-i18n`、`LanguageSync` 相关 import 与调用。
3. `export default async function` → `export default function`（去 async)。
4. 每个 `serverT('some.key', language)` → `t('some.key')`（键名不变）。
5. 传给子组件的 `translations` 对象结构**保持不变**。
6. 若页面有 `export async function generateMetadata`，改为静态 `export const metadata: Metadata = { title: '...' }`，并加 `import type { Metadata } from 'next'`。注意：`metadata` 只能从 **server 组件**导出——因此此类页面**不能**整体 `'use client'`，而是：保留 `page.tsx` 为 server 组件（导出静态 `metadata`)，把 `useI18n` 逻辑下沉到一个新的 `XxxClient` 包装组件。详见 Task 9 对 `latest-torrents` 的处理。

### Recipe B —— 动态路由占位壳

适用：`torrent/[id]`、`user/[username]`、`wiki/[slug]`、`announcements/[id]`、`auth/signup/[code]`、`category/[name]/torrents`。

`page.tsx` **保持 server 组件**，导出 `generateStaticParams` 与静态 `metadata`，渲染一个新的 client 壳组件；壳组件用 `useParams()`/`usePathname()` 读取真实参数。

**`page.tsx` 模板：**
```tsx
import type { Metadata } from 'next';
import TorrentDetailClientShell from './components/TorrentDetailClientShell';

export const dynamicParams = false;
export function generateStaticParams() {
  return [{ id: '_placeholder' }];
}
export const metadata: Metadata = { title: 'Torrent' };

export default function TorrentPage() {
  return <TorrentDetailClientShell />;
}
```

**client 壳组件模板（`components/TorrentDetailClientShell.tsx`):**
```tsx
'use client';
import { useParams, usePathname } from 'next/navigation';
import DashboardWrapper from '@/app/dashboard/components/DashboardWrapper';
import TorrentDetailContent from './TorrentDetailContent';

export default function TorrentDetailClientShell() {
  const params = useParams();
  const pathname = usePathname();
  let id = typeof params?.id === 'string' ? params.id : (Array.isArray(params?.id) ? params.id[0] : '');
  if (!id || id === '_placeholder') {
    const seg = pathname.split('/').filter(Boolean);
    id = seg[1] || '';
  }
  if (!id) return null;
  return (
    <DashboardWrapper>
      <TorrentDetailContent torrentId={id} />
    </DashboardWrapper>
  );
}
```

`usePathname` 兜底时各路由真实参数所在 path 段索引（`pathname.split('/').filter(Boolean)` 后）:
- `/torrent/[id]` → `seg[1]`
- `/user/[username]` → `seg[1]`
- `/wiki/[slug]` → `seg[1]`
- `/announcements/[id]` → `seg[1]`
- `/auth/signup/[code]` → `seg[2]`
- `/category/[name]/torrents` → `seg[1]`（值需 `decodeURIComponent`)

---

## Task 列表

### Task 1: 配置 `next.config.ts` 启用静态导出

**Files:**
- Modify: `client/next.config.ts`

- [ ] **Step 1: 修改配置**

在 `nextConfig` 对象顶部加入三项（保留现有 `images.remotePatterns`，但强制 `unoptimized`):
```ts
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
    remotePatterns: [ /* 保持现状不变 */ ],
  },
};
```
即：新增 `output: 'export'`、`trailingSlash: true`，并把 `images.unoptimized` 由条件表达式改为常量 `true`（删除 `process.env.NODE_ENV ...` 那行的条件逻辑）。

- [ ] **Step 2: 提交**
```bash
git add client/next.config.ts
git commit -m "feat: [ADD: enable static export in next.config]"
```

---

### Task 2: `useI18n` 暴露 `language`

**Files:**
- Modify: `client/app/hooks/useI18n.ts`

- [ ] **Step 1: 修改返回值**

将文件末尾的 `return { t };` 改为：
```ts
  return { t, language };
```

- [ ] **Step 2: 提交**
```bash
git add client/app/hooks/useI18n.ts
git commit -m "feat: [ADD: expose detected language from useI18n]"
```

---

### Task 3: 新增 `ClientI18nRoot` 并改造 `layout.tsx`

**Files:**
- Create: `client/app/components/ClientI18nRoot.tsx`
- Modify: `client/app/layout.tsx`

- [ ] **Step 1: 创建 `ClientI18nRoot.tsx`**
```tsx
'use client';

import { useEffect } from 'react';

const SUPPORTED = ['en', 'es', 'zh'] as const;
const DEFAULT_LANG = 'es';

function detectLanguage(): string {
  try {
    const match = document.cookie.match(/(?:^|; )i18nextLng=([^;]+)/);
    const lng = match ? decodeURIComponent(match[1]) : '';
    if ((SUPPORTED as readonly string[]).includes(lng)) return lng;
  } catch {}
  const nav = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : DEFAULT_LANG).toLowerCase().slice(0, 2);
  return (SUPPORTED as readonly string[]).includes(nav) ? nav : DEFAULT_LANG;
}

export function ClientI18nRoot() {
  useEffect(() => {
    const lang = detectLanguage();
    document.documentElement.lang = lang;
    if (!/(?:^|; )i18nextLng=/.test(document.cookie)) {
      document.cookie = `i18nextLng=${lang}; path=/; max-age=31536000`;
    }
  }, []);
  return null;
}
```

- [ ] **Step 2: 改写 `layout.tsx`**

删除 `import { headers }`、`import { getPreferredLanguage }`、`import { LanguageSync }`，新增 `import { ClientI18nRoot } from './components/ClientI18nRoot';`。`RootLayout` 改为非 async,`<html lang="es">` 写死默认值，body 内用 `<ClientI18nRoot />` 替换 `<LanguageSync ... />`:
```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ToasterProvider from './components/ToasterProvider';
import SWRProvider from './components/SWRProvider';
import { ClientI18nRoot } from './components/ClientI18nRoot';

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Obsidian Tracker",
  description: "The OverPowered Torrent Tracker",
  icons: { icon: '/favicon.png', apple: '/favicon.png' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-text`} suppressHydrationWarning>
        <ClientI18nRoot />
        <ToasterProvider />
        <SWRProvider>
          {children}
        </SWRProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: 提交**
```bash
git add client/app/components/ClientI18nRoot.tsx client/app/layout.tsx
git commit -m "feat: [ADD: client-side i18n root and static layout]"
```

---

### Task 4: `DashboardWrapper` 客户端化

**Files:**
- Modify: `client/app/dashboard/components/DashboardWrapper.tsx`
- Read(确认 props): `client/app/dashboard/components/DashboardHeader.tsx`、`DashboardSidebar.tsx`

- [ ] **Step 1: 改写为 client 组件**

顶部加 `'use client';`。删除 `next/headers`、`server-i18n` import。用 `useI18n()` 取 `t` 与 `language`;branding 用 `useEffect`+`fetch` 拉取（失败回退 `'Obsidian Tracker'`)。`navItems` 的 `serverT('...', language)` 全部改为 `t('...')`。组件签名去 `async`。完整逻辑：
```tsx
'use client';
import { ReactNode, Suspense, useEffect, useState } from 'react';
import { useI18n } from '@/app/hooks/useI18n';
import DashboardHeader from './DashboardHeader';
import DashboardSidebar from './DashboardSidebar';
import { API_BASE_URL } from '@/lib/api';
import { MobileSidebarProvider } from '../context/MobileSidebarContext';

export default function DashboardWrapper({ children }: { children: ReactNode }) {
  const { t, language } = useI18n();
  const [brandingName, setBrandingName] = useState('Obsidian Tracker');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/config/branding`)
      .then(r => r.json())
      .then(b => { if (!cancelled && b?.brandingName) setBrandingName(b.brandingName); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const navItems = [
    { href: '/dashboard', label: t('sidebar.nav.home'), icon: 'Home' },
    { href: '/categories', label: t('sidebar.nav.categories'), icon: 'ListUl' },
    { href: '/requests', label: t('sidebar.nav.requests'), icon: 'HelpCircle' },
    { href: '/announcements', label: t('sidebar.nav.announcements'), icon: 'News' },
    { href: '/wiki', label: t('sidebar.nav.wiki'), icon: 'BookOpen' },
    { href: '/rss', label: t('sidebar.nav.rss'), icon: 'Rss' },
    { href: '/bookmarks', label: t('sidebar.nav.bookmarks'), icon: 'Bookmark' },
  ];

  return (
    <MobileSidebarProvider>
      <div className="h-screen bg-background overflow-hidden">
        <Suspense fallback={<div className="h-16 bg-surface border-b border-border fixed top-0 left-0 right-0 z-50" />}>
          <DashboardHeader language={language} brandingName={brandingName} />
        </Suspense>
        <Suspense fallback={<div className="w-64 bg-surface border-r border-border h-[calc(100vh-4rem)] fixed left-0 top-16 z-20" />}>
          <DashboardSidebar navItems={navItems} brandingName={brandingName} currentLanguage={language} />
        </Suspense>
        <main className="h-full lg:ml-64 pt-16 overflow-y-auto">
          <div className="p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </MobileSidebarProvider>
  );
}
```

- [ ] **Step 2: 提交**
```bash
git add client/app/dashboard/components/DashboardWrapper.tsx
git commit -m "refactor: [MOD: make DashboardWrapper client-side]"
```

---

### Task 5: `AdminDashboardWrapper` 客户端化

**Files:**
- Modify: `client/app/admin/components/AdminDashboardWrapper.tsx`

- [ ] **Step 1: 改写为 client 组件**

同 Task 4 模式：`'use client'`、去 `async`、`useI18n()` 取 `t`/`language`、branding 用 `useEffect`+`fetch`。12 个 nav item 的 `serverT('admin.nav.*', language)` 全改为 `t('admin.nav.*')`(key 不变）。`AdminHeader` 接收 `language`/`brandingName` props 保持不变；`AdminSidebar` 接收 `items` 不变。参照 Task 4 的完整代码结构改造，保留原有 className 与 `Suspense` 包裹。

- [ ] **Step 2: 提交**
```bash
git add client/app/admin/components/AdminDashboardWrapper.tsx
git commit -m "refactor: [MOD: make AdminDashboardWrapper client-side]"
```

---

### Task 6: 动态路由 —— `torrent/[id]`

**Files:**
- Modify: `client/app/torrent/[id]/page.tsx`
- Create: `client/app/torrent/[id]/components/TorrentDetailClientShell.tsx`

- [ ] **Step 1: 创建壳组件**（见 Recipe B 模板，段索引 `seg[1]`，无需 decode)

- [ ] **Step 2: 改写 `page.tsx`** 为 Recipe B 模板（`generateStaticParams` 返回 `[{ id: '_placeholder' }]`,metadata title `'Torrent'`)。删除原有 `headers`/`getPreferredLanguage`/`getTranslations`/`I18nProvider` 逻辑（`useI18n` 不依赖 Provider，可安全移除）。

- [ ] **Step 3: 提交**
```bash
git add client/app/torrent/[id]/page.tsx client/app/torrent/[id]/components/TorrentDetailClientShell.tsx
git commit -m "feat: [ADD: static shell for torrent detail route]"
```

---

### Task 7: 动态路由 —— `announcements/[id]`

**Files:**
- Modify: `client/app/announcements/[id]/page.tsx`
- Create: `client/app/announcements/[id]/components/AnnouncementDetailShell.tsx`

- [ ] **Step 1: 创建壳组件**

`'use client'`。用 `useParams()`/`usePathname()`(`seg[1]`）取 `id`；用 `useI18n()` 构建原 `translations` 对象（8 个 key:`sidebar.nav.announcements`、`dashboard.backToAnnouncements`、`dashboard.createdBy`、`dashboard.createdAt`、`dashboard.updatedAt`、`dashboard.notFound`、`dashboard.error`、`dashboard.loading`)；渲染 `<DashboardWrapper>` 包裹 `<AnnouncementDetailClient announcementId={id} translations={translations} />`，保留原骨架与外层 `<div className="max-w-7xl mx-auto px-4">` 及标题块。

- [ ] **Step 2: 改写 `page.tsx`** 为 Recipe B 模板（`generateStaticParams` → `[{ id: '_placeholder' }]`,metadata title `'Announcement'`，渲染 `AnnouncementDetailShell`)。

- [ ] **Step 3: 提交**
```bash
git add client/app/announcements/[id]/page.tsx client/app/announcements/[id]/components/AnnouncementDetailShell.tsx
git commit -m "feat: [ADD: static shell for announcement detail route]"
```

---

### Task 8: 动态路由 —— `category/[name]/torrents`

**Files:**
- Modify: `client/app/category/[name]/torrents/page.tsx`
- Create: `client/app/category/[name]/torrents/components/CategoryTorrentsShell.tsx`

- [ ] **Step 1: 创建壳组件**

`'use client'`。取 `name`:`useParams()`/`usePathname()`(`seg[1]`）并 `decodeURIComponent`。`searchParams` 改用 `useSearchParams()`，构造 `{ page, source, sort }` 对象（`sp.get('page') || undefined` 等）。用 `useI18n()` 构建原 `translations` 对象（key 与原文件完全一致：`categoryTorrents.*`、`sidebar.nav.home`、`sidebar.nav.categories`)。渲染 `<DashboardWrapper>` 包裹 `<CategoryTorrentsClient categoryName={categoryName} searchParams={searchParams} translations={translations} />`，保留骨架。

注意：`useSearchParams()` 需在 `<Suspense>` 内使用。壳组件本体读取 `useSearchParams`，因此 `page.tsx` 渲染壳时外层包 `<Suspense fallback={null}>`。

- [ ] **Step 2: 改写 `page.tsx`**
```tsx
import type { Metadata } from 'next';
import { Suspense } from 'react';
import CategoryTorrentsShell from './components/CategoryTorrentsShell';

export const dynamicParams = false;
export function generateStaticParams() {
  return [{ name: '_placeholder' }];
}
export const metadata: Metadata = { title: 'Category' };

export default function CategoryTorrentsPage() {
  return <Suspense fallback={null}><CategoryTorrentsShell /></Suspense>;
}
```

- [ ] **Step 3: 提交**
```bash
git add client/app/category/[name]/torrents/page.tsx client/app/category/[name]/torrents/components/CategoryTorrentsShell.tsx
git commit -m "feat: [ADD: static shell for category torrents route]"
```

---

### Task 9: `latest-torrents`（含 generateMetadata)

**Files:**
- Modify: `client/app/latest-torrents/page.tsx`
- Create: `client/app/latest-torrents/components/LatestTorrentsPageClient.tsx`

- [ ] **Step 1: 创建 client 组件** `LatestTorrentsPageClient.tsx`,`'use client'`，用 `useI18n()` 构建 `translations`(key 与原文件一致）并渲染原有 JSX(`DashboardWrapper` + 标题 + `LatestTorrentsClient`)。

- [ ] **Step 2: 改写 `page.tsx`** 为 server 组件：删除 `generateMetadata`，改 `export const metadata: Metadata = { title: 'Latest Torrents' };`,`export default function` 渲染 `<LatestTorrentsPageClient />`。

- [ ] **Step 3: 提交**
```bash
git add client/app/latest-torrents/page.tsx client/app/latest-torrents/components/LatestTorrentsPageClient.tsx
git commit -m "refactor: [MOD: static metadata + client body for latest-torrents]"
```

---

### Task 10: 动态路由 —— `user/[username]`(server fetch → client)

**Files:**
- Modify: `client/app/user/[username]/page.tsx`
- Create: `client/app/user/[username]/components/PublicProfileShell.tsx`
- Read: `client/app/user/[username]/components/PublicProfileContent.tsx`（确认其 props/数据形态）

- [ ] **Step 1: 创建壳组件** `PublicProfileShell.tsx`,`'use client'`。取 `username`(`seg[1]`,`decodeURIComponent`)。用 SWR `fetch(\`${API_BASE_URL}/user/\${username}\`)`(cache no-store 语义 → 加 `{ cache: 'no-store' }`)，处理三种结果：加载中骨架；`404`/网络错误 → 渲染「未找到」UI（用 `useI18n` 的 `t`)；`403`/`error==='private'` → 渲染私有资料 UI（原文案来自 `publicProfile.private.title/description`，改用 `t(...)`)；成功 → `<PublicProfileContent profile={profile} />`。整体包在 `<DashboardWrapper>`。

- [ ] **Step 2: 改写 `page.tsx`** 为 Recipe B 模板（`generateStaticParams` → `[{ username: '_placeholder' }]`，删除 `generateMetadata`，改 `export const metadata: Metadata = { title: 'Profile' }`，渲染 `PublicProfileShell`)。

- [ ] **Step 3: 提交**
```bash
git add client/app/user/[username]/page.tsx client/app/user/[username]/components/PublicProfileShell.tsx
git commit -m "feat: [ADD: static shell for public profile route]"
```

---

### Task 11: 动态路由 —— `wiki/[slug]`(server fetch → client)

**Files:**
- Modify: `client/app/wiki/[slug]/page.tsx`
- Create: `client/app/wiki/[slug]/components/WikiPageShell.tsx`
- Read: `client/app/wiki/[slug]/components/WikiPageClient.tsx`（确认 props)

- [ ] **Step 1: 创建壳组件** `WikiPageShell.tsx`,`'use client'`。取 `slug`(`seg[1]`,`decodeURIComponent`)。SWR 拉 `\`${API_BASE_URL}/wiki/\${slug}\``；加载中渲染原 `WikiPageSkeleton`（把骨架移入壳组件）；失败/空 → 「未找到」UI(`t`)；成功 → 渲染标题块（`page.title` + `t('wiki.pageDescription')`)+ `<WikiPageClient page={page} />`，整体包 `<DashboardWrapper>`。

- [ ] **Step 2: 改写 `page.tsx`** 为 Recipe B 模板（`generateStaticParams` → `[{ slug: '_placeholder' }]`,metadata title `'Wiki'`，渲染 `WikiPageShell`)。

- [ ] **Step 3: 提交**
```bash
git add client/app/wiki/[slug]/page.tsx client/app/wiki/[slug]/components/WikiPageShell.tsx
git commit -m "feat: [ADD: static shell for wiki page route]"
```

---

### Task 12: 动态路由 —— `auth/signup/[code]`(server fetch → client)

**Files:**
- Modify: `client/app/auth/signup/[code]/page.tsx`
- Create: `client/app/auth/signup/[code]/components/InviteSignupShell.tsx`

- [ ] **Step 1: 创建壳组件** `InviteSignupShell.tsx`,`'use client'`。取 `code`(`seg[2]`)。SWR 拉 `\`${API_BASE_URL}/invite/\${code}\`` 得 `inviteInfo`；用 `useI18n()` 构建原 `serverTranslations` 对象（key 与原文件完全一致）。按原逻辑渲染 `AuthCard` + 邀请信息块 +（有效时）`<SignUpForm registrationMode="INVITE" inviteCode={code} hideInviteUi serverTranslations={...} />`，加 `<LanguageSelector />`。移除 `LanguageSync`（语言由 `ClientI18nRoot` 处理）。加载中渲染骨架或 `null`。

- [ ] **Step 2: 改写 `page.tsx`** 为 Recipe B 模板（`generateStaticParams` → `[{ code: '_placeholder' }]`,metadata title `'Sign Up'`，渲染 `InviteSignupShell`)。

- [ ] **Step 3: 提交**
```bash
git add client/app/auth/signup/[code]/page.tsx client/app/auth/signup/[code]/components/InviteSignupShell.tsx
git commit -m "feat: [ADD: static shell for invite signup route]"
```

---

### Task 13: 首页 `app/page.tsx`(server fetch → client)

**Files:**
- Modify: `client/app/page.tsx`
- Create: `client/app/components/HomePageClient.tsx`（或就地改造）

- [ ] **Step 1: 客户端化**

首页含服务端 fetch(`/stats`、`/config/branding`）与大量 `serverT`。改造：新建 `HomePageClient.tsx`,`'use client'`，用 `useI18n()` 取 `t`;`/config/branding` 与 `/stats` 用 SWR 在客户端拉取（保留原有骨架/错误 UI);`SiteStatistics` 改为客户端组件（用 SWR 拉 `/stats`)。所有 `serverT('home.*', language)` 改 `t('home.*')`。`page.tsx` 变为 server 组件，导出静态 `metadata`（沿用 layout 默认或 `title: 'Obsidian Tracker'`),`export default function Home(){ return <HomePageClient/> }`。

- [ ] **Step 2: 提交**
```bash
git add client/app/page.tsx client/app/components/HomePageClient.tsx
git commit -m "refactor: [MOD: client-side home page]"
```

---

### Task 14: 批量静态页改造 —— 第一批（dashboard 区）

**Files（均按 Recipe A):**
- `client/app/dashboard/page.tsx`
- `client/app/bookmarks/page.tsx`
- `client/app/rss/page.tsx`
- `client/app/requests/page.tsx`
- `client/app/categories/page.tsx`
- `client/app/search/page.tsx`

- [ ] **Step 1: 逐个应用 Recipe A**(`'use client'`、`useI18n()`、`serverT(k, language)`→`t(k)`、去 `async`、删 `headers`/`server-i18n`/`LanguageSync`)。若某文件有 `generateMetadata`，参照 Task 9 拆出 client 组件。

- [ ] **Step 2: 本地校验** `cd client && npx tsc --noEmit`（应无新增类型错误）。

- [ ] **Step 3: 提交**
```bash
git add client/app/dashboard client/app/bookmarks client/app/rss client/app/requests client/app/categories client/app/search
git commit -m "refactor: [MOD: client i18n for dashboard-section pages]"
```

---

### Task 15: 批量静态页改造 —— 第二批（auth 区）

**Files（均按 Recipe A):**
- `client/app/auth/signin/page.tsx`
- `client/app/auth/signup/page.tsx`
- `client/app/auth/unverified/page.tsx`
- `client/app/profile/page.tsx`
- `client/app/wiki/page.tsx`
- `client/app/announcements/page.tsx`
- `client/app/torrent/upload/page.tsx`

- [ ] **Step 1: 逐个应用 Recipe A**(auth 页多把 `serverTranslations` 传给表单组件，结构保持不变，仅把 `serverT` 换成 `t` 并确保文件为 client)。

- [ ] **Step 2: 本地校验** `cd client && npx tsc --noEmit`。

- [ ] **Step 3: 提交**
```bash
git add client/app/auth client/app/profile client/app/wiki client/app/announcements client/app/torrent/upload
git commit -m "refactor: [MOD: client i18n for auth/profile/wiki pages]"
```

---

### Task 16: 批量静态页改造 —— 第三批（admin 区）

**Files（均按 Recipe A):**
- `client/app/admin/wiki/page.tsx`
- `client/app/admin/categories/page.tsx`
- `client/app/admin/peerban/page.tsx`
- `client/app/admin/users/page.tsx`
- `client/app/admin/requests/page.tsx`
- `client/app/admin/announcements/page.tsx`
- `client/app/admin/torrent-approvals/page.tsx`
- `client/app/admin/settings/page.tsx`
- `client/app/admin/rss-management/page.tsx`
- `client/app/admin/torrent-management/page.tsx`
- `client/app/admin/ranks/page.tsx`（若使用 serverT)

- [ ] **Step 1: 逐个应用 Recipe A**。

- [ ] **Step 2: 本地校验** `cd client && npx tsc --noEmit`。

- [ ] **Step 3: 提交**
```bash
git add client/app/admin
git commit -m "refactor: [MOD: client i18n for admin pages]"
```

---

### Task 17: 清理 `server-i18n.ts` 的服务端依赖

**Files:**
- Modify: `client/app/lib/server-i18n.ts`
- Read: 全库 grep 确认无残余 `getPreferredLanguage`/`getLanguageFromCookies` 调用。

- [ ] **Step 1: 验证无引用**
```bash
cd client && grep -rn "getPreferredLanguage\|getLanguageFromCookies\|from.*server-i18n\|next/headers" app
```
预期：除 `server-i18n.ts` 自身外无匹配。

- [ ] **Step 2: 删除或简化**

若 `serverT`/`getTranslations` 仍被引用则保留这些纯函数；否则删除整个 `server-i18n.ts`。优先：全部迁移完成后删除该文件。删除 `import { cookies } from "next/headers"` 及 `getLanguageFromCookies`/`getPreferredLanguage`/`getLanguageFromHeaders`。

- [ ] **Step 3: 提交**
```bash
git add client/app/lib/server-i18n.ts
git commit -m "chore: [DEL: remove server-only i18n helpers]"
```

---

### Task 18: 构建验证 + 修复

**Files:**
- `client/` 全量

- [ ] **Step 1: 构建**
```bash
cd client && npx next build
```
预期：产出 `client/out/`。逐一修复报错（常见：遗漏的 `next/headers`、动态路由缺 `generateStaticParams`、`useSearchParams` 未包 Suspense、client 组件导出 `metadata`)。

- [ ] **Step 2: 确认产物**
```bash
cd client && ls out
```
预期：存在 `index.html`、`torrent/_placeholder/index.html`、`user/_placeholder/index.html`、`wiki/_placeholder/index.html`、`announcements/_placeholder/index.html`、`auth/signup/_placeholder/index.html`、`category/_placeholder/torrents/index.html` 等。

- [ ] **Step 3: 提交**
```bash
git add -A client
git commit -m "build: [FIX: resolve static export build errors]"
```

---

### Task 19: nginx 配置示例

**Files:**
- Create: `client/nginx.static.conf.example`

- [ ] **Step 1: 编写示例配置**
```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/obsidian-client/out;   # 指向 client/out
    index index.html;

    # 静态资源与 _next 直接命中
    location /_next/ { try_files $uri =404; }

    # 无边界动态路由 -> 占位壳
    location /torrent/       { try_files $uri $uri/ /torrent/_placeholder/index.html; }
    location /user/          { try_files $uri $uri/ /user/_placeholder/index.html; }
    location /wiki/          { try_files $uri $uri/ /wiki/_placeholder/index.html; }
    location /announcements/ { try_files $uri $uri/ /announcements/_placeholder/index.html; }
    location /auth/signup/   { try_files $uri $uri/ /auth/signup/_placeholder/index.html; }
    location ~ ^/category/[^/]+/torrents/ {
        try_files $uri $uri/ /category/_placeholder/torrents/index.html;
    }

    # 其余静态页
    location / { try_files $uri $uri/ =404; }
}
```

注意：`/wiki/`、`/announcements/`、`/auth/signup/`、`/category/.../torrents` 的前缀会同时覆盖其「列表页」静态路由（如 `/wiki/index.html`)。因 `try_files $uri $uri/` 在前，真实存在的静态文件优先命中，仅当文件不存在时才回退到占位壳，因此列表页不受影响。

- [ ] **Step 2: 提交**
```bash
git add client/nginx.static.conf.example
git commit -m "docs: [ADD: nginx static serving example config]"
```

---

## Self-Review 记录

- **Spec 覆盖：** 配置（T1)、i18n 客户端化（T2/T3)、数据客户端化（T4/T5/T10/T11/T12/T13)、6 动态路由（T6-T12)、metadata(T9/T10/T11/T12)、searchParams(T8)、批量 serverT 页（T14-T16)、清理（T17)、构建验证（T18)、nginx(T19)。全覆盖。
- **占位符：** Recipe B/壳组件模板给出完整代码；批量任务引用 Recipe A 并给出完整 Before/After 示例，文件清单明确。
- **类型一致性：** `useI18n()` 返回 `{ t, language }`(T2 定义，T4/T5/各壳使用一致）;`generateStaticParams` 占位值统一为 `'_placeholder'`。
