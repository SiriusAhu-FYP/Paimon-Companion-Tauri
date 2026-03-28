# Phase 2.1 — 结构整理 / 收敛阶段

**日期**：2026-03-23
**前置依赖**：Phase 2 功能基线稳定，进入真实服务接入前；`structure-analysis.md` 盘点完成
**性质**：结构整理方案——只收敛、不扩张
**核心原则**：Phase 2.1 的目标是结构收敛，不改变现有功能行为和用户交互语义

---

## 1. 为什么现在值得做 Phase 2.1

Phase 2 已完成 Stage-only 单实例播出架构、StageHost docked/floating 双模式、OBS 透明捕获验证、MUI v6 迁移等关键里程碑。但在快速迭代过程中，代码中积累了以下结构性问题：

1. **职责混杂**：`StageWindow.tsx`（354 行）同时承担渲染初始化、窗口控制、Tauri API 调用、工具栏 UI、事件订阅、localStorage 读写；`main.tsx` 混入了窗口标签判断、服务初始化、事件订阅接线
2. **重复逻辑**：窗口标签判断在 `main.tsx` 和 `App.tsx` 各实现一遍；Tauri 环境检测在 `window-sync.ts` 和 `StageWindow.tsx` 多处重复
3. **边界模糊**：`ControlPanel.tsx` 混入了 Stage 窗口控制逻辑（模型选择、表情订阅），与其"主链路/调试控制"的定位冲突
4. **历史残留**：`Live2DPreview.tsx`（74 行）仍然 import 并实例化 `Live2DRenderer`，但主窗口已不再使用它
5. **持久化散落**：`StageWindow.tsx` 顶部的 `saveZoom` / `loadZoom` 是唯一的 localStorage 使用点，没有统一的持久化工具层

这些问题不会阻塞当前功能运行，但会：
- 增加后续 AI / 人类协作时的理解成本
- 提高 Phase 3 真实服务接入时的修改风险
- 使 code review 和交接更加困难

**现在整理的时机最佳**：功能稳定、结构已收敛、还未进入 Phase 3 的真实服务接入阶段。越晚整理，积累的债务越多，整理成本越高。

---

## 2. 本阶段要解决的具体问题

### T1：收敛窗口标签判断（低风险）

**现状**：

| 位置 | 实现 |
|------|------|
| `src/main.tsx` 第 14-25 行 | `getCurrentWindow().label` + URL 参数检测，赋值给模块级 `windowLabel` |
| `src/App.tsx` 第 5-16 行 | `getWindowLabel()` 函数，同样的逻辑再实现一遍 |

**问题**：两处各自维护一份完全相同的逻辑，改一处忘改另一处就会出错。

**整理方向**：
- 将窗口标签判断收敛为单一实现
- `main.tsx` 负责获取标签并传入 React 树（通过 props 或 context），`App.tsx` 消费标签而非重新计算
- 或将 `getWindowLabel()` 抽取到 `@/utils/window-label.ts`，两处共用

**涉及文件**：`src/main.tsx`、`src/App.tsx`
**预估改动量**：~15 行

---

### T2：提取 main.tsx 广播接线逻辑（中风险）

**现状**：`src/main.tsx` 第 27-59 行在模块顶层用命令式代码完成了：
- `broadcastFullState()` 封装
- `bus.on("character:state-change")` / `bus.on("runtime:mode-change")` / `bus.on("character:expression")` 三个订阅
- `onControlCommand` 响应 `request-state`
- `paimonTools.pipeline` 挂载

**问题**：
- 订阅逻辑在 React 渲染之前执行，没有清理（cleanup）机制
- 与 React 组件生命周期割裂——如果未来需要在 HMR 热更新时重新初始化，缺少卸载路径
- 代码可读性差：服务初始化、mock 挂载、广播接线三件事混在一起

**整理方向**：
- 将广播接线逻辑提取为 `useMainWindowSync` hook（或 `setupMainWindowSync()` 函数），在 `MainWindow.tsx` 的 `useEffect` 中调用
- `main.tsx` 只保留：服务初始化 → React 渲染

**涉及文件**：`src/main.tsx`、`src/app/MainWindow.tsx`（或新建 `src/hooks/use-main-window-sync.ts`）
**预估改动量**：~40 行移动 + ~10 行新 hook 包装

---

### T3：分离 ControlPanel 中的 Stage 控制逻辑（低风险）

**现状**：`src/features/control-panel/ControlPanel.tsx` 中混入了以下 Stage 相关逻辑：

| 行号 | 内容 | 本质归属 |
|------|------|---------|
| 24-25 | `selectedModel` / `expressions` state | Stage 模型管理 |
| 28-37 | `onControlCommand` 订阅 `report-expressions` | Stage 通信 |
| 39-44 | `handleModelChange` → `broadcastControl({ type: "set-model" })` | Stage 控制 |
| 46-48 | `handleExpression` → `broadcastControl({ type: "set-expression" })` | Stage 控制 |
| 91-110 | 模型选择下拉框 UI | Stage 控制 UI |
| 156-178 | 表情按钮列表 UI | Stage 控制 UI |

**问题**：ControlPanel 的定位是"主链路运行状态控制 + 调试工具"，但它混入了 Stage 窗口的模型/表情管理，导致职责不清。

**整理方向**：
- 将模型选择、表情列表订阅和相关 UI 移入 `StageHost.tsx`（已经是 Stage 控制的主要承载组件）
- ControlPanel 专注于：运行状态（急停/恢复）、角色状态展示、麦克风测试、mock 测试

**涉及文件**：`src/features/control-panel/ControlPanel.tsx`、`src/features/stage/StageHost.tsx`
**预估改动量**：~60 行移动

---

### T4：清理 Live2DPreview.tsx 残留（低风险）

**现状**：`src/features/live2d/Live2DPreview.tsx`（74 行）仍然：
- import `Live2DRenderer` 并在 `useEffect` 中 `new Live2DRenderer()` + `renderer.init()`
- 订阅 `player.onMouthData`
- 订阅 `character:expression` 事件

但自从 Stage-only 架构收敛后，主窗口已不再渲染 `Live2DPreview`——`MainWindow.tsx` 使用的是 `StageSlot`（纯占位区）。

**问题**：
- 文件仍然存在且可被 import，未来可能被误用
- 仍然 hardcode 了 Hiyori 模型路径，与当前 model-registry 不一致
- 占用仓库空间和 AI 阅读时间

**整理方向**：
- 删除 `Live2DPreview.tsx`
- 从 `src/features/live2d/index.ts` 中移除其导出（如果有）
- 确认无其他文件引用它

**涉及文件**：`src/features/live2d/Live2DPreview.tsx`、`src/features/live2d/index.ts`
**预估改动量**：删除 74 行 + 调整 index 导出

---

### T5：统一 Tauri 环境检测（低风险）

**现状**：

| 位置 | 实现 |
|------|------|
| `src/utils/window-sync.ts` 第 49 行 | `"__TAURI_INTERNALS__" in window` |
| `src/features/stage/StageWindow.tsx` 第 62 行 | `const hasTauri = "__TAURI_INTERNALS__" in window` |
| `src/features/stage/StageWindow.tsx` 第 84 行 | 同上，再来一次 |

**问题**：同一个检测逻辑散布在多处，且字符串 `"__TAURI_INTERNALS__"` 是 magic string。

**整理方向**：
- 在 `window-sync.ts` 中导出 `isTauriEnvironment()` 工具函数
- `StageWindow.tsx` 中的多处检测改为调用此函数

**涉及文件**：`src/utils/window-sync.ts`、`src/features/stage/StageWindow.tsx`
**预估改动量**：~5 行新增 + ~6 行替换

---

### T6：抽取 StageWindow localStorage 持久化工具（低风险）

**现状**：`src/features/stage/StageWindow.tsx` 第 12-23 行定义了 `ZOOM_STORAGE_KEY`、`saveZoom()`、`loadZoom()` 三个顶层声明，用于缩放比例的 localStorage 持久化。

**问题**：
- 持久化逻辑直接写在组件文件顶部，职责不匹配
- 如果后续有更多需要持久化的 Stage 设置（眼神模式、窗口尺寸偏好等），每个都写在组件顶部会越来越混乱

**整理方向**：
- 新建 `src/utils/stage-storage.ts`，收纳所有 Stage 相关的 localStorage 读写
- `StageWindow.tsx` 改为 import 并调用
- 为后续新增持久化项预留统一位置

**涉及文件**：新建 `src/utils/stage-storage.ts`、修改 `src/features/stage/StageWindow.tsx`
**预估改动量**：~15 行新建 + ~5 行替换

---

## 3. 本阶段明确不做什么

| 不做的事 | 原因 |
|---------|------|
| `Live2DRenderer.ts` 大类拆分 | 430 行渲染核心，拆分需逐一验证 7 种能力不回退，风险高 |
| `mock.ts` 动态 import 循环依赖治理 | 等真实 LLM/TTS 接入后自然消失 |
| `window-sync.ts` ControlCommand 联合类型重构 | 命令仍在增长中，过早抽象反而增加维护成本 |
| Service 层 Provider 注入机制 | 等 Phase 3 接入真实服务时再做 |
| 新目录结构模板 | 当前 `features/` + `services/` + `utils/` + `hooks/` 组织已足够，不需要翻新 |
| 大规模重命名 | 仅在职责移动时调整归属 |
| 真实 LLM / TTS / ASR 接入 | Phase 3 范围 |
| 新功能开发 | 本阶段只收敛，不扩张 |

---

## 4. 低风险高收益 vs 高风险应延后

### 低风险高收益（Phase 2.1 先做）

| 整理项 | 风险 | 收益 | 改动量 |
|--------|------|------|--------|
| T1: 窗口标签判断收敛 | 极低 | 中 | ~15 行 |
| T4: 删除 Live2DPreview.tsx | 极低 | 中 | 删除 74 行 |
| T5: 统一 Tauri 环境检测 | 极低 | 中 | ~11 行 |
| T6: localStorage 持久化抽取 | 极低 | 低-中 | ~20 行 |
| T3: ControlPanel Stage 逻辑分离 | 低 | 高 | ~60 行移动 |

### 中风险中收益（Phase 2.1 可做，需谨慎）

| 整理项 | 风险 | 收益 | 改动量 |
|--------|------|------|--------|
| T2: main.tsx 广播接线 hook 抽取 | 中 | 中 | ~50 行 |

### 高风险应延后（Phase 3+）

| 整理项 | 风险 | 收益 | 延后原因 |
|--------|------|------|---------|
| Live2DRenderer 大类拆分 | 高 | 高 | 渲染核心，任何拆分错误都导致模型不可用 |
| mock.ts 循环依赖 | 高 | 中 | 真实服务接入后自然消失 |
| ControlCommand 类型重构 | 中-高 | 低 | 命令仍在增长，过早抽象增加维护成本 |
| Service Provider 注入 | 中 | 中 | Phase 3 接入真实服务时自然需要 |

---

## 5. 建议执行顺序

按"风险从低到高、依赖从少到多"排序：

```
Step 1: T4 — 删除 Live2DPreview.tsx
         最简单，无依赖，纯删除

Step 2: T5 — 统一 Tauri 环境检测
         独立改动，不影响其他整理项

Step 3: T6 — 抽取 localStorage 持久化
         独立改动，为后续清理 StageWindow 做铺垫

Step 4: T1 — 窗口标签判断收敛
         涉及 main.tsx 和 App.tsx，但改动量小

Step 5: T3 — ControlPanel Stage 逻辑分离
         改动量较大，但逻辑清晰，移动即可

Step 6: T2 — main.tsx 广播接线 hook 抽取
         风险最高的一项，放最后做
         如果时间或信心不足，可以降级为只做注释标记
```

每完成一步：TypeScript 编译通过 → Linter 通过 → 可选手测验证 → 单独 commit。

---

## 6. 验收标准

### 编译与 lint

- [ ] `npx tsc --noEmit` 零错误
- [ ] 所有修改文件 lint 通过

### 功能不回退

- [ ] `pnpm tauri dev` 正常启动
- [ ] Stage 窗口可正常打开、显示模型
- [ ] 模型切换正常工作
- [ ] 眼神模式切换正常
- [ ] 缩放和缩放记忆正常
- [ ] docked / floating 切换正常
- [ ] 底部状态栏位置正确

### 结构改善可衡量

- [ ] `Live2DPreview.tsx` 已从仓库中删除
- [ ] `main.tsx` 与 `App.tsx` 不再各自维护窗口标签判断逻辑
- [ ] `ControlPanel.tsx` 不再包含模型选择和表情列表 UI
- [ ] `StageWindow.tsx` 不再直接包含 localStorage 读写函数
- [ ] Tauri 环境检测统一为 `window-sync.ts` 导出的工具函数

### 每个整理项独立可回滚

- [ ] 每个整理项对应一个独立的 git commit
- [ ] 回滚任意一个 commit 不影响其他整理项

---

## 7. 风险点与回滚思路

| 风险 | 影响 | 缓解 |
|------|------|------|
| T2 广播接线 hook 抽取后 HMR 行为变化 | 开发环境热更新可能出现不一致 | 手测确认；如有问题可回滚单个 commit |
| T3 模型选择移到 StageHost 后 UI 布局变化 | 左栏可能变高 | 视觉审查；如空间不足可调整 |
| T4 删除 Live2DPreview 后发现有隐式依赖 | 编译错误 | 先用 `tsc --noEmit` 确认无引用再删除 |
| 多个整理项同时进行时的合并冲突 | 文件级冲突 | 严格按顺序执行，每步独立 commit |

**回滚策略**：每个整理项是独立 commit，`git revert <commit>` 即可回滚单项而不影响其他。

---

## 8. 与后续真实服务接入的关系边界

### 本阶段整理 → Phase 3 接入的关系

| Phase 2.1 整理项 | 对 Phase 3 的帮助 |
|------------------|------------------|
| T1 窗口标签收敛 | 减少 Phase 3 新增窗口类型时的维护点 |
| T2 广播接线 hook 化 | Phase 3 接入真实 ASR 时，新增的广播订阅有统一位置 |
| T3 ControlPanel 分离 | Phase 3 新增真实 LLM/TTS 控制时，ControlPanel 职责清晰 |
| T4 删除 Live2DPreview | 消除误用风险，Phase 3 不会再有人试图复活它 |
| T5 Tauri 检测统一 | Phase 3 新增 Tauri 能力调用时，检测逻辑不再散落 |
| T6 持久化抽取 | Phase 3 新增用户偏好设置时，有统一的持久化层 |

### 明确的边界

- **Phase 2.1 只整理结构**，不改变任何功能行为
- **Phase 2.1 不触碰 Service 层的 Provider 机制**——那是 Phase 3 的事
- **Phase 2.1 不拆分 Live2DRenderer**——那需要渲染层的专项重构
- **Phase 2.1 的所有改动都不应影响 `window-sync.ts` 的 ControlCommand 协议**——命令契约在 Phase 3 之前保持稳定

### 真实服务替换点不变

Phase 2.1 不改变 `structure-analysis.md` 附录 D 中记录的四个替换点：

| 替换点 | 位置 | Phase 2.1 是否涉及 |
|--------|------|-------------------|
| 真实 LLM | `services/index.ts` 第 40 行 | 不涉及 |
| 真实 TTS | `services/index.ts` 第 42 行 | 不涉及 |
| 直播弹幕适配器 | `services/external-input/` | 不涉及 |
| RAG / 知识库 | `services/knowledge/` | 不涉及 |

---

## 附录：文件改动范围预估

| 文件 | 类型 | 涉及整理项 |
|------|------|-----------|
| `src/main.tsx` | 修改 | T1, T2 |
| `src/App.tsx` | 修改 | T1 |
| `src/app/MainWindow.tsx` | 修改 | T2 |
| `src/features/control-panel/ControlPanel.tsx` | 修改 | T3 |
| `src/features/stage/StageHost.tsx` | 修改 | T3 |
| `src/features/live2d/Live2DPreview.tsx` | 删除 | T4 |
| `src/features/live2d/index.ts` | 修改 | T4 |
| `src/utils/window-sync.ts` | 修改 | T5 |
| `src/features/stage/StageWindow.tsx` | 修改 | T5, T6 |
| `src/utils/stage-storage.ts` | 新建 | T6 |
| `src/hooks/use-main-window-sync.ts` | 新建 | T2 |
| `src/utils/window-label.ts` | 新建（可选） | T1 |

**总计**：修改 8 个文件，删除 1 个文件，新建 2-3 个文件。预估总改动量 ~200 行（移动 + 新增 + 删除）。
