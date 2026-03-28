# Run 08: 眼神模式修复 + 模型切换稳定性 + UX 改进

## 本次完成内容

### 1. 眼神模式修复（P0）

**根因**：`pixi-live2d-display` 库默认 `autoInteract: true`，会自动监听 `pointermove` 事件驱动模型眼神跟随鼠标。我们之前的代码虽然实现了三种眼神模式，但从未禁用这个默认行为，导致：
- "静止"模式仍然跟随鼠标（被库内部覆盖）
- "随机"模式仍然跟随鼠标（被库内部覆盖）
- "跟随"模式中 `model.focus()` 参数传入的是 [-1,1] 范围值，但实际 API 接受屏幕像素坐标

**修复**：
- `Live2DModel.from(path, { autoInteract: false })` 禁用自动交互
- "静止"模式：`model.focus(canvasW/2, canvasH/2, true)` — 看向 canvas 中心（摄像头方向）
- "跟随"模式：`model.focus(screenX, screenY)` — 直接传入鼠标屏幕坐标
- "随机"模式：正弦叠加偏移转换为像素坐标后传入 `model.focus()`

**文档参考**：[pixi-live2d-display Interactions](https://guansss.github.io/pixi-live2d-display/interactions/)

### 2. 模型切换稳定性修复（P0）

**根因**：之前每次切换模型都 `destroy()` 整个 `Live2DRenderer` 再 `new` 一个新的，同时创建新的 `PIXI.Application`。这导致：
- WebGL context 泄漏（浏览器限制约 16 个 context）
- canvas DOM 元素残留状态不一致
- 切换次数多了之后 WebGL context lost，模型黑屏

**修复**：
- 新增 `Live2DRenderer.switchModel(modelPath)` 方法，复用已有 `PIXI.Application`
- 只清理旧 model（`removeChild` + `destroy`），再加载新 model 到同一个 stage
- `StageWindow` 中初始化用 `initRenderer()`，后续切换用 `switchModel()`
- 两者都是稳定的 `useCallback` 引用，不会触发 effect 重跑

### 3. 9:16 预设标注星标

在 `BUILT_IN_PRESETS` 中为三个 9:16 比例的预设添加 ⭐ 前缀。

### 4. 缩放记忆 + 重置按钮

- 使用 `localStorage` (`paimon-live:stage-zoom`) 持久化缩放比例
- 滚轮缩放后自动保存
- 模型加载/切换后自动恢复上次缩放
- `Live2DRenderer` 新增 `setZoom()` / `resetZoom()` 方法
- `window-sync` 新增 `reset-zoom` 命令
- `StageHost` 缩放区域新增"重置"按钮

### 5. 移除 StageHost 顶部状态栏

移除了 StageHost 组件顶部的状态指示块（播出中/未启动、贴靠/浮动 Chip、情绪/说话状态），因为这些信息已经被底部 StatusBar 完全覆盖。同步移除了 `useCharacter` hook 的使用。

### 6. 底部信息栏位置调整

将 `MainWindow` 布局中 StatusBar 和 EventLog 的顺序交换：
- 事件日志在 StatusBar 上方
- StatusBar 始终固定在窗口最底部

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/features/live2d/live2d-renderer.ts` | 禁用 autoInteract，修复眼神坐标系，新增 switchModel/setZoom/resetZoom |
| `src/features/stage/StageWindow.tsx` | 拆分 initRenderer/switchModel，缩放持久化，reset-zoom 命令 |
| `src/features/stage/StageHost.tsx` | 移除顶部状态栏，9:16 星标，重置缩放按钮 |
| `src/app/MainWindow.tsx` | StatusBar 移至 EventLog 下方 |
| `src/utils/window-sync.ts` | 新增 reset-zoom 命令类型 |

## 验证结果

- TypeScript 编译通过（`npx tsc --noEmit` 无错误）
- Linter 检查通过
- HMR 热更新正常

## 待用户手测验证

- [ ] 静止模式：模型是否面向前方不动，不再跟随鼠标
- [ ] 跟随模式：模型眼神是否正确跟随鼠标移动
- [ ] 随机模式：模型眼神是否沿自然路径缓慢移动
- [ ] 切换模型：多次快速切换是否稳定，不黑屏
- [ ] 缩放记忆：缩放后关闭重开应用是否恢复
- [ ] 重置缩放：按钮是否有效
- [ ] StatusBar 是否在事件日志下方
- [ ] 顶部状态栏是否已移除
