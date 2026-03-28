# Run 08-002: Phase 2.1 Blueprint 产出

## 本次完成内容

基于 `blueprints/phase2-1/structure-analysis.md` 的结构盘点结果，撰写了 Phase 2.1 结构整理收敛阶段的正式 blueprint 文档。

## 从 structure-analysis.md 提炼的核心问题

### 适合现在处理（6 项）

1. **窗口标签判断重复**：`main.tsx` 与 `App.tsx` 各自实现一遍
2. **main.tsx 广播接线过于命令式**：订阅逻辑在 React 渲染前执行，无清理路径
3. **ControlPanel 混入 Stage 控制逻辑**：模型选择/表情列表本应归 StageHost
4. **Live2DPreview.tsx 已废弃未删除**：仍有 Live2DRenderer 实例化代码
5. **Tauri 检测逻辑散布 3 处**：`"__TAURI_INTERNALS__"` magic string 重复出现
6. **localStorage 持久化散落在组件文件**：`saveZoom`/`loadZoom` 直接写在 StageWindow 顶部

### 适合延后（4 项）

1. **Live2DRenderer 430 行大类拆分** — 渲染核心，风险高
2. **mock.ts 动态 import 循环依赖** — 真实服务接入后自然消失
3. **ControlCommand 15 种变体重构** — 命令仍在增长，过早抽象增加维护成本
4. **Service 层 Provider 注入** — 等 Phase 3

### 为什么这些问题适合现在处理

- 功能已稳定，结构已收敛到 Stage-only 单实例
- 还未进入 Phase 3 真实服务接入——现在整理成本最低
- 6 项整理项都是低/中风险，每项独立可回滚
- 整理后直接降低后续 AI / 人类协作理解成本

### 为什么另一些问题应该延后

- **Live2DRenderer 拆分**：430 行类承担 7 种能力，拆分需逐一验证每种能力不回退
- **mock.ts 循环依赖**：当前是 devtools 专用，Phase 3 接入真实 LLM/TTS 后 mock 路径自然缩减
- **ControlCommand 重构**：命令类型仍在随功能演进增长，过早抽象只会造成更多维护成本

## 产出文件

| 文件 | 说明 |
|------|------|
| `blueprints/phase2-1/phase2-1-blueprint.md` | Phase 2.1 正式 blueprint 文档 |
| `dev-reports/phase2/run08/002-phase2-1-blueprint.md` | 本报告 |

## 测试

本次为纯文档产出，不涉及代码改动，无需运行测试。
