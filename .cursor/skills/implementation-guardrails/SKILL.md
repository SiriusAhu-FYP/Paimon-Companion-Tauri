---
name: implementation-guardrails
description: Paimon Live 实施护栏。当开始实现任务、run、blocker-fix 或 Phase 实施时使用。触发词：开始实现、做 run、blocker-fix、接进去、实施、开始改代码。
---

# Implementation Guardrails

## 核心原则

1. **范围收紧**：只做当前任务明确要求的内容，不顺手扩张到下一个 phase 或无关模块
2. **保住已成立能力**：Stage、OBS、Pipeline、配置体系、provider 接口、mock 回退等不得轻易破坏
3. **小步修改**：优先最小必要改动，不演变成大规模结构翻新
4. **mock 永远保留**：接入 real provider 时不得删除 mock 路径，必须保留可回退能力
5. **真实验证优先**：编译通过 ≠ 完成，需明确已手测 / 未验证项
6. **run 报告属于交付物**：无报告视为交付不完整
7. **git 提交必须明确**：Conventional Commits + scope + 记录 commit hash
8. **不把 polish 当主线**：UI 小问题、风格优化不抢占主任务
9. **发现范围变化时先停下来**：边界明显变化时先说明，不直接一并做掉
10. **真实手测优先于实现报告**：如果实现汇报与用户亲自验证到的现象冲突，以真实手测结果为准。

## 实施前核查清单

开始实现前，逐项确认：

```
- [ ] 本轮范围已明确（做什么 / 不做什么）
- [ ] 当前已成立能力未被破坏的风险已评估
- [ ] mock 回退路径保留方案已确认
- [ ] 验证方式已明确（手测项 / 未验证项）
- [ ] run 报告计划已确认
- [ ] commit 时机已确认
```

## 实施中护栏提醒

### 范围护栏
- 如果发现任务边界明显变化 → 先停下来汇报变化，不直接做掉
- 如果发现可以"顺手优化"的地方 → 记录为待办，不在当前 run 动手

### 已成立能力护栏
- 如果改动会影响 Stage / OBS / provider 接口 / 配置体系 → 先评估风险
- 如果可能破坏 mock 回退能力 → 禁止删除 mock 路径

### 交付护栏
- 每次明确任务完成后 → 必须生成 run 报告
- 每次实现类任务结束后 → 必须 git commit
- commit message → Conventional Commits + scope
- 缺 run 报告或缺 commit hash 的交付，视为未完整完成

## 输出格式

当需要以结构化方式输出护栏提醒时：

```
## 本轮实施范围

### 做
- ...

### 不做
- ...

## 风险提醒
- （哪些已成立能力不能破坏）
- （哪些改动可能影响当前稳定性）

## 实施要求
- 最小必要改动
- mock 保留
- 小步验证
- 可回退

## 交付要求
- run 报告
- git commit（Conventional Commits + scope）
- commit hash
- 已验证 / 未验证项
```

## 约束

- 不替代 phase blueprint
- 不替代 closeout-review
- 不直接写架构方案
- 不鼓励过度设计
- 不把所有技术债都塞进当前 run
