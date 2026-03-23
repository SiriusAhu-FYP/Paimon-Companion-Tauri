# Phase 2 Run04 — MUI 接入 + 主界面四栏布局重构

## 本次完成内容

### 1. MUI v6 接入与 Material 3 暗色主题
- 安装 `@mui/material` `@emotion/react` `@emotion/styled` `@mui/icons-material`
- 创建 `src/theme.ts`，定义暗色主题（palette、typography、shape、组件 override）
- 在 `src/main.tsx` 中包裹 `ThemeProvider` + `CssBaseline`

### 2. MainWindow 四栏布局重构
原三栏布局（StageHost | ChatPanel | ControlPanel）重构为四栏：

| 栏位 | 宽度 | 组件 |
|------|------|------|
| 左栏 | ~240px | StageHost（纯控制面板） |
| 中左栏 | ~350px | StageSlot（模型贴靠区） |
| 中间 | flex | ChatPanel |
| 右栏 | ~280px | ControlPanel |

状态全部提升到 `MainWindow`，包括：
- `stageVisible` / `stageMode` / `alwaysOnTop` / `displayMode` / `eventLogOpen`
- `syncStagePosition` 使用 StageSlot 的实际 DOM rect

### 3. StageSlot 组件
- 不渲染 Live2D，仅作为 Stage docked 模式的定位目标
- 通过 `onRectChange` 回调上报 DOM rect
- 边框根据 `clean` 模式条件控制

### 4. StageHost 纯控制面板
- 所有控件使用 MUI 组件（Button、ButtonGroup、Chip、Typography、Tooltip）
- 置顶按钮始终显示，docked 模式下锁定（Lock 图标 + disabled）
- 通过 `HelpTooltip` 为各控制项添加悬浮提示
- 监听 `sync-state` 事件实现双向同步

### 5. ControlPanel MUI 替换
- section 结构改为 MUI `Box` + `Typography` + `Button`
- 急停/恢复使用 MUI 图标按钮
- 表情切换使用 MUI `Button` variant 切换
- 增加 `HelpTooltip` 解释

### 6. ChatPanel MUI 替换
- 消息列表使用 MUI `Paper` + `Typography`
- 输入框改为 MUI `TextField`
- 发送按钮使用 MUI `Button` + `SendIcon`

### 7. StatusBar 底部状态栏
- 单行紧凑显示：运行状态、Stage 状态（可见/模式/显示模式）、角色情绪
- 右侧 TerminalIcon 按钮切换事件日志展开/折叠
- EventLog 从固定 footer 改为可折叠面板

### 8. CSS 瘦身
- 移除所有已被 MUI 组件替代的 class-based 样式
- 仅保留 Stage 窗口（独立 Tauri window）样式、动画 keyframes、事件日志样式

## 改动文件列表

| 文件 | 类型 |
|------|------|
| `package.json` | 新增 MUI 依赖 |
| `pnpm-lock.yaml` | 锁文件更新 |
| `src/theme.ts` | 新增暗色主题 |
| `src/main.tsx` | ThemeProvider 包裹 |
| `src/App.css` | 大幅精简 |
| `src/app/MainWindow.tsx` | 四栏布局 + 状态提升 |
| `src/app/StatusBar.tsx` | 新增底部状态栏 |
| `src/components/HelpTooltip.tsx` | 新增 Tooltip 复用组件 |
| `src/components/index.ts` | 新增导出 |
| `src/features/stage/StageHost.tsx` | MUI 纯控制面板 |
| `src/features/stage/StageSlot.tsx` | 新增模型贴靠区 |
| `src/features/stage/StageWindow.tsx` | 同步、点击穿透、alwaysOnTop |
| `src/features/stage/index.ts` | 导出 StageSlot |
| `src/features/chat/ChatPanel.tsx` | MUI 替换 |
| `src/features/control-panel/ControlPanel.tsx` | MUI 替换 |
| `src/utils/window-sync.ts` | sync-state 命令 |

## 验证

- `npx tsc --noEmit` 通过，无错误
- 0 个 lint 错误

## 后续待办

1. **模型预览拖动缩放**：StageSlot 后续支持拖拽调整宽度，Stage 窗口同步缩放
2. **EventLog MUI 化**：当前事件日志仍使用 class-based 样式，后续可迁移
3. **真实环境手测**：需在 Tauri 桌面环境中验证四栏布局、docked 跟随、StatusBar 状态显示

## Commit

`4b72741` feat(ui): integrate MUI v6 + refactor MainWindow to four-column layout

```
feat(ui): integrate MUI v6 + refactor MainWindow to four-column layout

- Install @mui/material, @emotion/react, @emotion/styled, @mui/icons-material
- Create Material 3 dark theme (src/theme.ts)
- Wrap App with ThemeProvider + CssBaseline
- Restructure MainWindow: StageHost control | StageSlot dock | ChatPanel | ControlPanel
- Lift Stage state to MainWindow with syncStagePosition using DOM rect
- Create StageSlot as docked positioning target (no Live2D)
- Refactor StageHost as pure MUI control panel with locked always-on-top in docked mode
- Replace ControlPanel/ChatPanel with MUI components
- Add StatusBar with collapsible EventLog toggle
- Add HelpTooltip for contextual hints
- Slim down App.css, removing class-based styles replaced by MUI
```
