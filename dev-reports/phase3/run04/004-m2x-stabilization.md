# Phase 3 Run 04.3 — M2.x Stabilization 实施报告

## 概述

本次 run 修复了 L2D 加载失败的真正根因（Cubism Core SDK 缺失）、Stage 窗口关闭后无法恢复、语言路由问题，以及自动启动 Stage 的 UX 改进。

## Blocker 1: L2D 模型加载失败

### 真正根因

**`public/Core/live2dcubismcore.min.js` 缺失**。

`pixi-live2d-display/cubism4` 依赖全局加载的 Cubism 4 Core 运行时。该文件在 `.gitignore` 中（`public/Core/` 和 `public/Resources/` 被排除以遵守 Live2D 许可证），因此不会被 `git clone` 或 `pnpm install` 恢复。旧项目 `VoiceL2D-MVP` 中有这些文件，但新项目中丢失了。

报错信息：`Error: Could not find Cubism 4 runtime. This plugin requires live2dcubismcore.js to be loaded.`

### 修复

1. 从旧项目 `VoiceL2D-MVP/frontend/public/Core/` 复制完整 Cubism SDK Core 文件（8 个文件，含 `live2dcubismcore.min.js`、`.d.ts`、LICENSE 等）
2. 将 `index.html` 中 Cubism Core `<script>` 标签从 `<body>` 移到 `<head>`，与旧项目一致，确保在模块脚本之前同步加载

### 关于关闭/重新启动

- `hide-stage` 命令使用 `win.hide()` 而非 `win.close()`（上一轮 commit 已修复）
- `show-stage` 命令在 renderer 已销毁时重新 `initRenderer`
- `handleClose` 使用 `getCurrentWindow().hide()` 而非 `close()`

### 自动启动

- `MainWindow` 新增 `useEffect`：Tauri 环境下自动调用 `handleShowStage`
- 确保应用启动时 Stage 窗口自动可见，默认 clean + docked 模式

### 改动文件

- `public/Core/`（从旧项目复制，8 个文件）
- `index.html`（Cubism Core script 移到 `<head>`）
- `src/app/MainWindow.tsx`（自动启动 Stage）

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

## 重要说明：Cubism Core SDK

`public/Core/` 和 `public/Resources/` 在 `.gitignore` 中，**不会被 git 跟踪**。新环境设置时必须：

1. 从旧项目 `VoiceL2D-MVP/frontend/public/Core/` 复制 Cubism SDK Core
2. 确保 `public/Resources/` 下有 Live2D 模型文件

这不是代码 bug，而是 Live2D 许可证要求。

## 分支信息

- **当前分支**: `feature/phase3-integration`
