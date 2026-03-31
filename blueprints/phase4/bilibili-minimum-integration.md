# Phase 4 — B 站最小直播接入

> **文档定位**: Phase 4 正式 Kickoff Blueprint，作为后续 Run 的入口文档。
> 技术调研见 `docs/research/phase4-bilibili-connection-research.md`（双路方案）。
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

### 1.3 接入路线选择

**默认优先使用 B 站官方 Open Live 路线。匿名 WebSocket 作为 fallback 保留。**

| 维度 | 官方 Open Live（默认） | 匿名 WebSocket（fallback） |
|------|----------------------|--------------------------|
| 定位 | 推荐主方案 | 备用 / 原型验证 |
| 理由 | 用户已获取开发者凭证；官方接口更规范；FYP 答辩更具说服力 | 无凭证门槛；快速验证连通性；调试对照 |
| 安全 | 签名在 Rust 层，密钥不暴露 | 无密钥，无安全顾虑 |
| 稳定性 | 官方保障 | 非官方，可能随时变更 |

详细技术对比见 `docs/research/phase4-bilibili-connection-research.md`。

### 1.4 最小成功标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | 能通过官方 Open Live 连接到 B 站直播间并接收弹幕 | 连接后 EventLog 中出现弹幕事件 |
| 2 | 弹幕能触发角色 LLM 回复 | 弹幕 → pipeline.run → LLM 回复 → TTS 播报 |
| 3 | 连接状态可控 | ControlPanel 中有连接/断开按钮，状态指示 |
| 4 | 弹幕有基本节流 | 高频弹幕不会打爆 LLM 调用 |
| 5 | 不破坏现有链路 | 手动输入、知识库、TTS、Stage、OBS 均正常 |

---

## 2. 本阶段明确做什么

### 2.1 最小输入能力（官方路线）

通过 B 站官方 Open Live API 建立直播间长连接，接收弹幕和礼物消息。

具体实现：
- **HTTP 鉴权**：Rust 侧实现 HMAC-SHA256 签名 + `/v2/app/start` 调用，获取 `websocket_info`
- **WebSocket 连接**：TS 侧使用 `websocket_info.wss_link` 和 `auth_body` 建立连接
- **协议版本**：protover=2（zlib 压缩），使用 `pako` 解压
- **目标消息**：`LIVE_OPEN_PLATFORM_DM`（弹幕）、`LIVE_OPEN_PLATFORM_SEND_GIFT`（礼物）
- **心跳**：WebSocket 心跳每 30 秒 + HTTP 项目心跳每 20 秒（Rust 侧）
- **重连**：断线后自动重连（指数退避，最长 30 秒）
- **关闭**：退出时调用 `/v2/app/end` 清理场次

### 2.2 事件进入系统

弹幕/礼物消息通过已有 `ExternalInputService.injectEvent()` 注入，完全复用现有链路。BilibiliAdapter 内部处理官方/匿名两种消息格式的解析差异，输出统一的 `RawExternalEvent`：

```
BilibiliAdapter.onMessage()
  → 解析 LIVE_OPEN_PLATFORM_DM / LIVE_OPEN_PLATFORM_SEND_GIFT
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
- **ControlPanel**：新增 B 站连接卡片（主播身份码输入 + 连接/断开按钮 + 状态指示）
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
| `src/services/external-input/adapters/bilibili-adapter.ts` | B 站连接管理、消息解析（支持官方/匿名双模式） |
| `src/services/external-input/adapters/types.ts` | `IExternalAdapter` 接口定义 |
| `src/services/external-input/danmaku-consumer.ts` | 弹幕 → pipeline.run() 的消费逻辑 + 节流 |
| `src-tauri/src/bilibili.rs`（或类似） | Rust 侧：HMAC-SHA256 签名 + HTTP 调用（start/heartbeat/end） |

### 5.2 建议修改文件

| 文件 | 改动 |
|------|------|
| `src/services/external-input/external-input-service.ts` | 新增 adapter 挂载/卸载方法 |
| `src/services/index.ts` | 初始化 BilibiliAdapter + DanmakuConsumer |
| `src/services/config/types.ts` | AppConfig 新增 `bilibili` 配置节（app_id, access_key_id, code 等） |
| `src/features/control-panel/ControlPanel.tsx` | 新增 B 站连接卡片 UI |
| `src/types/events.ts` | 可能扩展 `ExternalDanmakuPayload` |
| `package.json` | 新增 `pako` 依赖 |
| `src-tauri/Cargo.toml` | 新增 `hmac`, `sha2`, `md-5` 等 crate |
| `src-tauri/src/lib.rs` 或 `main.rs` | 注册 bilibili 相关 Tauri commands |

### 5.3 明确不碰的区域

| 区域 | 理由 |
|------|------|
| `src/features/stage/` | Stage / Live2D 渲染与弹幕无关 |
| `src/services/tts/` | TTS 已稳定，弹幕进入 pipeline 后自然走 TTS |
| `src/services/llm/openai-llm-service.ts` | 弹幕只需调 `pipeline.run()`，不改 LLM 内部 |
| `src/features/settings/SettingsPanel.tsx` | B 站配置用 ControlPanel 的简单卡片 |
| `src/services/character/` | 角色系统不需要为弹幕改动 |
| `src/services/knowledge/` | 知识库服务不需要改动 |
| `src/services/pipeline/pipeline-service.ts` | Pipeline 编排不改 |

---

## 6. 实施前的 Spike 计划

**Phase 4 正式实施前必须完成一个 Spike，消除最关键的技术未知点。**

Spike 分为两部分，优先做 Spike 1（官方路线）：

### Spike 1：官方 Open Live 路线（优先）

| 验证项 | 验证目标 | 方式 | 预估时间 |
|--------|---------|------|----------|
| S1.1 Rust 侧 HMAC-SHA256 签名 | 能否在 Rust 中计算出与 B 站官方一致的签名 | 编写最小 Tauri command，对照官方 Demo 验证 | 1–2 小时 |
| S1.2 `/v2/app/start` 调用 | 能否成功开启场次，拿到 `game_id` + `websocket_info` | 使用真实凭证调用，检查返回值 | 1 小时 |
| S1.3 WebSocket 连接 + auth_body | 用返回的 `wss_link` 和 `auth_body` 能否建立连接并收到认证成功 | 在 Tauri 应用中测试 | 30 分钟 |
| S1.4 弹幕接收 + 消息解析 | 能否收到 `LIVE_OPEN_PLATFORM_DM` 并解析出用户名和文本 | 连接有活跃弹幕的房间 | 30 分钟 |
| S1.5 HTTP 心跳 + 关闭 | `/v2/app/heartbeat` 和 `/v2/app/end` 是否正常工作 | 连接保持 1 分钟后关闭 | 30 分钟 |

**前置条件**：需要主播提供身份码 `code`。如暂时无法获取，先做 S1.1（签名验证），其余推迟。

### Spike 2：匿名 WebSocket 路线（对照 / fallback 验证）

| 验证项 | 验证目标 | 方式 | 预估时间 |
|--------|---------|------|----------|
| S2.1 WebSocket 连通性 | Tauri WebView 中 `new WebSocket("wss://broadcastlv.chat.bilibili.com/sub")` 能否连接 | DevTools console | 30 分钟 |
| S2.2 认证 + 弹幕接收 | 匿名认证后能否收到 `DANMU_MSG` | console 脚本 | 30 分钟 |
| S2.3 zlib 解压 | `pako.inflate` 在 WebView 中是否正常 | 安装 pako 后测试 | 30 分钟 |

### Spike 执行顺序

```
1. 先做 Spike 2（匿名路线，~1.5 小时）
   → 快速验证 WebSocket 基础连通性，无凭证门槛
   → 如果不通，说明 Tauri WebView 的 WebSocket 有问题，两条路线都受影响

2. 再做 Spike 1（官方路线，~4 小时）
   → 验证 Rust 签名 + 官方 API 调用 + 官方消息格式
   → 如果 Spike 2 已验证 WebSocket 可通，Spike 1 只需验证 HTTP 层 + 消息格式差异

3. 产出 Spike 记录文档到 docs/research/
```

### Spike 产出物

- `docs/research/phase4-spike-results.md`：记录每个验证项的结果、截图/日志、结论
- 如果 Spike 1 通过：进入 Run 01 正式实施（官方路线）
- 如果 Spike 1 不通但 Spike 2 通过：Run 01 暂用匿名路线实施，平行排查官方路线问题
- 如果两条都不通：需要走 Rust 代理方案（Rust 侧建立 WebSocket，通过 Tauri Event 转发）

---

## 7. 建议的 Run 规划

### Spike（0.5–1 天）

验证双路连通性。产出 spike 记录文档。

### Run 01 — B 站弹幕接入（官方路线，3–4 天）

| 任务 | 内容 |
|------|------|
| T1 | Rust 侧：HMAC-SHA256 签名 + `/v2/app/start` + `/heartbeat` + `/end` Tauri commands |
| T2 | `IExternalAdapter` 接口 + `BilibiliAdapter` 实现（官方 WebSocket + 消息解析） |
| T3 | `ExternalInputService` 扩展（adapter 挂载/卸载） |
| T4 | `DanmakuConsumer`（弹幕 → pipeline.run + 节流） |
| T5 | `AppConfig.bilibili` 配置 + ControlPanel B 站连接 UI |
| T6 | `initServices` 初始化 + 生命周期管理（含 HTTP 心跳定时器） |
| T7 | 编译验证 + 手测 + 报告 |

### Run 02 — 增强（可选，1–2 天）

| 内容 | 说明 |
|------|------|
| 匿名 fallback 模式 | BilibiliAdapter 内支持匿名模式切换 |
| 礼物 → 角色表情反应 | 利用现有 `character.setEmotion()` |
| SC 支持 | `LIVE_OPEN_PLATFORM_SUPER_CHAT` 解析 + 高优先级处理 |
| 弹幕展示优化 | ControlPanel 弹幕实时 feed |
| 节流策略改进 | 简单队列 + 弹幕选取策略 |

---

## 8. 风险

| 风险 | 等级 | 缓解策略 |
|------|------|----------|
| 主播身份码获取困难 | 中 | 用户需提前在直播姬/弹幕姬中获取；如暂无法获取，先用匿名路线推进 |
| Rust 签名与 B 站不一致 | 中 | 对照官方 C# Demo 和签名验证工具排查 |
| 官方 API 权限 / 审核问题 | 中 | fallback 到匿名路线 |
| WebSocket 在 Tauri WebView 中不通 | 中 | Spike 验证；如不通，走 Rust 代理（tokio-tungstenite + Tauri Event） |
| 弹幕频率过高打爆 LLM | 中 | DanmakuConsumer 有冷却机制 + Pipeline 有 processing 锁 |
| 连接生命周期管理不当导致泄漏 | 中 | adapter 有 destroy() + 组件卸载时断开 + `/v2/app/end` 清理 |
| HTTP 心跳漏发导致场次过期 | 中 | 20 秒定时器 + 心跳失败重试 + 日志告警 |

---

## 9. 验收标准

| # | 验收项 | 验证方式 |
|---|--------|----------|
| 1 | 通过官方 Open Live 连接 B 站直播间 | ControlPanel 连接状态变绿 |
| 2 | EventLog 中出现弹幕事件 | 观察事件日志 |
| 3 | 弹幕触发 LLM 回复 | ChatPanel 出现弹幕触发的回复 |
| 4 | TTS 播报弹幕回复 | 听到角色回复弹幕 |
| 5 | 节流生效 | 高频弹幕不会连续触发 LLM |
| 6 | 断开后可重连 | 点击断开再连接，功能恢复 |
| 7 | 场次关闭正常 | 断开时调用 `/v2/app/end`，无幽灵场次 |
| 8 | 不破坏现有链路 | 手动输入、知识库、Stage、OBS 正常 |
| 9 | TypeScript + Vite build + Cargo build 通过 | 编译零错误 |

---

## 元信息

- Phase 4 分支（建议）：`feature/phase4-live-integration`
- 前序文档：
  - `docs/research/phase4-round1-observation.md`（仓库架构审计）
  - `docs/research/phase4-bilibili-connection-research.md`（B 站技术调研·双路方案）
  - `dev-reports/phase3-5/close-out.md`（Phase 3.5 交接文档）
- Blueprint 路径：`blueprints/phase4/bilibili-minimum-integration.md`
- 创建日期：2026-03-31
- 路线修正日期：2026-03-31（Open Live 升为默认主方案）
