# Phase 3 — 真实服务接入与直播能力接线

**日期**：2026-03-23
**前置依赖**：Phase 2 功能基线稳定、Phase 2.1 结构收敛完成、回归烟雾测试通过
**性质**：真实服务替换 + 外部输入接入——小步替换 mock，不破坏已有主链路

---

## 0. 路线图对齐说明

原始路线图（`phase-roadmap.md`）中的 Phase 定义如下：

| 原定 Phase | 名称 | 状态 |
|------------|------|------|
| Phase 2 | Voice Pipeline（mock 先行） | **已完成**——接口定义 + mock 实现 + Stage 播出 |
| Phase 3 | Control & Monitor | 大部分已在 Phase 1/2 中提前交付（控制面板、急停/恢复、事件日志、状态栏） |
| Phase 4 | Live Integration | OBS 透明捕获已在 Phase 2 中验证完成 |

由于项目的实际推进节奏，原定 Phase 3（Control & Monitor）和 Phase 4（Live Integration）的部分能力已经在 Phase 1–2 中提前落地。当前真正缺失的核心能力是：

1. **真实 LLM / TTS 替换 mock**（原属 Phase 2 规划，Phase 2 只做了接口和 mock）
2. **直播间外部输入的真实接入**（原属 Phase 4）
3. **知识/上下文层与 LLM 的真实串联**（原属 Phase 4）

因此本阶段重新定义为**"真实服务接入与直播能力接线"**，覆盖原路线图中尚未落地的核心能力。

---

## 1. 为什么现在适合进入 Phase 3

### 1.1 已有基础

| 能力 | 状态 |
|------|------|
| Stage-only 单实例播出架构 | 稳定运行 |
| OBS 透明窗口捕获 | 已验证 |
| 双窗口同步（主控 + Stage） | 事件总线 + BroadcastChannel / Tauri IPC |
| 主链路骨架 `pipeline.run()` | 文本 → LLM → TTS → 播放 → 口型同步 |
| 服务接口标准化 | `ILLMService`、`ITTSService`、`IASRService` 均已定义 |
| 事件总线 + Runtime 门控 | EventBus + RuntimeService（auto/stopped） |
| 外部事件框架 | `ExternalInputService` + `external:danmaku/gift/product-message` |
| 知识层占位 | `KnowledgeService`（内存长期知识 + 带 TTL 的临时上下文） |
| 控制面板 | 急停/恢复、角色状态、mock 测试 |
| 代码结构整理 | Phase 2.1 收敛完成，职责清晰 |

### 1.2 当前瓶颈

唯一阻止系统变成"最小可用直播系统"的障碍是：**所有外部服务调用仍然是 mock**。

- `MockLLMService`：随机回复预设文本，不理解上下文
- `MockTTSService`：返回正弦波音频，不产生语音
- ASR：仅有接口定义，无任何实现
- 弹幕/外部输入：仅有 mock 注入，无真实平台适配器
- 知识层：能存储和组装上下文，但 LLM 调用时未使用

现在替换这些 mock 是最小成本的——接口边界清晰、替换点集中在 `services/index.ts`，不需要改动 pipeline 编排逻辑。

---

## 2. 本阶段要解决的具体问题

### M1：真实 LLM 接入

**目标**：实现 `ILLMService` 的真实版本，替换 `MockLLMService`。

**当前状态**：
- `ILLMService` 接口已定义：`chat(messages: ChatMessage[], tools?: ToolDef[]) → AsyncGenerator<LLMChunk>`
- `LLMService` 门面已实现：负责 history 管理、事件发射、runtime 门控
- 替换点：`services/index.ts` 第 40 行 `new MockLLMService()`

**需要做的事**：
1. 新建 `src/services/llm/openai-llm-service.ts`（或按实际选型命名），实现 `ILLMService`
2. 支持流式响应（`AsyncGenerator<LLMChunk>`），逐 chunk yield
3. 支持 tool calling（`setExpression` 等），正确 yield `{ type: "tool-call" }`
4. 在 `services/index.ts` 中根据配置选择 mock 或真实实现
5. 将 `KnowledgeService.getAssembledContext()` 注入 system prompt

**配置需求**：
- API 端点 URL（支持 OpenAI 兼容接口，也兼容自建/代理服务）
- API Key
- 模型名称
- 可选参数：temperature、max_tokens 等

**接口契约不变**：真实实现必须遵守与 mock 相同的 `ILLMService` 接口，门面 `LLMService` 和 `PipelineService` 不需要修改。

---

### M2：真实 TTS 接入

**目标**：实现 `ITTSService` 的真实版本，替换 `MockTTSService`。

**当前状态**：
- `ITTSService` 接口已定义：`synthesize(text: string, config?: VoiceConfig) → Promise<ArrayBuffer>`
- `VoiceConfig`：`speakerId?`、`speed?`、`pitch?`
- 替换点：`services/index.ts` 第 42 行 `new MockTTSService()`
- `AudioPlayer` 使用 `decodeAudioData` 播放，要求返回 WAV 或浏览器可解码格式

**需要做的事**：
1. 新建 `src/services/tts/real-tts-service.ts`（按实际方案命名），实现 `ITTSService`
2. 调用外部 TTS API，返回音频 `ArrayBuffer`
3. 确保返回格式为 Web Audio API 可解码的格式（WAV、MP3 等）
4. 在 `services/index.ts` 中根据配置选择实现

**TTS 方案选型**：
- 优先方案：GPT-SoVITS / VITS 等自建 TTS 服务（本地或局域网部署，通过 HTTP API 调用）
- 备选方案：云端 TTS API（如 Azure、Google Cloud TTS 等）
- 方案选型在实施前确认，本 blueprint 只定义接口边界

**配置需求**：
- TTS 服务端点 URL
- 可选认证信息
- 默认 speaker ID
- 语速/音调参数

---

### M3：知识层与 LLM 的串联

**目标**：让 LLM 调用时自动获取知识上下文，使回复能基于商品信息和角色设定。

**当前状态**：
- `KnowledgeService` 已实现：`addKnowledge()`、`addLiveContext()`、`getAssembledContext()`、自动过期清理
- `ExternalInputService` 已将 `external:product-message` 路由到 `KnowledgeService`
- **但** `LLMService.sendMessage()` 和 `PipelineService.run()` 目前没有调用 `knowledge.getAssembledContext()`

**需要做的事**：
1. 在 `PipelineService` 或 `LLMService` 中，构建 LLM 请求前组装 system prompt：
   - 角色人设（从 `CharacterService` 获取）
   - 知识上下文（从 `KnowledgeService.getAssembledContext()` 获取）
2. 设计 system prompt 模板，明确角色设定、知识、临时上下文的注入位置和优先级
3. 确保 `KnowledgeService` 的已有接口满足需求，不满足则扩展

**不做**：
- 不实现 RAG / 向量检索 / Embedding——当前阶段知识层为纯文本注入
- 不实现知识管理 UI——通过配置文件或 DevTools 管理

---

### M4：配置管理基础

**目标**：建立统一的应用配置机制，支持 LLM/TTS 端点和凭证的配置。

**当前状态**：
- 无 `.env` / `.env.example`
- 无配置管理模块
- 无 `import.meta.env.VITE_*` 使用
- Tauri capabilities 中无 HTTP 权限

**需要做的事**：
1. 建立 Vite 环境变量方案：`.env` / `.env.example` + `import.meta.env.VITE_*` 类型声明
2. 或 建立 JSON/TOML 配置文件方案（通过 Tauri 文件系统读取）
3. 新建 `src/services/config/` 或 `src/utils/config.ts`，提供 `getConfig()` 接口
4. 配置项至少包括：
   - LLM API endpoint + API key + model name
   - TTS API endpoint + 认证信息
   - 角色人设文本（或人设文件路径）
5. 提供 `.env.example` 模板，方便新开发者快速配置

**MVP 阶段约定**：
- 配置方式以 `.env` 文件 + Vite 环境变量为最小可行方案
- 不做配置 UI——通过编辑配置文件完成
- API Key 不提交到仓库（`.gitignore` 已包含 `.env`）

---

### M5：弹幕 / 外部输入真实接入（边界定义）

**目标**：定义外部输入适配器接口，实现至少一个真实平台的弹幕接入。

**当前状态**：
- `ExternalInputService` 已实现：`injectEvent(RawExternalEvent)` → 标准化 → 事件总线
- `RawExternalEvent`：`{ source, type, data }`
- 事件类型已覆盖：`danmaku`、`gift`、`product-message`
- 目前只有 mock 注入（DevTools 和 ControlPanel 按钮）

**需要做的事**：
1. 定义适配器接口 `IExternalInputAdapter`：

```typescript
interface IExternalInputAdapter {
	readonly sourceId: string;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	onEvent(callback: (event: RawExternalEvent) => void): void;
	getStatus(): { connected: boolean; error?: string };
}
```

2. 实现至少一个真实适配器（如 B 站直播弹幕），消费平台 WebSocket / API 并转换为 `RawExternalEvent`
3. 适配器注册到 `ExternalInputService`，与现有 `injectEvent` 路径复用
4. 在 ControlPanel 或 StatusBar 中显示外部输入源连接状态

**本阶段边界**：
- 适配器数量：1 个真实平台 + mock 保留
- 不做弹幕筛选/排队/去重
- 不做自动弹幕回复触发（弹幕进入事件总线后，由操作员或后续阶段决定如何处理）
- 弹幕触发 LLM 回复的自动链路如果时间允许可做，但不是 M5 的必须交付

---

### M6：HTTP 网络能力开通

**目标**：让前端代码能正常发送 HTTP 请求到外部 API。

**当前状态**：
- Tauri capabilities 中无 HTTP 权限
- `src` 中无 `fetch` / HTTP 客户端调用
- CSP 为 `null`（未限制）

**需要做的事**：
1. 评估 HTTP 请求路径：
   - **方案 A**：前端直接 `fetch`（CSP 为 null 时可行，但 API Key 暴露在前端内存）
   - **方案 B**：通过 Tauri Rust 侧代理（更安全，但实现量更大）
   - **MVP 建议**：方案 A 先行，Phase 5 再迁移到方案 B
2. 如选方案 A：确认 Tauri WebView 的 `fetch` 能力和 CORS 限制
3. 如选方案 B：在 `src-tauri/` 中实现 `invoke` 命令，前端通过 `@tauri-apps/api/core` 调用
4. 添加必要的 Tauri capabilities 权限

---

## 3. 本阶段明确不做什么

| 不做的事 | 原因 |
|---------|------|
| ASR / 语音输入 | 真实语音输入需要麦克风权限、VAD 方案选型、音频流处理，复杂度高，单独规划 |
| 锁麦策略 | 依赖 ASR，ASR 不做则锁麦无意义 |
| 完整 RAG / 向量检索 | 当前阶段知识层走纯文本注入，够用即可 |
| 知识管理 UI | 通过配置文件管理，后续做 UI |
| 多平台弹幕适配 | 先做 1 个平台验证架构，其余平台后续扩展 |
| 弹幕自动回复队列 / 筛选 | 后续功能增强 |
| 配置 UI | 本阶段通过 `.env` / 配置文件管理 |
| Windows 安装包 | Phase 5 范围 |
| Stage / OBS 方案变更 | 已稳定，不动 |
| Live2DRenderer 重构 | 渲染核心无需改动 |
| 大规模目录重组 | Phase 2.1 已完成结构收敛 |

---

## 4. 接入边界详述

### 4.1 真实 LLM 接入边界

**范围内**：
- 实现 `ILLMService` 的 OpenAI 兼容版本
- 流式 SSE/chunked 响应解析
- tool calling 支持（至少 `setExpression`）
- system prompt 组装（角色人设 + 知识上下文）
- 环境变量配置

**范围外**：
- 多模型切换 UI（在配置文件中切换即可）
- Function calling 以外的 structured output
- 自建 LLM 推理服务部署
- Token 计数和费用统计
- 多轮对话摘要/历史压缩

### 4.2 真实 TTS 接入边界

**范围内**：
- 实现 `ITTSService` 的 HTTP API 调用版本
- 支持配置 endpoint、speaker、速度
- 返回浏览器可播放的音频格式

**范围外**：
- TTS 服务本身的部署和运维（视为外部依赖）
- 多声线实时切换 UI
- 流式 TTS（分段合成、边合成边播放）
- 情感化语音合成
- SSML 支持

### 4.3 弹幕 / 外部输入接入边界

**范围内**：
- 适配器接口定义
- 1 个真实平台适配器实现
- 弹幕事件路由到事件总线
- 连接状态展示

**范围外**：
- 多平台同时接入
- 弹幕排队/去重/过滤
- 自动弹幕回复链路（弹幕 → LLM → TTS 自动触发）
- 弹幕展示 UI（覆盖在 Stage 上）
- 礼物特效

### 4.4 知识 / 商品资料接入边界

**范围内**：
- `KnowledgeService.getAssembledContext()` 注入 LLM system prompt
- 通过 `external:product-message` 事件注入临时商品信息
- 通过配置文件加载初始长期知识

**范围外**：
- 向量数据库 / RAG 检索
- 知识管理 UI
- 自动商品信息抓取
- 多轮对话知识追踪

---

## 5. 建议执行顺序

按"依赖关系 + 风险从低到高"排序：

```
Step 1: M4 — 配置管理基础
         最底层基础设施，LLM/TTS 接入依赖它
         风险：低（纯新增，不改现有代码）
         交付：.env.example + config 模块 + 类型声明

Step 2: M6 — HTTP 网络能力开通
         确认 fetch 路径可用，排除网络层阻塞
         风险：低（验证性工作）
         交付：能从前端 fetch 到外部 API

Step 3: M1 — 真实 LLM 接入
         核心能力，需要配置和网络层就绪
         风险：中（涉及外部 API 调用、流式解析）
         交付：真实 LLM 回复替换 mock 预设文本

Step 4: M3 — 知识层与 LLM 串联
         依赖 M1 完成后才能验证效果
         风险：低-中（主要是 prompt 工程）
         交付：LLM 回复能基于角色设定和知识上下文

Step 5: M2 — 真实 TTS 接入
         依赖配置和网络层，但与 LLM 相互独立
         风险：中（依赖外部 TTS 服务可用性）
         交付：真实语音替换正弦波音频

Step 6: M5 — 弹幕 / 外部输入接入
         最后做，风险最高（涉及第三方平台协议）
         风险：中-高（平台 API 变更、认证、WebSocket 稳定性）
         交付：真实弹幕进入事件总线
```

### 分批策略

**第一批（MVP 最小闭环）**：M4 → M6 → M1 → M3 → M2

完成后系统能做到：操作员输入文本 → 真实 LLM 基于角色设定和知识回复 → 真实 TTS 语音播放 → Live2D 口型同步。这已经是一个**可用于演示和内部测试的最小闭环**。

**第二批（直播能力扩展）**：M5

弹幕接入需要真实直播间环境验证，可以在第一批稳定后再推进。

---

## 6. 验收标准

### 6.1 编译与基础检查

- [ ] `npx tsc --noEmit` 零错误
- [ ] 所有修改文件 lint 通过
- [ ] `pnpm tauri dev` 正常启动

### 6.2 功能不回退（Phase 2 基线）

- [ ] Stage 窗口正常打开、显示 Live2D 模型
- [ ] 模型切换、眼神模式、缩放控制正常
- [ ] docked / floating 模式切换正常
- [ ] OBS 透明窗口捕获正常
- [ ] 急停/恢复功能正常
- [ ] mock 测试按钮仍然可用（mock 实现保留，可通过配置切换）

### 6.3 M1 — 真实 LLM

- [ ] 配置 API endpoint 和 key 后，`pipeline.run()` 能获得真实 LLM 回复
- [ ] LLM 流式回复能在 ChatPanel 中实时显示
- [ ] tool calling（setExpression）能正确触发角色表情变化
- [ ] 未配置或配置错误时，有明确的错误提示（不 crash）
- [ ] mock 模式仍可通过配置切回

### 6.4 M2 — 真实 TTS

- [ ] 配置 TTS 端点后，LLM 回复文本能被合成为真实语音
- [ ] 语音播放时 Live2D 口型同步正常工作
- [ ] TTS 服务不可用时，有明确错误提示
- [ ] mock 模式仍可通过配置切回

### 6.5 M3 — 知识串联

- [ ] 加载角色人设后，LLM 回复风格符合人设
- [ ] 通过 `injectEvent` 注入商品信息后，LLM 回复能引用该商品信息
- [ ] 临时上下文过期后，LLM 不再引用过期信息

### 6.6 M4 — 配置管理

- [ ] `.env.example` 包含所有必要配置项及说明
- [ ] 应用能从环境变量读取配置
- [ ] 缺少必要配置时启动不 crash，给出清晰提示

### 6.7 M5 — 外部输入（如实施）

- [ ] 至少一个真实平台适配器能连接并接收弹幕
- [ ] 弹幕事件出现在事件日志中
- [ ] 适配器断开时能在 UI 中体现状态
- [ ] 断开不影响主链路运行

### 6.8 M6 — 网络能力

- [ ] 前端能成功 `fetch` 外部 HTTPS API
- [ ] 网络错误有合理的超时和重试策略（至少有超时）

---

## 7. 风险点与回滚思路

### 7.1 风险清单

| 风险 | 影响 | 等级 | 缓解措施 |
|------|------|------|---------|
| LLM API 调用失败（网络、鉴权、限速） | 主链路中断 | 高 | 错误捕获 + 降级到 mock；配置验证；超时控制 |
| TTS 服务不可用或返回格式不兼容 | 无语音输出 | 中 | 格式检测 + 降级到 mock TTS；支持多种音频格式 |
| Tauri WebView fetch 被 CORS 阻断 | 无法调用外部 API | 中 | 提前验证；必要时走 Tauri Rust 代理 |
| API Key 泄露 | 安全问题 | 中 | `.gitignore` 已包含 `.env`；文档中强调不提交 |
| 弹幕平台协议变更 | 适配器失效 | 中 | 适配器层隔离，不影响核心链路；保留 mock 注入 |
| 外部服务延迟过高导致用户体验差 | 回复缓慢 | 中 | 超时控制；UI 加载状态提示；考虑流式 TTS（Phase 5） |
| LLM 返回不当内容 | 直播安全 | 中 | Runtime 急停机制已就绪；可在 prompt 中加安全约束 |
| 同时替换 LLM + TTS 导致调试困难 | 定位问题难 | 低 | 严格按顺序替换，每步独立验证 |

### 7.2 回滚策略

**核心设计原则**：mock 实现永远保留，通过配置切换而非删除代码。

```
如果真实 LLM 出问题 → 配置切回 MockLLMService → 主链路恢复
如果真实 TTS 出问题 → 配置切回 MockTTSService → 主链路恢复
如果弹幕适配器出问题 → 断开适配器 → 主链路不受影响
如果配置模块出问题 → 回退 commit → 恢复到 Phase 2.1 状态
```

每个 M（Milestone）独立可回滚，任何一个 M 的失败不应影响其他已完成的 M。

### 7.3 降级策略

在 `services/index.ts` 的服务初始化中实现配置驱动的实现选择：

```
配置了有效 LLM endpoint → 使用真实 LLM
未配置或配置无效 → 降级到 MockLLMService + 控制台警告

配置了有效 TTS endpoint → 使用真实 TTS
未配置或配置无效 → 降级到 MockTTSService + 控制台警告
```

这保证了：
- 新开发者 clone 仓库后不配置也能运行（mock 模式）
- 生产环境配置好服务即切换为真实模式
- 运行时某个服务挂了可以快速切回 mock

---

## 8. 技术选型待定项

以下技术选型在本 blueprint 中**不做最终决定**，留到实施前根据实际情况确认：

| 选型 | 候选方案 | 决策时机 |
|------|---------|---------|
| LLM API | OpenAI 兼容（直连/代理）、Azure OpenAI、其他 | M1 实施前 |
| TTS 方案 | GPT-SoVITS（本地/局域网）、云端 TTS API | M2 实施前 |
| HTTP 路径 | 前端 fetch vs Tauri Rust 代理 | M6 实施时验证 |
| 弹幕平台 | B 站直播、抖音直播、其他 | M5 实施前 |
| 配置格式 | Vite 环境变量 vs JSON 配置文件 vs 混合 | M4 实施时确认 |

---

## 9. 与后续阶段的关系

### Phase 3 完成后的系统能力

完成本阶段后，Paimon Live 将具备：
- 操作员输入文本 → 真实 AI 回复 → 真实语音播出 → Live2D 口型同步
- AI 回复基于角色人设和知识上下文
- 至少一个真实弹幕源可接入（如实施 M5）
- OBS 透明捕获仍然可用
- 急停/恢复仍然有效

### 尚未覆盖（后续阶段）

| 能力 | 建议阶段 |
|------|---------|
| ASR / 语音输入 | Phase 4 |
| VAD + 锁麦策略 | Phase 4 |
| 多平台弹幕适配 | Phase 4 |
| 弹幕自动回复链路 | Phase 4 |
| 知识管理 UI | Phase 4/5 |
| 配置管理 UI | Phase 5 |
| RAG / 向量检索 | Phase 5+ |
| 流式 TTS（边合成边播放） | Phase 5 |
| Windows 安装包 | Phase 5 |
| 首次启动引导 | Phase 5 |
| 性能优化 | Phase 5 |

### 边界承诺

- Phase 3 不动 Stage / OBS / 多窗口方案
- Phase 3 不动 Live2DRenderer
- Phase 3 不动事件总线核心和 Runtime 门控机制
- Phase 3 的所有新增代码通过 `ILLMService` / `ITTSService` / `IExternalInputAdapter` 接口隔离，不侵入现有编排逻辑

---

## 附录 A：替换点一览

| 替换点 | 当前实现 | 目标实现 | 文件位置 |
|--------|---------|---------|---------|
| LLM Provider | `MockLLMService` | `OpenAILLMService`（暂定） | `services/index.ts` 第 40 行 |
| TTS Provider | `MockTTSService` | `RealTTSService`（暂定） | `services/index.ts` 第 42 行 |
| 知识注入 | 未串联 | `PipelineService` 或 `LLMService` 中组装 prompt | `services/pipeline/` 或 `services/llm/` |
| 外部输入 | `injectEvent` mock 调用 | 真实适配器 → `injectEvent` | `services/external-input/` |

## 附录 B：预估新增文件

| 文件 | 用途 |
|------|------|
| `src/services/llm/openai-llm-service.ts` | 真实 LLM 实现 |
| `src/services/tts/real-tts-service.ts` | 真实 TTS 实现 |
| `src/services/config/index.ts` 或 `src/utils/config.ts` | 配置管理 |
| `src/services/external-input/adapters/` | 弹幕适配器目录 |
| `.env.example` | 环境变量模板 |
| `src/vite-env.d.ts` 更新 | Vite 环境变量类型声明 |

## 附录 C：现有不改动的文件

| 文件 | 原因 |
|------|------|
| `src/services/pipeline/pipeline-service.ts` | 编排逻辑不变，通过接口消费新实现 |
| `src/services/llm/llm-service.ts` | 门面层不变，只替换底层 provider |
| `src/services/llm/types.ts` | 接口定义不变 |
| `src/services/tts/types.ts` | 接口定义不变 |
| `src/features/stage/*` | Stage 渲染层不变 |
| `src/utils/window-sync.ts` | 通信层不变 |
| `src/features/live2d/*` | Live2D 渲染层不变 |

唯一预期修改的现有文件：
- `src/services/index.ts`：根据配置选择实现
- `src/vite-env.d.ts`：环境变量类型
- `src/services/llm/index.ts` / `src/services/tts/index.ts`：新增导出
