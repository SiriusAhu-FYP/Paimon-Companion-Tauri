# Phase 0 — Supplement 修订汇报

**日期：** 2026-03-21
**分支：** `feature/phase0-bootstrap`
**依据：** `blueprints/phase0/supplement.md`

---

## 本次完成的工作

根据 `supplement.md` 的补充约束，对 Phase 0 已有文档进行了修订，并新增了缺失文档。

### 1. 修订的文档

#### architecture.md
- 将"单进程架构"修正为"单桌面宿主应用 + 可插拔外部服务"
- 明确允许外部 ASR/TTS/LLM 服务、未来 sidecar/helper process 存在
- 将"渲染同源"修正为"单一状态真源，双窗口同步渲染"——不是共享 renderer，而是共享状态
- 业务层模块表新增 runtime、knowledge、external-input
- 状态分类表新增运行时状态和知识状态
- 急停部分明确由 runtime 统一协调
- 明确 Windows-only 不预支跨平台复杂度

#### module-design.md
- 新增 `runtime` 模块（运行时控制器）——含运行模式、门控职责、模式定义
- 新增 `knowledge` 模块（知识与上下文层）——区分长期知识与临时高优先级上下文
- 新增 `external-input` 模块（外部事件标准化接入）——独立适配器框架
- 明确 LLM 模块不独自承担知识层和外部事件接入职责
- 明确 character 模块作为角色状态的唯一权威真源
- 明确口型数据走专门通道而非普通事件总线
- 通信矩阵新增 runtime、knowledge、external-input 相关条目
- Hook 列表新增 useRuntime()、useKnowledge()

#### data-flow.md
- 主链路新增 runtime 门控检查节点
- 主链路新增 knowledge 上下文获取步骤
- 新增"口型数据通道"专节——说明为何不走普通事件总线
- 新增"知识注入流"专节——区分长期知识和临时高优先级上下文的注入路径
- 新增优先级排序说明（临时 > 角色人设 > 长期知识）
- 事件类型新增 runtime:mode-change、system:manual-takeover
- 口型数据从事件列表中移除，标注走专门通道
- 急停/人工接管流程通过 runtime 统一控制

#### phase-roadmap.md
- 声明文档生成策略：每次最多只详细生成下一阶段
- Phase 2-5 精简为高层目标描述，不再包含详细交付物和验收标准
- Phase 1 指向 `blueprints/phase1/foundation.md` 作为详细施工文档
- Phase 1 关键交付物新增 runtime 和 spike 任务

### 2. 新增的文档

| 文档 | 说明 |
|------|------|
| `blueprints/phase0/product-requirements.md` | 产品需求文档——产品定位、用户角色、核心场景、能力需求、不做清单、成功标准 |
| `blueprints/phase1/foundation.md` | Phase 1 详细施工文档——任务清单、spike 验证计划、交付物、验收标准、风险点 |

### 3. 新增的目录

| 目录 | 说明 |
|------|------|
| `src/services/runtime/` | 运行时控制器模块占位 |
| `src/services/knowledge/` | 知识与上下文层模块占位 |
| `src/services/external-input/` | 外部事件接入模块占位 |

### 4. 其他修改

- `README.md` 目录结构更新，新增三个 services 子目录

---

## 测试

本阶段无业务代码，不涉及测试。

---

## 风险与待办

- Phase 1 的四个 spike 任务需要实际验证，结论将影响后续架构决策
- 状态管理方案选型（Zustand / Jotai / 自建）需在 Phase 1 初期确定
- Live2D 模型资源需从旧项目复制或另行准备
