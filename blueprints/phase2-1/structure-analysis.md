# Phase 2.1 结构整理分析报告

**日期**：2026-03-23（2026-03-23 第三次修订：更新验证状态、Stage-only 架构收敛、MUI v6 迁移）
**阶段**：Phase 2.1（结构现状盘点与整理优先级分析）
**性质**：事实盘点，不做架构判断，不设计方案

---

## 概述

本文档对 `main` 分支（commit `677dbb2`）的代码库进行结构现状全面盘点，为后续 Phase 2.1 结构整理提供事实依据。

**盘点范围**：src/ 下所有 TypeScript 模块、feature 组件、utils 工具
**盘点方法**：文件内容逐一审查、模块间依赖关系梳理、真实手测覆盖情况核实
**盘点立场**：取证与整理——只记录现状，不提出改造方案，不做架构判断

---

## 最新状态勘误 / Update

> 以下内容为 2026-03-23 补充，用于更正早期盘点中的过时假设。

### 架构状态（已收敛）

1. **当前为 Stage-only 单实例模型**：Live2D 渲染仅存在于 `StageWindow`，主界面使用 `StageSlot` 作为贴靠占位区，**不再保留第二套独立 PIXI + Live2D 渲染实例**
2. **当前为 StageHost + docked/floating 模式**：`StageHost` 承载所有舞台窗口控制 UI（尺寸预设、眼神、缩放锁定等），Stage 窗口支持 docked（贴靠）和 floating（浮动）两种模式
3. **UI 已迁移到 MUI v6**：控制面板等 UI 组件使用 MUI v6

### 手测/验证状态更正

| 项目 | 原文档状态 | 实际状态 |
|------|-----------|---------|
| OBS 透明窗口捕获 | 未验证 | ✅ 已完成验证 |
| Stage 窗口真实桌面环境打开 | 未确认 | ✅ 已独立打开并渲染 |
| Stage 透明背景 | 未验证 | ✅ CSS + Tauri transparent 配置已生效 |
| 主界面 Live2D 渲染 | 真实渲染实例 | ❌ 已移除，主界面为 StageSlot 占位 |

### Live2DRenderer 实例数量

- **当前：仅 StageWindow 持有 Live2DRenderer 实例**
- `Live2DPreview.tsx` 已不再是 PIXI 渲染实例，仅作为占位 UI（显示加载状态和角色文字信息）
- 两套渲染实例的旧架构已被废弃

---

## 1. 当前主要模块

### 1.1 Service 层（src/services/）

| 模块 | 文件 | 核心职责 |
|------|------|---------|
| event-bus | `event-bus.ts` | 类型安全的发布/订阅，含历史追踪（200 条上限） |
| runtime | `runtime-service.ts` | auto/stopped 双模式，`isAllowed()` 门控 |
| character | `character-service.ts` | 角色状态权威真源，表情/情绪管理 |
| knowledge | `knowledge-service.ts` | 长期知识 + 临时上下文（TTL 过期） |
| external-input | `external-input-service.ts` | 外部事件标准化接入，`injectEvent()` 入口 |
| llm | `llm-service.ts` + `mock-llm-service.ts` | LLM 门面，持有 ChatMessage 历史 |
| tts | `mock-tts-service.ts` | Mock TTS（正弦波 WAV 生成） |
| audio | `audio-player.ts` | 音频播放 + AnalyserNode 口型数据提取 |
| pipeline | `pipeline-service.ts` | 主链路编排：ASR→LLM→TTS→播放→口型 |

### 1.2 Feature 层（src/features/）

| 模块 | 文件 | 核心职责 |
|------|------|---------|
| live2d | `Live2DPreview.tsx` + `live2d-renderer.ts` + `model-registry.ts` | Live2D 渲染核心 |
| stage | `StageWindow.tsx` + `StageHost.tsx` + `StageSlot.tsx` | 舞台窗口/宿主/贴靠区 |
| chat | `ChatPanel.tsx` | 对话记录展示 |
| control-panel | `ControlPanel.tsx` | 主控制面板 + Stage 控制 |

### 1.3 Utils 层

| 模块 | 文件 | 核心职责 |
|------|------|---------|
| window-sync | `window-sync.ts` | BroadcastChannel/Tauri IPC 自适应封装，状态/口型/控制三通道 |
| mock | `mock.ts` | Mock 工具挂载 + mockVoicePipeline |

---

## 2. 职责过重或边界不清的部分

### 2.1 StageWindow.tsx（353 行）

**文件**：`src/features/stage/StageWindow.tsx`

**问题**：单一文件承担了渲染层初始化、窗口控制、Tauri API 动态调用、工具栏 UI、鼠标事件处理、localStorage 读写等多重职责。

**具体表现**：
- 动态 import `@tauri-apps/api/window` 在多处出现（`applyAlwaysOnTop`、`applyCursorEvents`、`handleControlCommand`）
- localStorage 读写（ZOOM_STORAGE_KEY）散布在工具函数中（第 14-23 行）
- `initRenderer` 和 `switchModel` 两个函数各自近百行
- `handleControlCommand` 的 switch 包含 10 种命令类型处理
- 工具栏 UI（`shouldShowToolbar`、`isFloating` 等）渲染逻辑直接内嵌在组件 return 中

**影响**：对 AI 可维护性影响最大，多个关注点混杂导致修改风险高。

---

### 2.2 main.tsx（70 行）

**文件**：`src/main.tsx`

**问题**：承担了窗口标签判断、服务初始化、事件订阅接线、devtools 工具挂载等多重不相关职责。

**具体表现**：
- 窗口标签判断逻辑与 `App.tsx` 重复（两处都有 `getWindowLabel()` + URL 参数检测）
- `broadcastFullState` / `broadcastControl` / `onControlCommand` 的订阅接线逻辑（第 31-59 行）与 `StageWindow.tsx` 中的同步订阅存在重复

**影响**：main.tsx 是主窗口初始化的唯一入口，但接线逻辑与窗口渲染逻辑耦合。

---

### 2.3 ControlPanel.tsx（>200 行）

**文件**：`src/features/control-panel/ControlPanel.tsx`

**问题**：混入了 Stage 窗口控制逻辑（模型选择、表情列表订阅）和主链路控制（麦克风测试），导致组件职责不单一。

**具体表现**：
- 第 28-37 行：订阅 `report-expressions` 来自 Stage 窗口
- 第 43-44 行：调用 `broadcastControl({ type: "set-model" })` 控制 Stage 窗口
- 第 50-58 行：麦克风测试逻辑

**影响**：Stage 相关控制和主链路控制在同一个组件中，边界模糊。

---

### 2.4 Live2DRenderer.ts（430 行）

**文件**：`src/features/live2d/live2d-renderer.ts`

**问题**：单一 class 承担了 PIXI 初始化、模型加载/切换、表情/动作驱动、口型平滑、眼神控制、缩放、resize 等 7 种不同能力。

**具体表现**：
- `eslint-disable @typescript-eslint/no-explicit-any` 类型绕过（`AnyModel = any`）
- 大量 `try/catch { /* */ }` 吞掉错误，调试困难
- `setupLipSyncHandler` / `startRandomEye` / `applyEyeMode` 等方法各自有独立的状态管理

**影响**：重构风险高，建议在 Phase 3 以后处理。

---

## 3. 重复逻辑 / 可复用部分

### 3.1 Stage 窗口/主窗口状态同步（3 处实现）

| 位置 | 方式 |
|------|------|
| `main.tsx` 第 31-46 行 | 直接订阅 bus 事件，调用 `broadcastState` / `broadcastControl` |
| `StageWindow.tsx` 第 223-237 行 | 在 `setup()` 中订阅 `onMouthSync` / `onControlCommand` |
| `StageHost.tsx` 第 83-96 行 | 订阅 `onControlCommand` 响应 sync-state |

**问题**：状态广播和监听分散在 3 处，没有统一的"同步策略管理层"。

**可复用方向**：将状态广播/控制命令的订阅逻辑抽取为独立 hook 或 service，避免每个窗口各自订阅。

---

### 3.2 Tauri / Browser 自适应逻辑（2 处）

| 位置 | 内容 |
|------|------|
| `window-sync.ts` 第 44-68 行 | `initTauriEvents()` 动态检测并选择 BroadcastChannel 或 Tauri IPC |
| `StageWindow.tsx` 第 62-63 行 | `const hasTauri = "__TAURI_INTERNALS__" in window` |

**问题**：`StageWindow` 中重复实现了 Tauri 检测逻辑。

**可复用方向**：统一到 `window-sync.ts` 中，或抽取为 `@/utils/tauri-detect.ts`。

---

### 3.3 口型同步通道（两条并行路径）

| 通道 | 用途 | 消费者 |
|------|------|---------|
| `player.onMouthData` callback | 本地 Live2D 渲染 | `Live2DPreview` |
| `broadcastMouth` (paimon:mouth-sync) | 跨窗口同步 | `StageWindow` |

**问题**：两条路径并行存在，`PipelineService` 同时调用两者，但职责边界已通过 BroadcastChannel 解耦，不算真正的重复。

---

## 4. mock / real 边界现状

### 4.1 明确已接 mock 的模块

| 模块 | mock 位置 | 真实替换点 |
|------|---------|-----------|
| LLM | `mock-llm-service.ts` | `src/services/index.ts` 第 40 行 `new MockLLMService()` |
| TTS | `mock-tts-service.ts` | `src/services/index.ts` 第 42 行 `new MockTTSService()` |
| Character config | `mock.ts` 的 `MOCK_CHARACTER_CONFIG` | 尚未实现 Tauri IPC 读取 |
| External input | `mock.ts` + `ExternalInputService` | 尚未实现真实平台适配器 |

### 4.2 边界不清的地方

**`mock.ts` 本身职责模糊**：同时承担了 mock 角色配置、mock 语音链路、mock 外部事件、exposeMockTools 四种职责。`mockVoicePipeline` 内部 `await import("@/services")` 动态获取 pipeline，形成潜在循环依赖。

**`pipeline-service.ts` 中 hardcode 了 mock provider**：没有 Provider 注入机制，切换真实 LLM/TTS 需要修改 `initServices()`。

---

## 5. 对后续 AI 可维护性影响最大的点

### Top 1：`StageWindow.tsx`（353 行）

- 单一文件承担渲染 + 窗口控制 + Tauri API 调用 + 工具栏 UI + 事件订阅 + localStorage
- 多个 `useEffect` 和 `useCallback` 深层嵌套，回调链超过 5 层
- AI 阅读时需要同时理解 PIXI 渲染逻辑、Tauri 窗口 API、React 组件生命周期

### Top 2：`Live2DRenderer.ts`（430 行）

- 单一 class 承担 7 种不同能力
- `AnyModel: any` 类型绕过散布在多处
- 大量 `try/catch { /* */ }` 吞掉错误，调试困难

### Top 3：`main.tsx`（70 行）

- 混入了窗口标签判断、服务初始化、事件订阅接线三件不相关的事
- 与 `App.tsx` 存在重复的窗口标签判断逻辑

### Top 4：`window-sync.ts`（134 行）

- `ControlCommand` 联合类型有 15 种变体
- `emitEvent` / `listenEvent` 的异步初始化增加了调试复杂度

---

## 6. 建议优先整理的问题

### 适合在 Phase 2.1 先整理（低风险高收益）

1. **`StageWindow.tsx` 中的 localStorage 读写抽取为独立工具函数**
   - 风险：极低，仅移动代码
   - 依据：`StageWindow.tsx` 第 14-23 行仅 10 行

2. **ControlPanel 中 Stage 相关逻辑移入 StageHost 或独立 hook**
   - 风险：低，仅重新导入和组合
   - 依据：`ControlPanel.tsx` 第 28-58 行

3. **main.tsx 的窗口标签判断统一到 App.tsx，删除重复**
   - 风险：低，消除重复代码
   - 依据：两处都有 `getWindowLabel()` + URL 参数检测

### 适合在 Phase 2.1 先整理（中风险中收益）

4. **main.tsx 的广播接线逻辑抽取为 `useMainWindowSync` hook**
   - 风险：中，涉及事件订阅生命周期
   - 依据：`main.tsx` 第 31-53 行

5. **window-sync.ts 中 Tauri/BroadcastChannel 自适应逻辑抽取为独立模块**
   - 风险：中，异步初始化逻辑复杂
   - 依据：`window-sync.ts` 第 44-93 行

### 建议留到 Phase 3（高风险应延后）

6. **Live2DRenderer 大类拆分**（>430 行）
   - 涉及渲染核心重构，风险高
   - 建议：Phase 3 以后

7. **mock.ts 的动态 import 循环依赖**
   - 建议：Phase 2 真实 pipeline 接入后作为自然演进

---

## 附录 A：当前真实生效路径 vs 历史残留路径

### A.1 当前真实参与运行的关键模块

| 模块/文件 | 证据 |
|---------|------|
| `src/main.tsx` | 服务初始化 + 广播接线，必不可少 |
| `src/App.tsx` | 窗口路由入口（main/stage 双路由） |
| `src/services/event-bus/event-bus.ts` | 全局事件中枢 |
| `src/services/runtime/runtime-service.ts` | 所有链路都调用 `isAllowed()` |
| `src/services/character/character-service.ts` | 表情驱动唯一来源 |
| `src/services/pipeline/pipeline-service.ts` | 主链路编排 |
| `src/services/llm/llm-service.ts` | 持有 ChatMessage 历史 |
| `src/services/audio/audio-player.ts` | 真实音频播放 + 口型数据生产 |
| `src/services/tts/mock-tts-service.ts` | pipeline 的 tts 依赖 |
| `src/utils/window-sync.ts` | 主窗口↔Stage 窗口同步必走 |
| `src/features/stage/StageWindow.tsx` | **Stage 渲染主体，持有 Live2DRenderer 实例** |
| `src/features/stage/StageHost.tsx` | Stage 控制 UI（尺寸预设、眼神、缩放锁定） |
| `src/features/stage/StageSlot.tsx` | 主界面贴靠占位区 |
| `src/features/control-panel/ControlPanel.tsx` | UI 控制入口 |
| `src/features/live2d/Live2DPreview.tsx` | **仅占位 UI，不再持有 PIXI 实例** |

### A.2 已边缘化的模块（历史残留/过渡文件）

| 模块/文件 | 说明 |
|---------|------|
| `src/features/live2d/live2d-renderer.ts` | **已被 StageWindow 直接使用，主窗口不再持有独立实例** |
| `src/services/knowledge/knowledge-service.ts` | 代码存在但从未被调用（无真实 LLM 对接） |
| `src/services/external-input/external-input-service.ts` | 接收 `injectEvent`，但无真实平台适配器 |
| `src/utils/mock.ts` | 仅 devtools 调用 |
| `src/services/llm/mock-llm-service.ts` | MockLLMService 被 LLMService 持有 |
| `src/services/tts/mock-tts-service.ts` | 同上 |
| `src/features/chat/ChatPanel.tsx` | 订阅 ASR/LLM 事件，但无真实服务 |

---

## 附录 B：整理项的风险/收益排序

### 低风险高收益

| 整理项 | 风险 | 收益 | 依据 |
|--------|------|------|------|
| StageWindow localStorage 抽取 | 极低 | 中 | 仅移动代码，10 行 |
| ControlPanel Stage 逻辑分离 | 低 | 中 | 约 30 行重组合 |
| main.tsx 窗口标签判断统一 | 低 | 低 | 仅消除重复 |

### 中风险中收益

| 整理项 | 风险 | 收益 | 依据 |
|--------|------|------|------|
| main.tsx 广播逻辑 hook 抽取 | 中 | 中 | 涉及事件订阅生命周期 |
| Tauri/BroadcastChannel 自适应抽取 | 中 | 中 | 异步初始化复杂 |
| Live2DRenderer try/catch 治理 | 中 | 低 | 需逐个审查 |

### 高风险应延后

| 整理项 | 风险 | 收益 | 依据 |
|--------|------|------|------|
| Live2DRenderer 大类拆分 | 高 | 高 | 430 行类，重构风险高 |
| mock.ts 动态 import 循环依赖 | 高 | 中 | 建议 Phase 2 真实 pipeline 接入后自然演进 |

---

## 附录 C：真实手测覆盖情况

### C.1 已通过真实 Tauri 桌面环境手测

| 模块/行为 | 依据 |
|---------|------|
| Tauri dev 启动 | `dev-reports/phase1/run03/002-closeout.md` |
| 三栏 UI 布局渲染 | 同上 |
| Live2D Hiyori 模型渲染 | 同上 |
| Live2D 表情切换（neutral→happy/sad/surprised） | 同上 |
| Runtime 门控（auto/stopped 切换） | 同上 |
| 急停后 pipeline 被阻断 | 同上 |
| BroadcastChannel 双窗口同步 | 同上（浏览器标签页实测） |
| **Stage 窗口在 Tauri 桌面端独立打开并渲染** | Phase 2.1 最新验证 |
| **OBS 透明窗口捕获** | Phase 2.1 最新验证 |
| **Stage 透明背景（CSS + transparent 配置生效）** | Phase 2.1 最新验证 |

### C.2 仅编译/构建通过，未手测

| 模块/行为 | 依据 |
|---------|------|
| Tauri 桌面端麦克风权限弹窗 | 待确认 |
| 直播间弹幕/礼物真实接入 | 待平台适配器 |

### C.3 代码存在但无真实验证

| 模块/行为 | 说明 |
|---------|------|
| KnowledgeService | 订阅 `external:product-message`，但无真实注入来源 |
| ExternalInputService | `injectEvent()` 可调用，但无真实平台适配器 |
| ChatPanel | 订阅 ASR/LLM 事件，但无真实服务 |

---

## 附录 D：未来真实服务接入的替换点

### D.1 真实 LLM

- **直接替换**：`src/services/llm/mock-llm-service.ts`
- **注入点**：`src/services/index.ts` 第 40 行 `new MockLLMService()`
- **接口契约**：已定义 `ILLMService` 接口（`src/services/llm/types.ts`），真实 Provider 只需实现 `chat(history): AsyncGenerator<LLMChunk>`
- **当前唯一消费者**：`src/services/llm/llm-service.ts` 第 19 行持有 `provider: ILLMService`

### D.2 真实 TTS

- **直接替换**：`src/services/tts/mock-tts-service.ts`
- **注入点**：`src/services/index.ts` 第 42 行 `new MockTTSService()`
- **接口契约**：已定义 `ITTSService` 接口（`src/services/tts/types.ts`），真实 Provider 只需实现 `synthesize(text): Promise<ArrayBuffer>`
- **当前唯一消费者**：`src/services/pipeline/pipeline-service.ts` 第 21 行持有 `tts: ITTSService`

### D.3 直播间弹幕/礼物接入

- **接入层**：`src/services/external-input/external-input-service.ts`
- 现有 `injectEvent(raw: RawExternalEvent)` 是标准注入入口
- 已有 `danmaku` / `gift` / `product-message` 标准化转发
- 未来需新增：WebSocket 弹幕适配器 / 直播平台 API 轮询适配器，封装为 `ExternalInputAdapter`

### D.4 知识库 / RAG 接入

- **接入层**：`src/services/knowledge/knowledge-service.ts`
- 现有 `addKnowledge()` / `addLiveContext()` 定义了两种知识写入路径
- 现有 `getAssembledContext()` 是 LLM 获取上下文的唯一出口
- **与 LLM 的关系**：KnowledgeService 当前不被 LLMService 直接持有，需在 pipeline 或 LLMService 中显式调用
- **RAG 检索层**：当前空白，真实 RAG 接入时需新增检索服务

---

## 证据来源

本次盘点依据以下文件：

### 核心文件
- `src/main.tsx`
- `src/App.tsx`
- `src/services/index.ts`
- `src/services/pipeline/pipeline-service.ts`
- `src/services/llm/llm-service.ts`
- `src/services/llm/mock-llm-service.ts`
- `src/services/audio/audio-player.ts`
- `src/services/tts/mock-tts-service.ts`
- `src/services/external-input/external-input-service.ts`
- `src/services/knowledge/knowledge-service.ts`
- `src/services/runtime/runtime-service.ts`

### Feature 文件
- `src/features/stage/StageWindow.tsx`
- `src/features/stage/StageHost.tsx`
- `src/features/stage/StageSlot.tsx`
- `src/features/live2d/Live2DPreview.tsx`
- `src/features/live2d/live2d-renderer.ts`
- `src/features/control-panel/ControlPanel.tsx`
- `src/features/chat/ChatPanel.tsx`

### Utils
- `src/utils/window-sync.ts`
- `src/utils/mock.ts`

### 阶段汇报
- `dev-reports/phase1/run03/002-closeout.md`

### 规划文档
- `blueprints/phase2/stage-and-pipeline.md`
