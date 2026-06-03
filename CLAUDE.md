# PassBar — Development Guidelines

## Design System: Typography

### Page-level headings

| Level | Usage | Class |
|-------|-------|-------|
| Page title (H1) | 每個頁面主標題，只出現一次 | `text-4xl font-bold text-primary` |
| Section title (H2) | 頁面內區塊標題（非 Card，帶 icon） | `text-base font-bold text-slate-800 flex items-center gap-2` |

### Card headings

shadcn `CardTitle` 預設 `text-2xl`，**一律覆寫**：

| Level | Usage | Class |
|-------|-------|-------|
| Card title | Card 主標題 | `text-base font-semibold` |
| Card subtitle | 緊接 title 下方，用 `<p>` 不用 `CardDescription` | `text-sm text-muted-foreground mt-0.5` |

> **不使用 `CardDescription`** — shadcn 內建 `space-y-1.5` 容易讓標題區擠在一起，改用 `<p>` 直接放在 `CardHeader` 內。

### Body / Label text

| Level | Usage | Class |
|-------|-------|-------|
| Body | 一般段落文字 | `text-sm text-slate-700` |
| Body muted | 說明性副文字 | `text-sm text-muted-foreground` |
| Label | 欄位標籤、metadata | `text-xs text-muted-foreground` |
| Label uppercase | 區塊分類標籤（如 "TEST MODE"） | `text-xs font-semibold uppercase tracking-wider text-slate-500` |
| Stat number (large) | 主要數字（正確率、分數） | `text-3xl font-bold` |
| Stat number (medium) | 次要數字 | `text-2xl font-bold` |

### CardHeader padding

```tsx
<CardHeader className="pb-3">   // 有副標題
<CardHeader className="pb-2">   // 無副標題
```

---

## Design System: Layout

### Page wrapper

`layout.tsx` 的 `<main>` 已套用 `mx-auto w-full max-w-7xl px-4 pb-4 pt-5 md:p-8`。

**頁面根元素絕對不加** `mx-auto`、`max-w-*`、`px-*`、`py-*`，只加動畫與間距：

```tsx
// ✅ 標準頁面
<div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

// ✅ Dashboard（stagger 動畫）
<div className={cn(
  'space-y-8 transition-all duration-700',
  visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
)}>

// ❌ 錯誤：不要加 mx-auto max-w-* — layout 已處理
<div className="mx-auto max-w-4xl space-y-6 ...">
```

> **根本原因**：layout.tsx 第 14 行已有 `max-w-7xl mx-auto px-4 pb-4 pt-5 md:p-8`。頁面若再加自己的 `mx-auto max-w-*`，會產生雙層 constraint，導致左右 padding 比其他頁面窄，視覺上像是「縮在中間」。

### Page header

```tsx
<header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
  <div>
    <h1 className="text-4xl font-bold text-primary">{t('page.title')}</h1>
    <p className="text-muted-foreground mt-1">{t('page.description')}</p>
  </div>
  {/* 右側：action buttons */}
</header>
```

### Main content padding（`layout.tsx` 控制）

```
mobile:  px-4 pb-4 pt-5
desktop: p-8
max-width: max-w-7xl mx-auto  ← layout 處理，頁面不重複
```

### Grid patterns

```tsx
// 統計數字卡片
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

// 內容 2/3 + sidebar 1/3
<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
  <Card className="lg:col-span-2 ...">
```

### Section spacing

```tsx
space-y-6   // 一般頁面各區塊間距
space-y-8   // Dashboard 較寬鬆
gap-4       // Card grid
gap-8       // 大版塊之間
```

---

## Design System: Cards

### 標準 Card

```tsx
<Card className="hover:shadow-md transition-shadow">
```

### 重要 / highlight Card（帶 primary 色調）

```tsx
<Card className="hover:shadow-md transition border-primary/20 bg-primary/5">
```

### 統計 KPI Card（dashboard 頂部）

```tsx
<Card className="bg-white/50 border-primary/10 shadow-sm transition-all duration-500 hover:shadow-md">
```

### Empty state Card

```tsx
<Card className="border-dashed">
  <CardContent className="flex flex-col items-center py-10 gap-3 text-center">
    <IconComponent className="h-8 w-8 text-muted-foreground" />
    <p className="text-sm text-muted-foreground">{t('page.noData')}</p>
    <Button asChild size="sm"><Link href="/create">...</Link></Button>
  </CardContent>
</Card>
```

### Stagger 入場動畫（dashboard KPI cards）

```tsx
style={{ transitionDelay: '0ms' }}    // 第 1 張
style={{ transitionDelay: '60ms' }}   // 第 2 張
style={{ transitionDelay: '120ms' }}  // 第 3 張
style={{ transitionDelay: '180ms' }}  // 第 4 張
```

---

## Design System: Buttons

| 用途 | Variant | Class |
|------|---------|-------|
| 主要 CTA | default | `h-11 px-5 text-sm font-semibold` |
| 次要動作 | outline | `h-11 px-5 text-sm` |
| Card 內小按鈕 | default `size="sm"` | — |
| Ghost（列表內） | ghost | `gap-2` |
| 帶 icon 的 CTA | default + asChild | `gap-2` + `<ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />` |

---

## Design System: Badges

| 語意 | Class |
|------|-------|
| 成功 / 通過 | `bg-green-100 text-green-700 border-green-200` |
| 警告 / 中斷 | `bg-amber-100 text-amber-600 border-amber-300` |
| 錯誤 / 緊急 | `bg-red-100 text-red-700 border-red-200` |
| 資訊（科目/模式） | `border-secondary text-secondary`（outline variant） |
| Primary 標籤 | `bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary rounded-md` |
| 次要標籤（章節） | `border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500 rounded-md` |

---

## Design System: Filter Chips

```tsx
// active
'rounded-full border px-3 py-1 text-xs font-medium border-primary bg-primary text-primary-foreground'

// inactive
'rounded-full border px-3 py-1 text-xs font-medium border-slate-200 bg-white text-slate-600 hover:border-primary/50 hover:bg-primary/5'
```

---

## Design System: Inline Filter Panel

篩選面板不使用 Sheet 抽屜，改用 inline 展開：

```tsx
{filterOpen && (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-150">
    ...
  </div>
)}
```

---

## Design System: Loading States

```tsx
// Skeleton block
<div className="animate-pulse rounded-md bg-muted/30 h-32" />

// Loading text
<p className="text-muted-foreground">{t('page.loading')}</p>

// Button loading
<Loader2 className="h-3 w-3 animate-spin" />
```

---

## Design System: Modals / Dialogs

```tsx
// Overlay
"fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"

// Dialog box
"bg-white rounded-2xl shadow-2xl w-96 animate-in zoom-in-95 duration-200 overflow-hidden"

// Dialog header
"bg-slate-50 border-b px-6 py-4"
```

---

## Design System: Colors (Semantic)

所有顏色透過 CSS variables（定義在 `globals.css`），**不 hardcode** hsl 值：

| Token | 用途 |
|-------|------|
| `text-primary` | 品牌主色（金色）、標題、強調 |
| `text-secondary` | 次要品牌色 |
| `text-muted-foreground` | 說明文字、placeholder、meta |
| `text-slate-700` | 一般內文 |
| `text-slate-500` | 較淡的說明 |
| `border-primary/20` | Card 邊框帶品牌色 |
| `bg-primary/5` | 極淡 primary 背景 |
| `bg-primary/10` | 淡 primary 背景（badge、icon bg） |

---

## Sidebar (AppSidebar)

### 結構

```
Sidebar (bg-secondary, no right border)
  SidebarHeader (p-6)
    BrandLogo + "PassBar" wordmark
  SidebarContent (px-0)
    SidebarMenu
      NavigationItem (collapsible section)
        SidebarMenuButton  ← section header
        CollapsibleContent
          Link items       ← sub-items (pl-10)
      Direct link items    ← no children
      Admin section        ← amber color scheme, role === 'admin' only
  SidebarFooter (bg-black/20 p-4, hidden on mobile)
    Avatar + displayName + EditDisplayName
    Sign out button
```

### Item 樣式

```tsx
// Section header (collapsible trigger / direct link)
"h-auto text-slate-300 hover:text-white hover:bg-white/5 py-4 px-4"
// icon: w-4 h-4
// label: "font-semibold text-xs uppercase tracking-wider"

// Sub-item (indented)
"flex items-center gap-3 pl-10 pr-4 py-3.5 text-xs transition-colors"

// Active state (normal)
"bg-white/10 text-white border-l-2 border-primary"

// Inactive state
"text-slate-400 hover:text-white hover:bg-white/5"

// Admin section active
"bg-amber-500/10 text-amber-300 border-l-2 border-amber-400"

// Admin section inactive
"text-amber-500/60 hover:text-amber-300 hover:bg-white/5"
```

### 規則

- Section 之間無額外間距（`gap-0`）
- Admin 區塊前有 divider：`<div className="mx-4 mb-1 border-t border-white/10" />`
- Mobile 時點選導航項目自動關閉 sidebar：`if (isMobile) setOpenMobile(false)`

---

## i18n 規範

### Key 命名格式

```
{page}.{section}.{element}
```

| 範例 | 說明 |
|------|------|
| `dashboard.dailyActivity` | Dashboard 頁，每日表現標題 |
| `review.filterMode` | Review 頁，篩選模式 |
| `performance.tabs.prescription` | Performance 頁，Tab 標籤 |
| `nav.createTest` | Sidebar 導航 |
| `auth.signOut` | 認證相關 |

### 新增 key 流程

1. 在 `i18n.ts` 的 `TranslationKey` union type 加入新 key
2. 在 `en`、`zh-TW`、`zh-CN` 三個 object 同步加入翻譯
3. JSX 改用 `{t('new.key')}`

### 動態參數

```ts
// 定義（i18n.ts）
'dashboard.milestoneText': 'Complete {count} more questions...'

// 使用
t('dashboard.milestoneText', { count: 25 })
```

### 禁止事項

- JSX 內禁止 hardcode 中文或英文 UI 字串
- 禁止 `language === 'zh-TW' ? '中文' : 'English'` 的三元判斷替代 `t()`
- 禁止在 component props 傳入 hardcode 字串（先 `t()` 轉換再傳）

---

## Project Structure

```
passbar/src/
  app/
    (main)/            # 主應用（dashboard, review, performance, create…）
      layout.tsx       # AuthGuard + Sidebar + main padding
    admin/             # 管理後台
    auth/              # 登入頁
  components/
    AppSidebar.tsx     # 主導航
    ui/                # shadcn primitives
  lib/
    i18n.ts            # 多語系（en / zh-TW / zh-CN）
    supabase.ts        # DB client
    types.ts           # 共用型別
    utils.ts           # cn() 等工具
    gemini-feedback.ts # AI 診斷
```

## Tech Stack

- **Framework**: Next.js 14 App Router
- **Styling**: Tailwind CSS + shadcn/ui
- **Font**: Inter（`font-body` / `font-headline`）
- **DB**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **AI**: Gemini API
- **Charts**: Recharts

## Coding Conventions

- `cn()` 合併 Tailwind class，禁止字串拼接
- Supabase query 結果一律 cast：`(data ?? []) as MyRowType[]`
- 型別明確標注，不用 `any`
- 分頁用 Supabase `.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)`，PAGE_SIZE = 15
- 篩選面板用 inline 展開，不用 Sheet 抽屜
- Tooltip 用 `absolute` 定位在 `relative` 父容器內，不用 `fixed`（避免 overflow 偏移）
