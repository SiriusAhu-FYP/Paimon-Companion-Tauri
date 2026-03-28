# Phase 4 第一轮观察报告

## 结论摘要

当前仓库已具备 Phase 4 B站最小接入的**大部分基础设施**。`ExternalInputService` + `EventBus` + `EventMap` 三件套已经形成了完整的"外部事件注入 → 总线分发 → 各服务消费"链路。B站弹幕接入的核心工作不是重写架构，而是**新增一个 WebSocket 适配器 + 补齐"弹幕 → LLM"的响应路径**。预估必改文件 5–7 个，新增 3–4 个，不需要触碰 Stage/Live2D/TTS 主链路。

---

## 关键发现

### 1. 最适合接入外部直播事件的入口

**模块**：`src/services/external-input/external-input-service.ts`

**已有接口**：

```typescript
// src/services/external-input/external-input-service.ts
interface RawExternalEvent {
    source: string;    // "bilibili" | "debug" | ...
    type: string;      // "danmaku" | "gift" | "product-message"
    data: Record<string, unknown>;
}

class ExternalInputService {
    injectEvent(raw: RawExternalEvent): void;  // 核心注入口
    registerSource(sourceId: string): void;
    unregisterSource(sourceId: string): void;
    getSourceStatus(): Record<string, { connected: boolean }>;
}
```

**调用链**：

```
B站 WebSocket 连接
  └→ BilibiliAdapter.onMessage()
       └→ 解析弹幕/礼物/SC → 构造 RawExternalEvent
            └→ ExternalInputService.injectEvent(raw)
                 ├→ runtime.isAllowed() 门控
                 └→ switch(raw.type)
                      ├ "danmaku"  → bus.emit("external:danmaku", payload)
                      ├ "gift"    → bus.emit("external:gift", payload)
                      └ "product-message" → bus.emit("external:product-message", payload)
```

**B站弹幕进来后最自然该先落到的层**：`ExternalInputService.injectEvent()`。这一层负责 runtime 门控和事件标准化，之后再由 EventBus 分发到各消费方。不应该绕过这层直接 emit 到总线。

### 2. 现有 EventBus / Dispatcher / Input Adapter 的雏形

| 名称 | 位置 | 现状 | 可复用？ |
|------|------|------|----------|
| `EventBus` | `src/services/event-bus/event-bus.ts` | 完整可用：typed `emit`/`on`/`once`/`subscribe`，200 条历史，全局单例 | **直接复用** |
| `ExternalInputService` | `src/services/external-input/external-input-service.ts` | 有 `injectEvent` + `registerSource` + runtime 门控，但无真实适配器 | **直接复用**，在此基础上挂适配器 |
| `EventMap` (typed events) | `src/types/events.ts` | 已定义 `external:danmaku`/`external:gift`/`external:product-message` 三种外部事件及其 payload 类型 | **直接复用** |
| `mockExternalEvents` | `src/utils/mock.ts` | 通过 `injectEvent` 注入 debug 弹幕/礼物/商品消息 | 仅调试用 |
| `KnowledgeService` | `src/services/knowledge/knowledge-service.ts` | 已订阅 `external:product-message`，自动写入长期知识或临时上下文 | **直接复用** |
| `EventLog` | `src/app/EventLog.tsx` | 已订阅 `external:danmaku`/`external:gift`/`external:product-message`，实时展示 | **直接复用** |

**结论**：EventBus + ExternalInputService + EventMap 三者构成完整的 Input Adapter 模式雏形。**缺的一环**是真实的 `BilibiliAdapter`（WebSocket 连接 + 协议解析 + 心跳保活）。

### 3. 主控台里最适合显示直播事件流的位置

**方案 A（改动最小、推荐）**：使用现有 `EventLog`（`src/app/EventLog.tsx`）。

`EventLog` 已经订阅了 `external:danmaku` / `external:gift` / `external:product-message`，并在 `MainWindow` 底部可折叠区域展示。接入 B站后，弹幕/礼物事件会**自动出现在事件日志中**，无需额外改动。

**方案 B（体验更好，可选后续）**：在 ControlPanel 中新增"直播事件"区块。

`ControlPanel`（`src/features/control-panel/ControlPanel.tsx`）的"Mock 测试"区块（L261-275）旁边或其上方，新增一个实时弹幕/礼物 feed 小窗。但这属于 UI 优化，不是最小版必需。

### 4. "外部事件触发角色反应"的基础与缺失

**已有基础**：

| 环节 | 状态 | 说明 |
|------|------|------|
| 事件注入 | ✅ 完整 | `ExternalInputService.injectEvent()` |
| runtime 门控 | ✅ 完整 | `runtime.isAllowed()` 在 `injectEvent` 内检查 |
| 事件类型化 | ✅ 完整 | `EventMap` 有三种外部事件 |
| 事件展示 | ✅ 完整 | `EventLog` 已订阅所有外部事件 |
| 商品 → 知识 | ✅ 完整 | `KnowledgeService` 自动消费 `product-message` |
| 弹幕 → LLM | ❌ **缺失** | `external:danmaku` 没有消费者把它送入 `pipeline.run()` |
| 礼物 → 角色反应 | ❌ **缺失** | `external:gift` 没有消费者触发表情/动作 |
| 弹幕过滤/排队 | ❌ **缺失** | 无防刷/冷却/优先级排队机制 |
| 真实 WebSocket 适配器 | ❌ **缺失** | 无 B站协议解析代码 |

**缺的关键一环**：弹幕 → LLM 的消费者。`data-flow.md` 设计上弹幕应作为用户输入送入 LLM，但当前代码中 `external:danmaku` 只被 `EventLog` 消费（展示），没有触发 `pipeline.run()`。

### 5. 是否需要统一 `LiveEvent` 类型？

**不需要在最小版引入新类型**。理由：

- `RawExternalEvent` 已经是统一的外部事件入口类型
- `EventMap` 中的 `ExternalDanmakuPayload` / `ExternalGiftPayload` / `ExternalProductMessagePayload` 已经是标准化的消费侧类型
- 新增 `LiveEvent` 会与现有 `RawExternalEvent` 语义重叠，增加不必要的类型层

如果后续接入多个平台（抖音、YouTube），可考虑在 `RawExternalEvent` 基础上扩展 `source` 枚举，但那是 Phase 4 之后的事。

---

## 文件与模块定位

### B站最小接入必改文件清单

| 文件 | 改动内容 |
|------|----------|
| `src/services/external-input/external-input-service.ts` | 新增 adapter 注册/生命周期管理方法 |
| `src/services/index.ts` | 初始化时创建 adapter、注册到 ExternalInputService |
| `src/features/control-panel/ControlPanel.tsx` | 新增"B站连接"开关按钮（房间号输入 + 连接/断开） |
| `src/services/config/types.ts` | AppConfig 中新增 `bilibili: { roomId: string; enabled: boolean }` |
| `src/types/events.ts` | 可能需扩展 `ExternalDanmakuPayload` 增加平台特有字段（如 medal、guard level） |

### B站最小接入建议新增文件清单

| 文件 | 说明 |
|------|------|
| `src/services/external-input/adapters/bilibili-adapter.ts` | B站直播 WebSocket 连接、心跳、协议解析 |
| `src/services/external-input/adapters/types.ts` | Adapter 接口定义（`IExternalAdapter`） |
| `src/services/external-input/danmaku-consumer.ts` | 弹幕 → LLM 的消费逻辑（过滤、冷却、排队、调用 pipeline.run） |

### 此 Phase 最好不要碰的区域

| 区域 | 理由 |
|------|------|
| `src/features/stage/` 整个目录 | Stage/Live2D 渲染与窗口管理，与外部事件无关，碰了容易引发窗口同步 bug |
| `src/services/tts/` | TTS 合成/队列/播放已稳定，弹幕进入 LLM 后自然走 pipeline，不需要改 TTS |
| `src/services/llm/openai-llm-service.ts` | LLM 流式实现，弹幕 → LLM 只需调用 `pipeline.run()`，不需要改 LLM 内部 |
| `src/features/settings/SettingsPanel.tsx` | Settings 已经很复杂，B站配置用 ControlPanel 的简单表单就够 |
| `src/services/config/config-service.ts` | 配置读写逻辑已稳定，只需在 types.ts 中扩展类型 |
| `src/services/character/character-service.ts` | 角色系统不需要为弹幕改动；礼物反应可以后续用现有 `setEmotion` 完成 |
| `src/theme.ts`、`src/contexts/`、`src/i18n/` | 主题/i18n 与直播接入零耦合 |

---

## 建议改动路径

### 现在能直接施工的

1. **创建 `IExternalAdapter` 接口**（`src/services/external-input/adapters/types.ts`）
   - `connect(config): Promise<void>`
   - `disconnect(): void`
   - `isConnected(): boolean`
   - `onEvent: (raw: RawExternalEvent) => void`

2. **实现 `BilibiliAdapter`**（`src/services/external-input/adapters/bilibili-adapter.ts`）
   - 连接 B站直播 WebSocket（`wss://broadcastlv.chat.bilibili.com/sub`）
   - 心跳包（每 30s）
   - 解析弹幕（`cmd: "DANMU_MSG"`）、礼物（`cmd: "SEND_GIFT"`）
   - 构造 `RawExternalEvent` 调用 `onEvent`
   - 注意：WebSocket 连接需要先 HTTP 获取 `room_id` 和 `token`

3. **在 `ExternalInputService` 上挂适配器**
   - `attachAdapter(id: string, adapter: IExternalAdapter): void`
   - `detachAdapter(id: string): void`
   - adapter 的 `onEvent` 回调指向 `this.injectEvent`

4. **在 `ControlPanel` 加 B站连接 UI**
   - 房间号输入框 + 连接/断开按钮
   - 连接状态指示（绿/红点）

5. **实现弹幕消费者**（`danmaku-consumer.ts`）
   - 订阅 `external:danmaku`
   - 最简版：直接调用 `pipeline.run(danmaku.text)`
   - 可选增强：冷却时间、队列、过滤规则

### 仍需确认的

1. **B站 WebSocket 在 Tauri WebView 中是否能直接连接**
   - 可能需要走 Rust 代理（类似 HTTP proxy），因为 WebView 的 WebSocket 可能受 CSP 限制
   - 备选：Rust 侧起 WebSocket 连接，通过 Tauri Event 转发到前端

2. **B站 API 认证方式**
   - 开放直播间弹幕 WebSocket 是否需要 Cookie/Token
   - 是否需要先调 REST API 获取 `room_id` 和 `danmu_info`

3. **弹幕 → LLM 的节流策略**
   - 大量弹幕涌入时如何控制 LLM 调用频率
   - 是否需要弹幕选取策略（随机/关键词/优先级）
   - 这些不影响最小版架构，但影响体验

4. **礼物 → 角色反应的具体表现**
   - 用现有 `character.setEmotion()` 还是需要新的动作系统
   - 最小版可以先不做

---

## 风险点

### 最可能破坏现有稳定性的改动点

1. **弹幕消费者直接调用 `pipeline.run()`**
   - `PipelineService.run()` 内部 `llm.sendMessage()` 有 `processing` 锁，不允许并发。如果弹幕频率高于 LLM 响应速度，后续弹幕会被 `isProcessing()` 阻断。这不会 crash 但会丢弹幕。
   - **缓解**：弹幕消费者必须有自己的队列和节流，不能直接裸调 `pipeline.run()`。

2. **WebSocket 连接生命周期管理**
   - 连接断开后重连、心跳超时、网络波动。如果 adapter 的生命周期管理不当，可能导致内存泄漏或幽灵连接。
   - **缓解**：adapter 有 `destroy()` + 组件卸载时必须断开。

### 最容易做过头的地方

1. **过度设计 Adapter 框架**：Phase 4 只需要 B站一个平台，不要为"未来多平台"做抽象工厂。`IExternalAdapter` 接口足够，不需要 AdapterRegistry / AdapterFactory / AdapterManager。

2. **弹幕过滤/AI 筛选**：很容易掉进"智能弹幕筛选"的坑。最小版只需要冷却时间 + 长度限制，不要做关键词过滤或 AI 评分。

3. **完整的 B站协议支持**：B站 WebSocket 协议有很多 cmd 类型（`DANMU_MSG`、`SEND_GIFT`、`SUPER_CHAT_MESSAGE`、`INTERACT_WORD`、`ENTRY_EFFECT` 等）。最小版只需要 `DANMU_MSG`，最多加 `SEND_GIFT`。

### 最容易偏离 Phase 目标的诱惑

1. **接入 ASR/VAD**：Phase 4 roadmap 提到语音输入闭环，但与 B站弹幕是独立的。先做弹幕，VAD 另开 run。

2. **改 ControlPanel 做复杂直播控制台**：ControlPanel 已经很满了，加太多 UI 会臃肿。B站连接只需要一个小卡片（房间号 + 开关）。

3. **碰 TTS/pipeline 内部**：弹幕走 `pipeline.run()` 即可，不需要改 pipeline 内部逻辑。

---

## 当前最值得继续追问的问题

1. **Tauri WebView 中 WebSocket 到 B站的连通性测试**——这是 Phase 4 最大的技术未知数。如果不通，就必须走 Rust 代理，工作量会显著增加。建议先做一个 spike。

2. **B站直播 WebSocket 的认证需求**——开放房间是否需要 Cookie？需要在 `docs/research/` 中留一份调研文档。

3. **弹幕 → LLM 的节流策略选型**——冷却时间多长合适？是否需要队列？这直接影响用户体验。建议先用最简单的"固定冷却 + 丢弃"策略。
