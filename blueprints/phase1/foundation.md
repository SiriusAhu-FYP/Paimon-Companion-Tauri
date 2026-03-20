# Phase 1 — Foundation

---

## 1. 本阶段目标

搭建可运行的基础框架，让以下能力在本阶段结束时可用：

- Live2D 角色能在 Tauri 窗口中正常加载和渲染
- 能通过代码或 UI 触发表情/动作切换
- 事件总线能正确发布和接收事件
- 运行时控制器的最小可行形态可用
- 基础 UI 布局就位（主窗口分区）
- 日志能输出到控制台
- 配置文件能被读取

---

## 2. 本阶段只做的事

| 编号 | 任务 | 说明 |
|------|------|------|
| F1 | 事件总线核心实现 | 类型安全的发布/订阅、订阅者生命周期管理 |
| F2 | 运行时控制器最小实现 | **仅** auto/stopped 两个模式切换、`isAllowed()` 门控查询、模式变更事件通知。完整的 manual/paused 模式、急停协调、人工接管流程留到后续 phase |
| F3 | Live2D 渲染模块 | Cubism Core 加载、模型加载、表情/动作播放 |
| F4 | 角色状态管理基础 | 角色配置加载、情绪/表情映射、状态维护（权威真源） |
| F5 | 日志服务基础 | 分级日志、控制台输出 |
| F6 | 配置加载 | 通过 Tauri IPC 读取本地配置文件 |
| F7 | 基础 UI 布局 | 主窗口分区（预览区 + 控制区 + 对话区占位） |
| F8 | React 桥接层选型 | 确定 React 与 service 的桥接方案（Zustand / Jotai / 自建 Hook）。**注意：此选型仅针对 UI 状态和 service→React 响应式桥接，不涉及核心业务状态归属——业务状态始终由 service 管理（service-first 原则）** |

---

## 3. 本阶段暂不做的事

| 事项 | 原因 |
|------|------|
| 语音采集 / VAD / ASR | Phase 2 任务 |
| LLM API 对接 | Phase 2 任务 |
| TTS 调用和音频播放 | Phase 2 任务 |
| 口型同步 | 依赖音频播放，Phase 2 |
| 控制面板完整 UI | Phase 3 任务 |
| OBS 舞台窗口 | spike 验证可行性，但正式实现在 Phase 4 |
| 外部事件接入 | Phase 4 任务 |
| 知识/上下文层实现 | Phase 2+ 任务，本阶段只有目录占位 |
| 急停/人工接管完整流程 | Phase 3 任务。本阶段 runtime 仅实现 auto/stopped 最小子集，不实现 manual/paused 模式、串行处理规则、锁麦协调等完整编排 |
| 打包分发 | Phase 5 任务 |

---

## 4. 技术验证任务（Spike）

在正式实现之前，以下技术点需要先做小规模验证，确认可行性后再纳入正式实现。

### Spike 1：Tauri 透明窗口 + OBS 窗口捕获

**问题：** Tauri 的透明窗口在 Windows 上是否能被 OBS 正常捕获？

**验证方式：**
- 创建一个 Tauri 透明窗口（`transparent: true` + `decorations: false`）
- 在窗口中渲染简单内容（纯色方块或文字）
- 使用 OBS 的"窗口捕获"功能尝试捕获
- 记录是否透明背景正确、是否有渲染异常

**产出：** 在 `docs/research/` 中记录结论。

### Spike 2：Live2D 在 Tauri + React 下的加载

**问题：** pixi.js + pixi-live2d-display 在 Tauri WebView 中是否能正常工作？

**验证方式：**
- 在当前项目中引入 pixi.js 6 和 pixi-live2d-display
- 加载一个测试用 Live2D 模型（Cubism4 格式）
- 测试模型渲染、表情切换、动作播放
- 确认 Cubism Core 的加载方式（script 标签 vs 模块导入）

**产出：** 在 `docs/research/` 中记录结论，确定渲染集成方式。

### Spike 3：Windows 下麦克风权限与音频采集

**问题：** Tauri WebView 中 Web Audio API / MediaStream 是否能正常获取麦克风？

**验证方式：**
- 在 Tauri 窗口中请求麦克风权限
- 使用 MediaStream API 采集音频
- 确认是否需要 Tauri Capability 或 Windows 权限配置

**产出：** 在 `docs/research/` 中记录结论。这个 spike 为 Phase 2 做准备，本阶段只验证不实现完整链路。

### Spike 4：双窗口状态同步

**问题：** 两个 Tauri 窗口之间如何同步角色状态？

**验证方式：**
- 创建两个窗口
- 在一个窗口中修改状态，观察另一个窗口是否能同步
- 调研 Tauri 多窗口通信机制（共享 WebView 上下文 vs IPC 中转 vs 其他）

**产出：** 在 `docs/research/` 中记录可行方案。

---

## 5. 交付物清单

| 交付物 | 说明 |
|--------|------|
| `src/services/event-bus/` | 事件总线核心实现 |
| `src/services/runtime/` | 运行时控制器最小实现 |
| `src/services/character/` | 角色状态管理基础实现 |
| `src/services/logger/` | 日志服务基础实现 |
| `src/features/live2d/` | Live2D 渲染组件 |
| `src/app/` | 主窗口布局组件 |
| `src/types/` | 事件类型定义、角色类型定义 |
| `src/hooks/` | service 桥接 Hook（useEventBus、useCharacter 等） |
| Tauri IPC 命令 | 配置文件读取 |
| Spike 结论文档 | `docs/research/` 下的验证结论 |
| 开发汇报 | `dev-reports/phase1-foundation.md` |

---

## 6. 验收标准

- [ ] `pnpm tauri dev` 启动后能看到主窗口和 Live2D 角色
- [ ] 能通过开发者工具或简单 UI 触发表情切换，角色响应变化
- [ ] 能通过开发者工具或简单 UI 触发动作播放
- [ ] 事件总线能正确发布事件，订阅方能收到回调
- [ ] runtime 能切换运行模式，切换后相关模块收到通知
- [ ] 日志能输出到浏览器控制台，包含模块名和级别
- [ ] 配置文件能被读取并用于角色加载
- [ ] 所有 spike 有明确的结论文档

---

## 7. 风险点

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Live2D Cubism Core 在 WebView 中加载失败 | 阻塞渲染模块 | Spike 2 提前验证 |
| pixi-live2d-display 与 pixi.js 版本不兼容 | 渲染异常 | 锁定已知兼容版本组合 |
| Tauri 透明窗口 OBS 捕获不理想 | 影响 Phase 4 | Spike 1 验证，必要时调研替代方案 |
| React 桥接选型不当 | 后续重构 | 先用最小方案（自定义 Hook + service 直接订阅），保持可替换性。业务状态始终在 service 层，桥接层可随时替换 |

---

## 8. 依赖与前置条件

- Phase 0 已完成（项目骨架、目录结构、规划文档就位）
- Live2D 测试模型已准备（可从旧项目 `VoiceL2D-MVP/frontend/public/Resources/` 复制示例模型）
- Live2D Cubism Core SDK 已获取（可从旧项目 `frontend/public/Core/` 复制）
- pnpm install 已执行
- Rust 工具链已安装
