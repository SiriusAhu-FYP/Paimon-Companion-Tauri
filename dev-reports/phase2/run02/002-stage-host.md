# Phase 2 Stage Host / Docked-Floating 重构报告

## 概述

本次 run 执行了一次架构调整：移除主界面中的第二套 Live2D 预览实例，替换为 Stage Host 停靠区域，实现 Stage 窗口的 docked/floating 双模式（含主窗口移动跟随），完善 Stage 控制，并调研主界面 dockable layout 方案。

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/app/MainWindow.tsx` | `Live2DPreview` → `StageHost` |
| `src/features/live2d/index.ts` | 移除 `Live2DPreview` 导出 |
| `src/features/stage/StageHost.tsx` | **新文件**：Stage 停靠区域组件 |
| `src/features/stage/StageWindow.tsx` | docked/floating 模式差异化交互 |
| `src/features/stage/index.ts` | 导出 `StageHost` |
| `src/features/control-panel/ControlPanel.tsx` | 移除舞台窗口控制块 |
| `src/App.css` | 移除 Live2D 预览样式，新增 Stage Host 样式 |

## 7 个必答项

### 1. 是否已移除主界面中的第二套 Live2D 预览？

**是。** `MainWindow.tsx` 不再引用 `Live2DPreview`，左栏改为 `StageHost`。`Live2DPreview` 组件文件保留（未删除），但不再被任何代码引用。`Live2DRenderer` 仍被 Stage 窗口使用。

整个应用现在只有一套 Live2D 模型实例——在 Stage 窗口中。

### 2. Stage Host / Stage Slot 现在如何工作？

Stage Host 占据主界面左栏（300px），包含三个区域：

**状态区域：**
- 绿色指示灯标识 Stage 是否正在播出
- 当前模式标签（贴靠/浮动）
- 角色情绪和说话状态

**停靠占位区域：**
- 占据左栏剩余空间
- docked + 可见时：显示红色实线边框，提示"Stage 窗口覆盖此区域"
- docked + 隐藏时：虚线边框，提示"点击启动显示 Stage"
- floating 时：提示"浮动模式 — Stage 独立窗口"

**控制按钮：**
- 启动/隐藏 Stage
- 重置位置（仅 Stage 可见时可用）
- 贴靠/浮动模式切换（active 高亮当前模式）

### 3. docked / floating 是否已实现？

**是。**

**Docked 模式：**
- Stage 窗口自动定位到主界面 Stage Host 区域上方，尺寸自动匹配
- 监听主窗口 `tauri://move` 和 `tauri://resize` 事件，通过 `requestAnimationFrame` 节流驱动 Stage 跟随
- Stage 窗口控制条不可拖拽（无 `data-tauri-drag-region`）
- 切换到 docked 时自动执行初始定位

**Floating 模式：**
- Stage 窗口可自由移动（`data-tauri-drag-region` 激活）
- 恢复默认 800x600 尺寸
- 控制条显示拖拽手势提示

### 4. Stage 在两种模式下是否仍为同一个窗口实例？

**是。** 模式切换仅通过以下操作完成：
- `setPosition()` 改变位置
- `setSize()` 改变大小
- `setStageMode` 更新 React 状态

绝不执行 `close()` 或重新创建窗口。Stage 窗口（label="stage"）在整个应用生命周期中是同一个 Tauri 窗口实例。

### 5. OBS 捕获是否会因模式切换而受影响？

**不会。** OBS 的窗口捕获源绑定的是窗口句柄（Windows 上是 HWND）。以下操作不会改变句柄：
- `setPosition()` — 移动窗口
- `setSize()` — 调整大小
- `show()` / `hide()` — 切换可见性

需要避免的操作（当前代码中不存在）：
- `close()` + 重新创建 — 会生成新句柄
- `destroy()` — 会销毁句柄

因此 docked ↔ floating 切换不会打断 OBS 捕获。

### 6. 后续主界面面板 docking 的建议方案

**推荐：** `react-resizable-panels`（bvaughn 维护）

| 维度 | 评价 |
|------|------|
| React 19 兼容 | 已支持 |
| 维护活跃度 | 高（bvaughn 是 React 团队前成员） |
| 复杂度 | 低——分栏可调大小，不含完整 tab 系统 |
| 适用性 | 适合当前需求（聊天/控制/日志面板的分栏调整） |

**适合做主窗口内 dockable 的面板：**
- ChatPanel — 纯 DOM，可调宽度
- ControlPanel — 纯 DOM，可调宽度
- EventLog — 纯 DOM，可调高度
- 未来的设置面板

**Stage 为什么不应作为普通面板：**
- Stage 是独立原生窗口（Tauri Window），拥有独立 HWND
- OBS 需要按窗口句柄独立捕获
- 透明无边框 + WebGL canvas，嵌入主窗口 DOM 会破坏 OBS 捕获链路
- 作为独立窗口时可在 docked 模式下"伪嵌入"主界面，保持两全

**升级路径：** 如后续需要更强的 IDE 级 tab + 拖拽停靠体验，可从 `react-resizable-panels` 升级到 `flexlayout-react` 或 `rc-dock`。

### 7. 当前是否还存在阻塞 Phase 2 close-out 的问题？

**需要真实 Tauri 桌面环境手测验证以下内容：**

1. **Tauri IPC 同步**：上一轮修复了 BroadcastChannel → Tauri IPC 的根因。本次未改动 IPC 层，需在 `pnpm tauri dev` 中确认表情/口型同步正常。
2. **Docked 跟随**：`tauri://move` 事件监听 + `setPosition` 节流跟随在浏览器中无法测试。需在桌面环境确认主窗口拖动时 Stage 是否实时跟随。
3. **Stage 拖动**：floating 模式下 `data-tauri-drag-region` 是否可用。
4. **退出清理**：上一轮的 `on_window_event` + `kill-port` 脚本是否有效。

如果以上 4 项手测通过，Phase 2 可以正式 close-out。

## 验证结果

| 项目 | 结果 |
|------|------|
| TypeScript 编译 | 零错误 |
| Tauri Rust 编译 | 零错误 |
| Linter | 零错误 |
| 主窗口布局 | StageHost 正确替换 Live2DPreview |
| Pipeline 运行 | 文本→LLM→TTS→播放→表情切换 完整跑通 |
| Stage 窗口 | 正常加载，docked/floating 切换按钮正确显示 |
| 角色状态同步 | Pipeline 后情绪正确更新（neutral → angry） |
