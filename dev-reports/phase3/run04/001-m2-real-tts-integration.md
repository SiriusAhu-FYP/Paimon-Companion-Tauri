# Phase 3 Run 04 — 真实语音链路升级（M2: Real TTS Integration）

## 概要

本次 run 实现了 Phase 3 中 M2（真实 TTS 接入）的核心功能：

1. 接入 GPT-SoVITS 作为 `ITTSService` 的真实实现
2. 实现文本切片器（按标点边界拆分）
3. 实现合成队列 + 播放队列（SpeechQueue）
4. 升级 PipelineService 使用分段合成+播放模式
5. 新增 Rust 二进制代理命令用于获取 WAV 音频

## 改动文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/services/tts/gptsovits-tts-service.ts` | GPT-SoVITS TTS 实现，三步流程：加载 GPT 权重 → 加载 SoVITS 权重 → /tts 合成 |
| `src/services/tts/text-splitter.ts` | 文本切片器，按句末标点拆分 + 超长句逗号二次拆分 |
| `src/services/tts/speech-queue.ts` | 合成+播放队列，串行合成 → 顺序播放，段间 speaking 状态不抖动 |

### 修改文件

| 文件 | 说明 |
|------|------|
| `src-tauri/src/commands/http_proxy.rs` | 新增 `proxy_binary_request` 命令（返回 `Vec<u8>`） |
| `src-tauri/src/lib.rs` | 注册 `proxy_binary_request` 命令 |
| `src/services/config/http-proxy.ts` | 新增 `proxyBinaryRequest()` 前端封装 |
| `src/services/tts/index.ts` | 导出 `GptSovitsTTSService`、`SpeechQueue`、`splitText` |
| `src/services/index.ts` | `resolveTTSProvider` 中 `gpt-sovits` 分支实例化真实 provider |
| `src/services/pipeline/pipeline-service.ts` | 使用 `splitText` + `SpeechQueue` 替代一次性合成+播放 |

### 未改动文件（边界承诺）

- `src/services/llm/*` — LLM 层不动
- `src/services/config/types.ts` — TTSProviderConfig 字段已齐全（上一 run 已完成）
- `src/features/settings/*` — 设置 UI 已有 GPT-SoVITS 字段
- `src/features/stage/*` — Stage 不动
- `src/services/audio/audio-player.ts` — AudioPlayer 不变
- `src/utils/window-sync.ts` — 口型同步通道不变

## GPT-SoVITS 接入摘要

### 三步流程
1. `GET /set_gpt_weights?weights_path=...`
2. `GET /set_sovits_weights?weights_path=...`
3. `GET /tts?text=...&text_lang=...&ref_audio_path=...&prompt_text=...&prompt_lang=...`

### VoiceConfig 在新项目中的落点
- 配置字段在 `TTSProviderConfig`（`src/services/config/types.ts`）中：
  - `gptWeightsPath` / `sovitsWeightsPath` — 服务端权重路径
  - `refAudioPath` / `promptText` / `promptLang` — 参考音频
  - `textLang` — 合成文本语言
  - `baseUrl` — GPT-SoVITS 服务地址
- 通过设置面板统一配置，存储在 Tauri Store / localStorage
- 权重路径缓存：已加载的权重路径与配置比对，未变则跳过重复加载

### Mock 回退
- 设置中切回 `mock` 即可使用 `MockTTSService`
- `baseUrl` 缺失时自动回退到 mock

## 文本切片策略摘要

- 按 `。！？；.!?;\n` + 省略号 `...`/`……` 作为主分割点
- 超过 80 字符的片段按逗号 `，,` 二次拆分
- 空片段自动过滤
- 保持原始顺序
- 不做语言检测或复杂合并

## 合成队列 / 播放队列设计摘要

`SpeechQueue` 封装分段合成+播放逻辑：
- **合成策略**：串行合成（当前阶段最简单可靠）
- **播放策略**：合成一段播放一段，播放完再合成下一段
- **跳过失败**：某段合成失败 → 日志警告 → 跳过继续
- **speaking 状态**：第一段成功播放时 `onSpeakingChange(true)`，最后一段播放完 `onSpeakingChange(false)`
- **口型联动**：AudioPlayer 已有 AnalyserNode → onMouthData → broadcastMouth 链路，无需额外处理

## 验证结果

| 验证项 | 结果 |
|--------|------|
| TypeScript 编译 | ✅ 零错误 |
| Lint 检查 | ✅ 无错误 |
| 应用加载 | ✅ 所有 UI 正常渲染 |
| 服务初始化 | ✅ 日志正常，mock TTS 正确加载 |
| Mock TTS 回退 | ✅ mock provider 仍可使用 |
| GPT-SoVITS 路径注册 | ✅ provider 选择逻辑已接入真实实现 |
| GPT-SoVITS 真实合成 | ⏳ 需本地 GPT-SoVITS 服务运行才能端到端验证 |

## 当前限制与后续增强项

1. **串行合成** — 当前阶段最安全，后续可升级为受控并发（如 2 路并行预合成）
2. **真流式 TTS** — 当前为分段模式，后续可探索边收边播
3. **中英混合** — 当前仅通过 `textLang` 参数粗粒度标记，不做逐句语言检测
4. **中断/抢占** — 当前 `speakAll` 是不可中断的，后续可加入 AbortController 支持
5. **权重预加载** — 当前首次合成时加载权重，后续可在初始化阶段预加载

## 下一步建议

- 用户配置 GPT-SoVITS 服务地址 + 权重路径后，进行真实端到端验证
- 验证通过后可进入 M3（知识注入）或 M5（外部输入适配）
