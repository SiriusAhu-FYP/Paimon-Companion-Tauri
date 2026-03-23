# Phase 2.1 Run 01: 结构整理执行报告

## 执行范围

按照 `blueprints/phase2-1/phase2-1-blueprint.md` 中定义的 6 项整理任务，本轮完成了 T4/T5/T6/T1/T3 共 5 项，T2 评估后决定不做。

## 完成项

### T4: 删除 Live2DPreview.tsx 残留

- 确认无其他文件引用 `Live2DPreview`，`index.ts` 也不导出它
- 直接删除 `src/features/live2d/Live2DPreview.tsx`（74 行）
- 消除已废弃文件被误用的风险

### T5: 统一 Tauri 环境检测

- 在 `src/utils/window-sync.ts` 新增 `isTauriEnvironment()` 导出函数
- 替换 `StageWindow.tsx` 中 2 处 `"__TAURI_INTERNALS__" in window`
- 替换 `MainWindow.tsx` 中 1 处同样的 magic string
- `window-sync.ts` 内部也改为调用此函数
- 最终全项目仅 `window-sync.ts` 第 45 行保留唯一一处 `__TAURI_INTERNALS__` 字面量

### T6: 抽取 localStorage 持久化

- 新建 `src/utils/stage-storage.ts`，统一管理所有 Stage 相关 localStorage 读写
- 将 `StageWindow.tsx` 顶部的 `saveZoom` / `loadZoom` 移入
- 将 `StageHost.tsx` 中的 `SizePreset` 接口、`loadCustomPresets` / `saveCustomPresets` 移入
- 两个组件改为从 `@/utils/stage-storage` 导入

### T1: 收敛窗口标签判断

- 新建 `src/utils/window-label.ts`，包含 `resolveWindowLabel()` 和导出的 `windowLabel` 常量
- `main.tsx` 移除内联的窗口标签判断逻辑（14-25 行），改为 `import { windowLabel }`
- `App.tsx` 移除内联的 `getWindowLabel()` 函数，改为同一 import
- 消除两处重复的 `getCurrentWindow().label` + URL 参数检测

### T3: ControlPanel Stage 逻辑分离

- 将模型选择 UI（Select/MenuItem）、表情列表订阅（onControlCommand report-expressions）和表情按钮列表从 `ControlPanel.tsx` 移入 `StageHost.tsx`
- `ControlPanel.tsx` 从 218 行降至约 140 行，职责收敛为运行状态/角色状态/Spike 验证/Mock 测试
- `StageHost.tsx` 新增模型下拉选择和表情按钮区域，归入 Stage 标签下

## 未做项

### T2: main.tsx 广播接线 hook 抽取

评估结论：本轮不做。

原因：
1. `main.tsx` 当前仅 57 行，三段结构清晰
2. 广播接线是模块级代码，移入 hook 引入不必要的生命周期复杂性
3. `bus.on()` 不需要 cleanup——订阅在整个应用生命周期内保持
4. 风险中等、收益低

## 改动文件

| 文件 | 类型 | 涉及整理项 |
|------|------|-----------|
| `src/features/live2d/Live2DPreview.tsx` | 删除 | T4 |
| `src/utils/window-sync.ts` | 修改 | T5 |
| `src/features/stage/StageWindow.tsx` | 修改 | T5, T6 |
| `src/app/MainWindow.tsx` | 修改 | T5 |
| `src/utils/stage-storage.ts` | 新建 | T6 |
| `src/features/stage/StageHost.tsx` | 修改 | T6, T3 |
| `src/utils/window-label.ts` | 新建 | T1 |
| `src/main.tsx` | 修改 | T1 |
| `src/App.tsx` | 修改 | T1 |
| `src/features/control-panel/ControlPanel.tsx` | 修改 | T3 |
| `blueprints/phase2-1/phase2-1-blueprint.md` | 修改 | 文档修正 |

## 验证结果

- TypeScript 编译通过（`npx tsc --noEmit` 零错误）
- 所有修改文件 lint 通过
- Vite HMR 热更新正常

## 改动统计

- 修改 9 个文件，删除 1 个文件，新建 2 个文件
- 净减少约 146 行代码（删除 240 行，新增 94 行）
- 不改变任何功能行为和用户交互语义
