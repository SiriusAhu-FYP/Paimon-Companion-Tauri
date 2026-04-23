# 托管模式三角色架构

This tracked file is only a placeholder.

The current working version has been moved to `.private/最终冲刺/08-托管三角色架构.md`, which is private and not tracked.

Do not use `docs/architecture/` as the implementation source of truth at this stage.

## 完成判定

以下任一条件触发任务结束：

- **Planner 判定完成**：`goalReached === true` 且本次运行中至少执行过一次动作
- **Evaluator 判定完成**：`goalProgress === "done"` 或 `goalAlignment === "achieved"`
- **达到最大轮次**：标记为失败
- **用户手动停止**

## Timeline 可视化

`DelegationTimelinePanel` 作为独立 dock 标签页，实时展示：

- 任务文本 + 目标
- 每轮决策卡片：Planner 推理、执行动作、Evaluator 评估结果
- 状态标签（成功/失败、对齐度、进度）
- 自动滚动跟踪最新轮次

数据来源为 `UnifiedRunRecord.delegationTimeline`。

## 事件日志

`DebugCaptureService` 写入 `events.jsonl`，并做了以下升级：

- **Payload 清洗**：`sanitizePayload` 截断 >512 字符的字符串，替换 base64 图片 URL 为元数据
- **深度限制**：对象递归深度 6 层，数组长度上限 32
- **事件节流**：高频状态变更事件（`orchestrator:state-change` 等）以 2 秒间隔节流写入

## 关键文件索引

| 文件 | 职责 |
|------|------|
| `src/services/unified/delegated-task-runner.ts` | 三角色循环主逻辑 |
| `src/services/unified/delegated-task-config.ts` | TOML 配置解析 |
| `src/services/unified/unified-runtime-service.ts` | 统一运行时编排 |
| `src/config/tasks/delegation-browser.toml` | 即插即用任务配置 |
| `src/types/unified.ts` | 类型定义 |
| `src/services/mcp/tool-defs.ts` | MCP 工具注册（含 consensus） |
| `src/features/control-panel/DelegationTimelinePanel.tsx` | Timeline UI |
| `src/services/debug-capture/debug-capture-service.ts` | 事件日志 |
