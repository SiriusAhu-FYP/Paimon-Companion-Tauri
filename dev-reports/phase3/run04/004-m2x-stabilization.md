# Phase 3 Run 04.3 — M2.x Stabilization 实施报告

## 概述

本次 run 修复了 3 个 blocker，使 M2.x 达到 close-out 条件。

## Blocker 1: L2D 模型加载失败 / 关闭永久杀死窗口

### 根因

`StageWindow.tsx` 中 `hide-stage` 命令和 `handleClose` 都调用了 Tauri `win.close()`。Tauri 窗口一旦 `close()` 就被销毁，无法再通过 `show()` 恢复。再次点击"启动"时，`Window.getByLabel("stage")` 虽然能找到窗口配置，但窗口实例已不存在，导致模型无法显示。

### 修复

| 位置 | 改动 |
|------|------|
| `StageWindow.tsx` `hide-stage` 命令 | `win.close()` → `win.hide()` |
| `StageWindow.tsx` `show-stage` 命令 | 如果 renderer 已销毁，重新调用 `initRenderer` |
| `StageWindow.tsx` `handleClose` | `getCurrentWindow().close()` → `getCurrentWindow().hide()` |
| `MainWindow.tsx` `handleShowStage` | 发送 `broadcastControl({ type: "show-stage" })` 通知 Stage 重建 renderer |

### 改动文件

- `src/features/stage/StageWindow.tsx`
- `src/app/MainWindow.tsx`

## Blocker 2: 语言路由修复

### 根因

`text-splitter.ts` 的 `detectNonCJKLang` 函数存在两个问题：

1. **日文被标为 unsupported**：没有检测假名。日文片段如果 CJK+假名比例 < 30%（短日文、夹杂标点/空格），会走到 `detectNonCJKLang`。而第 152 行的通杀正则 `/[^a-zA-Z0-9\s,.!?;:'"()\-]/` 会命中日文全角标点/假名，把它们标为 `unsupported`。
2. **法语等拉丁文的处理**：纯 ASCII 的法语（如 `Bonjour`）被标为 `en`，而含重音字符的法语（如 `café`）被标为 `unsupported`，行为不一致。

### 修复

`detectNonCJKLang` 重写：

- **新增假名优先检测**：含任何假名 → 直接标为 `ja`
- **移除过于激进的通杀正则**：不再用 `/[^a-zA-Z0-9\s,.!?;:'"()\-]/` 筛查
- **拉丁文统一视为 en**：法语/德文等带重音字符统一归为 `en`（GPT-SoVITS 可处理英文朗读，比跳过好）
- **仅明确的非拉丁文标为 unsupported**：韩文 Hangul、西里尔、阿拉伯、泰文

### 修复后语言路由行为

| 输入 | 标签 | 行为 |
|------|------|------|
| `你好世界` | `zh` | 正常合成 |
| `Hello world` | `en` | 正常合成 |
| `こんにちは` | `ja` | 正常合成 |
| `東京は美しい` | `ja` | 正常合成（假名占比足够） |
| `Bonjour` | `en` | 正常合成（拉丁文统一为 en） |
| `café` | `en` | 正常合成（不再因重音被标 unsupported） |
| `안녕하세요` | `unsupported` | 跳过 |
| `Привет` | `unsupported` | 跳过 |

### 改动文件

- `src/services/tts/text-splitter.ts`

## Blocker 3: unsupported 策略确认

当前策略已在 M2.2 中实现，本次确认无需改动：

- `SpeechQueue.prepareSegment()` 检测到 `segment.lang` 不在 `SUPPORTED_LANGS`（zh/en/ja）时跳过
- `GptSovitsTTSService.synthesize()` 对不在 `LANG_ROUTE` 中的语言返回空 `ArrayBuffer`
- 双层保护，日志明确
- UI `display_text` 保持不变

## 可选增强: TTS 直测输入框

**已存在**。设置面板中 GPT-SoVITS 配置区域已有"TTS 直测输入框"和"合成并播放"按钮，直接调用 TTS 链路合成+播放，不依赖 LLM。

## 验证结果

- [x] TypeScript 编译零错误
- [x] Lint 零错误
- [x] Stage 窗口关闭后可重新启动（hide 而非 close）
- [x] `show-stage` 命令重建 renderer
- [x] 日文假名文本正确标记为 `ja`
- [x] 法语/德文拉丁文统一标记为 `en`
- [x] 韩文/西里尔标记为 `unsupported` 并跳过
- [x] unsupported 行为一致：跳过合成、日志明确、UI 原文保持

## M2.x Close-out 评估

**可以 close-out**。M2.x 的所有 blocker 已修复：

1. L2D 模型正常加载和恢复
2. 语言路由覆盖 zh/en/ja，unsupported 行为一致
3. trim 默认关闭，可选开启
4. 队列审计完成，1-buffer 预缓冲逻辑正确
5. TTS 直测输入框已可用

下一步建议进入 M3（知识注入/角色卡方案设计）。

## 分支信息

- **当前分支**: `feature/phase3-integration`
