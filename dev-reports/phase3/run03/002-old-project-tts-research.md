# 旧项目 TTS/文本切片/队列/中英混合实现调研

**调研范围**：`E:\FYP-PROJECT\daikenja_app`、`E:\FYP-PROJECT\core\VoiceL2D-MVP`
**目的**：为新项目下一轮 Opus 实施（M2 GPT-SoVITS 真实 TTS 接入）提供可复用输入材料
**原则**：只做现状取证和对比，不做架构判断

---

## 1. 两个旧项目概况

| 项目 | 技术栈 | 架构定位 |
|------|--------|---------|
| `VoiceL2D-MVP` | Python (asyncio + requests + WebSocket) | 完整 ASR → LLM → TTS → 播放链路，桌面 Electron 前端 |
| `daikenja_app` | Python 脚本 | 仅含 SFX 音频生成脚本，与 TTS 无关 |

`daikenja_app` 的 `generate_sfx.py` 是一个纯音频文件生成工具，不参与 TTS 链路，在本调研中无参考价值。

---

## 2. GPT-SoVITS 接入现状

### 2.1 VoiceL2D-MVP 的接入方式

**关键文件**：
- `client/utils/tts_controller.py` — `TTSController` 类
- `client/utils/voice_manager.py` — `VoiceManager` 类 + `VoiceConfig` 数据类
- `charas.toml` — 每角色权重配置
- `client/client.py` — `speak()` 方法调用链路

**API 端点**（均通过 `requests` 调用）：

| 端点 | 方法 | 用途 |
|------|------|------|
| `{host}/set_gpt_weights` | GET + `weights_path` param | 加载 GPT 权重 |
| `{host}/set_sovits_weights` | GET + `weights_path` param | 加载 SoVITS 权重 |
| `{host}/tts` | GET + query params | 非流式合成 |
| `{host}/tts` + `streaming_mode=true` | GET stream | 流式合成 |

**非流式合成参数**（`tts_controller.py` 第 152–160 行）：

```python
params = {
    "text": text,
    "text_lang": text_lang,
    "ref_audio_path": voice_config.ref_audio_path,
    "prompt_text": voice_config.prompt_text,
    "prompt_lang": voice_config.prompt_lang,
}
url = f"{self.host}/tts?{urlencode(params)}"
response = requests.get(url, timeout=60)
```

**流式合成参数**（`tts_controller.py` 第 201–209 行）：

```python
params = {
    "text": text,
    "text_lang": text_lang,
    "ref_audio_path": voice_config.ref_audio_path,
    "prompt_text": voice_config.prompt_text,
    "prompt_lang": voice_config.prompt_lang,
    "streaming_mode": "true",
    "media_type": "wav",
}
```

**权重加载时机**：每次切换角色时调用 `tts.load_voice(voice_config)`（`client.py` 第 327 行），内部先调 `set_gpt_weights` 再调 `set_sovits_weights`。已加载相同角色时跳过（`client.py` 第 323–324 行 `_loaded_character` 缓存）。

**输出格式**：GPT-SoVITS 返回 WAV 格式，32000Hz、单声道、16-bit PCM（`tts_controller.py` 第 33–35 行硬编码常量）。

### 2.2 新项目接入方式

新项目当前有 `src/services/config/http-proxy.ts` 提供 `proxyRequest()` 和 `proxySSERequest()` 两个封装：
- Tauri 环境走 Rust `invoke` → `reqwest`，不受 CORS 约束
- 非 Tauri 环境走前端 `fetch`

**两种方式的本质差异**：
- VoiceL2D-MVP：Python `requests` 库直连 GPT-SoVITS 服务（无中间层）
- 新项目（Tauri）：前端 `invoke` → Rust `reqwest` → GPT-SoVITS（多一跳，但解 CORS 问题）

### 2.3 接入方式推荐

VoiceL2D-MVP 的接入方式更适合新项目参考，原因：
1. 它明确区分了权重加载（setup）和合成（tts）两个独立阶段
2. `VoiceConfig` 数据类完整定义了一个角色的所有 TTS 参数
3. 权重路径是服务端路径，不存在传输问题（服务端路径透传到 GPT-SoVITS）

---

## 3. 文本切片策略

### 3.1 VoiceL2D-MVP 的切片实现

**关键文件**：`client/client.py` 第 70–123 行，`split_into_sentences()` 函数

**切片规则**：

```python
pattern = r"([。！？；.!?;]+|\.{3}|……)"
```

按中英文标点切分：`。！？；.!?;` 以及省略号 `...` 和 `……`。

**合并逻辑**：切出的句子数量超过 `max_segments`（默认 2）时，按顺序合并，最后一段承载余数：

```python
sentences_per_segment = len(sentences) // max_segments
remainder = len(sentences) % max_segments
for i in range(max_segments):
    count = sentences_per_segment + (1 if i < remainder else 0)
    segment = "".join(sentences[idx : idx + count])
```

**结论**：没有考虑中英混合处理，没有按语言切换参数，没有按停顿点（逗号、顿号）再切分。最小切片单元是完整句子。

### 3.2 是否存在分角色/分语言切片

未发现。`split_into_sentences` 对所有文本一视同仁，不查语言、不切短句、不处理中英混合。

### 3.3 值得迁移的切片策略

**最小可复用方案**：
- 直接迁移 `split_into_sentences` 的标点正则 pattern：`r"([。！？；.!?;]+|\.{3}|……)"`
- 保留 `max_segments` 限制，防止一个 TTS 请求承载过多内容导致超时
- **不迁移**合并逻辑（M2 阶段可以逐句合成，不需要合并）

---

## 4. 队列机制

### 4.1 VoiceL2D-MVP 的队列实现

**关键文件**：`client/client.py`

**相关字段**：
- `_text_input_queue: asyncio.Queue[tuple[str, str]]`（第 183 行）— 输入队列
- `_processing_lock: asyncio.Lock`（第 182 行）— 处理锁

**队列消费逻辑**（`client.py` 第 610–631 行）：

```python
async def _process_text_input_queue(self) -> None:
    while True:
        try:
            source, text = await asyncio.wait_for(
                self._text_input_queue.get(), timeout=0.5
            )
            await self.process_user_input(text, source)
        except asyncio.TimeoutError:
            continue
```

**特点**：
- 只有一个输入队列（ASR 结果和文本输入混在一起），按 FIFO 顺序处理
- 锁 `_processing_lock` 保证同一时刻只有一个 `process_user_input` 在执行（第 437 行 `async with self._processing_lock`）
- **没有独立的合成队列和播放队列区分**
- 合成是阻塞的：生成完一段音频 → 发给前端 → 等前端确认播放完成 → 才继续下一段（第 383–386 行 `wait_for_playback_complete`）

### 4.2 播放顺序保证机制

**关键文件**：`client/utils/websocket_server.py` — `wait_for_playback_complete()`

`speak()` 方法中的顺序保证逻辑（`client.py` 第 355–393 行）：

```python
# 1. 先生成所有音频 chunk
for sentence in sentences:
    audio_data = self.tts.generate_audio(sentence, voice_config)
    audio_chunks.append((sentence, audio_data))

# 2. 发送第一个，等待播放完，再发下一个（串行）
for i, (sentence, audio_data) in enumerate(audio_chunks):
    await self.ws_server.send_audio(audio_data, sentence)
    if i < len(audio_chunks) - 1:
        await asyncio.sleep(0.1)  # 段间小延迟
    playback_completed = await self.ws_server.wait_for_playback_complete(timeout=...)
```

**本质**：合成并发（一次性生成多段音频），但播放严格串行（等上一段播完才发下一段）。

### 4.3 不建议照搬的部分

- `_text_input_queue` 是 Python asyncio 的队列实现，新项目是 TypeScript，没有对应原语
- WebSocket 通信模式（`wait_for_playback_complete` 依赖前端回调），新项目 Tauri 环境是事件总线 + IPC
- 没有独立的合成队列，`asyncio.Queue` 混用了输入排队和合成任务调度

### 4.4 值得参考的部分

- **锁机制**：`asyncio.Lock` 保证同一时刻只有一个 process 在运行，新项目可以用 `RuntimeService` 的 `auto/stopped` 模式类比
- **播放顺序保证**：`wait_for_playback_complete` 的模式（等待前端回调确认播放完成）是可借鉴的交互契约
- **提前合成**：在播放当前段时预合成下一段（目前代码未实现，但链路是支持的）

---

## 5. 中英混合处理

### 5.1 现状

VoiceL2D-MVP **完全没有中英混合处理逻辑**。`split_into_sentences` 不区分语言，`generate_audio` 不切换 `text_lang`，所有文本用同一个 `text_lang` 参数。

`charas.toml` 中每个角色的 `prompt_lang` 和 `text_lang` 均硬编码为 `"zh"`。

### 5.2 最小可行方案

从 VoiceL2D-MVP 的现状看，当前阶段不需要做复杂的语言检测和参数切换。最简单的可行方案：

- 输入文本中英混合 → 按标点切片 → 整句送 TTS（GPT-SoVITS 对纯中文处理最好，英文可能会发音奇怪，但这属于模型本身能力问题，不在接入层处理）
- 暂不做语言检测和参数切换

---

## 6. 新项目中的推荐落点（现状映射）

> 只做现状映射，不做架构设计。

### 6.1 GPT-SoVITS 接入层

**推荐落点**：`src/services/tts/gptsovits-tts-service.ts`（M2 实施文件，Phase 3 blueprint 附录 B 已预估）

**VoiceL2D-MVP 参考**：
- `TTSController` 类的 API 调用模式（set_gpt_weights → set_sovits_weights → tts）
- `VoiceConfig` 数据类结构
- `load_voice()` 缓存机制（`_loaded_character`）

### 6.2 文本切片逻辑

**推荐落点**：调用方（`PipelineService` 或新 TTS service 内部）

**VoiceL2V-MVP 参考**：`split_into_sentences()` 的标点正则，可直接迁移

### 6.3 队列逻辑

**推荐落点**：不应单独抽象队列，而应依赖已有的 `RuntimeService`（auto/stopped 模式）和 `PipelineService` 的 `run()` 串行执行机制

**VoiceL2D-MVP 参考**：
- 播放顺序保证模式（等待前端回调）→ 新项目中对应 `AudioPlayer` 播放完成事件
- `asyncio.Lock` 类比 → `RuntimeService.isAllowed()` 门控

### 6.4 角色 TTS 配置存储

**推荐落点**：`CharacterService` + `charas.toml` 格式（或等价 JSON 格式）

**VoiceL2D-MVP 参考**：`VoiceManager` + `charas.toml`，但需注意新项目是 TypeScript + Tauri，不直接用 TOML

---

## 7. 可复用能力清单

| 能力 | 来源 | 可复用程度 | 备注 |
|------|------|-----------|------|
| GPT-SoVITS API 调用流程（set_gpt_weights → set_sovits_weights → tts） | VoiceL2D-MVP `TTSController` | 高 | 接口参数可直接迁移 |
| `VoiceConfig` 数据结构（gpt_weights_path, sovits_weights_path, ref_audio_path, prompt_text, prompt_lang） | VoiceL2D-MVP `voice_manager.py` | 高 | 字段命名和类型可直接迁移到 TS |
| 权重加载缓存（`_loaded_character` 避免重复加载） | VoiceL2D-MVP `client.py` | 高 | 对应新项目 `CharacterService` 缓存当前角色权重 |
| 标点切片正则 `r"([。！？；.!?;]+|\.{3}|……)"` | VoiceL2D-MVP `client.py` | 高 | 可直接迁移到 TS |
| 播放顺序保证（等待前端回调） | VoiceL2D-MVP `websocket_server.py` | 中 | 需适配为 `AudioPlayer` 事件机制 |
| 音频参数常量（32000Hz, 1ch, 16-bit） | VoiceL2D-MVP `tts_controller.py` | 高 | 新项目 `AudioPlayer` 已知支持这些参数 |
| 流式合成模式（`streaming_mode=true, media_type=wav`） | VoiceL2D-MVP `tts_controller.py` | 高 | 新项目 SSE 代理已支持流式响应 |
| `asyncio.Lock` 处理并发 | VoiceL2D-MVP `client.py` | 低（TS 无直接等价） | 依赖 `RuntimeService` 门控替代 |
| 独立合成队列 | VoiceL2D-MVP | 低 | 新项目 `PipelineService` 本身已串行 |
| 中英混合语言切换 | VoiceL2D-MVP | 无 | 当前未实现 |

---

## 8. 不建议照搬的部分

| 内容 | 原因 |
|------|------|
| Python asyncio 队列 | TS 无等价原语，应依赖现有 RuntimeService 和 PipelineService |
| WebSocket 通信协议 | 新项目是 Tauri IPC + 事件总线，交互模式完全不同 |
| TOML 配置文件 | 新项目用 JSON（ConfigService），charas.toml 格式只迁移数据字段 |
| 等待播放完成的超时逻辑（`wait_for_playback_complete`） | 新项目 `AudioPlayer` 播放完成事件机制不同，需要重新设计 |
| 固定 `max_segments=2` 的合并策略 | M2 阶段逐句合成更简单，暂不需要合并逻辑 |
| `prompt_lang` 和 `text_lang` 均硬编码 `"zh"` | 扩展点，但 M2 阶段可以先硬编码 |

---

## 9. 对新项目最有价值的 5 个实现点

1. **`TTSController` 的三步 API 流程**：`set_gpt_weights` → `set_sovits_weights` → `tts`，这是 GPT-SoVITS 的标准使用顺序，权重加载和合成完全分离

2. **`VoiceConfig` 数据结构**：五字段（gpt_weights_path、sovits_weights_path、ref_audio_path、prompt_text、prompt_lang）完整定义了一个角色的 TTS 配置，可直接迁移到 TypeScript 接口

3. **权重加载缓存**：`_loaded_character` 在角色未切换时跳过权重加载，避免每次合成都发 `set_gpt_weights`/`set_sovits_weights` 请求

4. **标点切片正则**：`r"([。！？；.!?;]+|\.{3}|……)"` — 可直接迁移到 TS，实现最小粒度的文本分段

5. **流式合成 + 播放串行模式**：`streaming_mode=true` + `wait_for_playback_complete`，这是让 TTS 输出能实时口型同步的关键——先小 chunk 收到就立即开始播放，等效于流式 TTS 的边合成边播放效果

---

## 10. 涉及的关键文件路径

**VoiceL2D-MVP**：

| 文件 | 关键内容 |
|------|---------|
| `client/utils/tts_controller.py` | `TTSController` 类，非流式/流式合成，`generate_audio_stream()`，`set_gpt_weights()`，`set_sovits_weights()` |
| `client/utils/voice_manager.py` | `VoiceConfig` dataclass，`VoiceManager` 类 |
| `client/client.py` | `split_into_sentences()`，`_loaded_character` 缓存，`speak()` 合成+播放串行逻辑，`asyncio.Lock` |
| `client/utils/websocket_server.py` | `wait_for_playback_complete()`（播放确认回调）|
| `charas.toml` | 派蒙等角色的 TTS 权重配置 |
| `examples/stream_example.py` | 流式 TTS 调用的完整参数示例 |
| `examples/tts_request_example.py` | 非流式 TTS 调用示例 |

**daikenja_app**：

| 文件 | 关键内容 |
|------|---------|
| `bin/generate_sfx.py` | 仅 SFX 音频生成，与 TTS 无关 |

**新项目相关文件**：

| 文件 | 用途 |
|------|------|
| `src/services/config/http-proxy.ts` | 已有 `proxyRequest` / `proxySSERequest`，M2 TTS 调用复用此层 |
| `src/services/config/types.ts` | `TTSProviderConfig` 已增加 gpt-sovits 字段（`gptWeightsPath` 等） |
| `src/services/config/config-service.ts` | 已有 `loadConfig/updateConfig` |
| `src/services/tts/types.ts` | `ITTSService` 接口定义 |
| `src/services/llm/openai-llm-service.ts` | SSE 流式解析参考（`192a6d3` 新增），M2 可参考其 buffer 管理模式 |

---

## 附录：M2 实施最需要的 5 个细节补充

### 1. 旧项目的流式 TTS 消费方式

**文件**：`examples/stream_example.py`（纯演示）、`client/client.py` `speak()` 方法（实际链路）

**实际链路（`client.py`）**：旧项目**不使用流式 TTS**，`speak()` 调用的是非流式 `generate_audio()`，一次性获取完整 WAV bytes，然后发给前端。只有 `tts_controller.py` 第 180–228 行的 `generate_audio_stream()` 定义了流式方法，但实际链路中未被调用。

**流式示例**（`stream_example.py`）展示的才是真正边收边播的模式：

```python
# 收到 1KB 数据块就立即写入 PyAudio 流，不等全部收完
for chunk in response.iter_content(chunk_size=1024):
    if chunk:
        stream.write(chunk)  # 边收边播
```

**结论**：新项目 M2 如要走流式 TTS + 实时口型同步，需要使用 `streaming_mode=true` + `media_type=wav` + `proxySSERequest()`，参考 `stream_example.py` 的消费模式——按 chunk 块写入 `AudioPlayer`，不等全部收完再播。

---

### 2. 播放完成确认契约

**文件**：`client/utils/websocket_server.py`、`frontend/src/components/Live2DComponent.tsx`

**前后端交互细节**：

```
后端 speak():
  for sentence in audio_chunks:
      ws_server.send_audio(audio_data, sentence)  # 发一段音频
      if i < len-1: asyncio.sleep(0.1)            # 段间小延迟
  ws_server.wait_for_playback_complete(timeout)   # 等前端确认

前端收到 audio 消息:
  playbackQueue.push({audio_data, text})
  processPlaybackQueue()                           # 消费队列

processPlaybackQueue():
  while queue not empty:
      item = queue.shift()
      await playBase64Audio(item.audioData, item.text)
      await new Promise(r => setTimeout(r, 300))  # 段间等 300ms
  ws.send({type: 'playback_complete'})            # 全部播完，通知后端
```

**关键细节**：
- 确认时机：**队列全部清空后**才发 `playback_complete`，不是每段都发
- 无 sentence id / chunk id 对应机制——`send_audio` 发了文本字段但 WS 层没有追踪
- 超时：后端 `wait_for_playback_complete` 超时 60s，前端段间只等 300ms 固定间隔

**值得新项目参考的部分**：后端等全部播完再继续的契约设计，是保证多段音频顺序不乱的关键。新项目可对应为 `AudioPlayer` 的"播放完成"事件，`PipelineService` 在收到该事件后才发送下一段。

---

### 3. `charas.toml` 的真实字段与样例

**所有字段汇总**：

| 字段 | 类型 | 说明 | 派蒙样例 |
|------|------|------|---------|
| `name` | string | 角色显示名 | `"派蒙"` |
| `prompt_path` | string | 系统提示词文件路径 | `"characters/Paimon.md"` |
| `voice.gpt_weights_path` | string | GPT 模型权重文件路径（服务端绝对路径） | `/home/ahu/fyp-tts/.../派蒙-e10.ckpt` |
| `voice.sovits_weights_path` | string | SoVITS 模型权重文件路径（服务端绝对路径） | `/home/ahu/fyp-tts/.../派蒙_e10_s19390.pth` |
| `voice.ref_audio_path` | string | 参考音频文件路径（服务端绝对路径） | `/home/ahu/fyp-tts/.../平静-好耶！...wav` |
| `voice.prompt_text` | string | 参考音频对应的文字内容 | `"好耶！《特尔克西的奇幻历险》出发咯！"` |
| `voice.prompt_lang` | string | 参考音频语言 | `"zh"` |

**注意**：没有 `text_lang` 字段，`text_lang` 在调用 `tts` 时从参数传入（`client.py` 第 343 行 `speak()` 调用 `generate_audio(sentence, voice_config)` 时 `text_lang` 硬编码为 `"zh"`）。

**最值得直接迁移**：五字段 `VoiceConfig` 结构（gpt_weights_path、sovits_weights_path、ref_audio_path、prompt_text、prompt_lang）可原样迁移到 TypeScript，`prompt_path` 对应新项目 `CharacterService` 中角色人设路径。

---

### 4. 中断 / 打断 / 停止逻辑

| 场景 | 机制 | 文件位置 |
|------|------|---------|
| TTS 播放期间禁止录音 | `vad.pause()`（TTS 开始时调用，播完调用 `vad.resume()`） | `client.py` 第 236 行 `_lock_audio_sync()` |
| 前端停止口型 | `stopLipSync()`（置 `lipSyncActiveRef.current = false`，平滑关闭嘴部） | `Live2DComponent.tsx` 第 236 行 |
| 录音器停止 | `recorder.stop()`（清空 `_audio_queue`） | `client.py` 第 762 行 `stop_listening()` |
| 队列清空 | `audio_recorder.py` 第 147 行 `clear_queue()` | 清空录音缓冲队列 |

**不存在的能力**：没有"停止当前 TTS 播放"的机制；没有"清空播放队列"的接口；没有"打断当前播报"的急停对 TTS 的影响处理。

**M2 最有用的参考**：`vad.pause()` / `vad.resume()` 的锁机制，确保 TTS 播报期间不处理新的 ASR 输入。

---

### 5. GPT-SoVITS 调用失败模式与处理

**权重加载失败**（`set_gpt_weights` / `set_sovits_weights`，`tts_controller.py` 第 62–76 行）：

```python
response = requests.get(url, params=params, timeout=30)
if response.status_code == 200:
    self._current_gpt_weights = weights_path
    return True
else:
    lg.error(f"[TTSController] Failed to set GPT weights: {response.text}")
    return False  # ← 整句 return False，不抛异常
except requests.RequestException as e:
    lg.error(f"[TTSController] Error setting GPT weights: {e}")
    return False
```

**合成失败**（`generate_audio`，第 162–178 行）：

```python
response = requests.get(url, timeout=60)
if response.status_code == 200:
    return response.content  # ← bytes
else:
    lg.error(f"[TTSController] TTS request failed: {response.status_code} - {response.text}")
    return None  # ← 返回 None，不抛异常
except requests.RequestException as e:
    lg.error(f"[TTSController] Error generating audio: {e}")
    return None
```

**调用方处理**（`client.py` 第 360–368 行）：

```python
for sentence in sentences:
    audio_data = self.tts.generate_audio(sentence, voice_config)
    if audio_data:
        audio_chunks.append((sentence, audio_data))
    else:
        lg.error(f"[TTS] Failed: {sentence[:30]}...")  # ← 跳过该句，继续下一句
```

**空音频检测**：GPT-SoVITS 返回 200 但内容为空时，旧项目**没有检测**，直接把空 bytes 发给前端。`AudioPlayer` 或前端 Web Audio API 对空音频通常忽略，不会 crash。

**连接检查**（`check_connection`）：根路径返回 200 或 404 都认为服务器在线，不可靠（GPT-SoVITS 根路径无 handler，真实服务也可能返回 404）。新项目已用 `/set_gpt_weights?weights_path=/tmp/dummy` 替代，更可靠。

**M2 最需要复制的处理**：权重加载失败返回 `False`、合成失败返回 `None`、调用方跳过失败句继续处理——这套错误不抛异常的策略值得新项目直接复用。
