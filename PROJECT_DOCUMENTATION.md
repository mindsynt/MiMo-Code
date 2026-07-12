# MiMoCode 项目说明文档

> **生成时间**：2026-07-12
> **项目地址**：https://github.com/XiaomiMiMo/MiMo-Code（forked from anomalyco/opencode）
> **License**：MIT（使用受限，详见 USE_RESTRICTIONS.md）

---

## 1. 项目概述

**MiMoCode**（前身为 OpenCode）是小米 MiMo 团队开发的**终端原生 AI 编程助手**。它能读写代码、执行命令、管理 Git，通过持久化记忆系统在多次会话间保持对项目的深度理解，并持续自我改进。

### 核心定位

- 终端优先的 AI 编码助手（TUI-first）
- 支持多 LLM 提供商（20+ 模型接入，含 MiMo Auto 免费通道）
- 多 Agent 协作系统（build / plan / compose / max）
- 跨平台支持（CLI / Web / Desktop Electron）
- 云端服务（SST Cloudflare 部署 + Stripe 计费）

### 关键数字

- **18 个 workspace packages**（Monorepo 架构）
- **721 个核心源文件**（opencode 包），118,916 行 TypeScript/TSX
- **40+ 工具实现**（文件操作、搜索、Shell、Agent、MCP 等）
- **17+ 内置技能**（Office 文档、PDF、学术搜索、深度调研等）
- **95+ 测试文件**覆盖核心功能
- **126+ 个 LLM Provider SDK** 依赖（@ai-sdk/* 系列）
- **CLI 命令**：23 个（run、generate、debug、serve、models、stats、export、import、github、pr、session、plugin、db 等）

---

## 2. 技术栈总览

| 领域 | 技术选型 |
|------|----------|
| **运行时 / 包管理** | Bun 1.3.14 + Turborepo |
| **语言** | TypeScript (ESM) |
| **前端框架** | SolidJS + Vite |
| **状态管理 / 异步** | Effect (v4.0.0-beta.48) |
| **终端 UI** | @opentui/solid (0.1.101) |
| **Web UI** | SolidJS + Tailwind CSS + Kobalte |
| **桌面应用** | Electron + Vite |
| **数据存储** | Drizzle ORM (1.0.0-beta.19) + SQLite (FTS5) |
| **API 框架** | Hono (4.10.7) |
| **LLM 编排** | Vercel AI SDK (6.0.168) + 多提供商适配器 |
| **Web 搜索** | MCP SDK (1.27.1) + tree-sitter |
| **代码检查** | oxlint (TypeScript-aware) + Prettier |
| **测试** | Bun 内置测试 + Playwright (E2E) |
| **部署** | SST (Cloudflare) / Electron-builder / npm |
| **CI/CD** | GitHub Actions（lint / typecheck / test 三流水线） |
| **认证** | OpenAuthJS + Stripe 计费 |

---

## 3. 项目结构（18 Packages）

### 3.1 核心包

| Package | npm 名称 | 路径 | 用途 |
|---------|----------|------|------|
| **opencode** | `@mimo-ai/cli` | `packages/opencode/` | ★ 核心 CLI：TUI、Agent、Session、工具、存储、MCP、LSP、技能、工作流、子 Agent 系统 |
| **app** | `@mimo-ai/app` | `packages/app/` | Web UI SPA（SolidJS），桌面应用共用 |
| **desktop** | `@mimo-ai/desktop` | `packages/desktop/` | Electron 桌面应用，嵌入 app 包 |
| **ui** | `@mimo-ai/ui` | `packages/ui/` | 共享 SolidJS 组件库（Tailwind + 主题 + 国际化） |
| **web** | `@mimo-ai/web` | `packages/web/` | 官方文档和营销网站（Astro + Starlight） |
| **sdk** | `@mimo-ai/sdk` | `packages/sdk/js/` | TypeScript SDK，OpenAPI 生成（v1 + v2 双版本） |
| **plugin** | `@mimo-ai/plugin` | `packages/plugin/` | 插件 SDK（工具扩展、TUI 路由、工作区适配器） |
| **shared** | `@mimo-ai/shared` | `packages/shared/` | 共享工具函数和类型（平台无关） |
| **script** | `@mimo-ai/script` | `packages/script/` | 构建/发布脚本（版本计算、渠道检测） |

### 3.2 云服务包

| Package | npm 名称 | 路径 | 用途 |
|---------|----------|------|------|
| **console/app** | `@mimo-ai/console-app` | `packages/console/app/` | 云控制台 Web UI（Stripe 计费、OpenAuth） |
| **console/core** | `@mimo-ai/console-core` | `packages/console/core/` | 控制台后端（Drizzle 数据库、模型、权限、订阅、API Key 管理） |
| **console/function** | `@mimo-ai/console-function` | `packages/console/function/` | Cloudflare Workers API 函数（认证、日志处理） |
| **console/mail** | `@mimo-ai/console-mail` | `packages/console/mail/` | 事务性邮件模板（jsx-email） |
| **console/resource** | `@mimo-ai/console-resource` | `packages/console/resource/` | Cloudflare 资源抽象（KV、Buckets，Bun/Node 双平台） |
| **enterprise** | `@mimo-ai/enterprise` | `packages/enterprise/` | 企业版/自托管会话分享门户 |
| **function** | `@mimo-ai/function` | `packages/function/` | Cloudflare Worker（GitHub App webhook） |

### 3.3 工具与扩展包

| Package | 路径 | 用途 |
|---------|------|------|
| **slack** | `packages/slack/` | Slack 集成 Bot（@slack/bolt） |
| **storybook** | `packages/storybook/` | UI 组件 Storybook 文档 |
| **containers** | `packages/containers/` | CI 容器镜像（Dockerfiles） |
| **extensions** | `packages/extensions/` | IDE 扩展（Zed editor） |
| **identity** | `packages/identity/` | 品牌资产（Logo、图标） |

### 3.4 依赖关系

```
Root
├── @mimo-ai/cli (opencode) ← 核心
│   ├── @mimo-ai/shared
│   ├── @mimo-ai/plugin
│   ├── @mimo-ai/sdk
│   ├── @mimo-ai/ui
│   └── 126+ 外部提供商 SDK（@ai-sdk/*）
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

## 4. 核心架构（packages/opencode）

### 4.1 源码结构

```
packages/opencode/src/
├── agent/           # Agent 系统（build/plan/compose/max）
├── cli/             # CLI 命令（23 个命令）
│   ├── cmd/         # run/generate/debug/serve/models/stats/export/import/github/pr/session/plugin/db 等
│   └── cmd/tui/     # TUI 子命令（attach/thread）
├── cli/ui           # TUI SolidJS 应用（~1228 行）
├── file/            # 文件操作（watcher/ripgrep/ignore/protected）
├── inbox/           # 消息收件箱（render/sql）
├── ide/             # IDE 集成
├── lfs/             # Git LFS
├── memory/          # 持久化记忆（FTS5 全文搜索）
├── metrics/         # 指标系统
├── model/           # 模型管理
├── node/            # Node.js 平台适配
├── plugin/          # 插件系统
├── project/         # 项目管理（vcs/bootstrap/instance/schema）
├── provider/        # LLM 提供商适配层（20+ 提供商）
├── pty/             # 伪终端（Bun/Node 双平台）
├── session/         # ★ 会话系统（35+ 模块）
│   ├── checkpoint*.ts  # 检查点机制（fork/冷启动/验证/对齐/重试）
│   ├── compaction.ts    # 上下文压缩
│   ├── overflow.ts      # 溢出处理
│   ├── goal.ts          # Goal/停止条件
│   ├── auto-dream.ts    # 自我改进
│   ├── llm.ts           # LLM 请求
│   ├── processor.ts     # 消息处理器
│   └── prompt/          # 17+ 模型专用 Prompt
├── server/          # Hono HTTP/WS 服务器（Bun/Node 双平台）
├── shell/           # Shell 执行（跨平台）
├── skill/           # 技能系统
├── storage/         # 存储层（SQLite/db.bun/db.node）
├── tool/            # 40+ 工具实现（read/write/edit/glob/grep/bash/actor/task/workflow 等）
├── vcs/             # 版本控制（Git）
├── workflow/        # 工作流引擎（compose/deep-research/fact-check）
└── util/            # 通用工具函数
```

### 4.2 主要模块详解

#### Agent 系统
- **build**：默认主 Agent，全权限开发
- **plan**：只读分析模式，禁止写入非计划文件
- **compose**：编排器，确定性的 JS 脚本协调多 Agent
- **max**：实验性，并行 best-of-N 推理 + 裁判选优
- **general**：通用多步骤子 Agent
- **explore**：快速只读代码探索子 Agent

#### 权限系统
- `runtimePermission()` 合并 Agent + 用户/会话规则集 + hardPermissions
- 层级：agent.permission → 用户配置 → agent.hardPermission
- plan 模式的 hardPermission 始终拒绝非计划文件写入

#### Session 系统（35+ 模块）
- **Checkpoint**：SQLite FTS5 持久化，支持 fork 模式（继承父上下文）和冷启动模式（仅传递 delta）
- **Compaction**：token 感知的上下文压缩和截断
- **Overflow**：溢出处理和重建
- **Goal/Stop**：独立裁判模型评估停止条件
- **Dream/Distill**：提取知识→记忆，发现模式→技能

#### 工具系统（40+ 工具）
- 注册表模式 + Zod Schema 验证
- 每个工具配对 `.ts`（实现）+ `.txt`（提示描述）+ `.shell.txt`（Shell 描述）
- 类别：文件（read/write/edit）、搜索（glob/grep/codesearch）、Shell（bash/lsp）、Agent 编排（actor/task/workflow）、知识（memory/history/skill）、外部（webfetch/websearch/mcp）

#### 技能系统
- **内置技能（17+）**：arxiv、docx-official、pdf-official、pptx-official、xlsx-official、html-to-video-pipeline、deep-research、design-blueprint、frontend-design、evolve、skill-creator、super-research、loop、mimocode、modern-python-toolchain、research-paper-writing、drive-mimo
- **Compose 技能**：brainstorm、plan、execute、tdd、debug、verify、review、merge、report、subagent、worktree、parallel、feedback、ask

#### 工作流系统
- **内置工作流**：`compose`（Brainstorm→Design→Implement→Verify→Review→Report→Merge）、`deep-research`（Brief→Plan→Research→Reflect→Write→Review）、`fact-check`（Plan→Search→Extract→Group→Crosscheck→Report）
- 确定性的 JavaScript 脚本，沙箱运行时，支持 `agent()`、`parallel()`、`pipeline()`
- 自定义工作流：`.mimocode/workflows/` 或 `.claude/workflows/` 放置 `.js`

### 4.3 平台适配

使用条件导入实现 Bun/Node 双平台兼容：
- `#db` → `db.bun.ts` / `db.node.ts`
- `#pty` → `pty.bun.ts` / `pty.node.ts`
- `#hono` → `adapter.bun.ts` / `adapter.node.ts`
- `#read-sqlite` → `read-sqlite.bun.ts` / `read-sqlite.node.ts`

---

## 5. CLI 命令（23 个）

| 命令 | 说明 |
|------|------|
| `mimo run` | 运行主 Agent |
| `mimo generate` | 生成内容 |
| `mimo serve` | 启动 HTTP/WS 服务器 |
| `mimo debug` | 调试模式 |
| `mimo console` | 控制台管理 |
| `mimo providers` | 管理 LLM 提供商 |
| `mimo agent` | Agent 管理 |
| `mimo upgrade` | 升级 |
| `mimo uninstall` | 卸载 |
| `mimo models` | 模型管理 |
| `mimo stats` | 统计信息 |
| `mimo export` | 导出会话 |
| `mimo import` | 导入会话 |
| `mimo github` | GitHub 集成 |
| `mimo pr` | Pull Request 操作 |
| `mimo session` | 会话管理 |
| `mimo plugin` | 插件管理 |
| `mimo db` | 数据库操作 |
| `mimo mcp` | MCP 服务器管理 |
| `mimo acp` | ACP 协议 |
| `mimo tui thread` | TUI 线程 |
| `mimo tui attach` | TUI 附加 |
| `mimo web` | Web UI（临时禁用） |
| `mimo completion` | 生成 Shell 补全脚本 |

---

## 6. 主要功能特性

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
| **Slack 集成** | Slack Bot 协作 |
| **GitHub 集成** | PR 创建、Issue 管理、代码搜索 |

---

## 7. 配置系统

### 7.1 配置文件

| 文件 | 项目级 | 全局 |
|------|--------|------|
| 主配置 | `.mimocode/mimocode.jsonc` | `~/.config/mimocode/mimocode.json` |
| TUI 配置 | `.mimocode/tui.json` | `~/.config/mimocode/tui.json` |
| 认证凭据 | — | `~/.local/share/mimocode/auth.json` |

Windows 下 XDG 路径位于 `%LOCALAPPDATA%\mimocode\`，可通过 `MIMOCODE_HOME` 覆盖。

### 7.2 数据目录

| 目录 | 默认路径（Linux） | 内容 |
|------|------------------|------|
| data | `~/.local/share/mimocode/` | SQLite 数据库、认证凭据、记忆、日志 |
| state | `~/.local/state/mimocode/` | TUI 偏好设置、最近使用模型 |
| cache | `~/.cache/mimocode/` | 语言服务器、缓存的模型目录、技能 |

### 7.3 JSON Schema 自动补全

- `mimocode.jsonc`：`https://mimo.xiaomi.com/mimocode/config.json`
- `tui.json`：`https://mimo.xiaomi.com/mimocode/tui.json`

---

## 8. 快速开始

### 8.1 安装

```bash
# 方式 1：npm 全局安装
npm install -g @mimo-ai/cli
mimo

# 方式 2：一键脚本
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

### 8.2 本地开发

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

# 启动 API Server（端口 4096）
bun dev serve
```

### 8.3 构建

```bash
# 构建独立二进制
./packages/opencode/script/build.ts --single
./packages/opencode/dist/opencode-<platform>/bin/opencode

# 全量构建
bun run --cwd packages/opencode script/build.ts
```

---

## 9. 开发指南

### 9.1 构建命令

| 命令 | 说明 |
|------|------|
| `bun dev` | 启动开发服务器 |
| `bun lint` | 运行 oxlint 检查 |
| `bun typecheck` | 运行 Turborepo typecheck |
| `bun test` | 运行测试（从包目录执行） |

### 9.2 测试

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

### 9.3 代码风格

- 优先使用 Bun API（如 `Bun.file()`）
- 避免 `else`，使用早返回
- `const` 优先于 `let`，减少变量数量
- 点表示法优先于解构
- 函数式数组方法（flatMap/filter/map）优先于 for 循环
- 避免 `try/catch`，避免 `any` 类型
- 注释描述意图而非逻辑
- Drizzle Schema 使用 `snake_case` 字段名

### 9.4 调试

```bash
# 启用调试
export BUN_OPTIONS=--inspect=ws://localhost:6499/

# 调试服务器
bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve

# 调试 TUI
bun run --inspect=ws://localhost:6499/ --cwd packages/opencode --conditions=browser ./src/index.ts
```

---

## 10. CI/CD 与部署

### 10.1 GitHub Actions

| 流水线 | 触发 | 说明 |
|--------|------|------|
| **lint.yml** | push/main/dev/PR | 运行 `bun lint`（oxlint） |
| **typecheck.yml** | push/main/dev/PR | 运行 `bun typecheck`（tsgo） |
| **test.yml** | push/main/dev/PR | 4 分片并行测试，JUnit 工件上传 |

### 10.2 部署方式

| 方式 | 说明 |
|------|------|
| **npm** | `@mimo-ai/cli` 发布到 npm |
| **桌面** | Electron-builder（mac/win/linux） |
| **云端** | SST（Cloudflare Workers/Services + Stripe） |
| **Nix** | `flake.nix` 开发环境和包 |
| **一键脚本** | `install` / `install.ps1` 从 mimo.xiaomi.com |

---

## 11. 开发哲学

- **渐进式迭代**：保持每次改动可编译、可验证
- **复用优先**：学习既有实现，吸收现有经验
- **简单性**：每个函数/类只承担单一责任，避免过早抽象
- **表达清晰**：拒绝炫技式写法，可读性优先
- **跟随项目风格**：导入顺序、命名、格式化保持一致
- **务实**：优先满足真实需求，避免理想化设计

---

## 12. 安全与使用限制

- **无沙箱**：Agent 不运行在沙箱中，权限系统是 UX 特性而非安全隔离
- **服务器模式**：可选启用，需设置 `OPENCODE_SERVER_PASSWORD`
- **使用限制**：详见 `USE_RESTRICTIONS.md`（禁止军事用途、恶意网络活动等）
- **安全报告**：通过 GitHub Security Advisory 提交

---

## 13. 与 OpenCode 的关系

MiMoCode 基于 [OpenCode](https://github.com/anomalyco/opencode) fork 构建，保留其全部核心能力（多 Provider、TUI、LSP、MCP、插件），并在此基础上构建了：
- 持久化记忆（SQLite FTS5）
- 智能上下文管理（checkpoint/compaction/overflow）
- 子智能体编排（actor/workflow）
- 目标驱动的自主循环（goal/stop）
- Compose 工作流（spec-driven 开发）
- 自我进化（dream/distill）

---

## 14. 文档体系

| 文档 | 路径 | 用途 |
|------|------|------|
| 主 README | `README.md` | 英文功能介绍 |
| 中文 README | `README.zh.md` | 中文功能介绍 |
| npm 包说明 | `README_npm.md` | npm 包文档 |
| 贡献指南 | `CONTRIBUTING.md` | 开发贡献指南 |
| Agent 指南 | `AGENTS.md` / `CLAUDE.md` | 开发准则 |
| 安全策略 | `SECURITY.md` | 安全报告流程 |
| 使用限制 | `USE_RESTRICTIONS.md` | 使用限制 |
| 项目概览 | `PROJECT_OVERVIEW.md` | 项目总体说明 |
| Compose 设计文档 | `docs/compose/` | Compose 模式设计 |
| Harness 文档 | `docs/harness/` | 测试框架 |
| Web 特性报告 | `docs/web-features-and-apis-report.md` | Web API 文档 |

---

## 15. 关键入口文件

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

---

## 附录：主要依赖版本

| 依赖 | 版本 |
|------|------|
| Bun | 1.3.14 |
| TypeScript | 5.8.2 |
| Effect | 4.0.0-beta.48 |
| SolidJS | 1.9.10 |
| Vite | 7.1.4 |
| Tailwind CSS | 4.1.11 |
| Hono | 4.10.7 |
| Drizzle ORM | 1.0.0-beta.19 |
| AI SDK | 6.0.168 |
| Zod | 4.1.8 |
| MCP SDK | 1.27.1 |
| Turborepo | 2.8.13 |
| SST | 3.18.10 |
