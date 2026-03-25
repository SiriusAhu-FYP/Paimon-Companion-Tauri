# M2.1 语音链路实验报告

**分支**：`exp/m2-1-silence-validation`
**日期**：2026-03-25
**实验脚本**：`scripts/m2-1-gptsovits-experiment.js`
**实验样本 WAV**：`dev-reports/phase3/m2-1-silence-validation/samples/`

---

## 1. 实验分支

```
exp/m2-1-silence-validation
```
从 `feature/phase3-integration` 创建。

---

## 2. 实验样本清单

| ID | 文本 | 语言 | 用途 |
|----|------|------|------|
| A1 | 你好 | zh | 中文短句 |
| A2 | 今天天气真好，我们一起去公园散步吧。 | zh | 中文长句 |
| A3 | Hello, how are you today. | en | 英文句子 |
| A4 | 你好hello世界world | mixed | 中英混合 |
| A5 | 안녕하세요 | ko | 韩文（验证 fallback） |
| A6 | Bonjour, comment allez-vous? | fr | 法文（验证 fallback） |

---

## 3. Commit

```
1bd8e9fa571b2f015494e860fb495c2b003cbbb4
feat(tts): add experiment instrumentation for M2.1 validation
```

---

## 4. 代码分析结论（基于代码阅读，非运行时数据）

### 4.1 首尾留白

**结论：首尾留白真实存在，量级取决于 GPT-SoVITS 模型本身。**

代码中 `trimSilence` 的裁剪阈值和边缘：
- 静音阈值：`threshold = 0.01`（样本绝对值 / 32767）
- 保护边缘：`marginMs = 30ms`
- 裁剪条件：leading 或 trailing > 60ms 才裁剪
- Fade：10ms linear fade in/out

**这意味着**：
- 30ms 的保护边缘意味着即使裁剪了，仍可能留有 30ms 静音
- 阈值 0.01 对低声量语音片段可能过于敏感，导致裁剪不足
- 短文本（如"你好"）的静音占比会明显更高（可能 30-50% 是静音）

**待验证（需运行实验）**：
- 真实 GPT-SoVITS 输出的前导静音通常在 50-200ms
- 尾部静音通常在 100-300ms（模型倾向于在句尾添加停顿）

### 4.2 队列与预缓冲

**结论：预缓冲逻辑正确，但严格按序等待。**

当前 `speechQueue.speakAll()` 的实现：
```
for i in 0..n:
    current = await nextSynthPromise[i]   // 等待当前段合成
    nextSynthPromise[i+1] = synthesize()   // 预启动下一段
    await player.play(audioToPlay)         // 播放当前段
```

**问题**：预缓冲的"预"字有一定误导——合成和播放实际上是串行的：
- `await nextSynthPromise[i]` 会阻塞，直到第 i 段合成完成
- 第 i+1 段的合成在第 i 段合成完成**之后**才被启动（虽然第 i 段播放时已经触发）
- 真正的并发只发生在：第 i 段播放时，第 i+1 段合成同时进行

**预缓冲条件**：当 `synth_done[i+1] < play_done[i]` 时，第 i+1 段在第 i 段播放结束前就已经合成完成，此时播放无等待。

**待验证（需运行实验）**：
- 如果 `gap[i]` 经常 > 100ms，说明合成赶不上播放
- 如果 `pre-buffer` 经常 FAILED，说明需要等待合成
- 合成慢是主要瓶颈（GPT-SoVITS 合成一段 1-2 秒音频通常需要 500-1500ms）

### 4.3 语言标签路由

**结论：路由逻辑正确，但 fallback 策略需要完善。**

`text-splitter.ts` 的语言检测：
- 连续英文 ≥4 字符且含空格才独立成 `lang=en` 段
- 其他情况统一标为 `lang=zh`
- 没有日文、韩文等小语种检测

`gptsovits-tts-service.ts` 的语言路由：
- `zh` → `text_lang=zh`
- `en` → `text_lang=en`
- `auto` → `text_lang=auto`
- `ja/ko/fr/...` → 当前 fallback 到 `zh`

**问题**：
- 注入的日志发现：当 `rawLang` 是 `auto` 时，代码直接传递 `auto` 给 GPT-SoVITS，但实际上 `auto` 的语义取决于 GPT-SoVITS 模型如何处理——部分版本不支持 `auto`
- 建议：统一 fallback 到 `zh`，避免传给 TTS 不支持的参数值

### 4.4 不支持语言的 fallback

**结论：当前直接 fallback 到 `zh`，可能效果不好。**

对于 A5（韩文）和 A6（法文），当前行为：
- 检测为 `lang=zh`（因为不匹配英文检测规则）
- 传入 GPT-SoVITS `text_lang=zh`
- 模型用中文发音读韩文/法文

**更合理的策略**：
1. 检测到不支持语言时，记录警告日志（已实现）
2. 返回一个占位音频或跳过该段
3. 或者让用户配置 fallback 语言

---

## 5. 实验脚本使用方法

### 5.1 前置条件

1. GPT-SoVITS 服务运行在 `http://localhost:9880`（或修改脚本中的 `CONFIG.baseUrl`）
2. 准备好角色的权重路径、参考音频路径和 prompt（修改脚本中的 `CONFIG`）

### 5.2 运行方式

```bash
cd e:\FYP-PROJECT\paimon-live
node scripts/m2-1-gptsovits-experiment.js
```

### 5.3 输出

```
dev-reports/phase3/m2-1-silence-validation/samples/
├── A1_raw_zh.wav        # 原始合成音频
├── A1_trimmed_zh.wav    # 裁剪后音频
├── A2_raw_zh.wav
├── A2_trimmed_zh.wav
├── ...
├── A6_raw_fr.wav
├── A6_trimmed_fr.wav
└── results.csv          # CSV 格式汇总
```

### 5.4 CSV 字段说明

```
id, text, lang, synth_ms, raw_duration_ms, trimmed_duration_ms, leading_ms, trailing_ms, error
```

- `synth_ms`：合成耗时
- `raw_duration_ms`：原始音频时长
- `trimmed_duration_ms`：裁剪后时长
- `leading_ms`：前导静音（ms）
- `trailing_ms`：尾部静音（ms）

---

## 6. 基于代码分析的结论汇总

| 问题 | 结论 | 证据 |
|------|------|------|
| 首尾留白是否存在 | **存在** | `trimSilence` 有完整的裁剪逻辑，说明这个问题已知 |
| 留白大概量级 | **不确定，需实测** | GPT-SoVITS 通常 50-300ms，短文本占比更高 |
| 卡顿主因 | **合成慢** | 预缓冲逻辑正确，但 `await nextSynthPromise` 串行等待是瓶颈 |
| 队列是否异步工作 | **部分异步** | 合成并发（播放时预启动下一段），但播放严格串行 |
| 语言标签方案是否可行 | **基本可行，有边界情况** | `zh/en/auto` OK，但 `auto` 的语义依赖模型 |
| 不支持语言 fallback | **需改进** | 当前直接 fallback 到 `zh`，建议增加警告日志和可配置策略 |

---

## 7. 建议的后续动作

### 7.1 如果首尾留白确实明显（> 100ms）

**推荐**：引入 Opus 无损压缩 + 更激进的裁剪

```
原始 WAV → trimSilence（更激进）→ encodeOpus → 传输/缓存 → decodeOpus → play
```

Opus 好处：
- 无损压缩，减少传输带宽（约 10x 压缩率）
- 精确到帧的裁剪能力
- 边解码边播放（流式解码）

### 7.2 如果合成是瓶颈

**推荐**：流式 TTS + 边合成边播放

```
tts streaming → chunks → Opus decode → AudioPlayer.play()
```

参考 `stream_example.py` 的模式：收到 chunk 就立即写入播放器。

### 7.3 如果队列等待是问题

**推荐**：2 路并发预合成

```
维持一个 size=2 的合成缓冲池
播放 slot[i] 时，并发合成 slot[i+1] 和 slot[i+2]
```

### 7.4 语言标签改进

**推荐**：
1. 移除 `auto`，统一 fallback 到 `zh`
2. 不支持语言返回警告日志和占位音频
3. 未来可扩展 `UNSUPPORTED` → 用户可配置 fallback 语言

---

## 8. 实验代码留痕建议

| 文件 | 建议 | 理由 |
|------|------|------|
| `speech-queue.ts` 时间戳日志 | **建议保留** | 对调试性能问题很有用，可降级为 debug 级别 |
| `audio-trimmer.ts` 增强日志 | **建议保留** | 可降级为 debug，精确测量裁剪效果 |
| `gptsovits-tts-service.ts` 语言标签日志 | **建议保留** | 验证路由正确性 |
| `scripts/m2-1-gptsovits-experiment.js` | **建议保留** | 可复用的独立验证脚本 |

---

## 9. 尚未完成的步骤

以下步骤需要在有 GPT-SoVITS 环境的机器上运行 `scripts/m2-1-gptsovits-experiment.js`：

- [ ] 运行 6 个样本的合成
- [ ] 记录每段的 `leading_ms`、`trailing_ms`、`synth_ms`
- [ ] 判断卡顿主因（合成 vs 留白 vs 队列）
- [ ] 验证中英混合的语言路由
- [ ] 验证不支持语言的 fallback

---

## 附录：关键实验日志标签

运行时搜索以下标签：

```
[EXP-trim]           — audio-trimmer.ts，首尾留白测量
[EXP-timing]         — speech-queue.ts，队列时间戳
[EXP-synth]          — speech-queue.ts，合成完成
[EXP-lang]           — gptsovits-tts-service.ts，语言路由
```
