# VoiceL2D-MVP 审计报告

> 审计目标：梳理旧项目 `VoiceL2D-MVP` 的核心能力、技术栈、架构特征与迁移可行性，为 Paimon Live 的后续 phase 提供依据。

---

## 1. 项目概述

VoiceL2D-MVP 是一个已验证的虚拟角色语音交互原型，由三个进程协作运行：

| 进程 | 技术 | 端口 | 职责 |
|------|------|------|------|
| 前端 | React 19 + Vite 7 + pixi.js 6 + pixi-live2d-display | 7788 | Live2D 渲染、UI 面板、SSE/WebSocket 接收 |
| MCP 服务 | Python FastMCP (HTTP) | 8848 | LLM 工具调用桥：接收 MCP tool call → HTTP 请求前端 API |
| 语音客户端 | Python asyncio | 7789 (WebSocket) | 语音采集 → VAD → ASR → LLM → TTS → WebSocket 推送 |

启动顺序：前端 → MCP 服务 → 语音客户端。

---

## 2. 已验证的核心能力

### 2.1 语音输入链路

- **音频采集**：`sounddevice` 录音，48kHz 单声道
- **VAD**：`webrtcvad`（可调 aggressiveness 1-3），检测语音段起止
- **ASR**：
  - 云端：SiliconFlow SenseVoiceSmall API（HTTP POST）
  - 本地：faster-whisper + CUDA（可选依赖）
- **锁麦策略**：TTS 播放期间暂停 VAD，防止回声自触发

### 2.2 LLM 对话

- 使用 OpenAI 兼容客户端调用智谱 GLM-4-Flash
- 支持 system prompt 注入（角色人设 markdown 文件）
- 支持工具调用（MCP tools → OpenAI function calling 格式转换）
- 对话历史在内存中维护

### 2.3 TTS 语音合成

- 调用外部 GPT-SoVITS 服务（HTTP API）
- 每个角色绑定独立的 TTS 权重路径、参考音频、提示文本
- 合成结果为 WAV，通过 WebSocket 以 base64 推送到前端播放

### 2.4 表情与动作触发

- LLM 通过 MCP tool call 触发 `play_expression(emotion)`
- MCP 服务将情绪映射到模型特定的表情资源名（`expression_mapping.json`）
- 通过 HTTP POST 调用前端 Vite 中间件 API → SSE 广播到前端
- 支持的情绪类型：angry / neutral / happy / sad / surprise / speechless

### 2.5 Live2D 渲染

- 渲染栈：PIXI.js 6 + pixi-live2d-display（Cubism4）
- 口型同步：Web Audio AnalyserNode 分析播放音频 → ParamMouthOpenY 参数驱动
- 支持多个模型切换（Resources 目录扫描）
- 模型资源：model3.json / cdi3.json / physics3.json / motions / expressions

### 2.6 前端通信

- **WebSocket（7789）**：Python 客户端 → 前端，承载音频数据、用户/AI 消息、状态同步、角色列表、playback 控制
- **SSE（/api/live2d/events）**：Vite 中间件 → 前端，承载 Live2D 动作/表情/模型切换事件
- **HTTP API（/api/live2d/*）**：MCP → Vite 中间件，驱动表情/动作

### 2.7 配置与角色管理

- `config.toml`：集中配置 LLM/ASR/MCP/WebSocket/VAD/音频参数
- `charas.toml`：角色人设路径 + TTS 声线配置绑定
- `characters/*.md`：角色人设文本（Paimon、XiangLing、Sucrose 等）

---

## 3. 技术栈明细

### 3.1 Python 依赖（pyproject.toml）

| 依赖 | 用途 | 迁移难度 |
|------|------|----------|
| fastmcp | MCP 服务框架 | 中 — 需评估 TS MCP SDK 成熟度 |
| openai | LLM API 客户端 | 低 — TS openai SDK 完全对等 |
| websockets | WebSocket 服务端 | 低 — Tauri 内可用原生 WebSocket |
| sounddevice | 音频采集 | 中 — 浏览器 Web Audio API 或 Tauri 插件 |
| simpleaudio | 音频播放 | 低 — 前端 Web Audio 已实现 |
| webrtcvad | 语音活动检测 | 中 — 需找 TS/WASM 替代或保留 Python |
| numpy | 音频数据处理 | 低 — TypedArray 可替代基本操作 |
| requests | HTTP 客户端 | 低 — fetch 原生支持 |
| toml | 配置解析 | 低 — TS 有 toml 解析库 |
| loguru | 日志 | 低 — 自建日志服务 |
| faster-whisper（可选） | 本地 ASR | 高 — 强依赖 Python + CUDA |
| torch（可选） | 本地推理运行时 | 高 — 无法迁移到 TS |

### 3.2 前端依赖（package.json）

| 依赖 | 用途 | 保留判断 |
|------|------|----------|
| react / react-dom | UI 框架 | 保留 |
| pixi.js 6 | 2D 渲染引擎 | 保留 |
| pixi-live2d-display | Live2D Cubism4 渲染 | 保留 |
| tailwindcss 相关 | 样式 | 按需引入 |
| lucide-react | 图标 | 按需引入 |

### 3.3 外部服务

| 服务 | 提供方 | 通信方式 |
|------|--------|----------|
| LLM | 智谱 GLM-4-Flash | HTTPS（OpenAI 兼容） |
| ASR（云） | SiliconFlow SenseVoice | HTTPS |
| TTS | GPT-SoVITS（自建） | HTTP |

---

## 4. 架构分析

### 4.1 当前架构特征

```
用户语音 → [Python 客户端] → VAD → ASR → LLM → TTS
                                         ↓ (tool call)
                                    [MCP 服务]
                                         ↓ (HTTP)
                                  [Vite 中间件 API]
                                         ↓ (SSE)
                                    [前端 React]
                                         ↓
                                   Live2D 渲染
```

- **三进程架构**：前端、MCP 服务、语音客户端各自独立启动
- **双通道通信**：WebSocket（音频/对话）+ SSE（Live2D 事件），两条链路独立
- **Vite 中间件充当后端**：Live2D API 仅在 Vite dev server 中存在，生产部署需要额外处理

### 4.2 架构痛点

1. **三进程耦合**：启动顺序有依赖，任一进程挂掉整体不可用，用户需手动启动三个进程
2. **Vite 中间件不可用于生产**：Live2D 控制 API 内嵌于 Vite 开发服务器插件，打包后不存在
3. **配置路径硬编码**：TTS 权重路径为 Linux 绝对路径，WebSocket 端口、前端 URL 分散在多处硬编码
4. **双通道复杂度**：WebSocket 和 SSE 两套实时通信并存，角色状态分裂在两条链路上
5. **前端巨组件**：`Live2DComponent.tsx` 超过 1000 行，承载了渲染、音频、WebSocket、SSE、UI 面板等全部职责
6. **无统一状态管理**：角色状态分散在前端组件 ref、Python 内存、MCP 服务三处
7. **无错误恢复**：WebSocket 仅有基础指数退避重连，缺乏系统级健康检测
8. **无紧急停止**：缺乏一键停止或人工接管机制

### 4.3 可迁移的设计决策

1. **OpenAI 兼容 API 模式**：LLM 调用已抽象为标准接口，切换模型只需改配置
2. **MCP 工具调用模式**：通过 tool call 驱动角色行为的思路可沿用
3. **表情映射分离**：情绪 → 模型表情的映射独立于代码，便于扩展
4. **口型同步方案**：Web Audio AnalyserNode 驱动 Live2D 参数的方案成熟可复用
5. **角色人设配置化**：markdown 人设 + TOML 配置的方式清晰可维护

---

## 5. 迁移可行性评估

### 5.1 可直接用 TypeScript 重写（低风险）

| 能力 | 说明 |
|------|------|
| LLM API 调用 | openai TS SDK 完全对等，流式响应支持良好 |
| 云端 ASR 调用 | 标准 HTTP POST，fetch 即可 |
| TTS API 调用 | 标准 HTTP POST，fetch 即可 |
| 配置加载 | toml 解析、JSON 配置均有成熟 TS 库 |
| WebSocket 服务 | 在 Tauri 架构下可用进程内事件替代，不再需要独立 WS 服务 |
| 对话历史管理 | 纯数据结构操作 |
| 表情映射 | JSON 数据，已独立于代码 |
| 日志系统 | 自建即可 |

### 5.2 需要适配但可行（中风险）

| 能力 | 说明 |
|------|------|
| 音频采集 | 浏览器 Web Audio API 或 Tauri 音频插件 |
| VAD | 需寻找 TS/WASM 实现（如 @ricky0123/vad-web）或保留 Python 子进程 |
| MCP 工具协议 | 需评估 TS MCP SDK 对 HTTP transport 的支持 |
| Live2D 控制 API | 从 Vite 中间件迁移到 Tauri 进程内通信 |

### 5.3 需保留 Python 或特殊处理（高风险）

| 能力 | 说明 |
|------|------|
| 本地 ASR（faster-whisper） | 强依赖 Python + CUDA/torch，无法迁移到 TS |
| GPT-SoVITS TTS 服务 | 独立部署的 Python 服务，Paimon Live 只需调 HTTP API 即可 |

### 5.4 迁移总结

旧项目中约 **80% 的 Python 代码**可用 TypeScript 重写，核心阻碍仅在于本地 ASR（faster-whisper + torch）。考虑到默认使用云端 ASR，本地 ASR 可作为后续可选功能单独处理。

GPT-SoVITS 作为外部 TTS 服务独立运行，不属于 Paimon Live 的进程边界，只需保证 HTTP 调用接口兼容即可。

---

## 6. 关键决策建议

1. **合并三进程为单一 Tauri 应用**：语音客户端和 MCP 桥的职责全部收入 TypeScript 业务层
2. **用进程内事件替代 WebSocket/SSE**：Tauri 的 IPC + TypeScript 事件总线取代跨进程通信
3. **拆分巨组件**：将 Live2DComponent 的职责分拆到 features/live2d、services/audio、services/event-bus
4. **引入统一状态管理**：角色状态、系统状态集中管理，避免多源分裂
5. **保留云端 ASR 作为默认路径**：本地 ASR 作为可选高级功能延后处理
6. **保留表情映射数据结构**：可直接复用 `expression_mapping.json` 的设计
7. **保留角色人设配置方式**：markdown 人设 + 结构化配置的模式可沿用
