# Phase 1.1: Validation & Wiring — 完成报告

**日期**: 2026-03-21
**阶段**: Phase 1.1（Phase 1 骨架的实机验证与关键接线）

---

## 概述

本阶段目标是将 Phase 1 的骨架代码在目标 Windows 开发机上做最小可运行验证，补齐关键接线，明确哪些能力已从"占位/文档"升级为"实机验证通过"。

---

## 完成清单

### Task 1: Tauri 运行时验证 ✅

| 项目 | 结果 |
|------|------|
| OS | Windows 10 (10.0.26200) |
| Rust | 1.94.0（从 1.84.1 升级，旧版本不满足依赖要求） |
| Tauri 2 | 编译成功，桌面窗口正常启动 |
| WebView2 | 基于 Chromium，支持 WebGL 2 |
| Vite | v7.3.1，开发服务器 ~200ms 启动 |
| 修复 | Rust 工具链从 1.84.1 → 1.94.0（多个 crate 要求 1.85+） |

**主窗口渲染确认**：三栏布局（角色预览 / 对话 / 控制面板）+ 底部事件日志，全部正常显示。

**`window.__paimon` mock 工具可用**：voicePipeline、externalEvents、stop、resume、setEmotion、injectDanmaku 等方法均可在 DevTools 中调用。

### Task 2: 双窗口实现 ✅

| 变更 | 详情 |
|------|------|
| `tauri.conf.json` | 新增 `stage` 窗口定义（800x600, transparent, no decorations, hidden） |
| `capabilities/default.json` | `windows` 数组添加 `"stage"`，新增窗口管理权限 |
| `App.tsx` | 根据 `getCurrentWindow().label` 路由到 MainWindow 或 StageWindow |
| `main.tsx` | 主窗口初始化 service + mock，订阅状态变化并通过 BroadcastChannel 广播 |
| `window-sync.ts` | 新建，封装 BroadcastChannel 的 broadcast / listen |
| `StageWindow.tsx` | 改为通过 BroadcastChannel 接收状态，设置透明背景 |
| `ControlPanel.tsx` | 新增"打开舞台窗口"按钮 |

### Task 3: Runtime 门控接线 ✅

| 变更 | 详情 |
|------|------|
| `mock.ts` | `mockVoicePipeline` 接受 `RuntimeService` 参数，`isAllowed()` 为 false 时拒绝并打印 BLOCKED 日志 |
| `ExternalInputService` | 新增 `setRuntime()` 方法，`injectEvent()` 在 stopped 模式下阻断并记录警告 |
| `services/index.ts` | 初始化时将 runtime 注入 ExternalInputService |
| `ControlPanel.tsx` | stopped 模式显示红色 STOPPED 徽章，新增"模拟语音链路"和"模拟外部事件"按钮 |

**实机验证**：
1. auto 模式下点击"模拟语音链路"→ 事件正常流转，角色情绪变为 happy ✅
2. 点击"急停"→ 模式变为 stopped，UI 显示红色 STOPPED 徽章 ✅
3. stopped 模式下点击"模拟语音链路"→ 事件被阻断，角色状态不变 ✅
4. 点击"恢复"→ 模式恢复 auto，pipeline 可再次执行 ✅

---

## Spike 验证汇总

### Spike 1: 透明窗口 + OBS 捕获

| 项目 | 状态 |
|------|------|
| Tauri 配置 | ✅ `transparent: true` + `decorations: false` |
| CSS 透明 | ✅ html/body/stage-window 全部 transparent |
| 编译运行 | ✅ 无报错 |
| OBS 验证 | ⏸️ 目标机无 OBS |

**结论**: 可行（配置就绪，OBS 捕获待有 OBS 环境时验证）

### Spike 2: Live2D / PIXI 加载

| 项目 | 状态 |
|------|------|
| Cubism Core SDK | ✅ v5.1.0 加载成功 |
| pixi.js | ✅ v6.5.10，WebGL 2 模式 |
| pixi-live2d-display | ✅ v0.4.0，必须使用 `/cubism4` 子路径导入 |
| 模型渲染 | ✅ Hiyori 模型完整渲染（纹理、物理、待机动画） |

**关键发现**: 导入必须用 `pixi-live2d-display/cubism4`，否则会尝试加载 Cubism 2 运行时报错。

**结论**: 可行——已实机验证通过

### Spike 3: 麦克风权限 + getUserMedia

| 项目 | 状态 |
|------|------|
| getUserMedia | ✅ 返回有效 MediaStream |
| AudioContext | ✅ 创建成功 |
| AnalyserNode | ✅ 可获取频率数据 |
| 权限弹窗 | ⏸️ 浏览器自动化环境自动授权，Tauri 桌面端弹窗行为待确认 |

**结论**: 可行——API 层验证通过

### Spike 4: 双窗口同步

| 项目 | 状态 |
|------|------|
| BroadcastChannel 方案 | ✅ 代码已实现 |
| 窗口路由 | ✅ 基于 window label 区分 |
| 状态广播 | ✅ character + runtime 状态变化时自动广播 |
| 跨窗口延迟 | ⏸️ 需实际打开两个窗口测量 |

**结论**: 可行——架构和代码就绪

---

## 当前状态总览

| 能力 | 之前状态 | 现在状态 |
|------|---------|---------|
| Tauri 桌面启动 | 未验证 | ✅ 实机通过 |
| 三栏 UI 布局 | 占位代码 | ✅ 实机渲染 |
| Live2D 角色渲染 | 文字占位 | ✅ 实机渲染（Hiyori） |
| Runtime 门控 | 代码存在但未接线 | ✅ 接线并实机验证 |
| 双窗口配置 | 未实现 | ✅ 代码就绪 |
| 跨窗口状态同步 | 未实现 | ✅ 代码就绪（BroadcastChannel） |
| 麦克风 API | 文档可行 | ✅ API 调用成功 |
| Mock 工具链 | DevTools 手动 | ✅ UI 按钮 + DevTools 双通道 |
| 透明窗口 | 文档可行 | ⏸️ 配置就绪，待 OBS 验证 |

---

## 改动的关键文件

### 新增文件
- `src/utils/window-sync.ts` — BroadcastChannel 跨窗口状态同步

### 修改文件
- `src-tauri/tauri.conf.json` — 添加 stage 窗口定义
- `src-tauri/capabilities/default.json` — 添加 stage 窗口权限
- `src/App.tsx` — 窗口标签路由
- `src/main.tsx` — 主窗口条件初始化 + 状态广播
- `src/utils/mock.ts` — 接入 runtime 门控
- `src/services/external-input/external-input-service.ts` — 接入 runtime 门控
- `src/services/index.ts` — 注入 runtime 到 ExternalInputService
- `src/features/control-panel/ControlPanel.tsx` — 新增窗口管理、Spike 验证、Mock 测试按钮区域
- `src/features/stage/StageWindow.tsx` — 改为 BroadcastChannel 状态接收
- `src/features/live2d/Live2DPreview.tsx` — 真实 PIXI + Live2D 渲染
- `index.html` — 添加 Cubism Core SDK 脚本
- `.gitignore` — 排除 SDK 和模型二进制文件

### 复制的资产（gitignore'd）
- `public/Core/` — Cubism Core SDK v5.1.0
- `public/Resources/Hiyori/` — Live2D 测试模型

### 新增依赖
- `pixi.js@6.5.10`
- `pixi-live2d-display@0.4.0`

---

## 未完成 / 仍为占位的内容

1. **双窗口实际同步延迟**：代码就绪但未在实际两个桌面窗口中测量延迟
2. **OBS 窗口捕获**：目标机未安装 OBS
3. **Tauri 桌面端麦克风权限弹窗**：API 可用但权限 UI 行为未在桌面端确认
4. **Live2D 表情/动作切换**：模型加载成功，但表情切换逻辑未集成到 CharacterService → Live2D 渲染流
5. **模型切换**：当前硬编码 Hiyori，动态模型切换未实现

---

## 下一步建议

**建议进入 Phase 1 收尾**，在此基础上：
1. 完成 Live2D 表情驱动（CharacterService → Live2D 渲染联动）
2. 在实际 Tauri 桌面端验证双窗口打开和同步
3. 安装 OBS 验证透明窗口捕获
4. 完善错误处理和边界情况

Phase 2（真实 ASR/TTS/LLM 集成）不应在这些基础验证完全通过之前启动。

---

## 测试记录

| 测试场景 | 方法 | 结果 |
|---------|------|------|
| Tauri dev 启动 | `pnpm tauri dev` | ✅ 编译运行成功 |
| UI 三栏渲染 | 浏览器截图验证 | ✅ 布局正确 |
| Live2D 渲染 | 浏览器截图验证 | ✅ Hiyori 模型显示 |
| 情绪切换 | 点击 happy 按钮 | ✅ 状态从 neutral → happy |
| 急停门控 | 急停 → 模拟语音链路 | ✅ 事件被阻断 |
| 恢复门控 | 恢复 → 模拟语音链路 | ✅ 事件正常流转 |
| 麦克风 API | 点击麦克风测试按钮 | ✅ getUserMedia 成功 |
| TypeScript 编译 | `npx tsc --noEmit` | ✅ 无错误 |
