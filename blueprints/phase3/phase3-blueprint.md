# Phase 3 — 真实服务接入与角色/知识基础

**日期**：2026-03-23
**前置依赖**：Phase 2 功能基线稳定、Phase 2.1 结构收敛完成、回归烟雾测试通过
**性质**：真实服务替换 + 角色设定导入 + 纯文本知识注入——小步替换 mock，不破坏已有主链路

---

## 0. 路线图对齐说明

原始路线图（`phase-roadmap.md`）中的 Phase 定义如下：

| 原定 Phase | 名称 | 状态 |
|------------|------|------|
| Phase 2 | Voice Pipeline（mock 先行） | **已完成**——接口定义 + mock 实现 + Stage 播出 |
| Phase 3 | Control & Monitor | 大部分已在 Phase 1/2 中提前交付（控制面板、急停/恢复、事件日志、状态栏） |
| Phase 4 | Live Integration | OBS 透明捕获已在 Phase 2 中验证完成 |

由于项目的实际推进节奏，原路线图中的部分能力已在 Phase 1–2 中提前落地。当前各阶段重新定义如下：

| Phase | 名称 | 核心目标 |
|-------|------|---------|
| **Phase 3** | 真实服务接入与角色/知识基础 | 真实 LLM/TTS 替换 mock、SillyTavern 角色卡导入、纯文本知识注入、配置管理基础 |
| **Phase 4** | 直播能力接线与语音输入闭环 | 真实直播/外部输入源接入、ASR 语音输入、VAD/锁麦策略 |
| **Phase 5** | 知识系统深化与产品化收口 | RAG/向量检索、知识管理 UI、配置/商品资料管理体验、打包安装引导 |

**本 blueprint 覆盖范围**：Phase 3（真实服务接入与角色/知识基础）

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

唯一阻止系统变成"最小可用播出系统"的障碍是：**所有外部服务调用仍然是 mock，且角色设定和知识上下文尚未与 LLM 接通**。

- `MockLLMService`：随机回复预设文本，不理解上下文，不读取角色设定
- `MockTTSService`：返回正弦波音频，不产生语音
- 角色设定：仅有占位，无导入机制（SillyTavern 角色卡未接入）
- 知识层：能存储和组装上下文，但 LLM 调用时未注入

ASR（语音输入）和弹幕/外部输入属于 Phase 4 范围，当前阶段不处理。

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

### M2：真实 TTS 接入（GPT-SoVITS 优先）

**目标**：实现 `ITTSService` 的真实版本，替换 `MockTTSService`。首选方案为 GPT-SoVITS，与旧项目 `VoiceL2D-MVP` 对齐。

**当前状态**：
- `ITTSService` 接口已定义：`synthesize(text: string, config?: VoiceConfig) → Promise<ArrayBuffer>`
- `VoiceConfig`：`speakerId?`、`speed?`、`pitch?`
- 替换点：`services/index.ts` 中 `resolveTTSProvider()`
- `AudioPlayer` 使用 `decodeAudioData` 播放，要求返回 WAV 或浏览器可解码格式

**为什么优先选 GPT-SoVITS 而非泛化 TTS provider**：
1. 旧项目 `VoiceL2D-MVP` 已验证过 GPT-SoVITS 的完整调用路径（HTTP API → WAV 音频 → 播放 → 口型同步）
2. GPT-SoVITS 部署在本地/局域网，不需要云端 API Key，调用路径更简单（前端直连即可）
3. GPT-SoVITS 支持角色声线克隆（ref_audio + prompt），与本项目"角色扮演"的场景完全匹配
4. 先跑通一个已验证方案，再考虑泛化扩展，比先设计泛化框架再适配具体方案更高效

**GPT-SoVITS API 接口（基于旧项目验证）**：

| 端点 | 方法 | 用途 |
|------|------|------|
| `{host}/set_gpt_weights?weights_path=...` | GET | 加载 GPT 权重（`.ckpt`） |
| `{host}/set_sovits_weights?weights_path=...` | GET | 加载 SoVITS 权重（`.pth`） |
| `{host}/tts?text=...&text_lang=...&ref_audio_path=...&prompt_text=...&prompt_lang=...` | GET | 合成语音，返回 WAV 字节 |

**GPT-SoVITS 音频参数**：
- 采样率：32000 Hz
- 声道：单声道
- 位深：16-bit（2 字节/采样）
- 格式：WAV（含 44 字节标准头）

**GPT-SoVITS 每角色配置**：
- `gpt_weights_path`：GPT 模型权重路径（TTS 服务端路径）
- `sovits_weights_path`：SoVITS 模型权重路径（TTS 服务端路径）
- `ref_audio_path`：参考音频路径（TTS 服务端路径）
- `prompt_text`：参考音频对应文本
- `prompt_lang`：参考音频语言（如 `"zh"`）

**需要做的事**：
1. 新建 `src/services/tts/gptsovits-tts-service.ts`，实现 `ITTSService`
2. 调用 GPT-SoVITS HTTP API，传入 text + 角色声线参数，返回 WAV `ArrayBuffer`
3. 首次连接时加载对应角色的 GPT/SoVITS 权重（通过 `/set_gpt_weights` 和 `/set_sovits_weights`）
4. 在 `services/index.ts` 的 `resolveTTSProvider()` 中添加 `"gpt-sovits"` 分支
5. 扩展 `TTSProviderConfig` 类型，增加 GPT-SoVITS 专属字段
6. 在 Settings UI 中添加 GPT-SoVITS 特有配置项

**网络路径**：
- GPT-SoVITS 部署在本地/局域网 → 前端直连 `fetch`（无需 Rust 代理）
- 调用不需要 API Key

**配置需求**：
- TTS 服务端点 URL（默认 `http://localhost:9880`）
- GPT 权重路径（服务端路径）
- SoVITS 权重路径（服务端路径）
- 参考音频路径（服务端路径）
- 参考音频文本
- 参考音频语言
- 合成语言（默认 `zh`）

**Mock 保留**：GPT-SoVITS 服务不可用时降级到 `MockTTSService`，不 crash。

**后续扩展**：GPT-SoVITS 跑通后，如有需要可通过 `ITTSService` 接口扩展其他 TTS provider（云端 TTS 等），但当前阶段不做泛化。

---

### M3：角色设定导入与知识层串联

**目标**：实现角色设定导入，并将角色设定和知识上下文串联到 LLM，使 AI 回复能基于角色人设、商品资料和当前上下文。

**角色设定导入（SillyTavern 角色卡）**：
- 支持导入 SillyTavern 角色卡 JSON 文件（`*.png` 内嵌或独立 JSON）
- 解析角色卡中的 `name`、`description`、`personality`、`first_mes`、`avatar` 等字段
- 角色卡格式定位为**外部导入格式**，内部角色数据结构按项目需求独立设计
- 解析后的角色设定写入 `CharacterService`，供后续 LLM 调用时注入 system prompt
- 本阶段仅支持纯文本角色设定，暂不涉及图像 Avatar 渲染

**当前状态**：
- `KnowledgeService` 已实现：`addKnowledge()`、`addLiveContext()`、`getAssembledContext()`、自动过期清理
- `CharacterService` 已实现：角色状态管理，但无外部导入机制
- **但**角色设定未与 LLM 接通，知识上下文也未注入 LLM

**需要做的事**：
1. 实现 SillyTavern 角色卡解析器（`src/services/character/card-parser.ts`）
2. 在 `CharacterService` 中增加角色卡导入方法 `importCharacterCard(card: CharacterCard): void`
3. 在 `PipelineService` 或 `LLMService` 中，构建 LLM 请求前组装 system prompt：
   - 角色人设（从 `CharacterService` 获取）
   - 知识上下文（从 `KnowledgeService.getAssembledContext()` 获取）
4. 设计 system prompt 模板，明确角色设定、知识、临时上下文的注入位置和优先级
5. 确保 `KnowledgeService` 的已有接口满足需求，不满足则扩展

**不做**：
- 不实现 RAG / 向量检索 / Embedding——当前阶段知识层为纯文本注入
- 不实现知识管理 UI——通过配置文件或 DevTools 管理
- 不实现角色卡在线编辑或完整管理 UI

---

### M4：配置管理基础

**目标**：建立统一的应用配置机制，支持 LLM/TTS 端点、凭证及运行时参数的配置与管理。

**当前状态**：
- 无配置管理模块
- 无持久化配置读写
- Tauri capabilities 中无 HTTP 权限

**配置策略（桌面应用产品形态）**：

| 配置类型 | 示例 | 存储方式 |
|---------|------|---------|
| **运行时可调参数** | LLM endpoint、model、temperature、TTS speed、默认角色等 | 设置界面 + 本地持久化 |
| **云端密钥/凭证** | API Key、auth token 等 | 本地安全存储（不写入前端可见内存） |

> **注意**：本项目不依赖 `.env` 作为用户配置路径。设置界面是唯一的正式配置入口，开发环境首次启动也通过设置界面或首次启动引导完成配置。`.env` 仅作为开发者本地启动时的可选开发辅助（`vite-env.d.ts` 类型声明可保留用于开发期提示）。

**非敏感配置（设置界面管理）**：
- LLM provider 选择（OpenAI 兼容 / Azure / 自建）
- LLM endpoint URL
- LLM model name
- temperature、max_tokens 等推理参数
- TTS endpoint URL
- TTS speaker / voice ID
- TTS speed、pitch 参数
- 默认角色人设路径
- 日志级别等运行参数

**敏感配置（安全存储）**：
- API Key、API Secret
- Auth token / session key
- 平台认证信息
- **原则**：云端密钥不应写入前端可见内存或环境变量，应存入更安全的本地存储（系统 keychain / Tauri Rust 安全存储），后续 Phase 4/5 细化

**需要做的事**：
1. 新建 `src/services/config/` 配置服务，提供 `getConfig()` / `setConfig()` 接口
2. 实现普通配置本地持久化（通过 Tauri fs API 读写 JSON 配置文件，路径建议 `app_data_dir()/config.json`）
   - **注意**：`config.json` 仅存储普通配置（endpoint、model、参数等），**敏感配置不写入此文件**
3. 敏感配置（API Key）写入单独的本地安全存储路径（Tauri Rust 侧存储 / 系统 keychain），不由普通 config 模块管理
4. 设置界面组件：可在 ControlPanel 中增加"设置"Tab 或独立 Modal
5. 首次启动引导（可选，可与设置界面合并），引导用户完成首次配置

**MVP 阶段约定**：
- **唯一正式配置入口**：设置界面
- `.env` / `vite-env.d.ts` 不作为配置方案组成部分
- 敏感配置（API Key）**必须**存入本地安全存储（Tauri Rust 侧安全存储 / 系统 keychain），不写入环境变量、不作为普通 JSON 明文存储、不暴露在前端运行时
- Phase 3 MVP 至少做到"不把密钥写入前端可见位置"，完整 secret 管理能力（如 keychain 集成）在 Phase 4/5 完善
- 敏感配置不提交到仓库

---

### M5：弹幕 / 外部输入接入（边界定义，本阶段暂不实施）

**目标**：定义外部输入适配器接口，实现至少一个真实平台的弹幕接入。

**与 Phase 3 的关系**：弹幕/外部输入属于 Phase 4"直播能力接线"范畴，本阶段仅做接口定义，不实施真实适配器。

**当前状态**：
- `ExternalInputService` 已实现：`injectEvent(RawExternalEvent)` → 标准化 → 事件总线
- `RawExternalEvent`：`{ source, type, data }`
- 事件类型已覆盖：`danmaku`、`gift`、`product-message`
- 目前只有 mock 注入（DevTools 和 ControlPanel 按钮）

**Phase 3 需要做的预备工作**：
1. 定义适配器接口 `IExternalInputAdapter`（不影响现有框架）：

```typescript
interface IExternalInputAdapter {
	readonly sourceId: string;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	onEvent(callback: (event: RawExternalEvent) => void): void;
	getStatus(): { connected: boolean; error?: string };
}
```

2. **Phase 4 再实施**：实现至少一个真实平台适配器（如 B 站直播弹幕），消费平台 WebSocket / API 并转换为 `RawExternalEvent`
3. 适配器注册到 `ExternalInputService`，与现有 `injectEvent` 路径复用
4. 在 ControlPanel 或 StatusBar 中显示外部输入源连接状态

**本阶段边界**：
- Phase 3 仅做接口定义，真实适配器在 Phase 4 实施
- 不做弹幕筛选/排队/去重
- 不做自动弹幕回复触发

---

### M6：HTTP 网络能力开通

**目标**：让前端代码能正常发送 HTTP 请求到外部 API。

**当前状态**：
- Tauri capabilities 中无 HTTP 权限
- `src` 中无 `fetch` / HTTP 客户端调用
- CSP 为 `null`（未限制）

**需要做的事**：
1. 评估 HTTP 请求路径（按服务类型选择）：
   - **本地/局域网服务（如自建 GPT-SoVITS）**：可接受前端直接 `fetch`，无密钥暴露风险
   - **云端服务（如 OpenAI API、Azure TTS）**：不应默认前端直连，API Key 会暴露在前端运行时内存中
     - 唯一可行路径：通过 Tauri Rust 侧代理（`src-tauri/` 实现 `invoke` 命令）转发请求，密钥仅存在于 Rust 侧
     - 不接受"构建期注入密钥"等伪隔离方案（密钥仍会存在于前端运行时内存）
   - **具体选型在 M6 实施前确认**，不预设默认方案
2. 确认 Tauri WebView 的 `fetch` 能力和 CORS 限制
3. 如选 Tauri Rust 代理：在 `src-tauri/` 中实现 `invoke` 命令，前端通过 `@tauri-apps/api/core` 调用
4. 添加必要的 Tauri capabilities 权限

---

## 3. 本阶段明确不做什么

| 不做的事 | 原因 |
|---------|------|
| ASR / 语音输入 | 属于 Phase 4 范围（直播能力接线与语音输入闭环） |
| VAD / 锁麦策略 | 依赖 ASR，属于 Phase 4 |
| 弹幕/外部输入真实接入 | 属于 Phase 4 范围（Phase 3 仅做接口定义） |
| 多平台弹幕适配 | Phase 4 范围 |
| 完整 RAG / 向量检索 | 当前阶段知识层走纯文本注入，完整 RAG 属于 Phase 5 |
| 知识管理 UI | 通过配置文件管理，Phase 5 再做 UI |
| 配置管理 UI（完整版） | 本阶段只做最小设置界面，完整配置 UI 属于 Phase 5 |
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
- 配置读取（从 ConfigService 获取 endpoint、model、key）

**范围外**：
- 多模型切换 UI（在配置文件中切换即可）
- Function calling 以外的 structured output
- 自建 LLM 推理服务部署
- Token 计数和费用统计
- 多轮对话摘要/历史压缩

### 4.2 真实 TTS 接入边界（GPT-SoVITS 优先）

**范围内**：
- 实现 `ITTSService` 的 GPT-SoVITS 版本（`GptSovitsTTSService`）
- GPT-SoVITS HTTP API 调用（`/tts`、`/set_gpt_weights`、`/set_sovits_weights`）
- 角色声线配置（权重路径、参考音频、prompt 文本）
- 支持配置读取（endpoint 等从 ConfigService 获取）
- 返回 WAV 格式音频（Web Audio API 可解码）

**范围外**：
- GPT-SoVITS 服务本身的部署和运维（视为外部依赖）
- 多声线实时切换 UI
- 流式 TTS（GPT-SoVITS 支持但本阶段不接入）
- 泛化 TTS provider 框架（先跑通 GPT-SoVITS，后续按需扩展）
- 情感化语音合成
- SSML 支持

### 4.3 弹幕 / 外部输入接入边界

> **注**：弹幕/外部输入属于 Phase 4 范围。Phase 3 仅做接口定义，真实适配器在 Phase 4 实施。

**Phase 3 范围内（仅接口定义）**：
- 适配器接口 `IExternalInputAdapter` 定义

**Phase 4 实施范围**：
- 1 个真实平台适配器实现
- 弹幕事件路由到事件总线
- 连接状态展示

**Phase 4 范围外**：
- 多平台同时接入
- 弹幕排队/去重/过滤
- 自动弹幕回复链路（弹幕 → LLM → TTS 自动触发）
- 弹幕展示 UI（覆盖在 Stage 上）
- 礼物特效

### 4.4 角色设定导入边界

**范围内**：
- SillyTavern 角色卡解析（JSON 格式，支持 `*.png` 内嵌或独立 JSON）
- 解析 `name`、`description`、`personality`、`first_mes` 等字段
- 角色卡定位为**外部导入格式**，内部数据结构按项目需求独立设计
- 解析后角色设定写入 `CharacterService`，供 LLM system prompt 使用

**范围外**：
- 角色卡在线编辑 UI
- 角色 Avatar 图像渲染（Live2D 模型切换除外）
- 多角色管理

### 4.5 知识 / 商品资料接入边界

**Phase 3 范围内（纯文本注入）**：
- `KnowledgeService.getAssembledContext()` 注入 LLM system prompt
- 通过 `external:product-message` 事件注入临时商品信息
- 通过配置文件加载初始长期知识

**Phase 5 范围**：
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
         交付：ConfigService + 本地 JSON 持久化 + 最小设置界面（可选首次启动引导）

Step 2: M6 — HTTP 网络能力开通
         确认 fetch 路径可用，排除网络层阻塞
         风险：低（验证性工作）
         交付：能从前端 fetch 到外部 API

Step 3: M1 — 真实 LLM 接入
         核心能力，需要配置和网络层就绪
         风险：中（涉及外部 API 调用、流式解析）
         交付：真实 LLM 回复替换 mock 预设文本

Step 4a: M3a — 角色设定导入（SillyTavern 角色卡）
         依赖 M1（M4 配置就绪后即可开始）
         风险：低（纯解析逻辑，无外部依赖）
         交付：角色卡解析器 + CharacterService 导入方法

Step 4b: M3b — 知识层与 LLM 串联
         依赖 M3a（角色设定就绪后）
         风险：低-中（主要是 prompt 工程）
         交付：LLM 回复能基于角色设定和知识上下文

Step 5: M2 — 真实 TTS 接入
         依赖配置和网络层，但与 LLM 相互独立
         风险：中（依赖外部 TTS 服务可用性）
         交付：真实语音替换正弦波音频

Step 6: M5 — 弹幕/外部输入接口定义
         仅做接口定义，真实适配器在 Phase 4 实施
         风险：低（接口设计不影响现有框架）
         交付：`IExternalInputAdapter` 接口定义完成

### 分批策略

**第一批（MVP 最小闭环）**：M4 → M6 → M1 → M3a → M3b → M2

完成后系统能做到：操作员输入文本 → 真实 LLM 基于角色设定和知识回复 → 真实 TTS 语音播放 → Live2D 口型同步。这已经是一个**可用于演示和内部测试的最小闭环**。

**第二批（Phase 4 预备）**：M5 接口定义（为 Phase 4 直播能力接线做好接口准备）

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

### 6.5 M3 — 角色设定导入与知识串联

**M3a — 角色设定导入**：
- [ ] 能导入 SillyTavern 角色卡 JSON 文件
- [ ] 正确解析 `name`、`description`、`personality`、`first_mes` 等字段
- [ ] 角色设定正确写入 `CharacterService`

**M3b — 知识串联**：
- [ ] 加载角色人设后，LLM 回复风格符合人设
- [ ] 通过 `injectEvent` 注入商品信息后，LLM 回复能引用该商品信息
- [ ] 临时上下文过期后，LLM 不再引用过期信息

### 6.6 M4 — 配置管理

- [ ] ConfigService 提供 `getConfig()` / `setConfig()` 接口
- [ ] 非敏感配置（endpoint、model 等）可在设置界面中修改并持久化
- [ ] 敏感配置（API Key）**不**写入前端环境变量、不作为普通 JSON 明文存储、不暴露在前端运行时
- [ ] 敏感配置至少采用最小可接受的本地安全存储方案（Tauri Rust 侧存储 / 系统 keychain）
- [ ] 应用在缺少必要配置时启动不 crash，给出清晰提示

### 6.7 M5 — 外部输入接口定义（本阶段仅做定义）

- [ ] `IExternalInputAdapter` 接口定义完整（connect/disconnect/onEvent/getStatus）
- [ ] 接口与现有 `ExternalInputService` 和 `injectEvent` 路径兼容
- [ ] 真实适配器实现不在本阶段范围内（Phase 4 实施）

### 6.8 M6 — 网络能力

- [ ] 本地/局域网服务（如自建 TTS）前端直连验证可行
- [ ] 云端服务（如需密钥的 LLM/TTS API）已验证不暴露密钥的调用路径（如 Tauri Rust 代理）
- [ ] 网络错误有合理的超时处理（至少有超时）

---

## 7. 风险点与回滚思路

### 7.1 风险清单

| 风险 | 影响 | 等级 | 缓解措施 |
|------|------|------|---------|
| LLM API 调用失败（网络、鉴权、限速） | 主链路中断 | 高 | 错误捕获 + 降级到 mock；配置验证；超时控制 |
| TTS 服务不可用或返回格式不兼容 | 无语音输出 | 中 | 格式检测 + 降级到 mock TTS；支持多种音频格式 |
| Tauri WebView fetch 被 CORS 阻断 | 无法调用外部 API | 中 | 提前验证；必要时走 Tauri Rust 代理 |
| API Key 泄露 | 安全问题 | 中 | 敏感配置不进入前端环境变量；不作为普通 JSON 明文存储；采用最小安全存储方案（Tauri Rust 侧 / keychain）；配置与 secret 不提交到仓库 |
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
| TTS 方案 | **GPT-SoVITS（已确认为首选）**，后续可扩展其他 provider | 已确认 |
| HTTP 路径 | 前端 fetch（本地/LAN）+ Tauri Rust 代理（云端） | **已确认并实施（M6）** |
| 弹幕平台 | B 站直播、抖音直播、其他 | M5 实施前 |
| 配置存储 | 本地 JSON（设置界面读写） | M4 实施时确认 |

---

## 9. 与后续阶段的关系

### 各阶段边界定义

| Phase | 名称 | 核心目标 |
|-------|------|---------|
| **Phase 3**（本 blueprint） | 真实服务接入与角色/知识基础 | 真实 LLM/TTS 替换 mock、设置界面+本地持久化配置、SillyTavern 角色卡导入、纯文本知识注入 |
| **Phase 4** | 直播能力接线与语音输入闭环 | 真实直播/外部输入源接入（弹幕等）、ASR 语音输入、VAD/锁麦策略、主播与外部输入的交互闭环 |
| **Phase 5** | 知识系统深化与产品化收口 | RAG/向量检索、知识管理 UI、商品资料管理体验、配置管理体验完善、打包安装引导、首次启动引导、性能优化 |

### Phase 3 完成后的系统能力

完成本阶段后，Paimon Live 将具备：
- 操作员输入文本 → 真实 AI 回复（基于角色人设） → 真实语音播出 → Live2D 口型同步
- AI 回复能基于角色设定和纯文本知识上下文
- 敏感配置安全存储，普通配置通过设置界面管理
- OBS 透明捕获仍然可用，急停/恢复仍然有效

### 尚未覆盖（后续阶段）

| 能力 | 建议阶段 |
|------|---------|
| ASR / 语音输入 | Phase 4 |
| VAD + 锁麦策略 | Phase 4 |
| 弹幕/外部输入真实接入 | Phase 4 |
| 多平台弹幕适配 | Phase 4 |
| 弹幕自动回复链路 | Phase 4 |
| 知识管理 UI | Phase 5 |
| 配置管理 UI（完整版） | Phase 5 |
| RAG / 向量检索 | Phase 5 |
| 流式 TTS（边合成边播放） | Phase 5 |
| Windows 安装包 | Phase 5 |
| 首次启动引导 | Phase 5 |
| 性能优化 | Phase 5 |

### 边界承诺

- Phase 3 不动 Stage / OBS / 多窗口方案
- Phase 3 不动 Live2DRenderer
- Phase 3 不动事件总线核心和 Runtime 门控机制
- Phase 3 的所有新增代码通过 `ILLMService` / `ITTSService` / `IExternalInputAdapter` 接口隔离，不侵入现有编排逻辑

> **Phase 3 close-out 说明**：Phase 3 已完成 close-out（详见 `dev-reports/phase3/run07/report.md`）。由于知识库 / RAG 能力已成为后续测试与集成的前置依赖，项目在 Phase 4 之前插入 Phase 3.5，作为计划执行中的补充阶段。原 Phase 5 路线图中"RAG / 向量检索"条目已移至 Phase 3.5 范围。

---

## 附录 A：替换点一览

| 替换点 | 当前实现 | 目标实现 | 文件位置 |
|--------|---------|---------|---------|
| LLM Provider | `MockLLMService` | `OpenAILLMService`（暂定） | `services/index.ts` |
| TTS Provider | `MockTTSService` | `GptSovitsTTSService` | `services/index.ts` |
| 角色设定导入 | 无 | `card-parser.ts` 解析 SillyTavern 角色卡 | `services/character/` |
| 知识注入 | 未串联 | `PipelineService` 或 `LLMService` 中组装 prompt | `services/pipeline/` 或 `services/llm/` |
| 外部输入 | `injectEvent` mock 调用 | Phase 4 实施，Phase 3 仅定义接口 | `services/external-input/` |

## 附录 B：预估新增文件

| 文件 | 用途 |
|------|------|
| `src/services/llm/openai-llm-service.ts` | 真实 LLM 实现 |
| `src/services/tts/gptsovits-tts-service.ts` | GPT-SoVITS TTS 实现 |
| `src/services/character/card-parser.ts` | SillyTavern 角色卡解析器 |
| `src/services/config/index.ts` | 配置管理服务（读写本地 JSON + 设置界面） |
| `src/features/settings/` | 设置界面组件（可选，先做在 ControlPanel 中） |

> **注**：`.env` / `vite-env.d.ts` 不作为本阶段配置方案组成部分，如未来确有非敏感开发期环境变量需求再补充。
> **注**：弹幕适配器目录 `src/services/external-input/adapters/` 属于 Phase 4 范围，Phase 3 不预估。

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
- `src/services/llm/index.ts` / `src/services/tts/index.ts`：新增导出

> **注**：如未来确有非敏感开发期环境变量需求，再补充 `vite-env.d.ts` 类型声明。
