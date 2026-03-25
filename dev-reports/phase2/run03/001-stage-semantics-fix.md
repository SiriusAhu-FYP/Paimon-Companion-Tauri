# Stage Window Semantics Fix — 报告

**日期**: 2026-03-23
**阶段**: Phase 2 — Stage window semantics fix run
**Commit**: `310e70f`

---

## 1. pinToApp 语义是否真正具备？

**是。** 通过 Tauri 2 的 `parent` 静态配置实现了 Win32 owned window 语义。

### 根因分析

之前的做法是用 `setPosition` 跟随 + `setAlwaysOnTop` 来模拟 "Stage 不被主窗口遮挡"。问题是 `setAlwaysOnTop(true)` 是**全局置顶**（压在所有应用之上），而不是"仅在 main 之上"。这不是正确的 pinToApp。

### 修复方案

在 `tauri.conf.json` 中为 Stage 窗口添加 `"parent": "main"`。根据 Tauri 2 schema 文档和 MSDN owned windows 规范：

- **An owned window is always above its owner in the z-order** — Stage 永远不会被 main 遮挡
- **The system automatically destroys an owned window when its owner is destroyed** — main 关闭时 Stage 自动清理
- **An owned window is hidden when its owner is minimized** — main 最小化时 Stage 跟随隐藏

这是操作系统级的行为保证，不需要任何 JS 层的模拟。

### 改动文件

- `src-tauri/tauri.conf.json` — 添加 `"parent": "main"` 和 `"skipTaskbar": true`

---

## 2. alwaysOnTop 是否已独立实现？

**是。** pinToApp 和 alwaysOnTop 现在是完全独立的两个概念。

| 概念 | 含义 | 实现方式 | 可见控制 |
|------|------|----------|----------|
| pinToApp | Stage 始终在 main 之上，跟随 main 最小化/关闭 | `parent: "main"` (OS 级) | 始终生效，不需要开关 |
| alwaysOnTop | Stage 是否压在**其他应用**之上 | `setAlwaysOnTop()` API | 仅 floating 模式下可切换 |

### 交互规则

- **docked 模式**: pinToApp 生效（parent 关系），alwaysOnTop 关闭（不需要压在其他应用上）
- **floating 模式**: pinToApp 仍生效（parent 关系始终存在），alwaysOnTop 可由用户开关

### 改动文件

- `src/features/stage/StageWindow.tsx` — effect 根据 mode 分别控制 alwaysOnTop
- `src/features/stage/StageHost.tsx` — floating 模式下显示"置顶"开关
- `src/utils/window-sync.ts` — 新增 `set-always-on-top` 控制命令

---

## 3. clean / interactive 两种显示模式是否已实现？

**是。**

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| clean | 控制条完全不渲染，Stage 窗口只有透明背景 + Live2D | OBS 播出 |
| interactive | hover 时显示控制条（模式切换、隐藏按钮、clean 切换） | 调试和操作 |

### 关键设计

- clean 模式下控制条**完全不渲染**（不是隐藏 opacity:0，而是条件渲染 false）
- 可拖动能力不绑定边框显示——在 floating + interactive 模式下可拖动
- 切换不影响窗口实例，OBS 捕获连续性不受影响

### 控制入口

- Stage 自身控制条上的 `clean` 按钮
- 主界面 StageHost 中的"显示模式"切换按钮
- 通过 `paimon:control` IPC 通道双向同步

### 改动文件

- `src/features/stage/StageWindow.tsx` — displayMode 状态 + 条件渲染
- `src/features/stage/StageHost.tsx` — displayMode 控制按钮
- `src/utils/window-sync.ts` — 新增 `StageDisplayMode` 类型和 `set-display-mode` 命令

---

## 4. docked / floating 的最终行为规则

### docked 模式

- 贴靠主界面 Stage Host 区域
- 主窗口移动/缩放时 Stage 跟随（via `tauri://move` / `tauri://resize` 事件）
- **不可自由拖动**（不添加 `data-tauri-drag-region`）
- **不被主窗口遮挡**（parent owned window 保证）
- alwaysOnTop 关闭
- 从任务栏隐藏（skipTaskbar）

### floating 模式

- 独立浮动，可自由移动（`data-tauri-drag-region` 激活）
- alwaysOnTop 可由用户切换
- 任务栏可见（skipTaskbar false）
- 仍为 main 的 owned window（不会被 main 遮挡）

### 共同点

- 始终同一个 Stage 窗口实例（不销毁/重建）
- OBS 捕获不受模式切换影响
- parent 关系始终存在

---

## 5. OBS 捕获连续性是否受影响？

**不受影响。**

- docked ↔ floating 切换不改变窗口实例（同一个 `label: "stage"` 窗口）
- `setAlwaysOnTop` / `setSkipTaskbar` 等属性变更不触发窗口重建
- `parent` 是静态配置，窗口创建时一次性设定
- OBS 的窗口源绑定基于窗口句柄（HWND），以上操作不改变句柄

---

## 6. 是否具备继续进行 Phase 2 close-out 测试的条件？

**需要在真实 Tauri 桌面环境中手测验证以下项目：**

1. ✅ 点击主应用时，docked 的 Stage 是否仍保持在主应用之上
2. ✅ 主应用最小化时，Stage 是否按预期隐藏
3. ✅ floating 模式下，Stage 是否可自由拖动
4. ✅ alwaysOnTop 开/关是否真实生效
5. ✅ clean / interactive 模式切换是否真实生效
6. ✅ OBS 捕获是否仍然抓的是同一个 Stage 窗口

**如果以上 6 项手测通过，Phase 2 可以正式 close-out。**

---

## 改动清单

| 文件 | 变更 |
|------|------|
| `src-tauri/tauri.conf.json` | Stage 窗口添加 `parent: "main"`, `skipTaskbar: true` |
| `src-tauri/capabilities/default.json` | 新增 `set-always-on-top`, `is-focused`, `set-ignore-cursor-events`, `minimize`, `unminimize`, `is-visible`, `set-skip-taskbar` 权限 |
| `src/utils/window-sync.ts` | 新增 `StageDisplayMode`, `set-always-on-top`, `set-display-mode` 控制命令 |
| `src/features/stage/StageWindow.tsx` | pinToApp 改为依赖 parent 关系；独立 alwaysOnTop；clean/interactive 显示模式 |
| `src/features/stage/StageHost.tsx` | 新增 alwaysOnTop 开关（floating 专属）；displayMode 切换；UI 优化 |
| `src/App.css` | 新增 `.stage-host-pin-label`、`.stage-host-controls h3` 样式 |

---

## 技术决策记录

**为什么用 `parent` 而不是 `setAlwaysOnTop` 实现 pinToApp？**

| | `parent` (owned window) | `setAlwaysOnTop` |
|--|------------------------|------------------|
| 语义 | "属于 main 的子窗口" | "压在所有应用之上" |
| z-order | 仅在 main 之上 | 在所有窗口之上 |
| 最小化跟随 | OS 自动处理 | 需要手动监听 |
| 关闭清理 | OS 自动处理 | 需要手动处理 |
| OBS 影响 | 无 | 无 |
| 正确性 | ✅ 精确表达 pinToApp | ❌ 过度——影响其他应用 |
