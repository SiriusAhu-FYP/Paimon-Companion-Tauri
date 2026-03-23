# Phase 2 Run07: Stage UX 增强与布局修复

## 本次完成内容

### 1. 鼠标滚轮缩放模型 + 锁定功能
- `Live2DRenderer` 新增 `applyZoomDelta()` / `getZoom()` API，维护 `userZoom` 与 `baseScale` 分离
- `StageWindow` 监听 canvas `wheel` 事件，非锁定时调用缩放
- `StageHost` 新增缩放锁定开关按钮，通过 `set-scale-lock` ControlCommand 同步
- 缩放范围限制在 0.2x ~ 5x

### 2. 浮动模式预设窗口尺寸（OBS 清晰度妥协方案）
- `StageHost` 在浮动模式下显示窗口尺寸控制区
- 内置 5 种预设：1:1(400), 4:3(640x480), 16:9(720p), 16:9(1080p), 9:16(480x854)
- 支持保存自定义尺寸预设（名称 + 宽高），存储在 localStorage
- 支持删除自定义预设
- 通过 `set-size` ControlCommand 控制 Stage 窗口尺寸

### 3. 贴靠模式 Stage 高度/位置修正
- **根因**：`StageSlot` 仅监听 `window.resize`，打开/关闭日志栏等 React 内部布局变化不触发 resize 事件
- **修复**：改用 `ResizeObserver` 监听 StageSlot DOM 元素尺寸变化
- 同时解决了全屏后 X 方向不修正的问题
- `MainWindow` 中 `handleSlotRectChange` 变更时自动触发 `debouncedSync()`

### 4. 全屏后 Stage X 方向修正
- 与任务 3 同一方案解决：`ResizeObserver` + debounced sync

### 5. clean 模式 Stage 窗口边框
- **根因**：Tauri 在 Windows 上 `decorations: false` 时，DWM shadows 实现会渲染一条细边框（已知 bug tauri-apps/tauri#10889）
- **修复**：`tauri.conf.json` 中 stage 窗口配置增加 `"shadow": false`

### 6. 隐藏 Stage 时不预留占位
- `MainWindow` 中 StageSlot 区域改为条件渲染：仅在 `stageVisible && stageMode === "docked"` 时显示
- 隐藏或浮动模式时 StageSlot 完全不渲染，ChatPanel 自动 flex 扩展

### 7. 眼神模式（三选一）
- `Live2DRenderer` 新增 `setEyeMode()` / `getEyeMode()` / `focusMouse()` API
- **静止 (fixed)**：`model.focus(0, 0, true)` 固定注视前方
- **跟随鼠标 (follow-mouse)**：`StageWindow` 监听 mousemove，转换为 [-1,1] 坐标调用 `model.focus()`
- **随机路径 (random-path)**：多频率正弦叠加生成自然缓慢注视路径，requestAnimationFrame 驱动
- `StageHost` 新增三按钮组切换眼神模式
- 默认模式为 `random-path`

### 8. 切换模型后预览失效
- **根因**：`app.destroy(true)` 会销毁 canvas DOM 元素，导致新 renderer 用已销毁的 canvas
- **修复**：改为 `app.destroy(false, { children: true, texture: true, baseTexture: true })`，保留 canvas DOM 元素
- model 单独调用 `model.destroy()` 确保资源释放
- `init()` 中 `this.destroyed = false` 允许复用 renderer

## 改动文件

| 文件 | 改动 |
|------|------|
| `src-tauri/tauri.conf.json` | stage 窗口加 `shadow: false` |
| `src/features/live2d/live2d-renderer.ts` | 缩放API、眼神模式、destroy修复 |
| `src/features/live2d/index.ts` | 导出 EyeMode 类型 |
| `src/features/stage/StageWindow.tsx` | 滚轮缩放、眼神模式、set-size/set-scale-lock/set-eye-mode 命令 |
| `src/features/stage/StageSlot.tsx` | ResizeObserver 替代 window.resize |
| `src/features/stage/StageHost.tsx` | 缩放锁、眼神切换、浮动尺寸预设 |
| `src/features/control-panel/ControlPanel.tsx` | 无结构变化，保持稳定 |
| `src/app/MainWindow.tsx` | StageSlot 条件渲染、debouncedSync |
| `src/utils/window-sync.ts` | 新增 set-scale-lock/set-eye-mode/set-size/EyeMode 类型 |

## 新增 ControlCommand

- `set-scale-lock { locked: boolean }` — 锁定/解锁滚轮缩放
- `set-eye-mode { mode: EyeMode }` — 切换眼神模式
- `set-size { width, height }` — 设置 Stage 窗口尺寸

## 风险与注意事项

1. `shadow: false` 在某些 Windows 版本上行为可能略有差异，需真机验证
2. 自定义预设存储在 localStorage，清除浏览器数据会丢失
3. 随机路径眼神的正弦参数可根据实际效果微调频率和幅度

## 测试建议

- [ ] 启动应用，确认 Stage 窗口在 clean 模式下无边框
- [ ] 切换模型，确认预览不失效
- [ ] 滚轮缩放模型，确认锁定后不可缩放
- [ ] 切换三种眼神模式，确认效果
- [ ] 打开/关闭日志栏，确认 Stage 窗口高度自动调整
- [ ] 全屏/还原窗口，确认 Stage X/Y 修正
- [ ] 隐藏 Stage，确认 StageSlot 区域折叠
- [ ] 浮动模式下使用尺寸预设，确认窗口大小变化
- [ ] 保存/删除自定义尺寸预设
