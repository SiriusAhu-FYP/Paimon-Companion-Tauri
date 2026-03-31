# Phase 4 — B 站最小直播接入

> **文档定位**: Phase 4 正式 Kickoff Blueprint，作为后续 Run 的入口文档。
> 技术调研见 `docs/research/phase4-bilibili-connection-research.md`。
> 仓库架构审计见 `docs/research/phase4-round1-observation.md`。

---

## 1. 本阶段正式目标

### 1.1 定位

Phase 4 的原始路线图目标是 **Live Integration**（OBS 输出 + 弹幕/礼物接入）。其中 OBS 舞台窗口（透明窗口 + 角色同源渲染）已在 Phase 2-1 中提前完成。

**因此，Phase 4 的实际聚焦点是：建立 B 站直播弹幕/礼物到角色反应的最小闭环。**

### 1.2 先只做 B 站，还是平台无关？

**先只做 B 站。**

理由：
- B 站是当前最明确的目标平台
- 多平台抽象在只有一个实现时是过度设计
- 仓库已有 `ExternalInputService` + `RawExternalEvent` 的统一接入模型，天然支持后续扩展 `source` 字段
- 不需要在本阶段引入 AdapterRegistry / AdapterFactory

### 1.3 最小成功标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | 能连接到指定 B 站直播间并接收弹幕 | 连接后 EventLog 中出现弹幕事件 |
| 2 | 弹幕能触发角色 LLM 回复 | 弹幕 → pipeline.run → LLM 回复 → TTS 播报 |
| 3 | 连接状态可控 | ControlPanel 中有连接/断开按钮，状态指示 |
| 4 | 弹幕有基本节流 | 高频弹幕不会打爆 LLM 调用 |
| 5 | 不破坏现有链路 | 手动输入、知识库、TTS、Stage、OBS 均正常 |

---

## 2. 本阶段明确做什么

### 2.1 最小输入能力

建立 B 站直播间 WebSocket 连接，接收弹幕和礼物消息。

具体实现：
- **连接方式**：匿名 WebSocket（`uid: 0`），不需要 B 站登录或开放平台审核
- **协议版本**：protover=2（zlib 压缩），使用 `pako` 解压
- **目标消息**：`DANMU_MSG`（弹幕）、`SEND_GIFT`（礼物）
- **心跳**：每 30 秒自动发送
- **重连**：断线后自动重连（指数退避，最长 30 秒）

### 2.2 事件进入系统

弹幕/礼物消息通过已有 `ExternalInputService.injectEvent()` 注入，完全复用现有链路：

```
BilibiliAdapter.onMessage()
  → 解析 DANMU_MSG / SEND_GIFT
  → 构造 RawExternalEvent { source: "bilibili", type: "danmaku" | "gift", data: {...} }
  → ExternalInputService.injectEvent(raw)
    → runtime.isAllowed() 门控
    → EventBus.emit("external:danmaku" | "external:gift", payload)
```

### 2.3 最小消费者链路

新增 **DanmakuConsumer**——订阅 `external:danmaku`，将选中的弹幕送入 `pipeline.run()`。

节流策略（第一轮）：
- 固定冷却时间（默认 15 秒，可配置），冷却期间丢弃新弹幕
- 弹幕文本长度过滤（< 2 字或 > 100 字丢弃）
- Pipeline 正在处理时丢弃（利用现有 `isProcessing` 锁）
- 不做 AI 评分 / 关键词过滤 / 优先级队列

### 2.4 最小可视验证

- **EventLog**（已有）：弹幕/礼物事件自动出现在事件日志中，无需额外改动
- **ControlPanel**：新增 B 站连接卡片（房间号输入 + 连接/断开按钮 + 状态指示）
- **ChatPanel**：弹幕触发的 LLM 回复自动出现在对话面板中（复用现有 pipeline 链路）

---

## 3. 本阶段明确不做什么

| 不做的事 | 原因 |
|----------|------|
| ASR / VAD | 语音输入与弹幕输入是独立的输入通道，不在本阶段范围 |
| 多平台（抖音、YouTube） | 只有一个实现时做抽象工厂是过度设计 |
| 复杂直播控制台 | ControlPanel 已经很满，B 站连接只需要一个小卡片 |
| 弹幕发送能力 | 本项目只需要接收弹幕，不需要通过 B 站发弹幕 |
| 礼物 → 角色表情/动作反应 | 留后续 run，最小版先记录礼物事件到 EventLog |
| AI 弹幕筛选 / 关键词过滤 | 最小版用固定冷却 + 长度过滤 |
| 弹幕优先级队列 | 最小版不排队，冷却期间直接丢弃 |
| 修改 Pipeline / LLM / TTS 内部 | 弹幕走 `pipeline.run()` 即可 |
| 修改 Stage / Live2D 渲染 | 与外部事件无关 |
| B 站开放平台接入 | FYP 项目用匿名连接够用 |

---

## 4. 和 Phase 3.5 的边界

### 4.1 Phase 3.5 解决了什么

Phase 3.5 建立了知识库基础设施，确保 LLM 回复"有知识依据"：

- 语义检索（embedding + Orama + vector/hybrid search）
- 检索结果注入 LLM prompt
- Rerank 精排（可选）
- 行为约束层（控制回复风格/长度）
- 角色卡 Broadcast Sanitization
- 知识录入 UX（drag-and-drop + dual-mode + 批量管理）
- liveContext 临时注入（运营消息、商品信息）

### 4.2 为什么现在轮到 Phase 4

- Phase 3.5 的核心价值是"让 LLM 回复有知识依据"——这个能力已经建立并验证
- Phase 4 的核心价值是"让弹幕能触发角色反应"——这是直播场景可用性的关键里程碑
- Phase 3.5 已 close-out ready（见 `dev-reports/phase3-5/close-out.md`）
- 弹幕进入 LLM 后，自然会利用 Phase 3.5 建立的知识检索能力

### 4.3 Phase 4 不重写 Phase 3.5 的内容

- 不修改 `KnowledgeService`（弹幕触发的 LLM 回复自然走 `query()` 检索知识）
- 不修改 `PromptBuilder`（行为约束对弹幕触发的回复同样生效）
- 不修改 `KnowledgePanel`
- `external:product-message` 的现有消费链路不变

---

## 5. 文件与模块边界

### 5.1 建议新增文件

| 文件 | 职责 |
|------|------|
| `src/services/external-input/adapters/bilibili-adapter.ts` | B 站 WebSocket 连接、心跳、协议解析 |
| `src/services/external-input/adapters/types.ts` | `IExternalAdapter` 接口定义 |
| `src/services/external-input/danmaku-consumer.ts` | 弹幕 → pipeline.run() 的消费逻辑 + 节流 |

### 5.2 建议修改文件

| 文件 | 改动 |
|------|------|
| `src/services/external-input/external-input-service.ts` | 新增 adapter 挂载/卸载方法 |
| `src/services/index.ts` | 初始化 BilibiliAdapter + DanmakuConsumer |
| `src/services/config/types.ts` | AppConfig 新增 `bilibili: { roomId, enabled }` |
| `src/features/control-panel/ControlPanel.tsx` | 新增 B 站连接卡片 UI |
| `src/types/events.ts` | 可能扩展 `ExternalDanmakuPayload`（增加 B 站特有字段，如 medal） |
| `package.json` | 新增 `pako` 依赖（zlib 解压） |

### 5.3 明确不碰的区域

| 区域 | 理由 |
|------|------|
| `src/features/stage/` | Stage / Live2D 渲染与弹幕无关，碰了容易引发窗口同步 bug |
| `src/services/tts/` | TTS 已稳定，弹幕进入 pipeline 后自然走 TTS |
| `src/services/llm/openai-llm-service.ts` | LLM 流式实现，弹幕只需调 `pipeline.run()`，不改 LLM 内部 |
| `src/features/settings/SettingsPanel.tsx` | B 站配置用 ControlPanel 的简单卡片 |
| `src/services/character/` | 角色系统不需要为弹幕改动 |
| `src/services/knowledge/` | 知识库服务不需要改动 |
| `src/services/pipeline/pipeline-service.ts` | Pipeline 编排不改，弹幕直接调 `pipeline.run()` |

---

## 6. 实施前是否还需要一个小实验

**需要。建议在 Run 01 正式实施前做一个 Spike。**

### Spike 内容

| 验证项 | 方式 | 预估时间 |
|--------|------|----------|
| Tauri WebView 中 WebSocket 到 B 站的连通性 | DevTools console 中直接 `new WebSocket(...)` | 30 分钟 |
| 认证包发送 + 认证成功响应 | 在 console 中构造二进制包 | 30 分钟 |
| zlib 解压（pako） | 安装 pako，解压实际收到的包 | 30 分钟 |
| 弹幕消息解析 | 连接有活跃弹幕的房间，解析 `DANMU_MSG` | 30 分钟 |

### 为什么需要 Spike

- **WebSocket 连通性是 Phase 4 最大的技术未知数**。如果 Tauri WebView2 对 `wss://broadcastlv.chat.bilibili.com` 有 CSP 限制或其他兼容问题，整个接入方案需要转为 Rust 代理方案，工作量会显著增加
- Spike 的成本极低（0.5–1 天），但能消除最大的不确定性
- Spike 不产出正式代码，只在 `docs/research/` 中记录结论

### 如果 Spike 不通

- **方案 B**：在 Rust 侧使用 `tokio-tungstenite` 建立 WebSocket 连接，通过 Tauri Event（`emit` / `listen`）将弹幕消息转发到前端
- 这会增加约 1 天的 Rust 开发工作量，但架构上更稳健（Rust 层可做更好的重连和心跳管理）
- 需要新增 Tauri command 和 Tauri Event listener

---

## 7. 建议的 Run 规划

### Spike（0.5–1 天）

验证 WebSocket 连通性 + 协议基础。产出 spike 记录文档。

### Run 01 — B 站最小弹幕接入（2–3 天）

| 任务 | 内容 |
|------|------|
| T1 | `IExternalAdapter` 接口 + `BilibiliAdapter` 实现（WebSocket + 心跳 + 协议解析） |
| T2 | `ExternalInputService` 扩展（adapter 挂载/卸载） |
| T3 | `DanmakuConsumer`（弹幕 → pipeline.run + 节流） |
| T4 | `AppConfig.bilibili` 配置 + ControlPanel B 站连接 UI |
| T5 | `initServices` 初始化 + 生命周期管理 |
| T6 | 编译验证 + 手测 + 报告 |

### Run 02 — 增强（可选，1–2 天）

| 内容 | 说明 |
|------|------|
| 礼物 → 角色表情反应 | 利用现有 `character.setEmotion()` |
| SC 支持 | `SUPER_CHAT_MESSAGE` 解析 + 高优先级处理 |
| 弹幕展示优化 | ControlPanel 弹幕实时 feed |
| 节流策略改进 | 简单队列 + 弹幕选取策略 |

---

## 8. 风险

| 风险 | 等级 | 缓解策略 |
|------|------|----------|
| WebSocket 在 Tauri WebView 中不通 | 中 | Spike 验证；如不通，走 Rust 代理 |
| B 站协议变更 | 低 | 协议多年来较稳定；匿名连接是最基础的功能 |
| 弹幕频率过高打爆 LLM | 中 | DanmakuConsumer 有冷却机制 + Pipeline 有 processing 锁 |
| 弹幕消费者与手动输入冲突 | 低 | Pipeline processing 锁天然互斥 |
| zlib 解压在 WebView 中性能问题 | 极低 | 每个包只有几 KB，`pako` 是毫秒级 |
| 连接生命周期管理不当导致泄漏 | 中 | adapter 有 destroy() + 组件卸载时断开 |

---

## 9. 验收标准

| # | 验收项 | 验证方式 |
|---|--------|----------|
| 1 | 输入房间号后能连接 B 站直播间 | ControlPanel 连接状态变绿 |
| 2 | EventLog 中出现弹幕事件 | 观察事件日志 |
| 3 | 弹幕触发 LLM 回复 | ChatPanel 出现弹幕触发的回复 |
| 4 | TTS 播报弹幕回复 | 听到角色回复弹幕 |
| 5 | 节流生效 | 高频弹幕不会连续触发 LLM |
| 6 | 断开后可重连 | 点击断开再连接，功能恢复 |
| 7 | 不破坏现有链路 | 手动输入、知识库、Stage、OBS 正常 |
| 8 | TypeScript + Vite build 通过 | 编译零错误 |

---

## 元信息

- Phase 4 分支（建议）：`feature/phase4-live-integration`
- 前序文档：
  - `docs/research/phase4-round1-observation.md`（仓库架构审计）
  - `docs/research/phase4-bilibili-connection-research.md`（B 站技术调研）
  - `dev-reports/phase3-5/close-out.md`（Phase 3.5 交接文档）
- Blueprint 路径：`blueprints/phase4/bilibili-minimum-integration.md`
- 创建日期：2026-03-31
