# MiMoCode 项目说明文档

> **生成时间**：2026-07-12
> **项目地址**：https://github.com/XiaomiMiMo/MiMo-Code（forked from anomalyco/opencode）
> **License**：MIT

---

## 1. 项目概述

**MiMoCode**（前身为 OpenCode）是小米 MiMo 团队开发的**终端原生 AI 编程助手**。它可以直接读取/写入代码、执行命令、管理 Git 仓库，并在跨会话中维护持久化记忆。

### 核心定位
- 终端优先的 AI 编码助手（TUI-first）
- 支持多 LLM 提供商（20+ 模型接入）
- 多 Agent 协作系统（build/plan/compose/max）
- 跨平台支持（CLI / Web / Desktop Electron）
- 云端服务（SST Cloudflare 部署）

### 关键数字
- **18 个 workspace packages**（Monorepo 架构）
- **721 个核心源文件**（opencode 包），118,916 行 TypeScript/TSX
- **40+ 工具实现**（文件操作、搜索、Shell、Agent、MCP 等）
- **17+ 内置技能**（Office 文档、PDF、学术搜索、深度调研等）
- **95+ 测试文件**覆盖核心功能

---

## 2. 技术栈总览

| 领域 | 技术选型 |
|------|----------|
| **运行时 / 包管理** | Bun 1.3.14 + Turborepo |
| **语言** | TypeScript (ESM) |
| **前端框架** | SolidJS + Vite |
| **状态管理** | Effect (v4.0.0-beta.48) |
| **终端 UI** | @opentui/solid |
| **Web UI** | SolidJS + Tailwind CSS + Kobalte |
| **桌面应用** | Electron + Vite |
| **数据存储** | Drizzle ORM + SQLite (FTS5) |
| **API 框架** | Hono |
| **LLM 编排** | Vercel AI SDK + 多提供商适配器 |
| **Web 搜索** | MCP SDK + tree-sitter |
| **代码检查** | oxlint (TypeScript-aware) + Prettier |
| **测试** | Bun 内置测试 + Playwright (E2E) |
| **部署** | SST (Cloudflare) / Electron-builder / npm |
| **CI/CD** | GitHub Actions（lint / typecheck / test 三流水线） |

---

## 3. 项目结构（18 Packages）

### 核心包

| Package | npm 名称 | 路径 | 用途 |
|---------|----------|------|------|
| **opencode** | `@mimo-ai/cli` | `packages/opencode/` | ★ 核心 CLI：TUI、Agent、Session、工具、存储、MCP、LSP、技能、工作流、子 Agent 系统 |
| **app** | `@mimo-ai/app` | `packages/app/` | Web UI SPA（SolidJS），桌面应用共用 |
| **desktop** | `@mimo-ai/desktop` | `packages/desktop/` | Electron 桌面应用，嵌入 app 包 |
| **ui** | `@mimo-ai/ui` | `packages/ui/` | 共享 SolidJS 组件库（Tailwind + 主题 + 国际化） |
| **web** | `@mimo-ai/web` | `packages/web/` | 官方文档和营销网站（Astro + Starlight） |
| **sdk** | `@mimo-ai/sdk` | `packages/sdk/js/` | TypeScript SDK，OpenAPI 生成 |
| **plugin** | `@mimo-ai/plugin` | `packages/plugin/` | 插件 SDK（工具扩展、TUI 路由、工作区适配器） |
| **shared** | `@mimo-ai/shared` | `packages/shared/` | 共享工具函数和类型（平台无关） |
| **script** | `@mimo-ai/script` | `packages/script/` | 构建/发布脚本（版本计算、渠道检测） |

### 云服务包

| Package | npm 名称 | 路径 | 用途 |
|---------|----------|------|------|
| **console/app** | `@mimo-ai/console-app` | `packages/console/app/` | 云控制台 Web UI（Stripe 计费、OpenAuth） |
| **console/core** | `@mimo-ai/console-core` | `packages/console/core/` | 控制台后端（Drizzle 数据库、模型、权限） |
| **console/function** | `@mimo-ai/console-function` | `packages/console/function/` | Cloudflare Workers API 函数 |
| **console/mail** | `@mimo-ai/console-mail` | `packages/console/mail/` | 事务性邮件模板（jsx-email） |
| **console/resource** | `@mimo-ai/console-resource` | `packages/console/resource/` | Cloudflare 资源抽象（KV、Buckets） |
| **enterprise** | `@mimo-ai/enterprise` | `packages/enterprise/` | 企业版/自托管会话分享门户 |
| **function** | `@mimo-ai/function` | `packages/function/` | Cloudflare Worker（GitHub App webhook） |

### 工具与扩展包

| Package | 路径 | 用途 |
|---------|------|------|
| **slack** | `packages/slack/` | Slack 集成 Bot（@slack/bolt） |
| **storybook** | `packages/storybook/` | UI 组件 Storybook 文档 |
| **containers** | `packages/containers/` | CI 容器镜像（Dockerfiles） |
| **extensions** | `packages/extensions/` | IDE 扩展（Zed editor） |
| **identity** | `packages/identity/` | 品牌资产（Logo、图标） |

### 依赖关系

```
Root
├── @mimo-ai/cli (opencode) ← 核心
│   ├── @mimo-ai/shared
│   ├── @mimo-ai/plugin
│   ├── @mimo-ai/sdk
│   ├── @mimo-ai/ui
│   └── 40+ 外部提供商 SDK
├── @mimo-ai/app ← Web UI
│   ├── @mimo-ai/sdk
│   ├── @mimo-ai/ui
│   └── @mimo-ai/shared
├── @mimo-ai/desktop ← 桌面应用
│   ├── @mimo-ai/app
│   └── @mimo-ai/ui
├── @mimo-ai/web ← 文档网站
│   └── @mimo-ai/cli (类型导入)
└── @mimo-ai/console-* ← 云控制台
    ├── @mimo-ai/console-core
    ├── @mimo-ai/console-mail
    └── @mimo-ai/console-resource
```

---

## 4. 核心架构

### 4.1 Effect 生态

项目使用 **Effect** 作为核心状态管理系统，所有主要系统（Agent、Provider、Session、Config、Auth、Plugin、Skill、MCP）都是 Effect `Service`，通过 `Layer.provide()` 链声明式组合依赖。

### 4.2 多 Agent 系统

| Agent | 权限 | 用途 |
|-------|------|------|
| **build** | 全权限 | 默认主 Agent，可执行所有操作 |
| **plan** | 只读 | 研究设计，禁止写入非计划文件 |
| **compose** | 编排器 | 工作流协调，确定性的 JS 脚本 |
| **max** | 实验性 | 并行最佳-N 推理，裁判选择 |
| **general** | 子 Agent | 通用多步骤任务 |
| **explore** | 子 Agent | 快速只读代码探索 |

权限继承：`runtimePermission()` 合并 Agent + 用户/会话规则集 + hardPermissions。

### 4.3 Session 系统

Session 管理包含 35+ 个模块：
- **Checkpoint**：SQLite FTS5 持久化记忆，支持 fork 模式和冷启动模式
- **Compaction**：上下文压缩，token 感知截断
- **Overflow**：溢出处理和重建
- **Goal/Stop**：独立裁判模型评估停止条件
- **Dream/Distill**：自我改进（提取知识→记忆，发现模式→技能）

### 4.4 工具系统

40+ 工具实现，采用注册表模式 + Zod Schema 验证：
- 文件操作：`read`、`write`、`edit`、`multiedit`、`apply_patch`
- 搜索：`glob`、`grep`、`codesearch`
- Shell：`bash`、`lsp`
- Agent 编排：`actor`、`task`、`workflow`、`plan`
- 知识：`memory`、`history`、`skill`
- 外部：`webfetch`、`websearch`、`mcp`

每个工具文件配对 `.ts`（实现）+ `.txt`（提示描述）+ `.shell.txt`（Shell 描述）。

### 4.5 Skill 系统

**内置技能（17+）**：arxiv、docx-official、pdf-official、pptx-official、xlsx-official、html-to-video-pipeline、deep-research、design-blueprint、frontend-design、evolve、skill-creator、super-research、loop、mimocode、modern-python-toolchain、research-paper-writing、drive-mimo

**Compose 技能**：brainstorm、plan、execute、tdd、debug、verify、review、merge、report、subagent、worktree、parallel、feedback、ask

### 4.6 Workflow 系统

**内置工作流**：`compose`、`deep-research`、`fact-check`

确定性的 JavaScript 脚本，通过 `agent()`、`parallel()`、`pipeline()` 协调多 Agent 管道，沙箱运行时带有限重试和自动并行化。

### 4.7 平台适配

使用条件导入实现 Bun/Node 双平台兼容：
- `#db` → `db.bun.ts`（Bun）/ `db.node.ts`（Node）
- `#pty` → `pty.bun.ts`（Bun）/ `pty.node.ts`（Node）
- `#hono` → `adapter.bun.ts`（Bun）/ `adapter.node.ts`（Node）
- `#read-sqlite` → `read-sqlite.bun.ts` / `read-sqlite.node.ts`

---

## 5. 主要功能特性

| 特性 | 说明 |
|------|------|
| **多 Agent 并行** | 支持多个 Agent 同时工作，权限隔离 |
| **持久化记忆** | SQLite FTS5 全文搜索，跨会话知识保留 |
| **智能上下文管理** | 自动 checkpoint、上下文重建、token 预算注入 |
| **任务跟踪** | 树形任务（T1, T1.1, T1.2），与 checkpoint 集成 |
| **子 Agent 系统** | 按需并行子 Agent，生命周期管理 |
| **Goal/Stop 条件** | `/goal` 命令，独立裁判模型评估 |
| **Compose 模式** | 规格驱动开发，内置完整生命周期技能 |
| **语音输入** | 实时流式 ASR（MiMo ASR + TenVAD） |
| **Dream & Distill** | `/dream` 提取知识，`/distill` 发现可复用模式 |
| **LSP 集成** | 语言服务器协议，代码智能感知 |
| **MCP 支持** | Model Context Protocol 集成 |
| **多 LLM 支持** | 20+ 提供商统一接口 |
| **插件系统** | 扩展工具、路由、工作区适配器 |
| **TUI** | 完整终端 UI，30+ 主题、8 语言国际化 |
| **桌面应用** | Electron 原生应用 |
| **Web UI** | 浏览器 SPA |
| **云控制台** | 认证、计费（Stripe）、模型管理 |
| **企业分享** | 团队协作，会话分享 |

---

## 6. 快速开始

### 6.1 安装

```bash
# 方式 1：npm 全局安装
npm install -g @mimo-ai/cli
mimo

# 方式 2：一键脚本
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

### 6.2 本地开发

```bash
# 前置要求：Bun 1.3+
bun install

# 启动 TUI 开发服务器
bun dev
bun dev .          # 在当前目录运行
bun dev <目录>     # 指定目录

# 启动 Web UI
bun run --cwd packages/app dev

# 启动桌面应用
bun --cwd packages/desktop dev

# 启动云控制台
bun run --cwd packages/console/app dev

# 启动 API Server
bun dev serve      # 端口 4096
```

### 6.3 构建

```bash
# 构建独立二进制
./packages/opencode/script/build.ts --single
./packages/opencode/dist/opencode-<platform>/bin/opencode

# 全量构建
bun run --cwd packages/opencode script/build.ts
```

---

## 7. 开发指南

### 7.1 构建命令

| 命令 | 说明 |
|------|------|
| `bun dev` | 启动开发服务器 |
| `bun lint` | 运行 oxlint 检查 |
| `bun typecheck` | 运行 Turborepo typecheck |
| `bun test` | 运行测试（从包目录执行） |

### 7.2 测试

测试必须从各个包目录运行（根目录有保护）：

```bash
# 核心包测试
cd packages/opencode && bun test --timeout 30000

# CI 模式（JUnit 输出）
bun test:ci --shard 1/4

# Web 测试
cd packages/web && bun test --conditions browser

# E2E 测试（Playwright）
cd packages/app && npx playwright test
```

### 7.3 代码风格

- 优先使用 Bun API（如 `Bun.file()`）
- 避免 `else`，使用早返回
- `const` 优先于 `let`，减少变量数量
- 点表示法优先于解构
- 函数式数组方法（flatMap/filter/map）优先于 for 循环
- 避免 `try/catch`，避免 `any` 类型
- 注释描述意图而非逻辑
- Drizzle Schema 使用 `snake_case` 字段名

### 7.4 调试

```bash
# 启用调试
export BUN_OPTIONS=--inspect=ws://localhost:6499/

# 调试服务器
bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve

# 调试 TUI
bun run --inspect=ws://localhost:6499/ --cwd packages/opencode --conditions=browser ./src/index.ts
```

### 7.5 预提交钩子

Husky 配置的预推送钩子：
1. 验证 Bun 版本匹配 `packageManager: bun@1.3.14`
2. 运行 `bun typecheck`

---

## 8. CI/CD 与部署

### 8.1 GitHub Actions

| 流水线 | 触发 | 说明 |
|--------|------|------|
| **lint.yml** | push/main/dev/PR | 运行 `bun lint`（oxlint） |
| **typecheck.yml** | push/main/dev/PR | 运行 `bun typecheck`（tsgo） |
| **test.yml** | push/main/dev/PR | 4 分片并行测试，JUnit 工件上传 |

### 8.2 部署方式

| 方式 | 说明 |
|------|------|
| **npm** | `@mimo-ai/cli` 发布到 npm |
| **桌面** | Electron-builder（mac/win/linux） |
| **云端** | SST（Cloudflare Workers/Services + Stripe） |
| **Nix** | `flake.nix` 开发环境和包 |
| **一键脚本** | `install` / `install.ps1` 从 mimo.xiaomi.com |

---

## 9. 配置与文档

### 9.1 主要配置文件

| 文件 | 用途 |
|------|------|
| `package.json` | Monorepo 根配置，workspace 目录 |
| `tsconfig.json` | 基础 TypeScript 配置 |
| `turbo.json` | Turborepo 任务编排 |
| `bunfig.toml` | Bun 配置（精确安装、测试保护） |
| `.oxlintrc.json` | 类型感知 lint 规则 |
| `sst.config.ts` | SST 部署配置 |
| `flake.nix` | Nix 开发 shell 和包覆盖 |

### 9.2 文档

| 文档 | 路径 |
|------|------|
| 主 README | `README.md` |
| 中文 README | `README.zh.md` |
| npm 包说明 | `README_npm.md` |
| 贡献指南 | `CONTRIBUTING.md` |
| Agent 指南 | `AGENTS.md` / `CLAUDE.md` |
| 安全策略 | `SECURITY.md` |
| 使用限制 | `USE_RESTRICTIONS.md` |
| Compose 设计文档 | `docs/compose/` |
| Harness 文档 | `docs/harness/` |
| Web 特性报告 | `docs/web-features-and-apis-report.md` |

### 9.3 本地配置

| 目录 | 用途 |
|------|------|
| `.mimocode/` | 项目配置（mimocode.jsonc, tui.json, skills, plugins） |
| `.dev-home/` | 本地开发目录（缓存、配置、数据、状态） |
| `.github/` | Actions 工作流、模板 |
| `script/` | 构建/发布脚本（20+ 文件） |
| `patches/` | 外部依赖补丁（solid-js, opentui 等） |

---

## 10. 开发哲学

- **渐进式迭代**：保持每次改动可编译、可验证
- **复用优先**：学习既有实现，吸收现有经验
- **简单性**：每个函数/类只承担单一责任，避免过早抽象
- **表达清晰**：拒绝炫技式写法，可读性优先
- **跟随项目风格**：导入顺序、命名、格式化保持一致
- **务实**：优先满足真实需求，避免理想化设计

---

## 附录：关键入口文件

| 文件 | 说明 |
|------|------|
| `packages/opencode/src/index.ts` | CLI 主入口，yargs 命令解析 |
| `packages/opencode/src/cli/cmd/tui/app.tsx` | TUI SolidJS 应用（~1228 行） |
| `packages/opencode/src/agent/agent.ts` | Agent 定义 |
| `packages/opencode/src/session/` | Session 系统（35+ 文件） |
| `packages/opencode/src/tool/` | 40+ 工具实现 |
| `packages/opencode/src/server/` | Hono HTTP/WS 服务器 |
| `packages/app/src/index.ts` | Web 应用入口 |
| `packages/desktop/src/main/` | Electron 主进程 |
| `packages/sdk/js/src/index.ts` | SDK 入口 |
| `packages/plugin/src/index.ts` | 插件 SDK 入口 |