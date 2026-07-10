# MiMo-Code Web 端功能、接口与前端布局样式深度报告

> 生成日期：2026-07-10
> 项目：MiMo-Code (OpenCode Fork) — 终端原生 AI 编程助手

---

## 目录

1. [项目架构概览](#1-项目架构概览)
2. [Web 端子系统总览](#2-web-端子系统总览)
3. [Web 前端应用（packages/app）用到的接口](#3-web-前端应用用到的接口)
   - 3.1 [SDK 客户端初始化流程](#31-sdk-客户端初始化流程)
   - 3.2 [所有被调用的 API 端点清单](#32-所有被调用的-api-端点清单)
   - 3.3 [流式 / SSE 实时通信机制](#33-流式--sse-实时通信机制)
4. [前端布局与样式系统](#4-前端布局与样式系统)
   - 4.1 [技术栈与构建配置](#41-技术栈与构建配置)
   - 4.2 [路由结构](#42-路由结构)
   - 4.3 [Provider 嵌套层级](#43-provider-嵌套层级)
   - 4.4 [布局视觉层级（完整 DOM 结构）](#44-布局视觉层级完整-dom-结构)
   - 4.5 [各页面布局详析](#45-各页面布局详析)
   - 4.6 [侧边栏系统](#46-侧边栏系统)
   - 4.7 [CSS 与样式系统](#47-css-与样式系统)
   - 4.8 [主题系统](#48-主题系统)
5. [跨平台架构要点](#5-跨平台架构要点)
6. [总结](#6-总结)

---

## 1. 项目架构概览

MiMo-Code 是一个 **monorepo**，使用 **Bun** + **Turborepo** 管理，部署于 **Cloudflare**（Workers / Pages / KV / R2 / Durable Objects）。整体包结构如下：

```
packages/
├── app/              # SolidJS + Vite 前端 Web 应用
├── console/
│   ├── app/          # SolidStart 管理控制台 + Zen LLM 代理
│   ├── core/         # Drizzle ORM schema (PlanetScale)
│   ├── function/     # Cloudflare Worker (OAuth 认证)
│   └── mail/         # 邮件模板
├── desktop/          # Electron 桌面客户端 (SolidJS 渲染)
├── enterprise/       # SolidStart 企业版应用
├── opencode/         # 核心 CLI/TUI + Hono HTTP 服务器
├── ui/               # 共享 SolidJS UI 组件库
├── sdk/js/           # JavaScript SDK（自动生成 + 手动封装）
├── web/              # Astro + Starlight 文档站点
├── function/         # Cloudflare Worker API（会话共享、飞书 webhook）
├── slack/            # Slack Bot (@slack/bolt)
└── shared/           # 共享工具/类型
```

### 部署拓扑

```
用户浏览器 ─┐
            ├── app.<domain> (SolidJS SPA, Cloudflare StaticSite)
            │     └── 调用 → opencode 本地 Hono Server (port 4096)
            │
            ├── console.<domain> (SolidStart SSR, Cloudflare Pages)
            │     ├──  /zen/* - LLM 代理端点
            │     ├──  /workspace/* - 工作区管理
            │     ├──  /auth/* - 认证认证
            │     └──  /stripe/* - 支付
            │
            ├── enterprise.<domain> (SolidStart SSR)
            │     └── 会话分享、企业工作区
            │
            ├── docs.<domain> (Astro Starlight)
            │     └── 产品文档 (18 种语言)
            │
            └── api.<domain> (Cloudflare Worker)
                  └── 会话共享 CRUD、GitHub 应用、飞书 webhook
```

---

## 2. Web 端子系统总览

| 包                     | 框架               | 部署                        | 定位                                |
| ---------------------- | ------------------ | --------------------------- | ----------------------------------- |
| `packages/app`         | SolidJS + Vite     | `app.<domain>` (StaticSite) | **主 Web 前端** — AI 编程助手网页版 |
| `packages/console/app` | SolidStart (SSR)   | `console.<domain>`          | **管理控制台** + Zen LLM 代理网关   |
| `packages/enterprise`  | SolidStart (SSR)   | 企业子域名                  | **企业版** — 团队协作/会话分享      |
| `packages/web`         | Astro + Starlight  | `docs.<domain>`             | **文档站点** (18 语言)              |
| `packages/desktop`     | Electron + SolidJS | 桌面安装包                  | **桌面客户端** — 原生体验           |
| `packages/ui`          | SolidJS + Tailwind | npm 包                      | **共享 UI 组件库** (185+ 组件)      |
| `packages/opencode`    | Hono + TUI         | CLI 二进制                  | **核心后端服务器** + TUI            |

**重点分析：`packages/app`** — 这是最完整的 Web 前端应用，下面详细分析其 API 调用和布局样式。

---

## 3. Web 前端应用（packages/app）用到的接口

### 3.1 SDK 客户端初始化流程

Web 前端通过 `@mimo-ai/sdk` 包连接 opencode 后端服务器。

**入口链：**

```
entry.tsx
  └─ 创建 ServerConnection.Http("http://localhost:4096")
      └─ AppInterface (ServerProvider → ConnectionGate → ServerKey)
          ├─ QueryClientProvider (TanStack Query)
          ├─ GlobalSDKProvider → 创建两个 SDK 实例
          │   ├─ eventSdk: SSE 事件流专用（长连接）
          │   └─ sdk: REST API 主客户端
          └─ GlobalSyncProvider → 响应式数据同步
```

客户端创建代码（`context/global-sdk.tsx`）：

```ts
// SSE 事件流客户端（长连接）
const eventSdk = createSdkForServer({ signal, fetch, server })

// REST API 主客户端
const sdk = createSdkForServer({
  server,
  fetch: platform.fetch,
  throwOnError: true,
})
```

### 3.2 所有被调用的 API 端点清单

以下清单整理了 `packages/app/src/` 中实际调用的所有 API，按模块分组。

#### 会话 API（`client.session.*`）— 核心交互

| SDK 方法                                                    | HTTP 端点                     | 用途                     | 调用位置                             |
| ----------------------------------------------------------- | ----------------------------- | ------------------------ | ------------------------------------ |
| `session.list()`                                            | `GET /session`                | 列出目录下所有会话       | `bootstrap.ts`, `global-sync.tsx`    |
| `session.create()`                                          | `POST /session`               | 创建新会话               | `submit.ts`                          |
| `session.get({ sessionID })`                                | `GET /session/:id`            | 获取会话元数据           | `sync.tsx`                           |
| `session.update({ sessionID, ... })`                        | `PATCH /session/:id`          | 更新标题/归档等          | `layout.tsx`, `message-timeline.tsx` |
| `session.delete({ sessionID })`                             | `DELETE /session/:id`         | 删除会话                 | 侧边栏操作                           |
| `session.messages({ sessionID, limit, before })`            | `GET /session/:id/message`    | 分页获取消息             | `sync.tsx`                           |
| `session.promptAsync({ sessionID, messageID, parts, ... })` | `POST /session/:id/message`   | **发送提示词（非流式）** | `submit.ts`                          |
| `session.shell({ sessionID, command })`                     | `POST /session/:id/shell`     | 执行 Shell 命令          | `submit.ts`                          |
| `session.command({ sessionID, command })`                   | `POST /session/:id/command`   | 向会话发送命令           | `submit.ts`                          |
| `session.abort({ sessionID })`                              | `POST /session/:id/abort`     | 中止活动会话             | `session.tsx`                        |
| `session.revert({ sessionID, messageID })`                  | `POST /session/:id/revert`    | 回滚到指定消息           | `session.tsx`                        |
| `session.unrevert({ sessionID })`                           | `POST /session/:id/unrevert`  | 取消回滚                 | `session.tsx`                        |
| `session.diff({ sessionID })`                               | `GET /session/:id/diff`       | 获取文件差异             | `sync.tsx`                           |
| `session.todo({ sessionID })`                               | `GET /session/:id/todo`       | 获取待办事项             | `sync.tsx`                           |
| `session.summarize(...)`                                    | `POST /session/:id/summarize` | 总结会话                 | `use-session-commands.tsx`           |
| `session.share({ sessionID, directory })`                   | `POST /session/:id/share`     | 创建分享链接             | `message-timeline.tsx`               |
| `session.unshare({ sessionID, directory })`                 | `DELETE /session/:id/share`   | 删除分享链接             | `message-timeline.tsx`               |
| `session.status()`                                          | `GET /session/status`         | 获取所有会话状态         | `bootstrap.ts`                       |

#### 项目 API（`client.project.*`）

| SDK 方法                             | HTTP 端点              | 用途         | 调用位置       |
| ------------------------------------ | ---------------------- | ------------ | -------------- |
| `project.list()`                     | `GET /project`         | 列出所有项目 | `bootstrap.ts` |
| `project.current()`                  | `GET /project/current` | 获取当前项目 | `bootstrap.ts` |
| `project.update({ projectID, ... })` | `PATCH /project/:id`   | 更新项目名称 | `layout.tsx`   |

#### VCS API（`client.vcs.*`）

| SDK 方法             | HTTP 端点       | 用途          | 调用位置       |
| -------------------- | --------------- | ------------- | -------------- |
| `vcs.get()`          | `GET /vcs`      | 获取 VCS 信息 | `bootstrap.ts` |
| `vcs.diff({ mode })` | `GET /vcs/diff` | 获取 git diff | `session.tsx`  |

#### 配置 API（`client.global.*` / `client.config.*`）

| SDK 方法                           | HTTP 端点              | 用途         | 调用位置          |
| ---------------------------------- | ---------------------- | ------------ | ----------------- |
| `global.config.get()`              | `GET /global/config`   | 获取全局配置 | `bootstrap.ts`    |
| `global.config.update({ config })` | `PATCH /global/config` | 更新全局配置 | `global-sync.tsx` |
| `global.dispose()`                 | `POST /global/dispose` | 重置全局状态 | `settings.tsx`    |
| `config.get()`                     | `GET /config`          | 获取实例配置 | `bootstrap.ts`    |

#### 提供商 API（`client.provider.*`）

| SDK 方法           | HTTP 端点                    | 用途           | 调用位置                      |
| ------------------ | ---------------------------- | -------------- | ----------------------------- |
| `provider.list()`  | `GET /provider`              | 列出 AI 提供商 | `bootstrap.ts`                |
| `provider.auth()`  | `GET /provider/auth`         | 获取认证方式   | `dialog-connect-provider.tsx` |
| `provider.oauth.*` | `POST /provider/:id/oauth/*` | OAuth 授权流程 | `dialog-connect-provider.tsx` |

#### 权限 API（`client.permission.*`）

| SDK 方法                  | HTTP 端点                    | 用途               | 调用位置         |
| ------------------------- | ---------------------------- | ------------------ | ---------------- |
| `permission.list()`       | `GET /permission`            | 列出待处理权限请求 | `bootstrap.ts`   |
| `permission.respond(...)` | `POST /permission/:id/reply` | 批准/拒绝权限      | `permission.tsx` |

#### 问题 API（`client.question.*`）

| SDK 方法                             | HTTP 端点                   | 用途           | 调用位置                    |
| ------------------------------------ | --------------------------- | -------------- | --------------------------- |
| `question.list()`                    | `GET /question`             | 列出待处理问题 | `bootstrap.ts`              |
| `question.reply({ requestID, ... })` | `POST /question/:id/reply`  | 回答问题       | `session-question-dock.tsx` |
| `question.reject({ requestID })`     | `POST /question/:id/reject` | 拒绝问题       | `session-question-dock.tsx` |

#### 文件 API（`client.file.*` / `client.find.*`）

| SDK 方法                      | HTTP 端点           | 用途     | 调用位置   |
| ----------------------------- | ------------------- | -------- | ---------- |
| `file.list({ path })`         | `GET /file`         | 列出目录 | `file.tsx` |
| `file.read({ path })`         | `GET /file/content` | 读取文件 | `file.tsx` |
| `find.files({ query, dirs })` | `GET /find/file`    | 搜索文件 | `file.tsx` |

#### 终端 API（`client.pty.*`）

| SDK 方法                            | HTTP 端点         | 用途         | 调用位置       |
| ----------------------------------- | ----------------- | ------------ | -------------- |
| `pty.create(directory, ...)`        | `POST /pty`       | 创建终端 PTY | `terminal.tsx` |
| `pty.resize({ ptyID, rows, cols })` | `PUT /pty/:id`    | 调整终端大小 | `terminal.tsx` |
| `pty.remove({ ptyID })`             | `DELETE /pty/:id` | 关闭终端     | `terminal.tsx` |

#### 其他 API

| SDK 方法                                             | HTTP 端点                             | 用途           | 调用位置             |
| ---------------------------------------------------- | ------------------------------------- | -------------- | -------------------- |
| `app.agents()`                                       | `GET /agent`                          | 列出 AI Agent  | `bootstrap.ts`       |
| `command.list()`                                     | `GET /command`                        | 列出命令       | `bootstrap.ts`       |
| `lsp.status()`                                       | `GET /lsp`                            | LSP 状态       | `global-sync.tsx`    |
| `mcp.status()`                                       | `GET /mcp`                            | MCP 状态       | `bootstrap.ts`       |
| `mcp.connect({ name })` / `mcp.disconnect({ name })` | `POST /mcp/:name/connect\|disconnect` | MCP 开关       | `status-popover.tsx` |
| `worktree.create({ directory })`                     | `POST /experimental/worktree`         | 创建 worktree  | `submit.ts`          |
| `path.get()`                                         | `GET /path`                           | 获取路径信息   | `bootstrap.ts`       |
| `global.event({ signal, ... })`                      | `GET /global/event`                   | **SSE 事件流** | `global-sdk.tsx`     |

**总结：Web 前端共调用约 40+ 个 API 端点**，涵盖会话 CRUD、项目管理、文件读写、终端控制、权限/问题响应、提供商 OAuth 等全功能。

### 3.3 流式 / SSE 实时通信机制

Web 前端的实时通信核心是一条 **长连接的 SSE（Server-Sent Events）流**。

#### 连接架构

```
eventSdk.global.event({ signal, onSseError })
    │
    ▼
Server → SSE `/global/event`
    │
    ├─ 事件接收循环（GlobalSDKProvider）
    │   ├─ 心跳检测（15 秒超时 → 自动重连）
    │   ├─ 16ms 帧缓冲（批量合并事件）
    │   └─ 去重合并（同类型事件合并，delta 被 updated 覆盖）
    │
    └─ GlobalSyncProvider（按 directory 分发）
        └─ 响应式 Store 更新 → SolidJS 自动重渲染
```

#### 关键参数

| 参数       | 值             | 说明                       |
| ---------- | -------------- | -------------------------- |
| 心跳超时   | 15,000ms       | 无事件则断开重连           |
| 重连延迟   | 250ms          | 断线后的等待时间           |
| 帧缓冲     | 16ms           | 按帧批量处理，避免频繁渲染 |
| 可见性重连 | 页面切回时检查 | 若超时则主动断开重连       |

#### SSE 事件类型清单

前端订阅以下事件类型，覆盖全场景的实时更新：

| 事件类型                                                    | 说明                        |
| ----------------------------------------------------------- | --------------------------- |
| `server.connected`                                          | 服务器重连 — 触发全量刷数   |
| `global.disposed`                                           | 全局状态重置 — 触发全量刷数 |
| `project.updated`                                           | 项目信息更新                |
| `server.instance.disposed`                                  | 目录实例释放                |
| `session.created` / `session.updated` / `session.deleted`   | 会话 CRUD                   |
| `session.diff`                                              | 文件差异更新                |
| `session.status`                                            | 会话状态变化（idle ↔ busy） |
| `todo.updated`                                              | 待办事项更新                |
| `message.updated` / `message.removed`                       | 消息更新/删除               |
| `message.part.updated` / `message.part.removed`             | 消息部分更新                |
| **`message.part.delta`**                                    | **流式增量文本** — 逐字推送 |
| `vcs.branch.updated`                                        | Git 分支切换                |
| `permission.asked` / `permission.replied`                   | 权限请求/回复               |
| `question.asked` / `question.replied` / `question.rejected` | 问题相关                    |
| `lsp.updated`                                               | LSP 状态变动                |
| `file.watcher.updated`                                      | 文件系统变更                |

#### 提示词发送后的流式渲染流程

1. **用户提交** → `submit.ts` 调用 `session.promptAsync()`（非流式 REST POST）
2. **服务器接受** → 返回 200，开始 AI 生成
3. **SSE 推送** → 服务器通过 SSE 发送 `message.part.updated` + `message.part.delta`
4. **前端合并** → `event-reducer.ts` 将 delta 追加到对应 part，触发 SolidJS 响应式更新
5. **UI 渲染** → `MessageTimeline` 组件响应式展示逐字出现的消息

---

## 4. 前端布局与样式系统

### 4.1 技术栈与构建配置

| 技术                  | 版本   | 用途                    |
| --------------------- | ------ | ----------------------- |
| SolidJS               | 1.9.10 | UI 框架（组件化响应式） |
| @solidjs/router       | 0.15.4 | 客户端路由              |
| @solidjs/meta         | 0.29.4 | 页面级 meta 标签        |
| Tailwind CSS          | v4     | 工具类样式              |
| @kobalte/core         | —      | 无障碍组件基元          |
| @tanstack/solid-query | —      | 服务端状态缓存          |
| Vite                  | —      | 构建工具                |

**构建插件**（`vite.config.ts`）：

- `@tailwindcss/vite` — Tailwind v4 管线
- `vite-plugin-solid` — SolidJS HMR 与编译
- `opencode-desktop:theme-preload` — 内联主题 CSS 防闪烁
- `opencode-desktop:config` — 路径别名 `@` → `src/`

**CSS 入口**（`index.css`）：

```css
@import "@mimo-ai/ui/styles/tailwind";  /* Tailwind + 设计 Token */
@font-face { font-family: 'JetBrainsMono Nerd Font Mono'; ... }
```

### 4.2 路由结构

定义在 `app.tsx` 第 301-305 行：

```
/                  → Home            首页 / 项目选择页
/:dir              → DirectoryLayout 项目目录布局（数据包装层）
  /:dir/           → 重定向到会话    （自动跳转）
  /:dir/session/:id → Session        会话视图（核心交互页）
```

### 4.3 Provider 嵌套层级

应用使用了深层的 Provider 嵌套（从外到内，`app.tsx`）：

```
<MetaProvider>
<Font>
<ThemeProvider>                     ← 主题管理 (data-theme / data-color-scheme)
  <LanguageProvider>                ← 国际化 i18n
    <UiI18nBridge>                  ← 向 UI 组件库暴露语言包
      <ErrorBoundary → ErrorPage>   ← 全局错误边界
        <DialogProvider>            ← 弹窗管理
          <MarkedProvider>          ← Markdown 渲染
          <FileComponentProvider>   ← 文件组件
            <ServerProvider>        ← 服务器连接管理
              <ConnectionGate>      ← 启动健康检查 (splash / 错误页)
                <ServerKey>
                  <QueryClientProvider>    ← TanStack Query 缓存
                    <GlobalSDKProvider>    ← SDK 客户端 + SSE 事件流
                      <GlobalSyncProvider> ← 响应式数据同步
                        <Router>
                          <AppShellProviders>  ← 应用内 Provider
                            <SettingsProvider>
                            <PermissionProvider>
                            <LayoutProvider>    ← 侧边栏状态
                            <NotificationProvider>
                            <ModelsProvider>
                            <CommandProvider>   ← 快捷键
                            <HighlightsProvider>
                              <Layout>         ← 实际布局组件
                                {children}     ← 页面内容
```

### 4.4 布局视觉层级（完整 DOM 结构）

```
<body>
<div#root>
  <div.relative.bg-background-base.flex-1.min-h-0.min-w-0.flex.flex-col>
    ├── <Titlebar />                      ← 标题栏（自定义组件）
    │
    ├── div.flex-1.min-h-0.min-w-0.flex>  ← 主体区域
    │   └── div.flex-1.min-h-0.relative
    │       └── div.size-full.relative.overflow-x-hidden
    │           │
    │           ├── nav.hidden.xl:block    ← 桌面端侧边栏 (>=xl断点)
    │           │   └── div.@container     ← CSS 容器查询
    │           │       ├── div.sidebar-rail (w-16, 固定64px)
    │           │       │   ├── [项目图标] × N (可拖拽排序)
    │           │       │   ├── [+] 按钮 (添加项目)
    │           │       │   └── [设置齿轮] + [帮助]
    │           │       └── div (flex-1 展开面板)
    │           │           └── SidebarPanel
    │           │               ├── 项目名称 + 路径 + 操作
    │           │               ├── [禁用工作区] → 本地会话列表
    │           │               └── [启用工作区] → 工作区列表
    │           │                   └── 可折叠工作区 → 会话列表
    │           │
    │           ├── <ResizeHandle>         ← 侧边栏拖拽分割线（打开时显示）
    │           │
    │           ├── nav.xl:hidden          ← 移动端侧边栏 (xl以下)
    │           │   └── @container, fixed定位, 滑动动画, max-w-[400px]
    │           │
    │           ├── div.absolute.inset-0   ← 主内容区域
    │           │   style={--main-left: sid ebar宽度 or "4rem"}
    │           │   transition-[left] cubic-bezier(0.22,1,0.36,1)
    │           │   └── main.size-full
    │           │       ├── Route "/→" → Home 主页
    │           │       └── Route "/session/:id" → Session 会话页
    │           │
    │           └── div (侧边栏预览悬浮层)
    │               └── SidebarPanel(merged=false)
    │
    └── <Toast.Region />                  ← Toast 通知区域
```

### 4.5 各页面布局详析

#### 4.5.1 Home 页面（`pages/home.tsx`）

| 区域       | 标签                | Tailwind 类                                   | 说明                       |
| ---------- | ------------------- | --------------------------------------------- | -------------------------- |
| 外层容器   | `<div>`             | `mx-auto mt-55 w-full md:w-auto px-4`         | 居中，顶部留白             |
| Logo       | `<Logo>`            | `md:w-xl opacity-12`                          | 半透明品牌标识             |
| 服务器按钮 | `<Button>`          | `mt-4 mx-auto text-14-regular text-text-weak` | 含状态指示圆点             |
| 项目列表   | `<ul>` / `<Switch>` | `mt-20 w-full flex flex-col gap-4`            | 最近项目 / 加载 / 空态三种 |

#### 4.5.2 Layout 布局（`pages/layout.tsx`）— 核心布局

**侧边栏三种状态：**

| 状态             | 宽度                 | 交互方式                               |
| ---------------- | -------------------- | -------------------------------------- |
| **关闭**（默认） | 仅 64px 轨道         | 鼠标悬浮时通过 aim（意图检测）展开预览 |
| **打开**         | 64px 轨道 + 可变面板 | `ResizeHandle` 拖拽调整（最小 244px）  |
| **悬浮预览**     | 轨道 + 临层面板      | 鼠标悬停项目图标时显示，带动画过渡     |

**主内容区域自适应：**

- 侧边栏关闭 → `left: 4rem`（仅轨道宽）
- 侧边栏打开 → `left: ${side()}px`（轨道 + 面板）
- 过渡动画：`cubic-bezier(0.22, 1, 0.36, 1)`，200ms

#### 4.5.3 DirectoryLayout（`pages/directory-layout.tsx`）

**数据包装层**，不渲染视觉元素，仅提供 Provider：

```
<SDKProvider>
  <SyncProvider>
    <DirectoryDataProvider>
      {props.children}
    </DirectoryDataProvider>
  </SyncProvider>
</SDKProvider>
```

职责：解码 base64 编码的 `:dir` 路由参数，建立与后端的实时连接。

#### 4.5.4 Session 会话页面（`pages/session.tsx`）— 核心交互

```
div.relative.bg-background-base.size-full.overflow-hidden.flex.flex-col
├── <SessionHeader />                           ← 会话标题栏
│
├── div.flex-1.min-h-0.flex.flex-col.md:flex-row  ← 主体（移动端纵向/桌面端横向）
│   │
│   ├── [移动端 Tab 栏]                          ← 手机端 session/changes 切换
│   │
│   ├── div.@container（主对话面板）              ← CSS 容器查询
│   │   .relative.shrink-0.flex.flex-col.min-h-0.h-full.bg-background-stronger
│   │   style="width: sessionPanelWidth()"
│   │   │
│   │   ├── div.flex-1.min-h-0.overflow-hidden    ← 消息区域
│   │   │   ├── [有会话ID] <MessageTimeline />    ← AI 对话流
│   │   │   └── [无ID] <NewSessionView />         ← 新建会话
│   │   │
│   │   ├── <SessionComposerRegion />             ← 底部输入区
│   │   │   └── prompt 输入、followup 队列、revert 状态
│   │   │
│   │   └── [Review 打开时] <ResizeHandle />      ← 会话/审查面板拖拽
│   │
│   └── <SessionSidePanel />                      ← 右侧面板
│       ├── 文件树（changes / all 两个 Tab）
│       └── 审查面板（git diff / branch diff / 逐轮 diff）
│
└── <TerminalPanel />                             ← 底部终端面板
    └── xterm.js 终端实例
```

**宽度自适应规则（会话面板）：**

- 纯会话视图 → `width: 100%`
- 审查视图打开 → `width: ${layout.session.width()}px`（最小 450px，可拖拽）
- 文件树打开 → `width: calc(100% - ${fileTree.width()}px)`

### 4.6 侧边栏系统

#### 4.6.1 SidebarContent（`sidebar-shell.tsx`）

```
div.flex.h-full.w-full.min-w-0.overflow-hidden
├── div.sidebar-rail (w-16, 64px 图标轨道)
│   ├── div.flex-1 (滚动区域)
│   │   └── <DragDropProvider>
│   │       └── <SortableProject × N>
│   │           └── <ProjectTile> (<Avatar> + 未读徽章)
│   │   └── [+] 按钮（添加项目）
│   └── div（底部固定）
│       └── [设置齿轮] + [帮助]
└── div[aria-hidden]（展开面板）
    └── <SidebarPanel>
```

#### 4.6.2 ProjectTile 项目图标样式

| 状态            | 样式                                                        |
| --------------- | ----------------------------------------------------------- |
| 选中            | `bg-transparent border-2 border-icon-strong-base`           |
| 未选中 + 非活跃 | `bg-transparent border border-transparent`                  |
| 未选中 + 活跃   | `bg-surface-base-hover border-border-weak-base`             |
| 悬浮            | `hover:bg-surface-base-hover hover:border-border-weak-base` |

#### 4.6.3 SortableWorkspace 工作区列表

```
<Collapsible variant="ghost">
├── Collapsible.Trigger
│   └── <WorkspaceHeader>
│       ├── Icon (branch) / Spinner
│       ├── "local:" / "sandbox:" 标签
│       └── 可内联编辑的工作区名
│   └── <WorkspaceActions>（悬浮时出现）
│       ├── 重命名 / 重置 / 删除 (DropdownMenu)
│       └── 新建会话按钮
└── Collapsible.Content
    └── <WorkspaceSessionList>
        ├── 新建会话项
        ├── <SessionItem × N>
        └── 加载更多按钮
```

#### 4.6.4 SessionItem 会话项样式

| 状态     | 样式                                                   |
| -------- | ------------------------------------------------------ |
| 基础     | `rounded-md cursor-default pr-3`                       |
| 悬浮     | `hover:bg-surface-raised-base-hover`                   |
| 焦点     | `[&:has(:focus-visible)]:bg-surface-raised-base-hover` |
| 展开子项 | `has-[[data-expanded]]:bg-surface-raised-base-hover`   |
| 当前活跃 | `has-[.active]:bg-surface-base-active`                 |

### 4.7 CSS 与样式系统

#### 4.7.1 设计 Token 体系（来自 `@mimo-ai/ui/styles/tailwind`）

全局使用统一的设计 Token，通过 Tailwind v4 的 CSS 自定义属性实现：

**颜色分类：**

| 类别 | 示例 Token                                                                       |
| ---- | -------------------------------------------------------------------------------- |
| 文字 | `text-text-strong` / `text-text-base` / `text-text-weak`                         |
| 图标 | `text-icon-base` / `text-icon-critical-base` / `text-icon-success-base`          |
| 背景 | `bg-background-base` / `bg-background-stronger` / `bg-surface-raised-base-hover` |
| 边框 | `border-border-weak-base` / `border-border-weaker-base`                          |
| 交互 | `text-interactive-base` / `text-diff-delete-base`                                |
| 尺寸 | `size-*` 统一尺寸体系                                                            |
| 阴影 | `shadow-xs-border-base`                                                          |

**字重与字号：**

| Token             | 说明                    |
| ----------------- | ----------------------- |
| `text-14-medium`  | 14px 中粗体（正文强调） |
| `text-14-regular` | 14px 常规体（正文）     |
| `text-12-regular` | 12px 常规体（辅助信息） |
| `text-14-mono`    | 14px 等宽体（代码）     |

#### 4.7.2 自定义 CSS（`index.css`）

仅有 3 个关键帧动画 + 2 个容器查询选择器：

```css
@layer components {
  /* 进度条擦除动画 */
  @keyframes session-progress-whip {
    from { clip-path: inset(0 100% 0 0); }
    to   { clip-path: inset(0 0% 0 0); }
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
}

/* 进度条组件 */
[data-component="session-progress"] {
  position: absolute; inset: 0; height: 2px; ...
}

/* 引导界面容器查询 */
[data-component="getting-started"] {
  container-type: inline-size;
}
[data-component="getting-started-actions"] {
  /* >= 17rem 时从列切换为行布局 */
}
```

#### 4.7.3 CSS 容器查询（`@container`）使用位置

| 位置                        | 作用                   |
| --------------------------- | ---------------------- |
| 桌面侧边栏 (`layout.tsx`)   | 根据面板宽度自适应内容 |
| 移动端侧边栏 (`layout.tsx`) | 移动端自适应           |
| 会话面板 (`session.tsx`)    | 根据宽度自适应         |
| 引导区域 (`index.css`)      | >=17rem 时操作从列→行  |

#### 4.7.4 响应式断点

| 断点  | 值     | 用途                                         |
| ----- | ------ | -------------------------------------------- |
| `md:` | 768px  | 移动端/桌面端布局切换                        |
| `xl:` | 1280px | 侧边栏可见性控制（桌面端始终显示侧边栏轨道） |

### 4.8 主题系统

**机制：** `@mimo-ai/ui/theme/context` 的 `<ThemeProvider>`

- 默认主题 ID：`"oc-2"`
- 配色方案：`"system"` / `"light"` / `"dark"`
- 持久化：`localStorage` 保存主题 + 配色方案

**预加载防闪烁（FOUC）：**
`<head>` 中的内联脚本：

1. 从 `localStorage` 读取主题 ID（默认 `oc-2`）
2. 迁移旧版 `oc-1` → `oc-2`，清除缓存 CSS
3. 设置 `document.documentElement.dataset.theme` + `dataset.colorScheme`
4. 非 `oc-2` 主题时内联 CSS 变量到 `<style id="oc-theme-preload">`

**主题 API：**

```ts
const theme = useTheme()
theme.themeId() // 当前主题 ID
theme.colorScheme() // "system" | "light" | "dark"
theme.setTheme(id) // 切换主题
theme.previewTheme() // 实时预览
theme.commitPreview() // 确认预览
```

**快捷键：**

- `mod+shift+T` → 切换主题
- `mod+shift+S` → 切换配色方案

---

## 5. 跨平台架构要点

### 5.1 三层共享能力

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   TUI       │      │  Web App    │      │  Desktop    │
│  (终端内)   │      │  (浏览器)   │      │  (Electron) │
├─────────────┤      ├─────────────┤      ├─────────────┤
│ 命令行界面  │      │ SolidJS SPA │      │ SolidJS 渲染│
│ 键盘驱动    │      │ 鼠标+键盘   │      │ 原生窗口    │
│ 低带宽友好  │      │ Token查询   │      │ 自动更新    │
└──────┬──────┘      └──────┬──────┘      └──────┬──────┘
       │                    │                    │
       └──────────┬─────────┴─────────┬──────────┘
                  │                   │
         ┌────────▼────────┐   ┌──────▼──────┐
         │  Hono Server    │   │  SDK 客户端  │
         │  (HTTP + SSE    │   │(@mimo-ai/  │
         │   + WebSocket)  │   │ sdk/js)     │
         └────────┬────────┘   └─────────────┘
                  │
         ┌────────▼────────┐
         │  LLM Providers  │
         │  LSP / MCP      │
         │  File System    │
         │  Git / PTY      │
         └─────────────────┘
```

### 5.2 共享技术组件

| 组件       | 三个平台共享                                            |
| ---------- | ------------------------------------------------------- |
| SDK 客户端 | `@mimo-ai/sdk/js` — 自动生成自 OpenAPI 规范             |
| UI 组件库  | `@mimo-ai/ui` — 185+ SolidJS 组件（Web + Desktop 共享） |
| 主题系统   | `@mimo-ai/ui/theme` — 跨平台统一色彩体系                |
| 国际化     | i18n 字典 — TUI / Web 共享                              |
| 后端 API   | 同一组 Hono 端点，所有客户端通过 HTTP/SSE/WS 通信       |

### 5.3 TUI 特有的路由 Web API

TUI 也有专属的 HTTP 端点用于外部控制（`/tui/*`）：

| 方法 | 路径                                                               | 用途              |
| ---- | ------------------------------------------------------------------ | ----------------- |
| POST | `/tui/append-prompt`                                               | 附加提示词到 TUI  |
| POST | `/tui/submit-prompt`                                               | 提交提示词        |
| POST | `/tui/open-help` / `open-sessions` / `open-themes` / `open-models` | 打开对话框        |
| POST | `/tui/execute-command`                                             | 执行命令          |
| POST | `/tui/select-session`                                              | 选择会话          |
| GET  | `/tui/control/next`                                                | 轮询获取 TUI 请求 |
| POST | `/tui/control/response`                                            | 提交 TUI 响应     |

---

## 6. 总结

### Web 端整体能力

MiMo-Code 具备完整的 Web 端能力体系，围绕 AI 编程助手核心场景展开：

1. **多端覆盖**：TUI（终端）、Web 应用（浏览器）、Desktop（Electron）三端统一体验
2. **丰富的 API 体系**：~140 个 REST 端点、4 个 WebSocket、2 个 SSE 流，前端实际使用约 40+ 个
3. **实时通信**：基于 SSE 的事件流驱动前端 UI 响应式更新，支持逐字 AI 输出渲染
4. **SolidJS 响应式架构**：采用细粒度响应式框架，Provider 深度嵌套但性能高效
5. **统一设计语言**：Tailwind v4 + CSS 自定义属性实现跨平台主题系统，支持亮/暗/跟随系统

### 关键架构决策

- 所有前端框架统一为 **SolidJS**（无 React/Vue）
- 后端全栈采用 **Hono**（Bun 适配器 + Cloudflare Workers）
- API 契约通过 **OpenAPI 3.1.1** 定义，自动生成 TypeScript SDK
- 实时数据流通过 **Server-Sent Events**（非 WebSocket 主通道），仅 PTY 使用 WebSocket
- 样式系统使用 **Tailwind v4** + CSS 容器查询，零 PostCSS 配置
