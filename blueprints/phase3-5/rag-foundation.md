# Phase 3.5 — Knowledge Base / RAG Foundation

> **文档定位**: Phase 3.5 阶段总览——阶段目标、范围、约束、与其他 Phase 的边界。
> Run 01 正式实施蓝图见 `run01-semantic-knowledge-foundation.md`。

---

## 1. 本阶段定位

Phase 3.5 是项目在执行过程中插入的补充阶段，位于 Phase 3（已完成）与 Phase 4（Live Integration）之间。

本阶段的核心职责是建立**知识库基础设施**：将角色设定、商品资料、FAQ 等长期知识结构化导入，完成索引与检索能力建设，并打通"检索 → 上下文注入 → LLM 生成"这一闭环。

---

## 2. 为什么插入在 Phase 3 与 Phase 4 之间

Phase 3 已 close-out，控制面板、急停、运行时已稳定可用。Phase 4 的目标是 OBS 输出与直播平台事件接入。

然而，Phase 4 的弹幕/礼物事件处理链路中，LLM 回复需要依赖**实时注入的知识上下文**（商品当前主推、活动口径、角色设定等）。没有知识库支撑的 LLM 回复是"无根"的，无法满足直播场景的质量要求。

因此，知识库能力是 Phase 4 直播集成**真正的而非可选的前置依赖**，而非可后期补齐的支线任务。插入 Phase 3.5 是规划执行中的必要补充，而非推翻原路线图。

---

## 3. 为什么是补充阶段，而非推翻原路线图

- 原路线图 Phase 4 目标不变：**仍是 Live Integration**，OBS 输出 + 弹幕/礼物接入。
- Phase 3.5 不引入新的整数编号，保持主路线 0→1→2→3→4→5 的顺序完整性。
- Phase 3.5 的交付物不涉及语音链路（Phase 2）、控制面板（Phase 3）、OBS 集成（Phase 4）等已有明确阶段划分的模块。
- 本阶段不改变任何已有 phase 的交付物定义。

---

## 4. 本阶段目标

1. 建立知识库数据模型：长期知识（角色设定、商品基础资料、FAQ）与临时高优先级知识（当前主推、库存变化、活动口径）的区分与统一抽象。
2. 实现知识导入与索引管道：支持从结构化数据源（JSON/YAML）导入知识条目，建立可检索向量索引（embedding 方案待定，可先用关键词倒排索引作为 fallback）。
3. 实现检索与引用注入：给定用户/事件输入，能够从知识库检索相关片段，并注入到 LLM 上下文中。
4. 建立知识更新机制：支持运行时热更新临时高优先级知识，且其优先级高于长期知识。
5. 与 LLM 服务解耦：知识库以服务形式提供检索接口，不绑定特定 LLM provider。

---

## 5. 本阶段范围

### 5.1 必做

- 知识库数据模型设计（types / interfaces）
- 知识导入模块（支持 JSON/YAML 批量导入，支持单条热更新）
- 检索模块（支持向量相似度检索，支持关键词召回，多路召回结果归并）
- 引用注入模块（将检索结果格式化为 LLM 可引用的上下文字符串）
- 知识服务（KnowledgeService）扩展：提供标准化的 `query(query: string): Promise<KnowledgeResult>` 接口
- LLM Pipeline 集成：在 PromptBuilder 中增加知识上下文注入钩子
- 管理 UI 最小原型：知识库查看、新增、编辑面板（只做 read/edit，不做复杂权限管理）

### 5.2 Run 01 实际技术路线（已确定）

> 注意：本节在 Run 01 计划确定后更新，反映实际采用的方案。
> 详细实施计划见 `run01-semantic-knowledge-foundation.md`。

Run 01 采用 **Semantic Knowledge Base Foundation** 路线，而非本文档初稿中描述的"可选 embedding + 关键词 fallback"方案：

- **向量数据库**：Orama（`@orama/orama`，纯 TS，浏览器/Tauri webview 原生运行）
- **Embedding**：OpenAI `text-embedding-3-small`，通过已有 Rust 代理调用
- **检索**：vector retrieval（语义检索）为主线，hybrid 为可选补充
- **持久化**：原始文档与索引快照分离存储（Tauri Store / localStorage），封装为可替换的持久化模块

Embedding 和本地向量索引已从"可选"提升为 Run 01 的**必做项**。

---

## 6. 本阶段明确不做

- 不实现弹幕/礼物事件的 WebSocket 接入（属于 Phase 4）。
- 不实现商品消息的实时优先队列（留待 Phase 4 细化，但接口设计时需预留）。
- 不实现 RAG 的完整评估基准与回归测试（可在 Phase 5 补充）。
- 不做 SaaS、多人协作、云平台相关功能。
- 不替换已有的 LLM、TTS、ASR 服务接入（这些属于 Phase 2/3）。
- 不改动已有 phase 的交付物定义。
- 不做性能优化（属于 Phase 5）。

---

## 7. 与 Phase 3 / Phase 4 的边界

### 与 Phase 3 的边界

Phase 3 已交付控制面板、急停、运行时。Phase 3.5 不修改这些模块。

- **KnowledgeService** 扩展后仍属于 `src/services/knowledge/` 目录，不移动到其他 phase 目录。
- 知识管理 UI（若有）放在 `src/features/knowledge/` 或复用已有 Settings 面板，不新建独立大模块。
- Phase 3 的 `EventBus` 订阅关系不变。

### 与 Phase 4 的边界

Phase 4 负责弹幕/礼物 WebSocket 接入、OBS 舞台窗口、直播事件到 LLM 的路由。

- Phase 3.5 提供 `KnowledgeService.query()` 接口，Phase 4 的外部事件处理层负责在适当位置调用该接口。
- Phase 4 的"商品消息与知识上下文注入"（原路线图描述）依赖本阶段建立的检索管道，但 Phase 4 不重写知识库模块。
- Phase 4 的 `external-input` 适配器框架不变，只在知识注入环节调用 Phase 3.5 的接口。

---

## 8. 最小验收标准

| # | 验收项 | 验证方式 |
|---|--------|----------|
| 1 | 知识库可导入 JSON/YAML 格式的角色设定与商品资料 | 导入后通过管理面板可查看 |
| 2 | 给定文本检索请求，返回 Top-K 相关知识片段 | 单元测试或 API 测试 |
| 3 | 检索结果可注入到 LLM Prompt 中，不破坏现有 LLM 调用链路 | 集成测试（mock LLM） |
| 4 | 临时高优先级知识可在运行时热更新，且优先级高于长期知识 | 手动测试验证 |
| 5 | 不破坏现有 Phase 2/3 已有的 LLM/TTS/控制面板功能 | 回归测试 |

---

## 9. 风险与待定

| 事项 | 风险等级 | 当前状态 |
|------|----------|---------|
| Embedding 模型选型 | 已确定 | `text-embedding-3-small` (1536d)，通过 DMXAPI 调用 |
| 向量数据库选型 | 已确定 | Orama (`@orama/orama`)，纯 TS，零原生依赖 |
| 商品消息优先级实现 | 中 | 临时消息与长期知识的优先级策略需在 Phase 4 前细化 |
| 知识库与 LLM Prompt 的耦合 | 中 | 需确保注入不导致 Prompt 长度超限（需配合 Phase 2 的分段策略） |
| 低 similarity threshold 随语料增长的噪声风险 | 中 | 当前 0.2 为暂定值，50 条以上需校准（见 `dev-reports/phase3-5/run01/002-*`） |
