# Phase 2 — 舞台完整化与主链路最小整合

---

## 命名说明

原始路线图（`phase-roadmap.md`）中 Phase 2 定义为 "Voice Pipeline"，目标是打通完整语音主链路。经过 Phase 1 close-out 评估，本阶段的实际范围做了以下调整：

**调整原因：**

1. Phase 1 完成后，Stage 窗口仍然只有文字状态显示，没有 Live2D 渲染。如果直接进入语音链路开发，Stage 窗口会长期停留在不可用状态，与"单一状态真源，双窗口同步渲染"的核心架构约束脱节。
2. 完整语音链路（ASR + LLM + TTS + 口型同步 + 锁麦）是一个很大的范围。如果一次性全部展开，调试成本高、验收周期长。更稳妥的做法是先用 mock 数据跑通主链路骨架，再逐步替换为真实服务。
3. Phase 1 已经证明了技术栈可行性，Phase 2 应该把这些能力真正组装成"最小可演示的主播系统"，而不是再增加一批孤立的技术模块。

**因此 Phase 2 重新定义为"舞台完整化与主链路最小整合"**，覆盖：
- Stage 窗口承载真实 Live2D 渲染
- 双窗口同步渲染落实到 Live2D 层面
- 主链路骨架搭建（mock → 真实服务的可替换接口）
- 为 Phase 3 的真实服务接入打好边界

原路线图中 Phase 2 "Voice Pipeline" 的完整语音采集、VAD、ASR 云端调用、锁麦策略等内容，部分纳入本阶段的"接口定义 + mock 实现"，部分推迟到 Phase 3 做真实接入。

---

## 1. 本阶段目标

让 Paimon Live 从"各模块独立可验证"进化为"最小可演示的主播系统骨架"。具体：

1. **Stage 窗口承载真实 Live2D 渲染**：OBS 舞台窗口不再是文字占位，而是一个真正渲染 Live2D 角色的透明窗口
2. **双窗口同步渲染**：主窗口和 Stage 窗口各自有独立的 Live2D 渲染实例，但基于同一 CharacterService 状态同步表情/动作
3. **主链路骨架搭建**：从"用户输入 → LLM 回复 → TTS 播放 → 角色反馈"的完整链路出发，先用 mock 实现跑通全流程，建立可替换接口
4. **口型同步基础**：建立 TTS 音频播放 → 口型数据提取 → Live2D 嘴型参数的通道
5. **服务接口标准化**：为 LLM / TTS / ASR 定义统一的 TypeScript 接口，使 mock 和真实实现可互换

---

## 2. 本阶段范围

### 2.1 Stage 窗口 Live2D 渲染

| 任务 | 说明 |
|------|------|
| Stage 窗口内嵌独立 Live2D 渲染实例 | 复用 `Live2DPreview` 的渲染逻辑，但作为独立实例 |
| 通过 BroadcastChannel 接收表情/动作指令 | 扩展 `SyncPayload` 包含表情参数 |
| 透明背景下的 Live2D 渲染验证 | 确认 PIXI `backgroundAlpha: 0` 在 Stage 窗口中正确工作 |
| Stage 窗口尺寸自适应 | Live2D 模型根据窗口大小自动缩放 |

### 2.2 双窗口同步渲染

| 任务 | 说明 |
|------|------|
| 同步通道扩展 | `SyncPayload` 增加 `expressionParams`（当前情绪对应的参数覆盖）和 `motionTrigger`（动作触发信号） |
| Stage 窗口表情/动作同步 | 接收到同步数据后，Stage 窗口的 Live2D 实例应用相同的参数覆盖和动作 |
| 主窗口操作 → 双窗口同时响应 | 点击表情按钮后，两个窗口的角色同时变化 |

### 2.3 主链路骨架（mock 先行）

建立完整的主链路数据流骨架，但所有外部服务调用先用 mock 实现：

| 链路环节 | 本阶段做什么 | 本阶段不做什么 |
|---------|------------|--------------|
| 用户文本输入 | 控制面板手动文本输入 → 触发 LLM 请求 | 麦克风采集、VAD、ASR |
| LLM 对接 | `LLMService` 接口定义 + mock 实现（延迟后返回预设回复 + 工具调用） | 真实 OpenAI API 调用 |
| TTS 合成 | `TTSService` 接口定义 + mock 实现（返回预置音频或合成静音段） | 真实 GPT-SoVITS 调用 |
| 音频播放 | 基础 `AudioPlayer`：接收音频数据 → Web Audio API 播放 | 完整播放队列管理、锁麦 |
| 口型数据 | 播放时通过 `AnalyserNode` 提取音量 → 驱动 `ParamMouthOpenY` | 高精度口型算法 |
| 角色反馈 | LLM mock 的工具调用 → CharacterService → 双窗口表情变化 | — |

### 2.4 口型同步通道

| 任务 | 说明 |
|------|------|
| 音频播放器基础实现 | 播放 ArrayBuffer/Blob 格式的音频 |
| AnalyserNode 音量提取 | 播放时实时提取音量值 |
| 口型数据专门通道 | 不走 EventBus，通过 callback 直接传递到 Live2D 渲染层 |
| ParamMouthOpenY 驱动 | 将音量映射到 Live2D 嘴型参数 |
| 双窗口口型同步 | 主窗口和 Stage 窗口同时响应口型数据 |

### 2.5 服务接口标准化

定义 TypeScript 接口，使 mock 实现和后续真实实现可互换：

```typescript
// 示意——最终接口在实现时确定
interface ILLMService {
	chat(messages: ChatMessage[], tools?: ToolDef[]): AsyncGenerator<LLMChunk>;
}

interface ITTSService {
	synthesize(text: string, voiceConfig: VoiceConfig): Promise<ArrayBuffer>;
}

interface IASRService {
	recognize(audio: ArrayBuffer): Promise<string>;
}
```

### 2.6 对话面板基础

| 任务 | 说明 |
|------|------|
| 文本输入框 | 在控制面板或对话面板中添加手动文本输入 |
| 对话消息展示 | 展示用户输入和 AI 回复的消息列表 |
| 流式回复显示 | LLM 流式 chunk 逐步追加到当前回复消息 |

---

## 3. 本阶段明确不做什么

| 事项 | 原因 |
|------|------|
| 麦克风采集 / VAD / ASR | Phase 3 接入真实服务时实现 |
| 真实 LLM API 调用 | 本阶段用 mock，Phase 3 替换 |
| 真实 TTS 服务调用 | 本阶段用 mock，Phase 3 替换 |
| 完整播放队列管理 | Phase 3 |
| 锁麦策略 | 依赖真实 TTS 播放和 VAD，Phase 3 |
| manual / paused 模式 | Phase 3 控制台完善时实现 |
| 完整急停协调（中断 TTS、清空队列） | Phase 3 |
| 人工接管完整流程 | Phase 3 |
| 外部平台弹幕/礼物接入 | Phase 4 |
| 知识/上下文层完整实现 | Phase 3+ |
| 配置文件 UI | Phase 5 |
| 打包分发 | Phase 5 |

---

## 4. 依赖前提

| 前提 | 状态 | 说明 |
|------|------|------|
| Phase 1 收口 | ✅ 已完成 | 所有基础设施已实机验证 |
| EventBus 可用 | ✅ | 类型安全的发布/订阅 |
| CharacterService 可用 | ✅ | 角色状态权威真源，表情映射 |
| RuntimeService 可用 | ✅ | auto/stopped 门控 |
| Live2D 渲染可用 | ✅ | Hiyori 模型加载、表情参数覆盖 |
| BroadcastChannel 同步可用 | ✅ | 跨窗口状态同步已验证 |
| Stage 窗口配置 | ✅ | tauri.conf.json 已定义 |
| Hiyori Live2D 模型 | ✅ | public/Resources/Hiyori/ |
| Mock 工具链 | ✅ | window.__paimon + UI 按钮 |

---

## 5. 模块级任务拆分

### M1: Live2D 渲染层重构（共享化）

**目标**：将 Live2D 渲染逻辑从 `Live2DPreview` 中提取为可复用模块，使主窗口和 Stage 窗口可以各自创建独立实例。

| 子任务 | 说明 |
|--------|------|
| M1.1 提取 Live2D 渲染核心 | 将模型加载、表情参数覆盖、动作播放、ticker 管理提取到 `src/features/live2d/live2d-renderer.ts`（纯逻辑，不依赖 React） |
| M1.2 Live2DPreview 改为消费者 | 主窗口的 `Live2DPreview` 组件调用提取后的渲染核心 |
| M1.3 口型参数接口 | 渲染核心暴露 `setMouthOpenY(value: number)` 方法 |

### M2: Stage 窗口 Live2D 渲染

**目标**：Stage 窗口渲染真实 Live2D 角色。

| 子任务 | 说明 |
|--------|------|
| M2.1 StageWindow 内嵌 Live2D | 创建独立的 PIXI Application + Live2D 模型实例 |
| M2.2 接收同步数据驱动渲染 | 通过 BroadcastChannel 接收表情参数 + 动作触发 |
| M2.3 透明背景验证 | 确认 PIXI backgroundAlpha=0 + Tauri transparent=true 的组合效果 |
| M2.4 全屏自适应 | Stage 窗口中模型居中、根据窗口尺寸自适应缩放 |

### M3: 同步通道增强

**目标**：BroadcastChannel 不仅同步状态文字，还同步渲染指令。

| 子任务 | 说明 |
|--------|------|
| M3.1 SyncPayload 扩展 | 增加 `expressionParams: Record<string, number>`、`motionTrigger?: { group: string; index: number }` |
| M3.2 主窗口广播增强 | 表情变化和动作触发时，将参数一并广播 |
| M3.3 口型数据同步通道 | 口型数据频率高于普通状态同步，需要独立的 BroadcastChannel 或专门处理（如降采样） |

### M4: 服务接口层

**目标**：定义 LLM / TTS / ASR 的标准接口和 mock 实现。

| 子任务 | 说明 |
|--------|------|
| M4.1 LLM 接口 + mock | `src/services/llm/` — 接口定义、mock 实现（预设回复 + 模拟工具调用 + 模拟流式输出） |
| M4.2 TTS 接口 + mock | `src/services/tts/` — 接口定义、mock 实现（返回预置音频片段或生成静音 + 正弦波测试音） |
| M4.3 ASR 接口 + 占位 | `src/services/audio/asr.ts` — 接口定义、占位实现。本阶段不实现真实 ASR，仅留接口 |

### M5: 音频播放 + 口型数据

**目标**：播放 TTS 返回的音频，并实时提取口型数据。

| 子任务 | 说明 |
|--------|------|
| M5.1 AudioPlayer 基础 | `src/services/audio/player.ts` — 接收 ArrayBuffer → AudioContext 播放 |
| M5.2 AnalyserNode 口型提取 | 播放时通过 AnalyserNode 提取音量，映射到 0–1 范围 |
| M5.3 口型数据专门通道 | callback 注册模式，Live2D 渲染层直接消费，不经过 EventBus |
| M5.4 双窗口口型同步 | 主窗口提取的口型数据通过专门 BroadcastChannel 传递给 Stage 窗口 |

### M6: 主链路串联

**目标**：将 M4、M5 与现有 service 串联成完整的 mock 主链路。

| 子任务 | 说明 |
|--------|------|
| M6.1 文本输入 → LLM | 对话面板输入文本 → 调用 LLMService.chat() |
| M6.2 LLM 流式响应 → UI | 流式 chunk → EventBus → ChatPanel 追加显示 |
| M6.3 LLM 工具调用 → 表情 | mock LLM 回复中包含 setExpression 工具调用 → CharacterService → 双窗口表情变化 |
| M6.4 LLM 完整回复 → TTS | llm:response-end → TTSService.synthesize() → AudioPlayer 播放 |
| M6.5 播放 → 口型 → Live2D | AudioPlayer 播放时提取口型 → 双窗口 ParamMouthOpenY 同步 |
| M6.6 播放完成 → 就绪 | audio:tts-end → 系统就绪，等待下一次输入 |
| M6.7 Runtime 门控 | 每个关键节点检查 `isAllowed()`，stopped 模式下拦截 |

### M7: 对话面板增强

**目标**：对话面板从占位变为可交互。

| 子任务 | 说明 |
|--------|------|
| M7.1 文本输入框 | 底部输入框，回车或按钮发送 |
| M7.2 消息列表 | 用户消息 + AI 回复，区分发送方 |
| M7.3 流式回复展示 | AI 回复逐字追加，打字机效果 |
| M7.4 系统状态提示 | "AI 正在思考"、"正在播放语音" 等状态提示 |

---

## 6. 建议执行顺序

```
Step 1: M1 — Live2D 渲染层重构
  ↓       提取渲染核心，主窗口行为不变
Step 2: M2 + M3 — Stage 窗口渲染 + 同步增强
  ↓       Stage 窗口显示 Live2D，双窗口表情同步
Step 3: M4 — 服务接口 + mock
  ↓       LLM / TTS 接口定义和 mock 实现
Step 4: M5 — 音频播放 + 口型
  ↓       播放测试音频，口型数据驱动嘴型
Step 5: M6 — 主链路串联
  ↓       文本输入 → mock LLM → mock TTS → 播放 → 角色反馈
Step 6: M7 — 对话面板增强
  ↓       可交互的对话界面
Step 7: 集成验收
          全流程 mock 主链路演示
```

**原则**：每个 Step 完成后都应可独立验证，不依赖后续 Step。

---

## 7. 验收标准

### Stage 窗口

- [ ] Stage 窗口打开后显示 Live2D 角色（非文字占位）
- [ ] Stage 窗口背景透明（PIXI + Tauri 配合）
- [ ] 主窗口切换表情 → Stage 窗口角色同步变化
- [ ] 主窗口播放触发 → Stage 窗口角色嘴巴同步张合

### 主链路

- [ ] 在对话面板输入文本 → 触发 mock LLM → 收到流式回复 → 对话面板显示
- [ ] mock LLM 回复包含工具调用 → 角色表情在双窗口同步变化
- [ ] mock LLM 完整回复 → 触发 mock TTS → 播放音频 → 角色嘴巴张合
- [ ] 播放完成后系统回到就绪状态
- [ ] stopped 模式下整个链路被拦截

### 口型同步

- [ ] 音频播放时角色嘴巴随音量张合
- [ ] 主窗口和 Stage 窗口口型同步
- [ ] 播放结束后嘴巴自动闭合

### 接口标准化

- [ ] LLMService 有明确 TypeScript 接口，mock 实现可被替换
- [ ] TTSService 有明确 TypeScript 接口，mock 实现可被替换
- [ ] ASRService 有接口定义（即使本阶段无实现）

### 代码质量

- [ ] TypeScript 编译无错误
- [ ] 新模块有清晰的 index.ts 导出
- [ ] 服务初始化流程与现有 `initServices()` 保持一致风格

---

## 8. 风险点

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| BroadcastChannel 在 Tauri 多 WebView 间不共享 origin | Stage 窗口无法接收同步数据 | Phase 1 浏览器端已验证可用；如 Tauri 端不可用，降级到 Tauri Event System（只需改 `window-sync.ts`） |
| 口型数据通过 BroadcastChannel 传输延迟过大 | Stage 窗口口型与主窗口不同步 | 口型数据量小（单个 number），BroadcastChannel 延迟应在亚毫秒级。如不满足，改为 Stage 窗口独立提取音频源 |
| Stage 窗口独立 Live2D 实例的内存/GPU 开销 | 两个 PIXI 实例占用资源 | Hiyori 模型纹理较小（2048x2），两个实例的总开销应可接受。后续可考虑共享纹理缓存 |
| mock LLM 的流式输出与真实 API 行为差异 | 替换真实服务时需要修改消费端 | mock 实现严格遵循接口定义（AsyncGenerator + SSE chunk 格式），减少替换时的改动 |
| PIXI backgroundAlpha=0 在 Tauri 透明窗口中渲染异常 | Stage 窗口背景不透明 | Phase 1 spike 已确认 Tauri 透明窗口配置就绪，PIXI 侧 backgroundAlpha=0 在主窗口已验证 |

---

## 9. 与 Phase 3 的边界

### Phase 2 做到这里为止

- Mock 主链路全流程可跑通
- Stage 窗口有真实 Live2D + 口型同步
- 双窗口同步渲染已验证
- LLM / TTS / ASR 接口定义完成
- 对话面板可交互

### Phase 3 从这里开始

| Phase 3 内容 | 与 Phase 2 的关系 |
|-------------|-----------------|
| 真实 LLM API 接入 | 替换 Phase 2 的 mock LLMService |
| 真实 TTS 接入（GPT-SoVITS） | 替换 Phase 2 的 mock TTSService |
| 麦克风采集 + VAD + ASR | 实现 Phase 2 预留的 ASR 接口 |
| 锁麦策略 | 依赖真实 TTS 播放和 VAD |
| 完整播放队列 | 依赖真实 TTS 返回速率 |
| manual / paused 模式 | 控制台完善 |
| 完整急停协调 | 需要真实服务才有中断的目标 |
| 串行处理规则 | 需要真实语音输入场景 |

**核心判断**：Phase 2 结束时，系统应该是一个"用 mock 数据可完整演示的主播系统骨架"。Phase 3 的工作是将 mock 替换为真实服务，并处理真实场景带来的复杂度（延迟、错误处理、锁麦、队列等）。

---

## 10. 交付物清单

| 交付物 | 说明 |
|--------|------|
| `src/features/live2d/live2d-renderer.ts` | Live2D 渲染核心（可复用） |
| `src/features/stage/StageWindow.tsx` | 重写为 Live2D 渲染 + 同步消费 |
| `src/services/llm/` | LLM 接口定义 + mock 实现 |
| `src/services/tts/` | TTS 接口定义 + mock 实现 |
| `src/services/audio/` | 音频播放器 + 口型数据通道 + ASR 接口占位 |
| `src/utils/window-sync.ts` | 扩展同步通道（表情参数 + 口型数据） |
| `src/features/chat/ChatPanel.tsx` | 增强为可交互（输入 + 消息列表 + 流式显示） |
| `src/hooks/use-llm.ts` | LLM 服务 React 桥接 |
| `src/hooks/use-audio.ts` | 音频状态 React 桥接 |
| spike 文档更新 | `docs/research/` 中的 Stage 渲染、口型同步验证 |
| `dev-reports/phase2-*.md` | 阶段汇报 |

---

## 11. 本文档对原始路线图的影响

原 `phase-roadmap.md` 中：
- Phase 2 = Voice Pipeline
- Phase 3 = Control & Monitor
- Phase 4 = Live Integration

调整后的建议映射：

| 原 Phase | 新 Phase | 说明 |
|----------|----------|------|
| Phase 2 Voice Pipeline | **Phase 2 舞台完整化 + 主链路骨架** | Stage Live2D + mock 主链路 |
| — | **Phase 3 真实服务接入** | 真实 LLM/TTS/ASR + 完整语音链路 |
| Phase 3 Control & Monitor | **Phase 4 控制台完善** | 完整急停/人工接管/日志面板 |
| Phase 4 Live Integration | **Phase 5 直播集成** | 弹幕/礼物/知识注入 |
| Phase 5 Polish & Package | **Phase 6 打磨与打包** | 配置 UI + 安装包 |

> 注意：此映射仅为建议方向。Phase 3 的详细规划应在 Phase 2 完成后再生成，届时根据实际情况决定是否合并或调整。路线图的正式更新应在 Phase 2 收口时统一处理。
