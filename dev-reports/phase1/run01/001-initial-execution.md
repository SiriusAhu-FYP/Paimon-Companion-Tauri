# Phase 1 — 初始执行报告

## 概述

Phase 1 的有限执行已完成。本次严格限制在骨架搭建、最小占位实现、mock 数据流和 spike 初步验证范围内。未接入真实 ASR/TTS/LLM 服务，未迁移旧项目业务逻辑。

---

## 本次具体实现了什么

### 1. 核心类型体系 (`src/types/`)

| 文件 | 内容 |
|------|------|
| `events.ts` | 全局事件类型映射表 `EventMap`，覆盖运行时/音频/LLM/角色/系统/外部共 6 类 25 个事件 |
| `runtime.ts` | `RuntimeMode`（auto/manual/stopped/paused）、`RuntimeState` |
| `character.ts` | `CharacterConfig`、`CharacterState` |
| `index.ts` | 统一 re-export |

### 2. 事件总线 (`src/services/event-bus/`)

| 能力 | 状态 |
|------|------|
| 类型安全的 `on<E>()` / `emit<E>()` | 已实现，可运行 |
| `once()` 一次性订阅 | 已实现 |
| `subscribe()` 批量订阅 | 已实现 |
| 事件历史追踪（200 条上限） | 已实现 |
| 订阅者生命周期管理（返回 unsubscribe） | 已实现 |

### 3. 运行时控制器 (`src/services/runtime/`)

| 能力 | 状态 |
|------|------|
| auto / stopped 模式切换 | 已实现，可运行 |
| `isAllowed()` 门控查询 | 已实现 |
| 模式变更事件通知 | 已实现 |
| 订阅 `system:emergency-stop` / `system:resume` | 已实现 |
| manual / paused 模式 | 类型已定义，逻辑未实现（按计划留到后续 phase） |

### 4. 日志服务 (`src/services/logger/`)

| 能力 | 状态 |
|------|------|
| 分级日志（debug/info/warn/error） | 已实现，可运行 |
| 模块名前缀 | 已实现 |
| 时间戳格式化 | 已实现 |
| `createLogger()` 工厂函数 | 已实现 |

### 5. 角色状态管理 (`src/services/character/`)

| 能力 | 状态 |
|------|------|
| 角色配置加载（内存 mock） | 已实现，可运行 |
| 情绪/表情状态维护（权威真源） | 已实现 |
| 响应 `llm:tool-call` 触发表情切换 | 已实现 |
| 状态变更事件通知 | 已实现 |

### 6. 知识与上下文层 (`src/services/knowledge/`)

| 能力 | 状态 |
|------|------|
| 长期知识存储 | 占位实现（内存数组） |
| 临时高优先级上下文管理 | 占位实现（带 TTL 过期清理） |
| 优先级排序组装 | 已实现 |
| 订阅 `external:product-message` | 已实现 |

### 7. 外部事件标准化接入 (`src/services/external-input/`)

| 能力 | 状态 |
|------|------|
| 调试事件注入 `injectEvent()` | 已实现，可运行 |
| 弹幕/礼物/商品消息标准化转发 | 已实现 |
| 外部源注册/状态管理 | 占位实现 |

### 8. 全局 service 注册中心 (`src/services/index.ts`)

| 能力 | 状态 |
|------|------|
| `initServices()` 统一初始化 | 已实现 |
| `getServices()` 获取全局单例 | 已实现 |
| `ServiceContainer` 类型 | 已定义 |

### 9. React-service 桥接 Hook (`src/hooks/`)

| Hook | 作用 |
|------|------|
| `useRuntime()` | 获取运行模式、stop/resume/isAllowed |
| `useCharacter()` | 获取角色状态、setEmotion |
| `useEventBus()` | 订阅事件，自动清理 |
| `useLogger()` | 获取模块级 logger |

### 10. 主窗口布局 (`src/app/`, `src/features/`)

| 组件 | 内容 |
|------|------|
| `MainWindow` | 三栏布局：左侧 Live2D 预览、中间对话面板、右侧控制面板、底部事件日志 |
| `Live2DPreview` | 占位组件，显示角色状态信息 |
| `ChatPanel` | 订阅 ASR/LLM 事件展示对话记录 |
| `ControlPanel` | 运行模式显示、急停/恢复按钮、表情切换按钮 |
| `EventLog` | 实时展示事件总线中的关键事件 |
| `StageWindow` | OBS 透明窗口占位组件 |

### 11. Mock 工具 (`src/utils/mock.ts`)

| 工具 | 作用 |
|------|------|
| `mockCharacterInit()` | 加载 mock 角色配置（派蒙） |
| `mockVoicePipeline()` | 模拟完整 ASR→LLM→TTS 事件链路 |
| `mockExternalEvents()` | 模拟弹幕/礼物/商品消息注入 |
| `exposeMockTools()` | 将调试工具挂载到 `window.__paimon` |

开发者工具中可用 `window.__paimon.voicePipeline()` 触发模拟链路。

### 12. Tauri 配置更新

- 主窗口增加 `label: "main"`，尺寸调整为 1200×800

---

## 新增文件清单

```
src/types/events.ts
src/types/runtime.ts
src/types/character.ts
src/types/index.ts
src/services/event-bus/event-bus.ts
src/services/event-bus/index.ts
src/services/runtime/runtime-service.ts
src/services/runtime/index.ts
src/services/logger/logger-service.ts
src/services/logger/index.ts
src/services/character/character-service.ts
src/services/character/index.ts
src/services/knowledge/knowledge-service.ts
src/services/knowledge/index.ts
src/services/external-input/external-input-service.ts
src/services/external-input/index.ts
src/services/index.ts
src/hooks/use-runtime.ts
src/hooks/use-character.ts
src/hooks/use-event-bus.ts
src/hooks/use-logger.ts
src/hooks/index.ts
src/app/MainWindow.tsx
src/app/EventLog.tsx
src/app/index.ts
src/features/control-panel/ControlPanel.tsx
src/features/control-panel/index.ts
src/features/chat/ChatPanel.tsx
src/features/chat/index.ts
src/features/live2d/Live2DPreview.tsx
src/features/live2d/index.ts
src/features/stage/StageWindow.tsx
src/features/stage/index.ts
src/utils/mock.ts
docs/research/spike-1-transparent-window.md
docs/research/spike-2-live2d-tauri-react.md
docs/research/spike-3-microphone-webview.md
docs/research/spike-4-dual-window-sync.md
```

---

## 骨架 vs 可运行

| 类别 | 模块 | 状态 |
|------|------|------|
| 可运行 | event-bus | 类型安全的发布/订阅，含历史追踪 |
| 可运行 | runtime | auto/stopped 模式切换 + 门控 |
| 可运行 | logger | 分级日志到控制台 |
| 可运行 | character | mock 配置加载 + 表情状态管理 |
| 可运行 | external-input | 调试注入 + 标准化转发 |
| 占位 | knowledge | 内存存储，接口已定义，无持久化 |
| 占位 | Live2DPreview | 无真实渲染，只展示状态文字 |
| 占位 | StageWindow | 透明窗口壳子，无 Live2D |
| 占位 | ChatPanel | 订阅事件展示，无真实 ASR/LLM |
| 可运行 | ControlPanel | 按钮可触发 runtime 和 character 状态变更 |
| 可运行 | EventLog | 实时展示事件总线事件 |
| 可运行 | Mock 工具 | 可通过 devtools 触发完整模拟链路 |

---

## 测试与验证

| 验证项 | 结果 |
|--------|------|
| TypeScript 编译（`tsc --noEmit`） | 通过，零错误 |
| Vite 生产构建（`vite build`） | 通过，输出 204KB JS |
| 模块间类型一致性 | 通过（EventMap 全局统一） |

> **注意：** 未进行 `pnpm tauri dev` 运行时验证（当前环境无 Rust 工具链和显示环境）。需要在目标开发机上验证 UI 渲染、事件流和 mock 工具是否正常工作。

---

## Spike 验证状态

| Spike | 状态 | 结论 |
|-------|------|------|
| Spike 1：透明窗口 + OBS | 初步调研 | Tauri 2 + WebView2 支持透明窗口，待实机验证 OBS 捕获 |
| Spike 2：Live2D 加载 | 初步调研 | 基于旧项目经验高度可行，推荐 pixi.js@6 + pixi-live2d-display@0.4 |
| Spike 3：麦克风权限 | 初步调研 | WebView2 支持 getUserMedia，为 Phase 2 准备 |
| Spike 4：双窗口同步 | 初步调研 | 推荐 Tauri Event System，架构已通过 service-first 准备好 |

所有 spike 均完成了基于文档的初步调研，结论已沉淀到 `docs/research/`。实机验证需要在目标开发机上进行。

---

## 还没做什么

| 事项 | 原因 |
|------|------|
| 真实 Live2D 渲染 | 需要 Cubism Core SDK + 模型文件 + spike 实机验证 |
| 真实 ASR / TTS / LLM 对接 | Phase 2 任务 |
| 配置文件读取（Tauri IPC） | 需要 Rust 工具链运行时验证 |
| OBS 舞台窗口实际渲染 | Phase 4 任务，当前只有占位组件 |
| 完整急停/人工接管流程 | Phase 3 任务，当前 runtime 仅 auto/stopped |
| React 桥接层选型（Zustand 等） | 当前使用自定义 Hook 直接桥接，够用则不引入额外依赖 |
| 运行时验证（pnpm tauri dev） | 当前环境无 Rust 工具链，需在目标开发机上验证 |

---

## 拆分说明

foundation.md 中的 F6（配置加载通过 Tauri IPC）在本次未实现，因为：
- 需要 Rust 端编写 IPC Command
- 当前使用 mock 内存配置替代
- 拆分为：Phase 1 后续补充（Rust IPC 命令实现 + 前端调用）

foundation.md 中的 F3（Live2D 渲染模块）在本次只做了占位组件，因为：
- 需要先完成 Spike 2 的实机验证
- 需要从旧项目复制 Cubism Core SDK 和测试模型
- 拆分为：Spike 2 实机验证 → pixi.js 集成 → 模型加载 → 表情/动作播放

foundation.md 中的 F8（React 桥接层选型）结论：
- 当前使用自定义 Hook（`useRuntime`、`useCharacter` 等）直接桥接 service 状态到 React
- 暂不引入 Zustand/Jotai，因为当前复杂度不需要
- 如果后续 UI 状态管理变复杂，再引入 Zustand 作为 UI 状态容器