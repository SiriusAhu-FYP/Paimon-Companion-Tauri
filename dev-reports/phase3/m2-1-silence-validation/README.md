# M2.1 语音链路实验报告

**分支**：`exp/m2-1-silence-validation`
**日期**：2026-03-25
**实验目的**：验证 M2.1 语音链路中的 4 个核心问题
**实验状态**：代码已注入，等待运行时验证

---

## 1. 实验代码改动概述

本次实验在 3 个文件中注入了增强日志，**不改变任何业务逻辑**：

| 文件 | 改动类型 | 实验目标 |
|------|----------|----------|
| `src/services/audio/audio-trimmer.ts` | 增强日志 | 精确测量首尾留白 |
| `src/services/tts/speech-queue.ts` | 时间戳日志 | 分析队列与卡顿 |
| `src/services/tts/gptsovits-tts-service.ts` | 入参日志 | 验证语言标签路由 |

---

## 2. 预期日志输出格式

### 2.1 首尾留白日志（audio-trimmer.ts）

每次调用 `trimSilence` 时输出：

```
[EXP-trim] leading=150ms, trailing=200ms, total=1500ms
[EXP-trim] TRIMMED 250ms silence (original=1500ms -> trimmed=1250ms, leading=150ms, trailing=200ms)
```

或跳过裁剪时：

```
[EXP-trim] SKIP — silence below threshold (60ms total), returning original
```

**解读**：
- `leading` > 0 表示前导静音存在
- `trailing` > 0 表示尾部静音存在
- GPT-SoVITS 正常情况下前导静音约 50-200ms，尾部静音约 100-300ms
- 如果 `leading` 或 `trailing` 经常 > 500ms，说明问题较严重

### 2.2 队列时间戳日志（speech-queue.ts）

每段播放时输出：

```
[EXP-timing][1/3] synth=800ms, play=1200ms, gap=0ms, text="今天天气真好..." lang=zh
[EXP-timing][2/3] synth=750ms, play=1100ms, gap=5ms, text="我们一起去公园散步吧" lang=zh
[EXP-timing][3/3] synth=820ms, play=1300ms, gap=3ms, text="希望你有愉快的一天" lang=zh
[EXP-timing] TOTAL: 3980ms for 3 segments
[EXP-timing] segment 1 pre-buffer: OK (play_start=800, next_synth_done=750)
[EXP-timing] segment 2 pre-buffer: OK (play_start=1905, next_synth_done=1570)
```

**关键指标解读**：

| 指标 | 健康值 | 警告值 | 说明 |
|------|--------|--------|------|
| `gap[i]` | < 50ms | > 100ms | 段间间隙，越小说明预缓冲越有效 |
| `pre-buffer` | OK | FAILED | FAILED 说明合成赶不上播放，需要等 |
| `synth_duration` | 依 TTS 性能 | > 2000ms | 合成过慢会导致整体卡顿 |

### 2.3 语言标签日志（gptsovits-tts-service.ts）

```
[EXP-lang] synthesize: text="Hello, how are you today...", rawLang=en, textLang=en
[EXP-lang] synthesize: text="你好，今天天气不错", rawLang=zh, textLang=zh
[EXP-lang] unsupported lang="ja" for text="こんにちは..." — will use fallback
[EXP-lang] synthesize: text="こんにちは...", rawLang=ja, textLang=UNSUPPORTED
```

---

## 3. 实验测试样本

建议使用以下测试样本触发不同场景：

### 样本集 A：首尾留白测试

| 样本 | 文本 | 预期 lang |
|------|------|-----------|
| A1 | 你好 | zh |
| A2 | 今天天气真好，我们一起去公园散步吧 | zh |
| A3 | Hello, how are you today | en |
| A4 | 你好hello世界world | 混合 → 拆分 |
| A5 | こんにちは（日本用户问好） | ja → UNSUPPORTED |

### 样本集 B：队列与卡顿测试

建议用较长的 LLM 回复（如 5-8 句话）来测试多段场景。

---

## 4. 验证检查清单

### 问题 1：GPT-SoVITS 首尾留白

- [ ] 运行样本 A1-A5，观察每段的 `[EXP-trim]` 日志
- [ ] 记录每段 `leading` 和 `trailing` 的毫秒数
- [ ] 对比不同类型文本（短句 vs 长句 vs 纯英文 vs 混合）

**预期结论**：
- 如果 `leading` 普遍 > 100ms 且不同样本差异大 → 首尾留白确实存在且明显
- 如果 `trailing` 普遍 > 200ms → 尾部留白比前导更严重
- 短文本（如"你好"）的静音占比会明显更高

### 问题 2：卡顿主因分析

- [ ] 观察 `gap[i]` 的值
- [ ] 检查 `pre-buffer` 是否出现 FAILED
- [ ] 对比 `synth_duration` vs `play_duration`

**判断逻辑**：

```
如果 gap[i] 经常 > 100ms 且 pre-buffer = FAILED → 卡顿主因是合成慢
如果 gap[i] 很小但总体播放不流畅              → 卡顿主因是 trimSilence 或 player 延迟
如果 pre-buffer 总是 OK 但仍有卡顿            → 瓶颈在 player.play() 而非合成
```

### 问题 3：预缓冲是否工作

- [ ] 检查每段的 `pre-buffer` 状态
- [ ] 正常情况：`next_synth_done < current_play_start`（合成在播放前完成）

**判断逻辑**：

```
pre-buffer = OK  → 1段预缓冲正常工作
pre-buffer = FAILED → 合成赶不上播放，存在等待
```

### 问题 4：语言标签路由

- [ ] 运行样本 A3（纯英文），确认 lang=en 正确传递
- [ ] 运行样本 A4（混合），确认拆分正确
- [ ] 运行样本 A5（日文），确认 UNSUPPORTED 被标记

---

## 5. 初步代码分析结论

### 5.1 首尾留白

**代码分析**：`trimSilence` 已实现首尾静音裁剪逻辑：
- 阈值：`threshold = 0.01`（样本绝对值 / 最大值）
- 保护边缘：`marginMs = 30ms`
- Fade：10ms linear fade in/out
- 裁剪条件：leading 或 trailing > `marginMs * 2`（即 60ms）

**结论**：现有实现已经能裁剪静音，但：
1. 30ms 的保护边缘可能仍然偏大（可以降到 10-15ms）
2. 阈值 0.01 可能对某些低声量语音过于敏感
3. 建议用真实 GPT-SoVITS 输出验证实际留白量级

### 5.2 预缓冲实现

**代码分析**：`speechQueue.speakAll()` 的实现是正确的 1 段预缓冲：
- 第 i 段播放时，第 i+1 段的合成已经并发启动
- 下一段合成完成后才进入播放（通过 await nextSynthPromise）
- 但这里是**顺序等待**而非真正的流式：等待第 i 段合成完成才开始播放

**潜在问题**：代码逻辑是"等待当前段合成完成后再播放"，而不是"合成和播放同时进行"。当前段播放时，下一段的合成已经在进行中，但**等待机制**是串行的：

```
await nextSynthPromise!  // 这里会等待当前段合成完成
// 然后播放
// 然后进入下一轮循环，再 await 下一段合成
```

这意味着：
- 如果合成 800ms + 播放 1200ms，总时间约 2000ms/段
- 预缓冲的价值在于：第 i 段播放时，第 i+1 段已经在合成

### 5.3 语言标签

**代码分析**：`text-splitter.ts` 的 `separateLanguages` 逻辑：
- 连续英文 ≥4 字符且含空格才独立成段（避免单词级别切分）
- 中文为主的段落中嵌入的英文会被提取为独立 `lang=en` 段
- GPT-SoVITS 支持：`zh`、`en`、`auto`、`ja`

**待验证**：日文（ja）传入 GPT-SoVITS 后的实际效果

---

## 6. 建议的后续动作

### 6.1 如果首尾留白确实明显

**推荐方案**：引入 Opus 无损压缩

```
原始 WAV → trimSilence → encodeOpus → 传输/缓存 → decodeOpus → play
```

好处：
- 无损压缩，减少传输带宽
- 保持语音质量
- 可以做更精确的首尾裁剪（因为 Opus 可以精确到帧）

### 6.2 如果合成是瓶颈

**推荐方案**：
1. 减少每段文本长度（更细粒度切片）
2. 预热 TTS（提前合成常用片段）
3. 流式 TTS 边合成边播放（如果 GPT-SoVITS 支持）

### 6.3 如果预缓冲未工作

**推荐方案**：检查 `synthDoneMs` 和 `playStartMs` 的时序，确保合成确实在播放开始前完成。

### 6.4 语言标签 fallback

对于不支持的语言（ja, ko 等），建议：
1. 检测到时返回警告日志
2. 尝试 fallback 到 `zh` 或 `auto`
3. 如果效果不好，在 KnowledgeService 中标记为"需要人工接管"

---

## 7. 实验代码留痕建议

| 文件 | 建议 |
|------|------|
| `speech-queue.ts` 的时间戳日志 | **建议保留** — 对调试性能问题很有用 |
| `audio-trimmer.ts` 的增强日志 | **建议保留** — 但可以降级为 debug 级别 |
| `gptsovits-tts-service.ts` 的语言标签日志 | **建议保留** — 验证路由正确性 |

---

## 8. 尚未完成的步骤

- [ ] **运行实验**：在桌面环境中运行 `pnpm tauri dev`，触发 pipeline 测试
- [ ] **收集数据**：从控制台日志中提取 `[EXP-trim]`、`[EXP-timing]`、`[EXP-lang]` 数据
- [ ] **填写验证结果**：根据实际运行结果填充上面的检查清单

---

## 附录：关键代码片段

### A. trimSilence 的裁剪条件

```typescript
// 如果静音区域很小（< 2 * margin），不裁剪
const minSilenceMs = marginMs * 2; // = 60ms
if (leadingSilenceMs < minSilenceMs && trailingSilenceMs < minSilenceMs) {
    return audioData; // 不裁剪
}
```

### B. 预缓冲时序逻辑

```typescript
for (let i = 0; i < segments.length; i++) {
    const current = await nextSynthPromise!;     // 等待当前段合成
    nextSynthPromise = this.synthesizeSegment(segments[i + 1]); // 预启动下一段
    // ...
    await this.player.play(audioToPlay);         // 播放当前段
}
```
