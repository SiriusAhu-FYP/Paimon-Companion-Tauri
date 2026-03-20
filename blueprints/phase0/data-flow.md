# Paimon Live — 数据流与事件流设计

---

## 1. 主链路数据流

主链路是系统最核心的数据通路：**用户语音 → AI 回复 → 角色反馈**。

### 1.1 完整主链路

```
用户说话
  │
  ▼
[audio] 麦克风采集
  │
  ▼
[audio] VAD 检测语音段起止
  │  发布 audio:vad-end (音频段数据)
  ▼
[audio] ASR 云端识别
  │  发布 audio:asr-result (识别文本)
  ▼
[llm] 构建请求 (system prompt + 对话历史 + 用户文本)
  │  发布 llm:request-start
  ▼
[llm] 调用 LLM API (流式)
  │  发布 llm:stream-chunk (逐段文本)
  │
  ├──→ 检测到 tool call ──→ 发布 llm:tool-call
  │                              │
  │                              ▼
  │                        [character] 解析表情/动作指令
  │                              │  发布 character:expression
  │                              │  发布 character:motion
  │                              ▼
  │                        [live2d] 播放表情/动作
  │
  ▼
[llm] 回复完成
  │  发布 llm:response-end (完整回复文本)
  ▼
[audio] TTS 合成请求
  │  发布 audio:tts-start
  ▼
[audio] 接收 TTS 音频 → 播放队列
  │  发布口型数据 → [live2d] 驱动嘴型
  │  锁麦（暂停 VAD）
  ▼
[audio] 播放完成
  │  发布 audio:tts-end
  │  解锁麦（恢复 VAD）
  ▼
等待下一轮用户输入
```

### 1.2 关键时序约束

1. **VAD → ASR**：VAD 检测到语音段结束后，立即将该段音频发送给 ASR
2. **ASR → LLM**：ASR 返回文本后，立即进入 LLM 请求队列
3. **LLM → TTS + 表情**：LLM 回复完成后触发 TTS；工具调用（表情/动作）在流式过程中即时触发
4. **TTS → 锁麦**：TTS 播放开始前锁麦，播放完成后解锁，防止回声自触发
5. **串行处理**：同一时间只处理一个用户输入，前一轮 TTS 播放完成后才能接受下一轮

---

## 2. 外部事件输入流

外部事件指来自直播平台或外部系统的消息，通过事件总线接入主链路。

### 2.1 弹幕 / 礼物事件

```
直播平台
  │  (WebSocket / HTTP 轮询)
  ▼
[外部事件接入适配器]
  │  标准化为统一事件格式
  │  发布 external:danmaku / external:gift
  ▼
[event-bus] 路由
  │
  ├──→ [llm] 作为用户输入注入对话
  │         (弹幕文本 → 用户消息)
  │
  └──→ [control-panel] UI 展示
```

### 2.2 商品消息事件

根据项目规则，商品消息需与普通知识区分处理：

```
商品管理系统
  │  (HTTP API / WebSocket)
  ▼
[外部事件接入适配器]
  │  发布 external:product-message
  ▼
[event-bus] 路由
  │
  ▼
[llm] 知识注入
  │
  ├── 长期知识（商品基础资料、FAQ）
  │   → 写入 system prompt 的知识区段
  │   → 优先级：正常
  │
  └── 临时高优先级消息（主推商品、库存变化、活动口径）
      → 插入到 system prompt 的高优先级区段
      → 优先级：高于长期知识
      → 有时效性，过期后自动移除
```

---

## 3. 状态同步流

角色状态是多个模块共同关注的数据，需要可靠的同步机制。

### 3.1 角色状态 → 渲染更新

```
[character] 状态变化
  │  发布 character:state-change
  │
  ├──→ [live2d 主窗口] 更新渲染
  │
  └──→ [live2d OBS窗口] 同步更新（同一状态源）
```

### 3.2 角色状态 → 控制面板

```
[character] 状态变化
  │  发布 character:state-change
  ▼
[control-panel]
  ├── 更新角色状态显示（情绪、模型名）
  ├── 更新预览画面
  └── 同步手动控制面板选项
```

### 3.3 系统状态 → 控制面板

```
[各 service] 状态变化
  │  发布各自状态事件
  ▼
[control-panel] 状态仪表盘
  ├── LLM 连接状态 / 延迟
  ├── ASR 服务状态
  ├── TTS 服务状态
  ├── 音频设备状态
  └── 错误告警
```

---

## 4. 紧急停止与人工接管流

### 4.1 紧急停止

```
触发方式：
  ├── 控制面板 "紧急停止" 按钮
  └── 全局快捷键

  │  发布 system:emergency-stop
  ▼
[event-bus] 广播
  │
  ├──→ [audio] 立即停止 TTS 播放，暂停麦克风采集
  ├──→ [llm]   中断当前请求，清空待处理队列
  ├──→ [character] 切换到 neutral 状态
  └──→ [live2d] 停止当前动作，回到 idle
```

### 4.2 人工接管

```
[control-panel] 操作员手动输入文本 / 选择回复
  │
  ▼
[llm] 跳过 AI 生成，直接使用操作员文本
  │  发布 llm:response-end (操作员文本)
  ▼
后续流程与主链路相同（TTS → 播放 → 角色反馈）
```

### 4.3 恢复正常

```
[control-panel] "恢复" 按钮
  │  发布 system:resume
  ▼
[event-bus] 广播
  │
  ├──→ [audio] 恢复麦克风采集和 VAD
  ├──→ [llm]   恢复接受新请求
  └──→ 系统回到正常自动运行状态
```

---

## 5. 事件类型汇总

### 5.1 音频事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `audio:vad-start` | 无 | VAD 检测到语音开始 |
| `audio:vad-end` | `{ audioData: ArrayBuffer }` | VAD 检测到语音结束，附带音频段 |
| `audio:asr-result` | `{ text: string, source: "voice" }` | ASR 识别结果 |
| `audio:tts-start` | `{ text: string }` | TTS 合成开始 |
| `audio:tts-end` | 无 | TTS 播放完成 |
| `audio:mouth-data` | `{ volume: number }` | 口型驱动数据（高频） |

### 5.2 LLM 事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `llm:request-start` | `{ userText: string }` | 开始 LLM 请求 |
| `llm:stream-chunk` | `{ delta: string }` | 流式回复片段 |
| `llm:tool-call` | `{ name: string, args: object }` | 工具调用 |
| `llm:response-end` | `{ fullText: string }` | 回复完成 |
| `llm:error` | `{ error: string }` | 请求失败 |

### 5.3 角色事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `character:expression` | `{ emotion: string, expressionName: string }` | 播放表情 |
| `character:motion` | `{ motionGroup: string, index: number }` | 播放动作 |
| `character:state-change` | `{ characterId, emotion, isSpeaking, ... }` | 状态变化 |
| `character:switch` | `{ characterId: string }` | 角色切换 |

### 5.4 系统事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `system:emergency-stop` | 无 | 紧急停止 |
| `system:resume` | 无 | 恢复运行 |
| `system:error` | `{ module: string, error: string }` | 系统级错误 |

### 5.5 外部事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `external:danmaku` | `{ user: string, text: string }` | 弹幕消息 |
| `external:gift` | `{ user: string, giftName: string, count: number }` | 礼物 |
| `external:product-message` | `{ type: "persistent"\|"priority", content: string, ttl?: number }` | 商品消息 |

---

## 6. 数据持久化

### 6.1 本地持久化（通过 Tauri 文件系统）

| 数据 | 格式 | 说明 |
|------|------|------|
| 应用配置 | TOML / JSON | LLM/ASR/TTS 服务地址、API Key、音频参数 |
| 角色配置 | TOML + Markdown | 角色人设、TTS 声线、表情映射 |
| 日志文件 | 文本 | 运行日志输出 |
| 对话历史 | JSON（可选） | 可选的本地对话记录存档 |

### 6.2 内存状态（不持久化）

| 数据 | 说明 |
|------|------|
| 当前对话历史 | 每次启动从空开始 |
| 音频缓冲区 | 实时音频数据 |
| 播放队列 | TTS 音频播放队列 |
| 事件订阅注册 | 运行时构建 |
