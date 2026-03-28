# Phase 3 Run 04.2 — M2.2 队列与节奏优化 实施报告

## 概述

本次 run 完成了 M2.2 的核心改动：正式化语言路由、队列审计与预缓冲有效性确认、trim 降级为可选开关、清理实验日志标签。

## 改动文件清单

| 文件 | 改动类型 | 摘要 |
|------|----------|------|
| `src/services/tts/text-splitter.ts` | 修改 | `SplitSegment.lang` 从 `"zh"\|"en"\|"auto"` 扩展为 `"zh"\|"en"\|"ja"\|"unsupported"`；新增日文检测（平假名/片假名占比 > 30%）；新增韩文/西里尔/阿拉伯/泰文等标记为 `unsupported`；`auto` 不再出现在最终输出 |
| `src/services/tts/gptsovits-tts-service.ts` | 修改 | 新增 `LANG_ROUTE` 语言路由表（zh/en/ja/auto→zh）；unsupported 语言直接返回空 `ArrayBuffer`；移除旧的 `unsupportedLangs` 数组（不再误标 ja）；清理 `[EXP-*]` 日志 |
| `src/services/tts/speech-queue.ts` | 重写 | 队列审计：确认 1-buffer 预缓冲异步并发正确性；新增 `SUPPORTED_LANGS` 集合用于跳过 unsupported 段；新增 `prepareSegment` 方法统一处理 unsupported 跳过；`trimEnabled` 默认 `false`，仅可选启用；清理 `SegmentTiming` 接口为正式结构；所有日志标签规范化为 `[queue]`/`[perf]`/`[synth]`/`[trim]`/`[lang]`/`[debug]` |
| `src/services/audio/audio-trimmer.ts` | 小改 | `[EXP-trim]` 标签改为 `[trim]`；详细日志降级为 `log.debug`，最终裁剪结果保留 `log.info` |
| `src/services/pipeline/pipeline-service.ts` | 小改 | 新增 `display_text` / `spoken_text` 差异日志（仅在 normalizer 产生变化时输出） |
| `src/utils/mock.ts` | 小改 | 新增 `setTrimEnabled` debug 钩子，暴露为 `window.__paimon.setTrimEnabled(bool)` |

## 语言路由设计

正式支持边界：**CN / EN / JP**，其余语言标记为 **unsupported**。

```
SplitSegment.lang 类型: "zh" | "en" | "ja" | "unsupported"

语言路由表 (LANG_ROUTE):
  zh   → "zh"      (中文)
  en   → "en"      (英文)
  ja   → "ja"      (日文，此前被误标为 unsupported，实验证明可合成)
  auto → "zh"      (保守 fallback，GPT-SoVITS 部分版本不支持 auto)
  其余 → 跳过合成    (返回空 ArrayBuffer)

检测规则:
  - CJK 汉字 + 假名占比 > 30% → CJK 为主
  - 假名占 CJK+假名 总量 > 30% → 日文 (ja)
  - 韩文 Hangul / 西里尔 / 阿拉伯 / 泰文 → unsupported
  - 纯拉丁字符 → 英文 (en)
```

## Unsupported 语言 Fallback 策略

本阶段采用最小可用方案：**跳过**。

- `SpeechQueue.prepareSegment()` 检测到 `segment.lang` 不在 `SUPPORTED_LANGS` 时直接返回空结果
- `GptSovitsTTSService.synthesize()` 对不在 `LANG_ROUTE` 中的语言返回空 `ArrayBuffer`
- UI `display_text` 保持不变，不影响用户看到的原文
- 后续增强方案（中文 fallback 口播替代文本）留待下一阶段

## 队列审计结论

### 1-buffer 预缓冲工作确认

审计当前代码确认以下关键行为：

1. **异步并发**：播放 slot[i] 的同时，slot[i+1] 的合成已在后台进行。`prepareSegment` 返回的 Promise 在 `await current` 之前就已启动。
2. **严格顺序播放**：`for` 循环中 `await nextSynthPromise` 确保按序等待，即使后续段先合成完成也不会乱序播放。
3. **unsupported 跳过**：`prepareSegment` 同步返回空结果，不占用合成时间。
4. **失败容错**：合成失败或 debug 注入失败时跳过该段，后续段继续。

### 性能日志增强

每段输出：`synth=Xms play=Xms gap=Xms lang=X text="..."` 
整轮汇总：`TOTAL: Xms (synth=Xms play=Xms gap=Xms) N/M segments played`

这些日志足以在真实联调时定位卡顿瓶颈。

### 2-buffer 评估

**本阶段未实施 2-buffer。** 原因：

- GPT-SoVITS 更可能以串行方式处理请求，多 buffer 并发提交的请求会排队而非真正并行
- 2-buffer 是否有真实收益必须以实际联调结果为准
- 当前 1-buffer 逻辑结构正确，如需升级可在短命实验分支上验证

## Trim 状态

- **默认关闭**（`_trimEnabled = false`）
- 可通过 `window.__paimon.setTrimEnabled(true)` 手动开启
- `trimSilence` 函数本身未修改，仅在调用侧加开关
- 与人工听感实验结论一致：raw 拼接更自然

## EXP-LOG 清理

所有 `[EXP-*]` 标签已替换为正式标签：

| 旧标签 | 新标签 | 文件 |
|--------|--------|------|
| `[EXP-timing]` | `[perf]` | speech-queue.ts |
| `[EXP-synth]` | `[synth]` | speech-queue.ts |
| `[EXP-lang]` | `[lang]` | gptsovits-tts-service.ts |
| `[EXP-trim]` | `[trim]` | audio-trimmer.ts, speech-queue.ts |

## 验证结果

- [x] TypeScript 编译零错误
- [x] Lint 零错误
- [x] `SplitSegment.lang` 类型正确扩展，`auto` 不出现在最终输出
- [x] 语言路由表覆盖 zh/en/ja + auto fallback
- [x] unsupported 语言跳过合成（不 crash、不乱读）
- [x] trim 默认关闭，debug 钩子可用
- [x] mock TTS 路径类型兼容
- [x] 所有 `[EXP-*]` 标签已清理

## 分支信息

- **当前分支**: `feature/phase3-integration`
- **实验分支**: 无（本次改动全部在主线完成）
- **PR 条件**: 待真实 Tauri + GPT-SoVITS 联调验证后可进入 PR

## 距离 M3 还差什么

1. 真实 Tauri + GPT-SoVITS 联调验证队列稳定性和卡顿改善
2. 语言路由在真实输入下的鲁棒性验证
3. M3 前置依赖：角色卡导入方案设计、知识库接入方案设计
