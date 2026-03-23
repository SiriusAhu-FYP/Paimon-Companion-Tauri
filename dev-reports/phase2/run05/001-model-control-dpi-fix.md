# Phase 2 Run05 — 模型控制正确性 + 口型驱动 + DPI 清晰度修复

## P0-1: 表情/动作控制语义修复

### 根因
`Live2DRenderer.setEmotion()` 在切换情绪时，除了设置参数覆盖外，还会**额外触发 motion 播放**：
- `happy`/`surprised` → `model.motion("TapBody", 0)`
- 其他非 neutral → `model.motion("Idle", 随机索引)`

这些 motion 自带参数动画，会在后续帧中覆盖表情参数（`applyEmotionParams` 每帧写入的值被 motion 系统读回覆盖），导致"点了表情按钮但模型播放了另一套动作"的现象。

此外，`surprised` 的 `EMOTION_PARAMS` 中包含 `ParamMouthOpenY: 0.6`，与口型驱动争用同一参数。

### 修复方案
- **彻底分离表情和动作**：`setEmotion()` 只更新 `currentEmotion` 标记，不触发任何 motion
- 每帧 ticker 中的 `applyEmotionParams()` 在 motion 系统之后执行，参数覆盖优先级高于 motion
- 移除 `surprised` 中的 `ParamMouthOpenY`，口型完全由 `setMouthOpenY()` 独占
- `playMotion()` 作为独立入口保留，用于需要播放动作的场景

### 最终控制语义边界

| 维度 | 负责者 | 入口 | 说明 |
|------|--------|------|------|
| Emotion（表情） | `setEmotion()` | 控制面板按钮 / LLM tool | 每帧覆盖 Cubism 参数，不触发 motion |
| Motion（动作） | `playMotion()` | 独立调用（暂无 UI 入口） | 触发模型 motion 动画 |
| MouthOpenY（口型） | `setMouthOpenY()` | AudioPlayer AnalyserNode | 高频独立通道，始终覆盖 |

## P0-2: 口型驱动修复

### 根因
`mockVoicePipeline()` 只发送总线事件（`audio:tts-start` / `audio:tts-end` 等），**从未调用 `pipeline.run()`**。而口型数据只有在 `pipeline.run()` → `player.play()` → `AnalyserNode.pumpMouthData()` 路径中才会产生。

### 修复方案
改造 `mockVoicePipeline()` 走完整 pipeline 路径：
- 调用 `getServices().pipeline.run()` 执行 mock LLM → mock TTS（生成正弦波 WAV）→ AudioPlayer.play() → AnalyserNode 提取音量 → `onMouthData` 回调 → `broadcastMouth` → Stage 接收

### 口型数据路径
```
pipeline.run() → MockLLM → MockTTS(正弦波WAV)
  → AudioPlayer.play() → AnalyserNode.pumpMouthData()
    → emitMouth(value) → broadcastMouth(value)
      → Stage: onMouthSync → setMouthOpenY(value)
```

同时，ticker 中口型参数改为**始终写入**（即使 mouthOpenY 为 0），确保口型能可靠复位。

## P0-3: Stage 渲染清晰度/DPI 修复

### 根因
`PIXI.Application` 创建时使用 CSS 像素（逻辑像素）作为 canvas backing store 分辨率，未考虑 `devicePixelRatio`。在高 DPI 屏幕（如 150%/200% 缩放）或 OBS 放大场景下，渲染明显模糊。

### 修复方案
- 获取 `window.devicePixelRatio`，创建 PIXI Application 时传入 `resolution: dpr` + `autoDensity: true`
- 物理像素 = 逻辑像素 × DPR
- canvas CSS 尺寸保持逻辑像素，WebGL backing store 按物理像素渲染
- `resize()` 时重新读取 DPR，适配动态 DPI 变化

## P1-4: floating 保留尺寸

### 根因
`handleModeChange` 在 `docked → floating` 时硬编码 `setSize(800, 600)`。

### 修复
移除硬编码尺寸，floating 切换时保留当前 Stage 窗口尺寸。

## P1-5: docked 背景文字

### 修复
docked + visible 状态下不再显示 StageSlot 中的文字提示（"Stage 覆盖此区域"），因为 Stage 窗口会覆盖此区域但文字可能穿透显示。仅在 docked + 未启动 或 floating 模式下显示引导文字。

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/features/live2d/live2d-renderer.ts` | 分离 emotion/motion 控制；DPI 适配；口型始终写入 |
| `src/utils/mock.ts` | mockVoicePipeline 走完整 pipeline 路径 |
| `src/features/stage/StageSlot.tsx` | docked+visible 时不显示文字 |
| `src/features/stage/StageWindow.tsx` | canvas 样式修正 |
| `src/features/control-panel/ControlPanel.tsx` | 适配 async mockVoicePipeline |
| `src/app/MainWindow.tsx` | 移除 floating 硬编码尺寸 |

## 验证

- `npx tsc --noEmit` 通过
- 0 个 lint 错误

## 尚存问题 / 距离 Phase 2 close-out 还差什么

1. **手测确认**：以上修复需在真实 Tauri 桌面环境 + OBS 中验证
2. **口型可见性**：依赖 mock TTS 生成的正弦波是否足够驱动 AnalyserNode 产生明显口型变化
3. **DPI 变化**：需验证在不同 Windows 缩放比例下清晰度是否改善
4. **Phase 2 close-out 条件**：
   - 表情按钮与模型表现一致 ✅（代码层面已修复）
   - 口型在 mock pipeline 中可见变化 ✅（代码层面已修复）
   - Stage DPI 清晰度明显改善 ✅（代码层面已修复）
   - 以上均需真实手测确认

## Commit

待提交后补充 hash。
