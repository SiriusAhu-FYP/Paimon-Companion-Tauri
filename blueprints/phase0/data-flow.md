# Paimon Live — 数据流与事件流设计

---

## 1. 主链路数据流

主链路是系统最核心的数据通路：**用户语音 → AI 回复 → 角色反馈**。

运行时控制器（runtime）在链路中充当门控角色——任何关键操作执行前，都需要检查 runtime 当前是否允许。

### 1.1 完整主链路

```
用户说话
  │
  ▼
[audio] 麦克风采集
  │  ← runtime 检查：当前模式是否允许采集
  ▼
[audio] VAD 检测语音段起止
  │  发布 audio:vad-end (音频段数据)
  ▼
[audio] ASR 云端识别
  │  发布 audio:asr-result (识别文本)
  ▼
[runtime] 门控检查：当前是否允许自动处理
  │  （急停/人工接管/暂停时拦截）
  ▼
[llm] 构建请求
  │  ← 从 character 获取角色人设
  │  ← 从 knowledge 获取知识上下文（长期 + 临时高优先级）
  │  发布 llm:request-start
  ▼
[llm] 调用 LLM API (流式)
  │  发布 llm:stream-chunk (逐段文本)
  │
  ├──→ 检测到 tool call ──→ 发布 llm:tool-call
  │                              │
  │                              ▼
  │                        [character] 解析表情/动作指令
  │                              │  更新角色状态（权威真源）
  │                              │  发布 character:expression
  │                              │  发布 character:motion
  │                              ▼
  │                        [live2d 主窗口] 响应渲染
  │                        [live2d OBS窗口] 同步渲染
  │
  ▼
[llm] 回复完成
  │  发布 llm:response-end (完整回复文本)
  ▼
[audio] TTS 合成请求
  │  发布 audio:tts-start
  │  runtime 通知锁麦 → audio 暂停 VAD
  ▼
[audio] 接收 TTS 音频 → 播放队列
  │  口型数据 → [专门通道] → [live2d] 驱动嘴型
  ▼
[audio] 播放完成
  │  发布 audio:tts-end
  │  runtime 通知解锁 → audio 恢复 VAD
  ▼
等待下一轮用户输入
```

### 1.2 关键时序约束

1. **VAD → ASR**：VAD 检测到语音段结束后，立即将该段音频发送给 ASR
2. **ASR → runtime 门控 → LLM**：ASR 返回文本后，经 runtime 门控检查后进入 LLM
3. **LLM → TTS + 表情**：LLM 回复完成后触发 TTS；工具调用（表情/动作）在流式过程中即时触发
4. **TTS → 锁麦**：TTS 播放开始前锁麦，播放完成后解锁，防止回声自触发
5. **串行处理**：同一时间只处理一个用户输入，由 runtime 保证前一轮完成后才接受下一轮

---

## 2. 口型数据通道

口型驱动数据是高频流，与普通业务事件有本质区别，需要差异化处理。

### 2.1 为什么不走普通事件总线

- 口型数据更新频率远高于普通业务事件（通常每帧或每几毫秒一次）
- 如果走全局事件总线，会导致日志流、调试面板、事件追踪被刷满
- 普通事件的历史追踪、序列化、日志记录对口型数据无意义

### 2.2 专门通道设计

```
[audio] 播放音频
  │  Web Audio AnalyserNode 提取音量
  │
  ▼
[口型数据通道] （专门通道，非事件总线）
  │  数据格式：{ volume: number }
  │  消费者直接订阅，无全局广播
  │
  ├──→ [live2d 主窗口] ParamMouthOpenY 参数更新
  └──→ [live2d OBS窗口] ParamMouthOpenY 参数更新
```

- 口型数据通道可实现为简单的 callback 注册 / 直接调用，不经过事件总线
- 只有 live2d 渲染组件消费，不需要其他模块关心
- 日志系统不记录口型数据

---

## 3. 知识注入流

知识上下文分两类路径注入到 LLM，由 knowledge 模块统一管理。

### 3.1 长期知识注入

```
配置文件 / 知识文档
  │  应用启动时或配置变更时加载
  ▼
[knowledge] 长期知识索引
  │  存储：角色设定、品牌信息、商品基础资料、FAQ、直播规则
  │
  ▼
[llm] 构建 prompt 时同步调用 knowledge 获取
  │  注入到 system prompt 的知识区段
  └──→ 优先级：正常
```

### 3.2 临时高优先级上下文注入

```
外部来源（运营台 / 平台消息 / 控制面板手动输入）
  │
  ▼
[external-input] 标准化
  │  发布 external:product-message
  ▼
[knowledge] 临时上下文管理
  │  存储：当前主推商品、活动话术、优惠信息、库存提醒、临时禁说词
  │  特性：有时效性，过期自动移除；可被替换和更新
  │
  ▼
[llm] 构建 prompt 时同步调用 knowledge 获取
  │  注入到 system prompt 的高优先级区段
  └──→ 优先级：高于长期知识
```

### 3.3 优先级排序

当 LLM 构建 prompt 时，knowledge 模块按以下优先级组装上下文：

1. **临时高优先级上下文**（Live Context）— 最高
2. **角色人设**（来自 character 模块）— 高
3. **长期知识**— 正常

---

## 4. 外部事件输入流

所有外部事件通过 external-input 模块统一接入，标准化后发布到事件总线。

### 4.1 弹幕 / 礼物事件

```
直播平台
  │  (WebSocket / HTTP 轮询 / 平台 SDK)
  ▼
[external-input] 适配器（每种来源一个）
  │  标准化为统一事件格式
  │  留痕（日志记录原始事件）
  │  发布 external:danmaku / external:gift
  ▼
[event-bus] 路由
  │
  ├──→ [llm] 弹幕文本作为用户输入（经 runtime 门控）
  ├──→ [character] 礼物触发特殊反应
  └──→ [control-panel] UI 展示
```

### 4.2 商品消息事件

```
商品管理系统 / 运营台 / 控制面板
  │
  ▼
[external-input] 标准化
  │  发布 external:product-message
  ▼
[knowledge] 接收并管理
  │  区分 persistent（长期）和 priority（临时高优先级）
  │  临时消息设置 TTL，过期自动清除
  ▼
[llm] 下次构建 prompt 时自动生效
```

### 4.3 调试注入

```
开发者 / 测试脚本
  │  本地调试接口
  ▼
[external-input] 标准化
  │  标记来源为 debug
  │  发布对应标准化事件
  ▼
后续流程与正常外部事件相同
```

---

## 5. 紧急停止与人工接管流

由 runtime 统一控制，其他模块响应 runtime 的模式变更。

### 5.1 急停

```
触发方式：
  ├── 控制面板 "急停" 按钮
  └── 全局快捷键

  │  发布 system:emergency-stop
  ▼
[runtime] 切换到 stopped 模式
  │  发布 runtime:mode-change { mode: "stopped" }
  ▼
各模块响应：
  ├──→ [audio] 立即停止 TTS 播放，暂停麦克风采集，清空播放队列
  ├──→ [llm]   中断当前请求，清空待处理队列
  ├──→ [character] 切换到 neutral 状态
  └──→ [live2d] 停止当前动作，回到 idle
```

### 5.2 人工接管

```
[control-panel] 操作员点击 "人工接管"
  │  发布 system:manual-takeover
  ▼
[runtime] 切换到 manual 模式
  │  发布 runtime:mode-change { mode: "manual" }
  ▼
效果：
  ├──→ [audio] 暂停自动录音和 VAD
  ├──→ [llm]   不再自动处理 ASR 结果
  └──→ 操作员可通过控制面板手动输入文本、触发 TTS、控制表情

操作员手动输入文本：
  │
  ▼
[llm] 跳过 AI 生成，直接使用操作员文本
  │  发布 llm:response-end (操作员文本)
  ▼
后续流程与主链路相同（TTS → 播放 → 角色反馈）
```

### 5.3 恢复正常

```
[control-panel] "恢复" 按钮
  │  发布 system:resume
  ▼
[runtime] 切换回 auto 模式
  │  发布 runtime:mode-change { mode: "auto" }
  ▼
各模块响应：
  ├──→ [audio] 恢复麦克风采集和 VAD
  ├──→ [llm]   恢复自动处理
  └──→ 系统回到正常自动运行状态
```

---

## 6. 事件类型汇总

### 6.1 运行时事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `runtime:mode-change` | `{ mode: "auto"\|"manual"\|"stopped"\|"paused", previous: string }` | 运行模式变更 |

### 6.2 音频事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `audio:vad-start` | 无 | VAD 检测到语音开始 |
| `audio:vad-end` | `{ audioData: ArrayBuffer }` | VAD 检测到语音结束，附带音频段 |
| `audio:asr-result` | `{ text: string, source: "voice" }` | ASR 识别结果 |
| `audio:tts-start` | `{ text: string }` | TTS 合成开始 |
| `audio:tts-end` | 无 | TTS 播放完成 |

**注意：** 口型数据（`volume` 等）不走事件总线，走专门通道。

### 6.3 LLM 事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `llm:request-start` | `{ userText: string }` | 开始 LLM 请求 |
| `llm:stream-chunk` | `{ delta: string }` | 流式回复片段 |
| `llm:tool-call` | `{ name: string, args: object }` | 工具调用 |
| `llm:response-end` | `{ fullText: string }` | 回复完成 |
| `llm:error` | `{ error: string }` | 请求失败 |

### 6.4 角色事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `character:expression` | `{ emotion: string, expressionName: string }` | 播放表情 |
| `character:motion` | `{ motionGroup: string, index: number }` | 播放动作 |
| `character:state-change` | `{ characterId, emotion, isSpeaking, ... }` | 状态变化 |
| `character:switch` | `{ characterId: string }` | 角色切换 |

### 6.5 系统事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `system:emergency-stop` | 无 | 急停请求 |
| `system:manual-takeover` | 无 | 人工接管请求 |
| `system:resume` | 无 | 恢复运行 |
| `system:error` | `{ module: string, error: string }` | 系统级错误 |

### 6.6 外部事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `external:danmaku` | `{ user: string, text: string, source: string }` | 弹幕消息 |
| `external:gift` | `{ user: string, giftName: string, count: number, source: string }` | 礼物 |
| `external:product-message` | `{ type: "persistent"\|"priority", content: string, ttl?: number }` | 商品消息 |

---

## 7. 数据持久化

### 7.1 本地持久化（通过 Tauri 文件系统）

| 数据 | 格式 | 说明 |
|------|------|------|
| 应用配置 | TOML / JSON | LLM/ASR/TTS 服务地址、API Key、音频参数 |
| 角色配置 | TOML + Markdown | 角色人设、TTS 声线、表情映射 |
| 长期知识 | Markdown / JSON | 商品基础资料、FAQ 等 |
| 日志文件 | 文本 | 运行日志输出 |

### 7.2 内存状态（不持久化）

| 数据 | 说明 |
|------|------|
| 运行模式 | 每次启动默认 auto |
| 当前对话历史 | 每次启动从空开始 |
| 临时高优先级上下文 | 直播场次内有效 |
| 音频缓冲区 | 实时音频数据 |
| 播放队列 | TTS 音频播放队列 |
| 事件订阅注册 | 运行时构建 |
