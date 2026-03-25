# Opus 本轮工作成果同步

## 1. 本轮目标

- **任务目标**：执行 Phase 1 Foundation 的有限实现，搭建可运行的基础框架骨架
- **阶段定位**：Phase 1 — Foundation（基础能力建设阶段）
- **执行策略**：严格限制在骨架搭建、最小占位实现、mock 数据流和 spike 初步验证范围内，不接入真实 ASR/TTS/LLM 服务，不迁移旧项目业务逻辑

**依据**：`blueprints/phase1/foundation.md`、`dev-reports/phase1/run01/001-initial-execution.md`

---

## 2. 本轮实际完成内容

### 已经完成

- **事件总线核心实现**：类型安全的发布/订阅系统，含历史追踪（200 条上限）、订阅者生命周期管理
  - 依据：`src/services/event-bus/event-bus.ts`、`dev-reports/phase1/run01/001-initial-execution.md`

- **运行时控制器最小子集**：auto/stopped 两个模式切换、`isAllowed()` 门控查询、模式变更事件通知
  - 依据：`src/services/runtime/runtime-service.ts`

- **角色状态管理（权威真源）**：角色配置加载（内存 mock）、情绪/表情状态维护、响应 `llm:tool-call` 触发表情切换
  - 依据：`src/services/character/character-service.ts`

- **知识与上下文层（占位）**：长期知识存储接口、临时高优先级上下文管理（带 TTL 过期清理）、优先级排序组装
  - 依据：`src/services/knowledge/knowledge-service.ts`

- **外部事件标准化接入（占位）**：调试事件注入 `injectEvent()`、弹幕/礼物/商品消息标准化转发、外部源注册/状态管理
  - 依据：`src/services/external-input/external-input-service.ts`

- **日志服务**：分级日志（debug/info/warn/error）、模块名前缀、时间戳格式化
  - 依据：`src/services/logger/logger-service.ts`

- **全局 Service 注册中心**：`initServices()` 统一初始化、`getServices()` 获取全局单例
  - 依据：`src/services/index.ts`

- **React-service 桥接 Hook**：`useRuntime()`、`useCharacter()`、`useEventBus()`、`useLogger()`
  - 依据：`src/hooks/` 下全部 Hook 文件

- **主窗口 UI 骨架**：三栏布局（左侧 Live2D 预览、中间对话面板、右侧控制面板）、底部事件日志
  - 依据：`src/app/MainWindow.tsx`、`src/features/` 下全部组件

- **舞台窗口占位组件**：OBS 透明窗口壳子，显示角色状态信息
  - 依据：`src/features/stage/StageWindow.tsx`

- **Mock 工具链**：`mockCharacterInit()`、`mockVoicePipeline()`、`mockExternalEvents()`、`exposeMockTools()`（挂载到 `window.__paimon`）
  - 依据：`src/utils/mock.ts`

- **核心类型体系**：`EventMap` 全局事件类型映射（6 类 25 个事件）、`RuntimeMode`、`RuntimeState`、`CharacterConfig`、`CharacterState`
  - 依据：`src/types/` 下全部类型文件

- **Spike 初步调研文档**：4 个 spike 均完成基于文档的初步调研，结论已沉淀到 `docs/research/`
  - 依据：`docs/research/spike-1-transparent-window.md` 至 `spike-4-dual-window-sync.md`

- **Phase 0 文档修订**：统一修订 5 份规划文档中残留的矛盾表述（MVP 与外部服务依赖、service-first 原则、runtime 分阶段实现）
  - 依据：`dev-reports/phase0/run03/003-closeout.md`

- **Phase 0 Supplement 修订**：根据 `supplement.md` 补充约束修订 architecture.md、module-design.md、data-flow.md、phase-roadmap.md，新增 `product-requirements.md`
  - 依据：`dev-reports/phase0/run02/002-supplement-revision.md`

### 部分完成

- **知识层**：接口边界已定义，内存存储已实现，但无持久化、无 RAG 检索
  - 依据：`src/services/knowledge/knowledge-service.ts`（占位实现）

- **Live2D 渲染**：占位组件已创建，但无真实 PIXI + pixi-live2d-display 集成
  - 依据：`src/features/live2d/Live2DPreview.tsx`、`docs/research/spike-2-live2d-tauri-react.md`

- **舞台窗口**：组件壳子已创建，但无透明窗口实际渲染、无 Live2D 实例
  - 依据：`src/features/stage/StageWindow.tsx`

- **对话面板**：订阅事件展示逻辑已实现，但无真实 ASR/LLM 对接
  - 依据：`src/features/chat/ChatPanel.tsx`

### 未完成或明确未做

- **真实 Live2D 渲染**：需要 Cubism Core SDK + 模型文件 + spike 实机验证
  - 依据：`dev-reports/phase1/run01/001-initial-execution.md` — "还没做什么"章节

- **真实 ASR / TTS / LLM 对接**：Phase 2 任务
  - 依据：`blueprints/phase1/foundation.md` — "本阶段暂不做的事"

- **配置文件读取（Tauri IPC）**：需要 Rust 工具链运行时验证，当前使用 mock 内存配置替代
  - 依据：`dev-reports/phase1/run01/001-initial-execution.md` — "拆分说明"

- **OBS 舞台窗口实际渲染**：Phase 4 任务，当前只有占位组件
  - 依据：同上

- **完整急停/人工接管流程**：Phase 3 任务，当前 runtime 仅 auto/stopped
  - 依据：`src/services/runtime/runtime-service.ts` 注释

- **React 桥接层选型（Zustand 等）**：当前使用自定义 Hook 直接桥接，够用则不引入额外依赖
  - 依据：`dev-reports/phase1/run01/001-initial-execution.md` — "拆分说明"

- **运行时验证（`pnpm tauri dev`）**：当前环境无 Rust 工具链，需在目标开发机上验证
  - 依据：同上

---

## 3. 关键修改文件与作用

### 核心服务层

- `src/services/event-bus/event-bus.ts`
  - **作用**：全局事件总线核心实现
  - **本次改了什么**：新增类型安全的 `on()`/`emit()`/`once()`/`subscribe()` 方法、事件历史追踪、订阅者生命周期管理
  - **状态**：✅ 可运行（TypeScript 编译通过）

- `src/services/runtime/runtime-service.ts`
  - **作用**：运行时控制器（门控）
  - **本次改了什么**：实现 auto/stopped 模式切换、`isAllowed()` 门控、订阅 `system:emergency-stop`/`system:resume` 事件
  - **状态**：✅ 可运行（最小子集）

- `src/services/character/character-service.ts`
  - **作用**：角色状态权威真源
  - **本次改了什么**：实现角色配置加载、情绪/表情状态管理、响应 `llm:tool-call` 触发表情切换、状态变更事件通知
  - **状态**：✅ 可运行（mock 配置）

- `src/services/knowledge/knowledge-service.ts`
  - **作用**：知识与上下文层
  - **本次改了什么**：实现长期知识存储、临时高优先级上下文管理（带 TTL）、优先级排序组装、订阅 `external:product-message`
  - **状态**：🟡 占位（内存存储，无持久化）

- `src/services/external-input/external-input-service.ts`
  - **作用**：外部事件标准化接入
  - **本次改了什么**：实现 `injectEvent()` 调试注入、弹幕/礼物/商品消息标准化转发、外部源注册/状态管理
  - **状态**：✅ 可运行（mock 注入）

- `src/services/index.ts`
  - **作用**：全局 Service 注册中心
  - **本次改了什么**：实现 `initServices()` 统一初始化、`getServices()` 获取全局单例、定义 `ServiceContainer` 类型
  - **状态**：✅ 可运行

### React 桥接层

- `src/hooks/use-runtime.ts`
  - **作用**：React 组件获取运行时状态
  - **本次改了什么**：实现 `useRuntime()` Hook，订阅 `runtime:mode-change` 事件，暴露 `stop()`/`resume()`/`isAllowed()`
  - **状态**：✅ 可运行

- `src/hooks/use-character.ts`
  - **作用**：React 组件获取角色状态
  - **本次改了什么**：实现 `useCharacter()` Hook，订阅 `character:state-change` 事件，暴露 `setEmotion()`
  - **状态**：✅ 可运行

- `src/hooks/use-event-bus.ts`
  - **作用**：React 组件订阅事件总线
  - **本次改了什么**：实现 `useEventBus()` Hook，自动随组件生命周期清理订阅
  - **状态**：✅ 可运行

### UI 组件层

- `src/app/MainWindow.tsx`
  - **作用**：主控制台窗口布局
  - **本次改了什么**：实现三栏布局（Live2D 预览 + 对话面板 + 控制面板）、底部事件日志
  - **状态**：🟡 占位（UI 骨架已就绪，待真实渲染）

- `src/features/stage/StageWindow.tsx`
  - **作用**：OBS 舞台窗口组件
  - **本次改了什么**：实现透明窗口占位组件，显示角色状态信息
  - **状态**：🟡 占位（壳子已创建，待真实 Live2D 渲染）

- `src/features/control-panel/ControlPanel.tsx`
  - **作用**：控制面板 UI
  - **本次改了什么**：实现运行模式显示、急停/恢复按钮、表情切换按钮、角色状态展示
  - **状态**：✅ 可运行（按钮可触发 runtime 和 character 状态变更）

- `src/features/live2d/Live2DPreview.tsx`
  - **作用**：Live2D 预览区域
  - **本次改了什么**：实现占位组件，显示角色状态文字信息
  - **状态**：🟡 占位（无真实渲染）

### 类型与 Mock

- `src/types/events.ts`
  - **作用**：全局事件类型映射表
  - **本次改了什么**：定义 `EventMap` 接口，覆盖运行时/音频/LLM/角色/系统/外部共 6 类 25 个事件
  - **状态**：✅ 已定义

- `src/utils/mock.ts`
  - **作用**：Mock 工具链
  - **本次改了什么**：实现 `mockVoicePipeline()` 模拟 ASR→LLM→TTS 链路、`mockExternalEvents()` 模拟外部事件注入、`exposeMockTools()` 挂载到 `window.__paimon`
  - **状态**：✅ 可运行（可通过 devtools 调用）

### 文档

- `docs/research/spike-1-transparent-window.md` 至 `spike-4-dual-window-sync.md`
  - **作用**：4 个技术验证任务的初步调研结论
  - **本次改了什么**：记录基于文档的调研结论、推荐方案、后续验证计划
  - **状态**：🟡 初步调研完成，待实机验证

- `dev-reports/phase0/run03/003-closeout.md`、`dev-reports/phase0/run02/002-supplement-revision.md`、`dev-reports/phase1/run01/001-initial-execution.md`
  - **作用**：阶段工作汇报
  - **本次改了什么**：记录 Phase 0 修订和 Phase 1 初始执行的详细成果
  - **状态**：✅ 已完成

---

## 4. 当前核心模块状态

### RuntimeService（运行时控制器）

- **当前职责**：全局运行状态管理、模式切换、门控查询
- **当前实现状态**：✅ Phase 1 最小子集（仅 auto/stopped）
- **关键接口/方法/状态**：
  - `getMode(): RuntimeMode`
  - `getState(): RuntimeState`
  - `isAllowed(): boolean`（门控）
  - `setMode(mode: RuntimeMode)`
  - `stop()` / `resume()`
  - 订阅 `system:emergency-stop` → 切换到 stopped
  - 订阅 `system:resume` → 切换到 auto
  - 发送 `runtime:mode-change` 事件
- **已接入哪些地方**：
  - `ControlPanel` 通过 `useRuntime()` 获取模式状态并触发 stop/resume
  - `EventLog` 订阅 `runtime:mode-change` 事件用于日志展示
- **还缺什么**：
  - manual / paused 模式（按计划留到 Phase 3+）
  - 完整急停协调逻辑（串行处理、锁麦等）
  - 人工接管流程
  - 依据：`src/services/runtime/runtime-service.ts` 注释、`dev-reports/phase1/run01/001-initial-execution.md`

### CharacterService（角色状态管理）

- **当前职责**：角色配置加载、情绪/表情状态维护（权威真源）、响应 LLM 工具调用
- **当前实现状态**：✅ 可运行（mock 配置加载）
- **关键接口/方法/状态**：
  - `getState(): CharacterState`
  - `getConfig(): CharacterConfig | null`
  - `loadConfig(config: CharacterConfig)`
  - `setEmotion(emotion: string)`
  - `setSpeaking(isSpeaking: boolean)`
  - 订阅 `llm:tool-call` → 触发 `setExpression` 时切换表情
  - 发送 `character:expression` / `character:state-change` 事件
- **已接入哪些地方**：
  - `Live2DPreview` 通过 `useCharacter()` 显示角色状态
  - `StageWindow` 通过 `useCharacter()` 同步角色状态
  - `ControlPanel` 通过 `useCharacter()` 显示状态并触发 `setEmotion()`
  - `mock.ts` 中 `mockCharacterInit()` 加载 mock 配置
- **还缺什么**：
  - 真实配置文件读取（需 Tauri IPC）
  - 真实 Live2D 渲染集成（需 PIXI + pixi-live2d-display）
  - 动作播放支持
  - 依据：`src/services/character/character-service.ts`、`dev-reports/phase1/run01/001-initial-execution.md`

### EventBus（事件总线）

- **当前职责**：模块间事件发布/订阅，核心通信枢纽
- **当前实现状态**：✅ 可运行
- **关键接口/方法/状态**：
  - `on<E>(event, handler): () => void`（返回 unsubscribe 函数）
  - `once<E>(event, handler): () => void`
  - `emit<E>(event, ...args)`
  - `subscribe(subscriptions[]): () => void`（批量订阅）
  - `getHistory()` / `clearHistory()`
  - `listenerCount(event)` / `removeAllListeners(event)`
  - 事件历史追踪（200 条上限，含时间戳）
- **已接入哪些地方**：
  - 所有 Service 都通过 EventBus 通信
  - React Hooks 通过 `useEventBus()` 订阅事件
  - `EventLog` 订阅关键事件用于展示
- **还缺什么**：
  - 暂无（Phase 1 需求已满足）
  - 依据：`src/services/event-bus/event-bus.ts`、`src/types/events.ts`

### KnowledgeService（知识与上下文层）

- **当前职责**：长期知识存储、临时高优先级上下文管理、优先级排序组装
- **当前实现状态**：🟡 占位（接口已定义，内存存储）
- **关键接口/方法/状态**：
  - `addKnowledge(entry: KnowledgeEntry)`
  - `addLiveContext(entry: LiveContextEntry)`
  - `removeLiveContext(id: string)`
  - `getAssembledContext(): string`（按优先级排序：临时 > 长期）
  - `getLiveContextCount()` / `getKnowledgeCount()`
  - 订阅 `external:product-message` → 区分 priority/persistent 类型
  - TTL 过期清理（`pruneExpired()`）
- **已接入哪些地方**：
  - `external-input` 通过事件注入商品消息
  - 暂无 LLM 模块调用（Phase 2 任务）
- **还缺什么**：
  - 真实 RAG 检索（向量库、Embedding 模型）
  - 持久化存储
  - 知识导入/管理界面
  - 依据：`src/services/knowledge/knowledge-service.ts`、`dev-reports/phase1/run01/001-initial-execution.md`

### ExternalInputService（外部事件标准化接入）

- **当前职责**：接收外部来源事件、标准化转换、调试注入
- **当前实现状态**：✅ 可运行（mock 注入）
- **关键接口/方法/状态**：
  - `injectEvent(raw: RawExternalEvent)`（调试/mock 注入入口）
  - `registerSource(sourceId)` / `unregisterSource(sourceId)`
  - `getSourceStatus(): Record<string, { connected: boolean }>`
  - 标准化转换：
    - `danmaku` → `external:danmaku`
    - `gift` → `external:gift`
    - `product-message` → `external:product-message`（区分 priority/persistent）
- **已接入哪些地方**：
  - `mock.ts` 中 `mockExternalEvents()` 调用 `injectEvent()`
  - `EventLog` 订阅外部事件用于展示
- **还缺什么**：
  - 真实平台适配器（直播平台弹幕/礼物 API）
  - 商品切换消息接入
  - 依据：`src/services/external-input/external-input-service.ts`

### 主窗口 / 舞台窗口

- **当前职责**：
  - 主窗口：操作员控制台（预览 + 对话 + 控制 + 日志）
  - 舞台窗口：OBS 透明输出窗口
- **当前实现状态**：🟡 骨架已创建，待真实渲染
- **关键组件**：
  - `MainWindow`：三栏布局 + 底部日志
  - `StageWindow`：透明窗口占位，显示角色状态文字
  - `Live2DPreview`：占位组件，显示角色状态文字
  - `ControlPanel`：急停/恢复按钮、表情切换、状态展示
  - `ChatPanel`：订阅 ASR/LLM 事件展示对话记录
  - `EventLog`：实时展示事件总线事件（50 条上限）
- **已接入哪些地方**：
  - 所有组件通过 Hooks 订阅 Service 状态
  - 按钮可触发 runtime 和 character 状态变更
- **还缺什么**：
  - 真实 Live2D 渲染（需 Spike 2 实机验证）
  - 透明窗口实机验证（需 Spike 1 实机验证）
  - 双窗口同步机制（需 Tauri Event API，Phase 4）
  - 依据：`src/app/MainWindow.tsx`、`src/features/` 下全部组件、`docs/research/spike-4-dual-window-sync.md`

### React Hooks / Bridge

- **当前职责**：Service 状态到 React 组件的响应式桥接
- **当前实现状态**：✅ 可运行（自定义 Hook 直接桥接）
- **关键 Hook**：
  - `useRuntime()`：获取运行模式、stop/resume/isAllowed
  - `useCharacter()`：获取角色状态、setEmotion
  - `useEventBus(event, handler)`：订阅事件，自动清理
  - `useLogger()`：获取模块级 logger（未详细实现）
- **设计原则**：Service-first —— 业务状态始终由 Service 管理，Hook 仅负责桥接到 React
- **已接入哪些地方**：
  - 所有 UI 组件都通过 Hooks 获取状态和触发操作
- **还缺什么**：
  - 暂无（当前复杂度不需要 Zustand 等额外状态库）
  - 如果后续 UI 状态变复杂，可引入 Zustand 作为 UI 状态容器（不改变业务状态归属）
  - 依据：`src/hooks/` 下全部 Hook、`dev-reports/phase1/run01/001-initial-execution.md`

### Spike 文档

- **当前状态**：🟡 初步调研完成，待实机验证
- **已完成**：
  - Spike 1：透明窗口 + OBS → Tauri 2 + WebView2 支持透明窗口，待实机验证 OBS 捕获
  - Spike 2：Live2D 加载 → 基于旧项目经验高度可行，推荐 pixi.js@6 + pixi-live2d-display@0.4
  - Spike 3：麦克风权限 → WebView2 支持 getUserMedia，为 Phase 2 准备
  - Spike 4：双窗口同步 → 推荐 Tauri Event System，架构已通过 service-first 准备好
- **还缺什么**：
  - 所有 spike 都需要在目标开发机上进行实机验证
  - 依据：`docs/research/spike-*.md`、`dev-reports/phase1/run01/001-initial-execution.md`

---

## 5. 当前是否已经形成以下能力

| 能力 | 状态 | 依据 |
|------|------|------|
| 是否已有单一状态真源 | ✅ 是 | `CharacterService` 作为角色状态的权威真源，所有窗口基于同一状态同步渲染（`src/services/character/character-service.ts` 注释） |
| 是否已有 runtime 门控 | ✅ 是 | `RuntimeService.isAllowed()` 提供门控查询，Phase 1 实现 auto/stopped 模式切换（`src/services/runtime/runtime-service.ts`） |
| 是否已有事件总线最小可用版本 | ✅ 是 | `EventBus` 实现类型安全的发布/订阅、历史追踪、订阅者生命周期管理（`src/services/event-bus/event-bus.ts`） |
| 是否已有主窗口 UI 骨架 | ✅ 是 | `MainWindow` 实现三栏布局 + 底部日志，包含 Live2DPreview/ChatPanel/ControlPanel/EventLog 组件（`src/app/MainWindow.tsx`） |
| 是否已有第二窗口（舞台窗口）骨架 | ✅ 是 | `StageWindow` 占位组件已创建，显示角色状态信息，待真实渲染（`src/features/stage/StageWindow.tsx`） |
| 是否已有 mock 数据流 | ✅ 是 | `mock.ts` 提供 `mockVoicePipeline()`/`mockExternalEvents()`/`exposeMockTools()`，可通过 devtools 调用（`src/utils/mock.ts`） |
| 是否已有知识层的长期/临时上下文区分 | ✅ 是 | `KnowledgeService` 区分 `longTermKnowledge` 和 `liveContext`，临时上下文带 TTL 和优先级（`src/services/knowledge/knowledge-service.ts`） |
| 是否已有人工注入外部事件的入口 | ✅ 是 | `ExternalInputService.injectEvent()` 提供调试/mock 注入入口，`window.__paimon` 暴露调试工具（`src/services/external-input/external-input-service.ts`、`src/utils/mock.ts`） |

---

## 6. 测试与验证

### 本轮跑了什么测试？

- **TypeScript 编译检查**：`tsc --noEmit` 通过，零错误
- **Vite 生产构建**：`vite build` 通过，输出 204KB JS
- **模块间类型一致性**：通过（`EventMap` 全局统一）

**依据**：`dev-reports/phase1/run01/001-initial-execution.md` — "测试与验证"章节

### 构建是否通过？

- ✅ TypeScript 编译：通过
- ✅ Vite 生产构建：通过
- ⚠️ Tauri 运行时验证：**未进行**（当前环境无 Rust 工具链和显示环境）

**依据**：同上

### 有哪些 spike 已经做了初步验证？

- ✅ Spike 1：透明窗口 + OBS → 基于文档调研，Tauri 2 + WebView2 支持透明窗口
- ✅ Spike 2：Live2D 加载 → 基于旧项目经验，pixi.js@6 + pixi-live2d-display@0.4 高度可行
- ✅ Spike 3：麦克风权限 → 基于文档调研，WebView2 支持 getUserMedia
- ✅ Spike 4：双窗口同步 → 基于文档调研，推荐 Tauri Event System

**注意**：所有 spike 均为**基于文档的初步调研**，**未进行实机验证**。需要在目标开发机上进行实际测试。

**依据**：`docs/research/spike-*.md`、`dev-reports/phase1/run01/001-initial-execution.md` — "Spike 验证状态"章节

### 哪些只是写了文档，还没有代码验证？

- **所有 spike 的实机验证**：需要在目标开发机上运行 `pnpm tauri dev` 进行实际测试
- **Live2D 渲染**：`Live2DPreview` 和 `StageWindow` 都是占位组件，无真实 PIXI 渲染
- **配置文件读取**：需要 Rust IPC Command 实现，当前使用 mock 内存配置
- **OBS 舞台窗口实际渲染**：Phase 4 任务，当前只有占位组件
- **完整急停/人工接管流程**：Phase 3 任务，当前 runtime 仅 auto/stopped

**依据**：`dev-reports/phase1/run01/001-initial-execution.md` — "还没做什么"章节

---

## 7. 当前最值得我继续追问的 5 个点

### 1. 问题：Live2D 渲染的实机验证结果如何？

- **为什么值得检查**：Spike 2 仅完成文档调研，需要在目标开发机上实际验证 pixi.js + pixi-live2d-display 在 Tauri WebView2 中是否正常工作。这是 Phase 1 的核心验收标准之一。
- **涉及文件**：
  - `docs/research/spike-2-live2d-tauri-react.md`
  - `src/features/live2d/Live2DPreview.tsx`
  - `src/services/character/character-service.ts`

### 2. 问题：透明窗口能否被 OBS 正常捕获？

- **为什么值得检查**：Spike 1 仅完成文档调研，需要在目标开发机上实际验证 Tauri 2 透明窗口在 Windows 上能否被 OBS"窗口捕获"功能正常捕获。这直接影响 Phase 4 的舞台窗口实现。
- **涉及文件**：
  - `docs/research/spike-1-transparent-window.md`
  - `src/features/stage/StageWindow.tsx`
  - `tauri.conf.json`（窗口配置）

### 3. 问题：双窗口同步机制的实际延迟如何？

- **为什么值得检查**：Spike 4 推荐 Tauri Event System，但未实际验证跨窗口通信的延迟。特别是高频口型数据（如果未来需要）的同步延迟会直接影响直播效果。
- **涉及文件**：
  - `docs/research/spike-4-dual-window-sync.md`
  - `src/services/character/character-service.ts`（状态真源）
  - `src/app/MainWindow.tsx`、`src/features/stage/StageWindow.tsx`

### 4. 问题：Mock 工具链在浏览器开发者工具中是否正常工作？

- **为什么值得检查**：`window.__paimon` 暴露的调试工具是 Phase 1 重要的调试手段。需要验证在真实 Tauri 环境中能否通过 devtools 调用 `voicePipeline()` 等工具触发完整模拟链路。
- **涉及文件**：
  - `src/utils/mock.ts`
  - `src/services/index.ts`（服务初始化）
  - `src/app/MainWindow.tsx`（UI 响应）

### 5. 问题：Runtime 门控是否真正起到作用？

- **为什么值得检查**：`RuntimeService.isAllowed()` 是 Phase 1 的核心门控机制。需要验证在 stopped 模式下，系统是否真的能阻止新的自动操作（如 ASR 触发、LLM 响应等）。当前实现只有模式切换，门控逻辑还未被实际调用。
- **涉及文件**：
  - `src/services/runtime/runtime-service.ts`
  - `src/hooks/use-runtime.ts`
  - `src/features/control-panel/ControlPanel.tsx`（急停/恢复按钮）

---

## 8. 证据来源

本次报告主要参考以下文件：

### 阶段汇报文档
- `dev-reports/phase1/run01/001-initial-execution.md` — Phase 1 初始执行报告
- `dev-reports/phase0/run03/003-closeout.md` — Phase 0 Close-out 报告
- `dev-reports/phase0/run02/002-supplement-revision.md` — Phase 0 Supplement 修订汇报

### 规划文档
- `blueprints/phase1/foundation.md` — Phase 1 详细施工文档
- `blueprints/phase0/bootstrap.md` — Phase 0 启动文档
- `blueprints/phase0/supplement.md` — Phase 0 补充约束

### 核心服务代码
- `src/services/event-bus/event-bus.ts` — 事件总线实现
- `src/services/runtime/runtime-service.ts` — 运行时控制器
- `src/services/character/character-service.ts` — 角色状态管理
- `src/services/knowledge/knowledge-service.ts` — 知识与上下文层
- `src/services/external-input/external-input-service.ts` — 外部事件接入
- `src/services/index.ts` — 全局服务注册中心

### React 桥接与 UI
- `src/hooks/use-runtime.ts`、`use-character.ts`、`use-event-bus.ts` — React Hooks
- `src/app/MainWindow.tsx` — 主窗口布局
- `src/features/stage/StageWindow.tsx` — 舞台窗口组件
- `src/features/control-panel/ControlPanel.tsx` — 控制面板
- `src/features/live2d/Live2DPreview.tsx` — Live2D 预览
- `src/features/chat/ChatPanel.tsx` — 对话面板
- `src/app/EventLog.tsx` — 事件日志

### 类型与 Mock
- `src/types/events.ts` — 全局事件类型映射
- `src/types/runtime.ts`、`character.ts` — 核心类型定义
- `src/utils/mock.ts` — Mock 工具链

### Spike 调研文档
- `docs/research/spike-1-transparent-window.md` — 透明窗口 + OBS 调研
- `docs/research/spike-2-live2d-tauri-react.md` — Live2D 加载调研
- `docs/research/spike-3-microphone-webview.md` — 麦克风权限调研
- `docs/research/spike-4-dual-window-sync.md` — 双窗口同步调研

### Git 历史
- 最近提交：`534768b feat(phase1): implement foundation service layer, UI shells, and spike docs`

---

## 附录：术语说明

- **Opus**：指上一次执行 Phase 1 初始任务的 AI 助手
- **Phase 1 Foundation**：基础能力建设阶段，目标是搭建可运行的框架骨架
- **Service-first**：业务状态始终由 Service 层管理，React 状态库仅用于 UI 层状态和桥接
- **单一状态真源**：角色状态只有一个权威数据源（`CharacterService`），所有窗口基于同一状态同步渲染
- **Spike**：技术验证任务，在正式实现前做小规模验证以确认可行性

---

**报告生成时间**：2026-03-21
**依据分支**：`feature/phase0-bootstrap`（根据 git 历史，最近提交为 `534768b`）
**报告用途**：供另一位架构顾问快速了解 Opus 本轮工作成果
