# Web 前端功能补齐：功能中心框架 + 语音输入

> 设计文档
> 日期：2026-07-10
> 基于：Web 前端（packages/app）与 TUI（packages/opencode）功能差距分析

---

## [S1] 问题背景

Web 前端（`packages/app`）与 TUI 之间存在约 20 项功能差距。TUI 是核心开发焦点，Web 端长期未同步更新。用户要求分批补齐，策略为「先搭框架再填功能」，首批实现语音输入。

## [S2] 解决方案概览

在 Web 前端中新增一个**「功能中心」侧边栏面板**，作为所有扩展功能的统一管理入口。首批实现语音输入模块作为第一个功能卡片。

## [S3] 功能中心框架

### [S3.1] 入口位置

在侧边栏轨道（`sidebar-rail`）底部，设置齿轮图标和帮助图标之间，新增一个「⚡ 功能中心」入口按钮。

### [S3.2] 面板结构

点击后，侧边栏展开一个名为「功能中心」的新面板。内部以可折叠卡片（Collapsible）组织功能模块：

```
功能中心面板
├── 🎤 语音输入       ← 首批实现
├── 🔌 插件管理       ← 后续
├── 🔧 LSP 管理       ← 后续
├── 📦 Checkpoint     ← 后续
├── 🧠 Memory         ← 后续
├── 🎯 Goal 目标      ← 后续
├── ↩️ 撤销/重做      ← 后续
├── 🔄 Workflow       ← 后续
└── 👥 子代理          ← 后续
```

### [S3.3] 与现有布局的关系

```
sidebar-rail (w-16)
├── 项目图标列表
├── [+]
├── [spacer]
├── ⚡ 功能中心       ← 新增
├── [设置齿轮]
└── [帮助]
```

面板展开后占用侧边栏面板区域（与项目面板互斥，通过底部 Tab 切换）。

### [S3.4] 文件结构

```
src/
├── context/
│   └── feature-center.tsx    ← FeatureCenterProvider，管理各功能模块的注册状态
├── pages/
│   └── layout/
│       └── feature-center.tsx ← 功能中心面板主组件
│       └── feature-center-button.tsx ← 侧边栏轨道按钮
├── components/
│   └── feature-center/
│       ├── feature-card.tsx   ← 可折叠功能卡片通用组件
│       ├── voice-panel.tsx    ← 语音输入配置卡
│       ├── plugin-panel.tsx   ← 插件管理卡（后续）
│       ├── lsp-panel.tsx      ← LSP 管理卡（后续）
│       ├── checkpoint-panel.tsx  ← Checkpoint 卡（后续）
│       ├── memory-panel.tsx   ← Memory 卡（后续）
│       ├── goal-panel.tsx     ← Goal 卡（后续）
│       ├── workflow-panel.tsx ← Workflow 卡（后续）
│       └── subagent-panel.tsx ← 子代理卡（后续）
```

### [S3.5] 功能模块接口

每个功能卡片组件遵循以下接口：

```tsx
interface FeatureCardProps {
  icon: string // emoji 图标
  title: string // 功能名称
  description: string // 简短描述
  children: ReactNode // 卡片展开后的配置/管理界面
  defaultOpen?: boolean // 是否默认展开
}
```

## [S4] 语音输入模块

### [S4.1] 技术方案

使用 **Web Speech API**（`SpeechRecognition`）实现语音转文字，这是浏览器原生 API，无需外部依赖。

### [S4.2] 组件结构

#### 麦克风按钮（`voice-button.tsx`）

位于 Prompt 输入区右侧，与发送按钮同级：

```
[prompt 输入框] [🎤] [发送]
```

状态：

- 灰色麦克风 🎤 — 未录音，可用
- 红色脉冲麦克风 🎤 — 录音中，anime 动画
- 不可用状态 — 不支持 SpeechRecognition 的浏览器隐藏该按钮

#### 语音配置卡（`voice-panel.tsx`）

在功能中心面板中，展开后包含：

```
🎤 语音输入
├── 输入设备: [下拉选择麦克风列表]
├── 语音控制模式: [开关] — 说「打开文件」自动执行
├── 语音发送: [开关] — 说「发送」自动提交
├── 状态: [就绪 ✅ / 录音中 🎤 / 不可用 ❌]
└── [测试麦克风] 按钮
```

### [S4.3] 状态管理

`VoiceProvider`（`context/voice.tsx`）管理：

```ts
interface VoiceState {
  isSupported: boolean // 浏览器是否支持 SpeechRecognition
  isListening: boolean // 是否正在录音
  isSpeechEnd: boolean // 是否检测到语音结束
  transcript: string // 当前识别文本
  interimTranscript: string // 中间结果
  error: string | null // 错误信息
  deviceId: string // 选中的麦克风设备 ID
  voiceControl: boolean // 语音控制模式
  voiceSend: boolean // 语音发送模式
  devices: MediaDeviceInfo[] // 可用麦克风列表
}
```

### [S4.4] 交互流程

```
用户点击 🎤
  → 请求 getUserMedia 权限
  → 权限被拒 → 显示错误提示
  → 权限通过 → 开始录音
    → SpeechRecognition.start()
    → 流式返回 interimResults
    → 实时显示在输入框（灰色文字）
    → 用户点击 🎤 停止 / 检测到语音结束
    → SpeechRecognition.stop()
    → finalResult 填入输入框（黑色文字）
    → 等待用户手动提交或自动提交
```

### [S4.5] 语音控制模式

当语音控制模式开启时，识别结果匹配以下命令直接执行：

| 语音命令          | 动作            |
| ----------------- | --------------- |
| "发送" / "提交"   | 提交当前 prompt |
| "清除" / "清空"   | 清空输入框      |
| "新建" / "新会话" | 创建新会话      |
| "撤销"            | 撤销上一条消息  |
| "重做"            | 重做            |

### [S4.6] 降级策略

| 浏览器状态               | 行为                   |
| ------------------------ | ---------------------- |
| 不支持 SpeechRecognition | 隐藏麦克风按钮         |
| 获取权限被拒             | 显示文字提示，按钮置灰 |
| 识别出错                 | 显示错误提示，可重试   |
| 静音超时（15s）          | 自动停止录音           |

### [S4.7] 文件详情

| 文件                                             | 行数估计 | 职责                          |
| ------------------------------------------------ | -------- | ----------------------------- |
| `src/utils/voice.ts`                             | ~80      | Web Speech API 封装，设备枚举 |
| `src/context/voice.tsx`                          | ~150     | VoiceProvider，录音状态管理   |
| `src/components/voice/voice-button.tsx`          | ~60      | 麦克风按钮 UI                 |
| `src/pages/feature-center/voice-panel.tsx`       | ~100     | 语音配置卡                    |
| `src/components/feature-center/feature-card.tsx` | ~40      | 可折叠卡片通用组件            |
| `src/context/feature-center.tsx`                 | ~30      | FeatureCenterProvider         |
| `src/pages/layout/feature-center.tsx`            | ~80      | 功能中心面板                  |
| `src/pages/layout/feature-center-button.tsx`     | ~30      | 侧边栏入口按钮                |
| 修改 `src/pages/layout/sidebar-shell.tsx`        | +10      | 添加功能中心按钮              |
| 修改 `src/pages/session.tsx`                     | +5       | 集成麦克风按钮到输入区        |
| 修改 `src/components/prompt/prompt-input.tsx`    | +15      | 添加麦克风按钮                |

## [S5] 后续迭代计划

| 迭代 | 功能                          | 估计工作量 |
| ---- | ----------------------------- | ---------- |
| v1   | 功能中心框架 + 语音输入       | 当前设计   |
| v2   | 插件管理 UI（从只读到可操作） | 中         |
| v3   | LSP 管理 UI（从只读到可操作） | 小         |
| v4   | Checkpoint 管理               | 中         |
| v5   | Memory 管理                   | 中         |
| v6   | Goal 目标跟踪                 | 中         |
| v7   | 撤销/重做 UI                  | 小         |
| v8   | Workflow/Compose 可视化       | 大         |
| v9   | 子代理管理                    | 中         |

## [S6] 测试策略

- 语音输入：在支持 SpeechRecognition 的浏览器中手动测试录音→转文字流程
- 降级测试：在不支持 SpeechRecognition 的浏览器中确认按钮隐藏
- 权限测试：拒绝麦克风权限后确认错误提示正确
- 功能中心：确认各卡片可折叠展开、状态正确

## [S7] 验证方式

1. 功能中心按钮出现在侧边栏轨道底部
2. 点击展开面板，语音输入卡片可折叠展开
3. 麦克风按钮出现在 Prompt 输入区
4. 点击麦克风开始录音，语音实时转文字填入输入框
5. 语音控制命令可执行（发送、清除等）
6. 不支持 SpeechRecognition 的浏览器正常隐藏麦克风
