# Paimon Live — 模块设计

---

## 1. 模块总览

```
src/
├── services/            # 核心业务逻辑（无 UI 依赖）
│   ├── runtime/         # 运行时控制器（全局状态与编排）
│   ├── event-bus/       # 事件总线
│   ├── llm/             # LLM 对接
│   ├── audio/           # 音频管线
│   ├── character/       # 角色状态管理（权威真源）
│   ├── knowledge/       # 知识与上下文层
│   ├── external-input/  # 外部事件标准化接入
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

### 2.1 runtime — 运行时控制器

**职责：** 管理系统全局运行状态，协调各模块的行为权限。

事件总线负责"发生了什么"，运行时控制器负责"当前允许系统怎么动"。

| 属性 | 说明 |
|------|------|
| 输入 | 来自控制面板的操作指令、全局快捷键、系统事件 |
| 输出 | 运行模式变更通知、各模块行为许可/禁止信号 |
| 依赖 | event-bus |
| 状态 | 当前运行模式、急停状态、人工接管状态、锁麦状态 |

**核心能力：**
- 全局运行状态管理（正常 / 急停 / 人工接管 / 暂停）
- 串行处理规则——同一时间只处理一个用户输入，前一轮完成后才接受下一轮
- 锁麦 / 解锁协调（通知 audio 模块暂停/恢复 VAD）
- 急停 / 恢复：中断所有进行中的 TTS、LLM 请求和音频采集
- 人工接管优先级：人工输入优先于自动链路
- 自动链路与人工链路之间的切换协调
- 决定当前是否允许继续自动播报、响应事件

**运行模式：**

| 模式 | 说明 |
|------|------|
| `auto` | 正常自动运行，语音链路全自动 |
| `manual` | 人工接管，自动链路暂停，操作员手动控制 |
| `stopped` | 急停状态，一切活动中断 |
| `paused` | 暂停状态，不接受新输入但不中断当前播放 |

**与事件总线的交互：**
- 订阅 `system:emergency-stop` → 切换到 stopped 模式
- 订阅 `system:resume` → 恢复到 auto 模式
- 发布 `runtime:mode-change` → 通知所有模块当前运行模式
- 其他模块在执行关键操作前，应检查 runtime 当前是否允许

**分阶段实现说明：**

上述为完整 runtime 设计目标。各阶段实现的最小子集如下：

| Phase | 实现范围 |
|-------|---------|
| Phase 1 | 仅 auto / stopped 两个模式切换、模式变更通知、`isAllowed()` 门控查询 |
| Phase 2+ | manual 模式、paused 模式 |
| Phase 3+ | 完整急停/恢复协调、人工接管流程、串行处理规则、锁麦协调 |

---

### 2.2 event-bus — 事件总线

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
- 事件历史追踪（供日志/调试用，但高频数据可豁免）
- 订阅者生命周期管理（自动清理）

**事件类型分类：**
- 运行时事件：`runtime:mode-change`
- 音频事件：`audio:vad-start`、`audio:vad-end`、`audio:asr-result`、`audio:tts-start`、`audio:tts-end`
- LLM 事件：`llm:request-start`、`llm:stream-chunk`、`llm:response-end`、`llm:tool-call`
- 角色事件：`character:expression`、`character:motion`、`character:state-change`
- 系统事件：`system:error`、`system:emergency-stop`、`system:resume`
- 外部事件：`external:danmaku`、`external:gift`、`external:product-message`

**关于高频数据（口型数据）的说明：**

口型驱动数据（`audio:mouth-data`）是高频流，更新频率远高于普通业务事件。在实现层面应保留差异化处理空间：
- 可走专门通道或局部消费路径，不做全局广播
- 不应被日志流、调试面板、事件追踪记录刷满
- 抽象上可统一命名，但实现上需注意性能

---

### 2.3 llm — LLM 对接

**职责：** 管理与大语言模型的通信、对话上下文和工具调用。

| 属性 | 说明 |
|------|------|
| 输入 | 用户文本（来自 ASR 或手动输入）、系统提示、工具定义 |
| 输出 | AI 回复文本、工具调用指令 |
| 依赖 | event-bus、character（获取角色人设）、knowledge（获取知识上下文）、runtime（检查运行模式） |
| 状态 | 对话历史、请求状态、可用工具列表 |

**核心能力：**
- OpenAI 兼容 API 调用（Chat Completions）
- 流式响应处理（SSE 解析）
- System Prompt 构建（从 character 获取角色人设，从 knowledge 获取知识上下文）
- Function Calling / Tool Use 解析与分发
- 对话历史管理（窗口大小控制、token 计数）
- 在执行请求前检查 runtime 当前模式是否允许

**边界澄清：**
- LLM 模块**不负责**知识管理和商品消息排序——这是 knowledge 模块的职责
- LLM 模块从 knowledge 模块获取已组装好的上下文片段，拼接到 prompt 中
- LLM 模块**不负责**外部事件的接入和标准化——这是 external-input 模块的职责

**与事件总线的交互：**
- 订阅 `audio:asr-result` → 触发 LLM 请求（需先检查 runtime 模式）
- 发布 `llm:stream-chunk` → 通知 UI 更新
- 发布 `llm:tool-call` → 触发角色行为
- 发布 `llm:response-end` → 触发 TTS

---

### 2.4 audio — 音频管线

**职责：** 管理完整的音频输入输出链路。

| 属性 | 说明 |
|------|------|
| 输入 | 麦克风音频流、TTS 返回的音频数据 |
| 输出 | ASR 识别文本、音频播放、口型驱动数据 |
| 依赖 | event-bus、runtime（锁麦指令、运行模式检查） |
| 状态 | 录音状态、VAD 状态、播放队列、锁麦状态 |

**核心能力：**
- 麦克风音频采集（Web Audio API / MediaStream）
- VAD 语音活动检测
- ASR API 调用（将音频段发送到云端识别）
- TTS API 调用（将文本发送到 GPT-SoVITS 合成）
- 音频播放管理（播放队列）
- 口型数据提取（高频，走专门通道，不与普通业务事件混同）
- 锁麦策略（TTS 播放期间暂停 VAD，防止回声）
- 在采集/播放前检查 runtime 当前模式

**子模块划分（建议）：**
- `recorder.ts` — 麦克风采集与 VAD
- `asr.ts` — ASR 服务调用
- `tts.ts` — TTS 服务调用
- `player.ts` — 音频播放与口型数据

---

### 2.5 character — 角色状态管理（权威真源）

**职责：** 集中管理角色人设、状态与行为映射。本模块是角色状态的**唯一权威真源**。

| 属性 | 说明 |
|------|------|
| 输入 | 角色配置文件、LLM 工具调用指令 |
| 输出 | 当前角色状态、表情/动作指令 |
| 依赖 | event-bus |
| 状态 | 当前角色、情绪状态、活跃模型、说话状态、表情映射表 |

**核心能力：**
- 角色配置加载（人设 markdown + 结构化配置）
- 角色切换
- 情绪 → 表情/动作映射（复用旧项目 expression_mapping 设计）
- 角色状态维护（当前情绪、是否在说话、空闲状态等）
- 为 LLM 提供角色上下文（system prompt 片段）

**状态真源原则：**
- 所有需要角色状态的模块（live2d、stage、control-panel）都从本模块获取
- 主控界面预览窗口和 OBS 舞台窗口基于同一状态渲染，确保一致性
- 不允许其他模块维护独立的角色状态副本

**与事件总线的交互：**
- 订阅 `llm:tool-call` → 解析表情/动作指令 → 更新状态
- 发布 `character:expression` / `character:motion` → 通知 Live2D 渲染
- 发布 `character:state-change` → 通知控制面板和所有依赖方

---

### 2.6 knowledge — 知识与上下文层

**职责：** 管理 LLM 所需的知识上下文，区分长期知识与临时高优先级直播上下文。

| 属性 | 说明 |
|------|------|
| 输入 | 长期知识文档、临时商品/活动消息、配置更新 |
| 输出 | 已组装的上下文片段（供 LLM 拼接到 prompt） |
| 依赖 | event-bus |
| 状态 | 长期知识索引、当前活跃的临时上下文列表 |

**核心能力：**
- 长期知识管理（角色设定、品牌信息、商品基础资料、FAQ、直播规则）
- 临时高优先级上下文管理（当前主推商品、活动话术、优惠信息、库存提醒、临时禁说词）
- 上下文组装——按优先级排序后输出给 LLM 模块
- 临时上下文的时效管理（过期自动移除）
- 预留未来 RAG 检索接口（当前阶段不实现）

**设计要求：**
- 临时高优先级上下文（Live Context）的优先级**高于**长期知识
- 不要把商品消息简单等同为普通知识库文档写入
- LLM 模块不独自承担知识层职责——知识的管理、排序、组装由本模块负责
- 当前阶段只需定义边界和接口，不要求实现完整 RAG

**与事件总线的交互：**
- 订阅 `external:product-message` → 更新临时上下文
- 提供同步接口供 LLM 调用获取当前上下文

---

### 2.7 external-input — 外部事件标准化接入

**职责：** 接收、标准化和转发来自外部来源的事件。

| 属性 | 说明 |
|------|------|
| 输入 | 外部来源的原始事件（弹幕、礼物、商品切换、调试注入等） |
| 输出 | 标准化后的内部事件 |
| 依赖 | event-bus |
| 状态 | 各外部源的连接状态 |

**核心能力：**
- 接收外部来源的事件（直播平台弹幕、礼物、商品消息、运营台指令、测试脚本注入等）
- 标准化为统一的内部事件格式
- 为日志、调试、回放提供留痕
- 与商品消息 / 平台事件解耦——本模块只做接入和标准化，不做业务处理

**为什么需要独立模块：**
- 外部输入来源多样，未来可能包括直播平台 API、运营台、本地调试工具等
- 如果把接入逻辑零散塞进 LLM、control-panel、character 等模块，会导致耦合混乱
- 独立模块便于为每种外部来源编写适配器，统一管理连接状态

**与事件总线的交互：**
- 发布 `external:danmaku` / `external:gift` / `external:product-message` 等标准化事件
- 其他模块（llm、knowledge、control-panel）按需订阅

---

### 2.8 logger — 日志与调试

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
- 事件流追踪（记录关键事件的时序，但高频口型数据除外）

---

## 3. Features 层模块

### 3.1 live2d — Live2D 角色渲染

**职责：** 管理 Live2D 模型的加载、渲染和状态驱动。

| 属性 | 说明 |
|------|------|
| 依赖 services | event-bus、character（状态真源）、audio（口型数据） |
| 内部组件 | Live2D 画布组件、模型加载器 |
| 对外接口 | React 组件（供控制面板预览和 stage 窗口使用） |

**核心能力：**
- PIXI.js + pixi-live2d-display 初始化
- Live2D Cubism Core 加载
- 模型加载与切换
- 表情/动作播放（响应 character 状态变化）
- 口型同步（消费 audio 模块的口型数据流）
- 画布尺寸自适应

**双窗口渲染说明：**
- 主控预览和 OBS 舞台窗口各自拥有独立的 Live2D 渲染实例
- 两者基于 character 模块的同一状态真源进行同步渲染
- 不是共享同一个 renderer 对象

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
| 依赖 services | event-bus、runtime、character、audio、llm、logger |
| 内部组件 | 状态仪表盘、手动控制面板、配置面板、日志查看器 |

**核心能力：**
- 各服务连接状态显示
- 手动触发表情/动作
- 急停 / 恢复按钮（通过 runtime 控制）
- 人工接管切换（通过 runtime 控制）
- 角色 / 模型切换
- 音频设备选择
- 日志实时查看

### 3.4 stage — OBS 舞台窗口

**职责：** 透明背景的 Live2D 角色输出窗口。

| 属性 | 说明 |
|------|------|
| 依赖 services | event-bus、character（状态真源） |
| 依赖 features | live2d（共享渲染组件定义，但各自有独立实例） |

**核心能力：**
- 透明背景渲染
- 基于 character 状态真源同步渲染（与主窗口一致）
- 可选字幕叠加
- 无 UI 控件

---

## 4. 模块间通信方式

### 4.1 设计原则

- services 之间通过 **事件总线** 通信，不直接互相调用
- 例外：llm 可同步调用 character 和 knowledge 获取数据（读操作，非事件）
- 例外：各模块可同步调用 runtime 检查当前运行模式
- features 通过 **自定义 Hook** 订阅 services 的状态和事件
- 高频口型数据走**专门通道**，不与普通事件总线混同

### 4.2 通信矩阵

| 发送方 | 接收方 | 通信方式 | 说明 |
|--------|--------|----------|------|
| audio | llm | 事件总线 | ASR 结果触发 LLM 请求 |
| llm | audio | 事件总线 | LLM 回复触发 TTS |
| llm | character | 事件总线 | 工具调用触发表情/动作 |
| character | live2d / stage | 事件总线 | 状态变化驱动渲染 |
| audio | live2d | 专门通道 | 口型数据驱动嘴型参数（高频） |
| external-input | event-bus | 事件总线 | 标准化外部事件 |
| external-input → knowledge | 事件总线 | 商品消息更新上下文 |
| runtime | 各模块 | 事件总线 | 运行模式变更通知 |
| 各模块 | runtime | 同步调用 | 执行前检查运行模式 |
| llm | knowledge | 同步调用 | 获取当前知识上下文 |
| 各模块 | logger | 直接调用 | 日志记录 |

### 4.3 React 桥接

**原则：** Hook 是 service 状态到 React 响应式 UI 的单向桥接，不是业务逻辑的容器。业务状态归属 service，Hook 只做订阅和转发。如果引入 Zustand 等 React 状态库，其职责仅限于 UI 层状态和桥接层，不承载核心业务逻辑。

每个 service 模块提供对应的 Hook：

- `useRuntime()` — 获取运行模式、急停/恢复操作
- `useEventBus()` — 订阅/发布事件
- `useLLM()` — 获取对话状态、发送消息
- `useAudio()` — 获取音频状态、控制录音/播放
- `useCharacter()` — 获取角色状态、切换角色
- `useKnowledge()` — 获取知识状态（控制面板用）
- `useLogger()` — 获取日志数据

---

## 5. 模块状态归属

| 状态 | 归属模块 | 说明 |
|------|----------|------|
| 运行模式 | runtime | auto / manual / stopped / paused |
| 急停状态 | runtime | 是否处于急停 |
| 人工接管 | runtime | 是否人工接管中 |
| 对话历史 | llm | 消息列表、pending 状态 |
| 录音状态 | audio | 是否在录音、VAD 是否激活 |
| 播放状态 | audio | 当前播放队列、口型数据 |
| 锁麦状态 | audio | TTS 播放期间的 VAD 暂停 |
| 当前角色 | character | 角色 ID、人设、语音配置（权威真源） |
| 角色情绪 | character | 当前情绪标签（权威真源） |
| 表情映射 | character | 情绪 → 表情资源的映射表 |
| 活跃模型 | character | 当前 Live2D 模型标识（权威真源） |
| 长期知识 | knowledge | 知识文档索引 |
| 临时上下文 | knowledge | 当前活跃的高优先级消息列表 |
| 外部源状态 | external-input | 各外部源连接状态 |
| 服务状态 | 各自 service | 连接状态、错误信息 |
| UI 状态 | React 组件 | 面板展开/折叠、选中项等 |
