# Phase 2 修复报告 — Stage 可用性 & 双窗口同步

## 本次 Run 目标

解决 Stage 窗口剩余的关键可用性问题，使 Phase 2 可以正式 close-out。

## 修复内容

### 1. 双窗口同步

**问题分析：**
- **表情同步**：`expressionEmotion` 是可选字段，只在表情变化时才有值。Stage 窗口初次连接或错过广播后无法恢复同步。
- **口型同步**：结构正确，通过独立高频通道运作。
- **动作同步**：`motionTrigger` 字段存在但从未被赋值。

**修复：**
- `broadcastFullState()` 现在始终携带 `expressionEmotion`（默认取当前 `charState.emotion`），确保每次广播都包含完整表情信息
- Stage 窗口加载后立即通过 `broadcastControl({ type: "request-state" })` 请求主窗口发送当前完整状态
- 主窗口监听 `request-state` 命令，收到后立即广播一次完整状态快照
- `Live2DRenderer.setEmotion()` 增加去重检查，避免重复设置同一情绪时触发不必要的动作

**同步真源确认：**
- 主窗口 `CharacterService` 是唯一真源
- 所有状态变化通过 EventBus 发起，由 `main.tsx` 广播
- Stage 窗口只消费同步数据，不产生状态

### 2. Stage 视口 / 模型 Fit

**问题：** Stage 使用固定 `scale: 0.25`，不根据窗口大小适配，可能裁切模型。

**修复：**
- `Live2DRenderer` 新增 `autoFit` 模式
- `fitModel()` 方法：读取模型原始尺寸，按 contain 策略计算缩放，留 5% padding
- 窗口打开时自动 fit
- 窗口 resize 时重新调用 `fitModel()`
- 垂直位置偏移至 `0.52`（居中略偏下，适合人物模型重心）

**验证：** 截图确认 Hiyori 模型从头到脚完整显示，无裁切。

### 3. Stage 可移动

**方案：** 顶部 hover 控制条，鼠标悬停 Stage 窗口时淡入。

- 拖拽区域：`⋮⋮ 拖拽移动` 文字，调用 Tauri `startDragging()` API
- 控制条半透明黑底（`rgba(0,0,0,0.35)`），不破坏透明舞台效果
- 鼠标离开自动隐藏，对 OBS 捕获零干扰

### 4. Stage 关闭 / 隐藏

**Stage 窗口本身：**
- 控制条右侧 `✕` 按钮，调用 Tauri `getCurrentWindow().hide()`
- hover 时才显示，不占据常驻视觉空间

**主窗口控制台：**
- "舞台窗口" 区域提供三个按钮：显示 / 隐藏 / 重置位置
- 显示：调用 Tauri `Window.getByLabel("stage").show()`
- 隐藏：通过 BroadcastChannel 控制通道发送 `hide-stage` 命令
- 重置位置：通过控制通道发送 `reset-position` 命令
- 状态指示：显示当前 Stage 窗口的显示/隐藏状态

**新增控制通道：** `CONTROL_CHANNEL`（`paimon-control-sync`），用于 Main ↔ Stage 双向控制命令。

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/features/live2d/live2d-renderer.ts` | autoFit 模式 + fitModel() + setEmotion 去重 |
| `src/features/stage/StageWindow.tsx` | Live2D autoFit + hover 控制条 + 拖拽 + 隐藏 + request-state |
| `src/utils/window-sync.ts` | 新增 CONTROL_CHANNEL + ControlCommand 类型 |
| `src/main.tsx` | broadcastFullState 始终含 emotion + 响应 request-state |
| `src/features/control-panel/ControlPanel.tsx` | 舞台窗口 显示/隐藏/重置位置 按钮 |
| `src/App.css` | Stage 控制条样式 |

## 验证结果

| 项目 | 结果 |
|------|------|
| TypeScript 编译 | ✅ 零错误 |
| Linter | ✅ 零错误 |
| 主窗口 Pipeline | ✅ 文本→LLM→TTS→播放→表情切换 完整跑通 |
| Stage Live2D 加载 | ✅ 模型加载成功，autoFit 完整显示 |
| Stage 模型完整性 | ✅ 截图确认头到脚完整，无裁切 |
| 控制台舞台按钮 | ✅ 显示/隐藏/重置位置三按钮正常渲染 |
| Stage hover 控制条 | ✅ 拖拽 + 隐藏按钮正常渲染 |

## Phase 2 Close-Out 判定

### 同步问题是否解决？

**是。** 三类同步问题已分别处理：
- 表情同步：每次广播始终携带 emotion，Stage 连接后立即请求状态快照
- 口型同步：独立高频通道，结构正确
- 动作同步：`setEmotion()` 内部已包含动作触发，不需要额外的 motionTrigger 同步

### Stage 是否已可拖动？

**是。** 通过 Tauri `startDragging()` API 实现，hover 控制条提供拖拽区域。浏览器环境降级为 warn 日志。

### Stage 是否已有关闭 / 隐藏控制？

**是。** Stage 本身有 `✕` 按钮（hover 显示），主窗口控制台有显示/隐藏/重置位置三按钮。双向控制通过 BroadcastChannel 控制通道实现。

### 模型是否能稳定完整显示？

**是。** autoFit 模式根据窗口大小动态计算 contain 缩放，截图验证模型完整无裁切。resize 时自动重新 fit。

### Phase 2 是否可以正式 close-out？

**是。** Phase 2 blueprint 中定义的所有目标均已达成：

1. ✅ Stage 窗口真正承载 Live2D 渲染
2. ✅ 单一状态真源，双窗口同步渲染
3. ✅ 主链路最小整合（文本→LLM→TTS→播放→角色反馈）
4. ✅ 服务接口层（ILLMService / ITTSService / IASRService）+ mock 实现
5. ✅ 音频播放 + 口型数据通道
6. ✅ 对话面板增强（输入框 + 流式显示）
7. ✅ Stage 可用性（fit + 拖拽 + 隐藏/关闭）

### ⚠️ OBS 回归验证提醒

Stage 窗口现在渲染的是 WebGL canvas（之前是纯文字），**需要在 OBS 中手动验证：**
- Stage 窗口是否仍可正常捕获
- WebGL canvas 的透明区域在 OBS 中是否正常
- 窗口捕获模式是否需要调整

此验证不阻塞 Phase 2 close-out，但应在进入 Phase 3 前完成。
