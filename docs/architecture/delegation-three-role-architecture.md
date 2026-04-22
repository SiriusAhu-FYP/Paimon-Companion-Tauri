# 托管模式三角色架构

> P5 Neo 产出的核心架构文档。描述 Delegation Mode（托管模式）中 Mission Analyst → Operations Planner → Progress Evaluator 的工作流。

## 概述

托管模式允许用户下达自然语言任务（如"在 Google 上搜索 XXX"），系统通过三个 LLM 角色的协作完成浏览器或游戏中的操作。整个流程以 **单次分析 + 循环执行** 的方式运行：

```
用户任务 → Mission Analyst（一次） → [Planner → 执行动作 → Evaluator] × N → 完成/失败
```

## 三角色

### Mission Analyst（任务分析师）

- **触发时机**：任务开始时调用一次
- **输入**：用户任务文本 + 当前屏幕截图
- **输出**：
  - `taskMode`：browser / game
  - `missionGoal`：提炼后的任务目标
  - `hardConstraints`：硬约束条件
  - `subtaskChain`：子任务链（引导 Planner 拆解步骤）
  - `completionSignals`：成功信号描述
  - `ackReply`：角色一致的知晓回复（如"派蒙知道啦！"）
- **使用模型**：云端 LLM

### Operations Planner（执行规划者）

- **触发时机**：每轮循环开始
- **输入**：当前截图 + 任务上下文 + Scratchpad 共享上下文 + 上轮 Evaluator 的 hint
- **输出**：
  - `goalReached`：是否已达目标
  - `reasoning`：推理过程
  - `expectedOutcome`：预期结果（用于 Evaluator 校验）
  - `actions`：MCP 工具调用列表（鼠标/键盘/等）
  - `reply`：面向用户的状态播报
- **策略检测**：`detectPlannerPolicyIssue` 检查空动作、重复失败签名、不完整操作链等，允许一次重试
- **使用模型**：云端 LLM

### Progress Evaluator（进度评估者）

- **触发时机**：每轮动作执行后
- **输入**：动作前截图 + 动作后截图 + Planner 的 `expectedOutcome`
- **输出**：
  - `actionSucceeded`：动作是否执行成功
  - `wasActionCorrect`：动作方向是否正确
  - `expectedMet`：预期结果是否达到
  - `goalAlignment`：与总目标的对齐程度
  - `goalProgress`：任务总进度
  - `reply`：角色播报
  - `nextHint`：下一轮 Planner 的修正建议
- **使用模型**：云端 LLM

## Scratchpad 临时上下文

角色间通过 Scratchpad 共享中间信息，避免每轮传入超长历史上下文：

```
scratchpad/
  roles/
    analyst.md          # Analyst 的完整分析
    planner.md          # Planner 各轮推理
    evaluator.md        # Evaluator 各轮评估
  shared/
    mission.json        # 任务快照（missionGoal, constraints, subtaskChain 等）
    context.md          # 每轮重写的跨角色摘要
    session.md          # 会话头信息
```

`shared/context.md` 每轮重写，包含：
- 任务目标 + 约束
- 上轮 Evaluator 的 hint 和预期是否达成
- 最近 2 条 Planner/Evaluator 笔记
- 最近 3 条历史行动摘要

Scratchpad 在日志启用时同步到 `debug-captures/` 目录。超过 1 天的 scratchpad 在应用启动时清理。

## TOML 即插即用配置

`src/config/tasks/delegation-browser.toml` 提供任务配置：

- `maxRounds`：最大循环次数
- `summaryWindowMs`：摘要窗口
- 每个角色的独立规则和温度（`[profile.roles.missionAnalyst]` 等）
- 定位器配置（`[profile.locator]`）
- 允许的工具列表

配置以自然语言描述为主，方便用户修改行为规则。由 `delegated-task-config.ts` 解析并提供类型安全的访问接口。

## 定位系统

鼠标操作需要坐标。当 Planner 输出的动作缺少精确坐标时，使用定位阶梯：

1. **Consensus 工具** (`host.resolve_locator_consensus`)：对本地 VLM 发起 4 次采样，去除离群值后取平均中心点
2. **单次本地视觉模型**：Qwen3-VL-2B-Instruct 单次定位
3. **规则修正**：基于 `locatorHint` 的启发式修正（如地址栏反转 Y 轴）
4. **云端视觉模型**：最后兜底

每层结果经过 `applyLocatorCoordinateCorrections` 修正（地址栏场景的 Y 轴翻转和偏移），且必须满足 `locatorMinConfidence` 阈值。

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
