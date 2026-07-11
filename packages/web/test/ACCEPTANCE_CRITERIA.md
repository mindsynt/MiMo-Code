# 展开/折叠功能验收契约

## 适用范围

`ContentText`、`ContentMarkdown`、`ContentBash`、`ContentError` 组件

## 行为契约

### 1. `expand` 属性

| 条件 | 预期行为 |
|------|----------|
| `expand=true` | 内容完全展开，**不显示**展开/折叠按钮 |
| `expand=false` 或未传 | 初始折叠，按溢出检测决定按钮可见性 |

### 2. 溢出检测 (`createOverflow`)

| 条件 | 预期 |
|------|------|
| `scrollHeight > clientHeight + 1` | `overflow.status = true` → 显示"展开"按钮 |
| `scrollHeight <= clientHeight + 1` | `overflow.status = false` → 不显示按钮 |
| 1px 子像素误差 | 被允许（+1 阈值），不视为溢出 |

### 3. 按钮显示逻辑（所有组件一致）

```
shouldShowButton = (!props.expand && overflow.status) || expanded()
```

- **溢出且未展开**：显示"展开"按钮
- **已展开**：显示"收起"按钮（无论溢出状态）
- **无溢出且未展开**：不显示按钮
- **强制展开**（`expand=true`）：不显示按钮

### 4. 按钮交互

| 操作 | 预期 |
|------|------|
| 点击"展开" | 内容完全显示，按钮变为"收起" |
| 点击"收起" | 内容折叠到 `-webkit-line-clamp: 3`，按钮变为"展开" |

### 5. 内容展示规则

| 组件 | 折叠态 CSS | 展开态 CSS |
|------|-----------|-----------|
| ContentText | `pre { display:-webkit-box; -webkit-line-clamp:3; overflow:hidden }` | `pre { display:block; overflow:visible }` |
| ContentMarkdown | `div[data-slot=markdown] { display:-webkit-box; -webkit-line-clamp:3; overflow:hidden }` | `div[data-slot=markdown][data-expanded] { display:block; overflow:visible }` |
| ContentBash | 通过 `data-expanded` 属性控制 | 同上 |
| ContentError | 通过 `data-expanded` 属性控制 | 同上（`-webkit-line-clamp: 7`） |

### 6. 上下文要求

| 组件 | 所需上下文 |
|------|-----------|
| ContentText | `ShareI18nProvider`（提供 `show_more`/`show_less` 等国际化消息） |
| ContentMarkdown | 同上 |
| ContentBash | 同上 |
| ContentError | 同上 |

## 验证清单

### 单元测试覆盖

- [x] `createOverflow`：初始状态为 `false`
- [x] `createOverflow`：溢出时返回 `true`
- [x] `createOverflow`：内容适配时返回 `false`
- [x] `createOverflow`：1px 阈值处理
- [x] `formatDuration`：毫秒/秒/分钟格式化
- [x] 组件模块导入完整性

### 需要完整 JSX 环境运行的测试

- [ ] `expand=true` → 按钮不显示
- [ ] `expand=false` + 溢出 → "展开"按钮可见
- [ ] `expand=false` + 无溢出 → 按钮不可见
- [ ] 点击"展开" → 变为"收起"
- [ ] 点击"收起" → 变为"展开"
- [ ] 按钮文本使用 i18n 消息

## CSS 质量门禁

- [x] stylelint 已配置（`lint:css` 可用）
- [x] 语法错误（`CssSyntaxError`）自动捕获
- [x] 重复选择器检测
- [ ] CI 中执行 `lint:css` 防止语法错误提交

## 已知限制

1. Solid 组件在 bun test 中的完整 DOM 渲染需要额外的运行时环境配置（`--conditions browser` + happy-dom），当前仅覆盖工具函数和模块导入验证。
2. 测试基础设施（solid-testing-library + bun）的兼容性仍需跟进。
