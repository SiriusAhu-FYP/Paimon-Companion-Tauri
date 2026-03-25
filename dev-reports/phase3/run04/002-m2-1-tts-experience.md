# Phase 3 Run 04.1 — M2.1 TTS 体验优化

## 完成概要

本次 run 对 TTS 播报体验进行了全面优化，涵盖文本切片重写、口播文本 normalizer、预缓冲合成队列、音频静音裁剪、中英分离、失败注入调试能力。

## 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/services/tts/text-splitter.ts` | 重写 | 语义边界切片 + 短片段合并 + 中英分离 |
| `src/services/tts/spoken-text-normalizer.ts` | 新建 | display_text → spoken_text 转换 |
| `src/services/tts/speech-queue.ts` | 重写 | 1段预缓冲并发合成 + 严格顺序播放 + 失败注入 |
| `src/services/tts/types.ts` | 修改 | VoiceConfig 新增 lang 字段 |
| `src/services/tts/gptsovits-tts-service.ts` | 修改 | synthesize 适配 lang 参数覆盖 |
| `src/services/tts/index.ts` | 修改 | 新增导出 normalizeForSpeech, SplitSegment |
| `src/services/audio/audio-trimmer.ts` | 新建 | WAV 首尾静音裁剪 + fade in/out |
| `src/services/audio/index.ts` | 修改 | 导出 trimSilence, TrimOptions |
| `src/services/pipeline/pipeline-service.ts` | 修改 | 集成 normalizer + SplitSegment + 暴露 getSpeechQueue() |
| `src/utils/mock.ts` | 修改 | 新增 setTTSFailIndex 调试钩子 |

## 切片策略摘要

**硬边界**：`。！？；\n` + 省略号 `...`/`……` + 英文句号（后跟空格+大写字母时）

**软边界**：`，、：,:` — 仅对超过 80 字符的长句启用

**短片段合并**：低于 15 字符的片段与相邻片段合并

**中英分离**：扫描连续英文块（≥4 字符且含空格），独立成段并标注 `lang: "en"`

### 切片示例

**输入**: `"你好！今天天气不错。Let's go to the park. 我们出发吧，记得带伞。"`

**输出**:
```json
[
  {"text": "你好！今天天气不错。", "lang": "zh"},
  {"text": "Let's go to the park.", "lang": "en"},
  {"text": "我们出发吧，记得带伞。", "lang": "zh"}
]
```

**输入**: `"派蒙觉得，这个问题很复杂，需要仔细想想，不过派蒙已经有了一些想法。"`

**输出**: 合并后不会过度碎片化，保持语义完整性。

## 队列实现摘要

- **模式**: 1段预缓冲并发合成 + 严格顺序播放
- 播放 slot[i] 时同步启动 slot[i+1] 的合成
- 播放严格按序，不会乱序
- 合成失败的段跳过，不影响后续段
- `onSpeakingChange` 仅在首段开始和末段结束时触发，段间不抖动

## 首尾留白实验结论

`audio-trimmer.ts` 实现了完整的 WAV PCM 扫描：
- 扫描首部：找到第一个绝对值 > threshold (0.01) 的采样点
- 扫描尾部：找到最后一个绝对值 > threshold 的采样点
- 输出 `leadingSilenceMs` 和 `trailingSilenceMs` 日志

**裁剪策略**:
- 保留 30ms 保护边缘 (marginMs)
- 施加 10ms 线性 fade in/out (fadeMs)
- 静音区域 < 60ms 时不裁剪
- 仅支持 16-bit PCM WAV（GPT-SoVITS 默认输出格式）

**真实数据需连接 GPT-SoVITS 后获取**，预计首尾静音在 50-200ms 范围。

## spoken_text normalizer 摘要

纯函数，rule table 模式，支持以下转换：
- `50%` → `百分之五十`
- `¥100` → `一百元`、`$50` → `五十美元`
- `14:30` → `十四点三十`
- `1+2=3` → `一加二等于三`
- `3.14` → `三点一四`
- `1234` → `一千二百三十四`（≤8位整数）
- `~` → `约`、`×` → `乘`
- 英文单词原样保留

UI 继续显示原始 `fullText`（display_text 不变）。

## 失败注入方式

通过 `window.__paimon.setTTSFailIndex(n)` 设置，指定第 n 个片段（0-based）合成时人为抛异常。

- 设置: `window.__paimon.setTTSFailIndex(1)` — 第 2 段失败
- 清除: `window.__paimon.setTTSFailIndex(null)`
- 效果: 该段跳过，后续段继续合成和播放，整轮不崩溃

## 验证结果

| 项目 | 状态 |
|------|------|
| TypeScript 编译 | ✅ 零错误 |
| Lint 检查 | ✅ 零错误 |
| 页面正常加载 | ✅ |
| 服务初始化正常 | ✅ |
| mock TTS provider 加载 | ✅ |
| mock tools 暴露 | ✅ (含 setTTSFailIndex) |

## 当前限制

1. 真实 GPT-SoVITS 端到端验证需运行 GPT-SoVITS 服务
2. 首尾留白的真实数据需要实际合成音频后采集
3. normalizer 规则集目前覆盖基础场景，可按需扩展
4. 中英分离目前仅对"连续英文含空格"的块独立切段，单词级混合不拆

## 距离 M3 还差什么

- M2.1 已完成，TTS 体验框架就绪
- 下一步可进入 M3（知识注入 / 角色卡导入）或继续 M2 的真实 GPT-SoVITS 端到端调试
- 建议先在 Tauri 环境下连接 GPT-SoVITS 做一次端到端验证后再进 M3
