# Paimon Live — 模块设计

---

## 1. 模块总览

```
src/
├── services/            # 核心业务逻辑（无 UI 依赖）
│   ├── event-bus/       # 事件总线
│   ├── llm/             # LLM 对接
│   ├── audio/           # 音频管线
│   ├── character/       # 角色状态管理
│   └── logger/          # 日志与调试
│
├── features/            # UI 功能模块（含组件与业务 Hook）
│   ├── live2d/          # Live2D 角色渲染
│   ├── chat/            # 对话面板
│   ├── control-panel/   # 控制台与监控
│   └── stage/           # OBS 舞台窗口
│
├── components/          # 共享 UI 组件
├── hooks/               # 通用 Hook
├── types/               # 共享类型
└── utils/               # 工具函数
```

核心原则：**services 不依赖 React**，可独立测试；**features 依赖 services**，通过 Hook 桥接。

---

## 2. Services 层模块

### 2.1 event-bus — 事件总线

**职责：** 模块间解耦通信的核心枢纽。

| 属性 | 说明 |
|------|------|
| 输入 | 任意模块发布的事件 |
| 输出 | 订阅方收到的事件回调 |
| 依赖 | 无（零依赖，最底层模块） |
| 状态 | 订阅者注册表 |

**核心能力：**
- 类型安全的事件发布 / 订阅（TypeScript 泛型约束事件类型）
- 同步与异步事件处理
- 事件历史追踪（供日志/调试用）
- 订阅者生命周期管理（自动清理）

**事件类型分类：**
- 音频事件：`audio:vad-start`、`audio:vad-end`、`audio:asr-result`、`audio:tts-start`、`audio:tts-end`
- LLM 事件：`llm:request-start`、`llm:stream-chunk`、`llm:response-end`、`llm:tool-call`
- 角色事件：`character:expression`、`character:motion`、`character:state-change`
- 系统事件：`system:error`、`system:emergency-stop`、`system:resume`
- 外部事件：`external:danmaku`、`external:gift`、`external:product-message`

---

### 2.2 llm — LLM 对接

**职责：** 管理与大语言模型的通信、对话上下文和工具调用。

| 属性 | 说明 |
|------|------|
| 输入 | 用户文本（来自 ASR 或手动输入）、系统提示、工具定义 |
| 输出 | AI 回复文本、工具调用指令 |
| 依赖 | event-bus、character（获取角色人设） |
| 状态 | 对话历史、请求状态、可用工具列表 |

**核心能力：**
- OpenAI 兼容 API 调用（Chat Completions）
- 流式响应处理（SSE 解析）
- System Prompt 构建（角色人设 + 知识注入）
- Function Calling / Tool Use 解析与分发
- 对话历史管理（窗口大小控制、token 计数）
- 知识接入预留：
  - 长期知识注入（角色设定、FAQ、商品基础资料）
  - 临时高优先级消息插入（当前主推商品、库存变化），优先级高于长期知识

**与事件总线的交互：**
- 订阅 `audio:asr-result` → 触发 LLM 请求
- 发布 `llm:stream-chunk` → 通知 UI 更新
- 发布 `llm:tool-call` → 触发角色行为
- 发布 `llm:response-end` → 触发 TTS

---

### 2.3 audio — 音频管线

**职责：** 管理完整的音频输入输出链路。

| 属性 | 说明 |
|------|------|
| 输入 | 麦克风音频流、TTS 返回的音频数据 |
| 输出 | ASR 识别文本、音频播放 |
| 依赖 | event-bus |
| 状态 | 录音状态、VAD 状态、播放队列、锁麦状态 |

**核心能力：**
- 麦克风音频采集（Web Audio API / MediaStream）
- VAD 语音活动检测
- ASR API 调用（将音频段发送到云端识别）
- TTS API 调用（将文本发送到 GPT-SoVITS 合成）
- 音频播放管理（播放队列、口型数据提取）
- 锁麦策略（TTS 播放期间暂停 VAD，防止回声）

**子模块划分（建议）：**
- `recorder.ts` — 麦克风采集与 VAD
- `asr.ts` — ASR 服务调用
- `tts.ts` — TTS 服务调用
- `player.ts` — 音频播放与口型数据

---

### 2.4 character — 角色状态管理

**职责：** 集中管理角色人设、状态与行为映射。

| 属性 | 说明 |
|------|------|
| 输入 | 角色配置文件、LLM 工具调用指令 |
| 输出 | 当前角色状态、表情/动作指令 |
| 依赖 | event-bus |
| 状态 | 当前角色、情绪状态、活跃模型、表情映射表 |

**核心能力：**
- 角色配置加载（人设 markdown + 结构化配置）
- 角色切换
- 情绪 → 表情/动作映射（复用旧项目 expression_mapping 设计）
- 角色状态维护（当前情绪、是否在说话、空闲状态等）
- 为 LLM 提供角色上下文（system prompt 片段）

**与事件总线的交互：**
- 订阅 `llm:tool-call` → 解析表情/动作指令 → 更新状态
- 发布 `character:expression` / `character:motion` → 通知 Live2D 渲染
- 发布 `character:state-change` → 通知控制面板

---

### 2.5 logger — 日志与调试

**职责：** 提供统一的日志接口和调试数据源。

| 属性 | 说明 |
|------|------|
| 输入 | 各模块的日志调用 |
| 输出 | 控制台输出、文件输出、UI 调试面板数据 |
| 依赖 | 无（可选依赖 event-bus 用于事件追踪） |
| 状态 | 日志缓冲区、日志级别配置 |

**核心能力：**
- 分级日志（debug / info / warn / error）
- 多输出目标（浏览器控制台、Tauri 文件写入、内存缓冲供 UI 读取）
- 结构化日志（时间戳、模块名、级别）
- 事件流追踪（记录关键事件的时序）

---

## 3. Features 层模块

### 3.1 live2d — Live2D 角色渲染

**职责：** 管理 Live2D 模型的加载、渲染和状态驱动。

| 属性 | 说明 |
|------|------|
| 依赖 services | event-bus、character、audio（口型数据） |
| 内部组件 | Live2D 画布组件、模型加载器 |
| 对外接口 | React 组件（供控制面板预览和 stage 窗口使用） |

**核心能力：**
- PIXI.js + pixi-live2d-display 初始化
- Live2D Cubism Core 加载
- 模型加载与切换
- 表情/动作播放（响应 character 事件）
- 口型同步（响应 audio 播放数据）
- 画布尺寸自适应

### 3.2 chat — 对话面板

**职责：** 对话消息展示与用户输入。

| 属性 | 说明 |
|------|------|
| 依赖 services | event-bus、llm |
| 内部组件 | 消息列表、输入框、状态指示器 |

### 3.3 control-panel — 控制台与监控

**职责：** 系统运行状态监控和手动操控。

| 属性 | 说明 |
|------|------|
| 依赖 services | event-bus、character、audio、llm、logger |
| 内部组件 | 状态仪表盘、手动控制面板、配置面板、日志查看器 |

**核心能力：**
- 各服务连接状态显示
- 手动触发表情/动作
- 紧急停止 / 恢复按钮
- 角色 / 模型切换
- 音频设备选择
- 日志实时查看

### 3.4 stage — OBS 舞台窗口

**职责：** 透明背景的 Live2D 角色输出窗口。

| 属性 | 说明 |
|------|------|
| 依赖 services | event-bus、character |
| 依赖 features | live2d（共享渲染组件） |

**核心能力：**
- 透明背景渲染
- 角色状态与主窗口同步
- 可选字幕叠加
- 无 UI 控件

---

## 4. 模块间通信方式

### 4.1 设计原则

- services 之间通过 **事件总线** 通信，不直接互相调用
- features 通过 **自定义 Hook** 订阅 services 的状态和事件
- 例外：llm 可直接调用 character 获取角色人设（同步数据读取，非事件）

### 4.2 通信矩阵

| 发送方 | 接收方 | 通信方式 | 说明 |
|--------|--------|----------|------|
| audio | llm | 事件总线 | ASR 结果触发 LLM 请求 |
| llm | audio | 事件总线 | LLM 回复触发 TTS |
| llm | character | 事件总线 | 工具调用触发表情/动作 |
| character | live2d | 事件总线 | 状态变化驱动渲染 |
| audio | live2d | 事件总线 | 口型数据驱动嘴型参数 |
| 各模块 | logger | 直接调用 | 日志记录 |
| 各模块 | control-panel | 事件总线 | 状态变化通知 |

### 4.3 React 桥接

每个 service 模块提供对应的 Hook：

- `useEventBus()` — 订阅/发布事件
- `useLLM()` — 获取对话状态、发送消息
- `useAudio()` — 获取音频状态、控制录音/播放
- `useCharacter()` — 获取角色状态、切换角色
- `useLogger()` — 获取日志数据

---

## 5. 模块状态归属

| 状态 | 归属模块 | 说明 |
|------|----------|------|
| 对话历史 | llm | 消息列表、pending 状态 |
| 录音状态 | audio | 是否在录音、VAD 是否激活 |
| 播放状态 | audio | 当前播放队列、口型数据 |
| 锁麦状态 | audio | TTS 播放期间的 VAD 暂停 |
| 当前角色 | character | 角色 ID、人设、语音配置 |
| 角色情绪 | character | 当前情绪标签 |
| 表情映射 | character | 情绪 → 表情资源的映射表 |
| 活跃模型 | character | 当前 Live2D 模型标识 |
| 服务状态 | 各自 service | 连接状态、错误信息 |
| UI 状态 | React 组件 | 面板展开/折叠、选中项等 |
