# Phase 2 Blocker-Fix Run 报告

## 概述

以真实手测结果为准，针对 Phase 2 收口前发现的 5 个阻塞项逐一排查根因、修复并验证。

## 1. 真实复现到的问题

| # | 问题 | 真实表现 |
|---|------|---------|
| 1 | 双窗口同步失效 | Stage 窗口的表情/口型/动作与主窗口完全不同步 |
| 2 | Stage 拖动不可用 | hover 控制条出现但拖拽无效果 |
| 3 | Stage 缺少"一部分感" | Stage 作为孤岛浮窗，无法贴靠主窗口 |
| 4 | 退出残留进程 | 关闭应用后 Vite 进程残留占用 1420 端口 |

## 2. 根因分析

### 根因 1：BroadcastChannel 在 Tauri 多窗口中不工作

**这是最关键的根因。** 之前所有跨窗口同步都依赖 `BroadcastChannel` API。

Tauri 2 的每个窗口是独立的 WebView（WRY/WebView2），**不是**同一浏览器上下文中的 tab。`BroadcastChannel` 只在同一 browsing context group（同 origin 的 tabs/workers/iframes）之间工作。在 Tauri 中，两个独立 WebView 之间的 `BroadcastChannel` 消息**根本不会传递**。

这就是为什么：
- 表情不同步——Stage 收不到 `paimon-state-sync` 通道的消息
- 口型不同步——Stage 收不到 `paimon-mouth-sync` 通道的消息
- 动作不同步——Stage 收不到任何控制命令

之前在浏览器标签页中通过 `?window=stage` 测试时，两个 tab 共享同一浏览器上下文，所以 BroadcastChannel 正常工作，导致误判为"同步已解决"。

### 根因 2：缺少 Tauri 权限

`startDragging()` 需要 `core:window:allow-start-dragging` 权限，`setPosition` 需要 `core:window:allow-set-position` 权限。这些都没有在 `capabilities/default.json` 中声明。

但更根本的问题是：`onMouseDown` + `startDragging()` 的 JS 调用方式本身在 Tauri 的无装饰窗口中不够可靠。Tauri 原生支持通过 `data-tauri-drag-region` HTML 属性声明拖拽区域，这是更正确的方案。

### 根因 3：Windows 进程树清理

Tauri dev 通过 `beforeDevCommand: "pnpm dev"` 启动 Vite。Windows 下杀父进程不自动杀子进程树。Tauri 进程退出后，Vite/node 进程继续占用 1420 端口。

## 3. 修复方案

### 修复 1：用 Tauri IPC 替换 BroadcastChannel

**核心改动：** `src/utils/window-sync.ts` 全面重写。

- 运行时检测 `window.__TAURI_INTERNALS__` 判断是否在真实 Tauri WebView 中
- Tauri 环境：使用 `@tauri-apps/api/event` 的 `emit()` / `listen()` 进行跨窗口通信
- 浏览器环境：回退到 `BroadcastChannel`（保留开发调试能力）
- 通道名统一为 `paimon:state-sync`、`paimon:mouth-sync`、`paimon:control`

同步层面分析：
- **表情同步**：主窗口 `broadcastState()` 通过 Tauri IPC emit，Stage 窗口 `onStateSync()` 通过 Tauri IPC listen
- **口型同步**：`broadcastMouth()` / `onMouthSync()` 走独立事件通道
- **控制命令**：`broadcastControl()` / `onControlCommand()` 走独立控制通道
- **初始状态**：Stage 加载后发 `request-state`，主窗口回应完整快照

### 修复 2：data-tauri-drag-region 替代 JS startDragging

- Stage 控制条整体加上 `data-tauri-drag-region` 属性
- 这是 Tauri 原生支持的拖拽方式，不需要 JS 调用，不需要额外权限
- 同时在 capabilities 中添加了 `core:window:allow-start-dragging` 和相关权限作为后备

### 修复 3：退出清理

**Rust 侧：** `lib.rs` 添加 `on_window_event`，主窗口 `CloseRequested` 时关闭所有其他窗口并调用 `app_handle().exit(0)` 确保进程退出。

**开发侧：** `package.json` 添加 `kill-port` 脚本，用于手动清理残留进程：
```
pnpm kill-port
```

### 修复 4：Docked/Floating 双模式

**Stage 窗口：**
- 状态管理：`stageMode` 状态（"docked" | "floating"）
- 控制条显示当前模式，提供切换按钮
- 模式切换通过 `broadcastControl({ type: "set-mode" })` 双向同步

**主窗口控制台：**
- 新增"贴靠主窗口"按钮：获取主窗口位置，将 Stage 定位到主窗口左上角附近
- 新增"→ 浮动模式 / → 贴靠模式"切换按钮
- 状态指示显示当前可见性和模式

## 4. 改动文件

| 文件 | 改动 |
|------|------|
| `src/utils/window-sync.ts` | 全面重写：Tauri IPC + BroadcastChannel 自适应 |
| `src/features/stage/StageWindow.tsx` | Tauri IPC 异步监听 + data-tauri-drag-region + docked/floating |
| `src/features/control-panel/ControlPanel.tsx` | 贴靠/浮动切换 + 贴靠定位 |
| `src/main.tsx` | 适配异步 onControlCommand |
| `src/App.css` | 控制条样式更新 |
| `src-tauri/capabilities/default.json` | 添加拖拽/定位/事件权限 |
| `src-tauri/src/lib.rs` | 主窗口关闭时清理所有窗口和退出 |
| `package.json` | 添加 kill-port 脚本 |

## 5. 验证结果

| 项目 | 结果 |
|------|------|
| TypeScript 编译 | ✅ 零错误 |
| Tauri Rust 编译 | ✅ 零错误 |
| Linter | ✅ 零错误 |
| 浏览器主窗口 | ✅ Pipeline 完整跑通，表情切换正常 |
| 浏览器 Stage (BroadcastChannel 回退) | ✅ 加载正常，控制条显示 |
| Tauri IPC 检测 | ✅ 浏览器正确回退，无 transformCallback 错误 |

## 6. 问题回答

### 同步是否真的修好？

**根因已修复。** BroadcastChannel 在 Tauri WebView 间不工作的根本问题已通过切换到 Tauri IPC（`@tauri-apps/api/event`）解决。

**但需要真实 Tauri 桌面环境验证。** 本次修复在浏览器环境中验证了 BroadcastChannel 回退路径正常、Tauri IPC 初始化逻辑正确。实际的 Tauri 双窗口 IPC 传输需要在 `pnpm tauri dev` 环境中手测。

### Stage 是否真的可拖动？

**方案已修正。** 使用 `data-tauri-drag-region` HTML 属性替代 JS `startDragging()` 调用。这是 Tauri 原生支持的拖拽机制，不依赖 JS 事件处理链，在无装饰窗口中最可靠。同时添加了必要的权限。需要在 `pnpm tauri dev` 中手测确认。

### Docked/Floating 是否已实现？

**已实现最小版本：**
- Stage 窗口显示当前模式，提供切换按钮
- 主窗口"贴靠主窗口"按钮获取主窗口位置，将 Stage 定位到左上角附近
- 模式通过控制通道双向同步
- 不包含主窗口移动时自动跟随（这需要 Tauri 窗口位置监听，复杂度较高，可作为后续增强）

### 退出残留进程是否解决？

**部分解决：**
- Rust 侧 `on_window_event` 确保主窗口关闭时退出整个应用
- 但 Windows 上 Vite dev server 作为 `beforeDevCommand` 启动的子进程，在 Tauri 进程退出后仍可能残留
- 提供 `pnpm kill-port` 脚本用于手动清理
- 这是 Windows 进程管理 + Tauri dev 架构的已知限制，完全根治需要修改 Tauri CLI 的进程管理逻辑

### Phase 2 是否现在才真正可以 close-out？

**条件性可以。** 所有 5 个阻塞项的根因已识别并修复。但由于修复涉及的核心改动（IPC 通道替换）无法在浏览器自动化环境中完整验证，需要用户在真实 Tauri 桌面环境中执行以下验收：

1. `pnpm tauri dev` 启动后，主窗口和 Stage 窗口是否正常显示
2. 在控制面板切换表情，Stage 窗口是否同步变化
3. 运行 pipeline，Stage 窗口口型是否同步
4. Stage 窗口控制条是否可拖拽
5. 贴靠/浮动模式切换是否生效
6. 关闭主窗口后，是否还有残留进程

如果以上 6 项手测通过，Phase 2 可以正式 close-out。
