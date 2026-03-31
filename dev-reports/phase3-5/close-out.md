# Phase 3.5 Close-out — Knowledge Base / RAG Foundation

> **文档定位**: Phase 3.5 阶段总结与交接文档。
> 阶段蓝图见 `blueprints/phase3-5/rag-foundation.md`。

---

## 1. Phase 3.5 的阶段目标（回顾）

Phase 3.5 是项目在 Phase 3（Control & Monitor）与 Phase 4（Live Integration）之间插入的补充阶段。核心目标是建立**知识库基础设施**，为 Phase 4 直播场景中 LLM 回复的质量提供前置依赖。

具体来说：
- 将角色设定、商品资料、FAQ 等长期知识结构化导入
- 完成 embedding + 向量索引 + 语义检索闭环
- 打通"检索 → 上下文注入 → LLM 生成"链路
- 建立知识更新机制（运行时热更新、持久化）
- 以服务形式提供检索接口，不绑定特定 LLM provider

---

## 2. 本阶段 Run 全览

Phase 3.5 共执行了 3 个正式 Run 和 2 个补丁性修复：

| Run | 目标 | 状态 | 报告位置 |
|-----|------|------|----------|
| Run 01 | Semantic Knowledge Base Foundation：embedding + Orama + 检索 + 注入 + UI | **accepted** | `run01/report.md` |
| Run 02 | Rerank Integration：recall→rerank→final 三段式检索升级 | **accepted** | `run02/report.md` |
| Run 03-A | Behavior Constraints Layer：system prompt 行为约束注入 | **implemented, not accepted** | `run03/run03-behavior-constraints-and-knowledge-ux.md` |
| Run 03-B | Knowledge Input UX：drag-and-drop + dual-mode + 字段引导 | **implemented, not accepted** | `run03/run03-behavior-constraints-and-knowledge-ux.md` |
| BugFix | L2D 关闭后重启加载失败 + JSON 模板自动填充 | **implemented, not accepted** | `run-xx-bugfix-l2d-json-template.md` |
| UX 重设计 | KnowledgePanel 添加知识入口 + 批量选择 + 编辑模式 + 预览溢出 | **implemented, not accepted** | `run-knowledge-panel-ux-redesign.md` |

---

## 3. 各 Run 详情

### Run 01 — Semantic Knowledge Base Foundation

**核心目标**：建立第一轮可测试的语义知识库闭环。

**实际完成内容**：
- 文本切块器（512 字符 + 50 重叠）
- OpenAI Embedding Service（`text-embedding-3-small`，1536 维，通过 Rust 代理）
- Orama 向量数据库封装（纯 TS，零原生依赖，浏览器 / Tauri webview 原生运行）
- 双层持久化（原始文档 + 索引快照，Tauri Store / localStorage）
- KnowledgeService 重构（import / query / remove / rebuild / persist）
- 检索结果格式化 + LLM 链路升级（`sendMessage` 改为 query + 格式化注入）
- SettingsPanel 知识管理 UI + 搜索验证框
- EmbeddingProvider 独立配置体系
- liveContext 临时注入保持向后兼容

**Patch 历史**：
- Patch A：similarity 阈值 0.5→0.2，searchMode 默认 hybrid，fulltext fallback，persona 冲突修复
- Patch B：title 纳入 embedding 输入，索引生命周期 revision 门控，schema v2→v3

**已知限制**：
- 必须有可用的 Embedding API，无 key 则导入失败（降级为 fulltext）
- 文档硬上限 200 条
- localStorage 容量约束（5–10 MB）
- similarity 阈值 0.2 在语料增长后可能产生噪声

### Run 02 — Rerank Integration

**核心目标**：将检索链路升级为 `hybrid recall (topK=20) → rerank (topN=10) → final topK=5`。

**实际完成内容**：
- `CompatibleRerankService`：兼容 `/v1/rerank` 端点（Cohere / Jina / DMXAPI）
- KnowledgeService 三段式检索（recall → rerank → final）
- searchMode 默认锁定 hybrid，UI 中不暴露
- Rerank 配置 UI（启用开关 + Profile 管理）
- 8 条真实 query 的 Baseline vs Rerank 对比实验

**手测结论**：
- 平均 top1 score：baseline 0.4905 → rerank 0.8746（+78.3%）
- 7/8 query 改善或增强，1/8 误排（Q4 "派蒙现货吗"）
- rerank 失败时正确降级为不 rerank
- rerank 默认关闭，需用户手动启用

**已知限制**：
- rerank 增加一次 API 调用延迟（10s 超时）
- Q4 误排为已知问题，可通过 `rerankEnabled=false` 一键回退

### Run 03 — Behavior Constraints & Knowledge Input UX

**核心目标**：A 线——system prompt 行为约束层；B 线——知识录入 UX 改善。

**A 线完成内容**：
- `BehaviorConstraintsConfig` 配置体系
- prompt-builder 位置 0 插入【直播行为约束】段落
- 默认约束：150 字上限、禁止括号动作描写、禁止场景旁白、口语化风格
- SettingsPanel 约束配置 UI（启用开关 + 字数上限 + 自定义规则）

**B 线完成内容**：
- Drag-and-drop 文件导入区域
- Dual-mode 输入（简洁模式 / JSON 模式切换）
- 可展开示例模板 + 复制到剪贴板
- 字段引导（helperText）+ JSON 实时验证

**补充**：Run 03 同时完成了角色卡 Broadcast Sanitization（paimon / ganyu 清洗版）。

### 补丁性修复

**L2D 关闭后重启加载失败**：
- 根因：WebGL context 在关闭时被污染，旧 canvas 无法恢复
- 最终方案：在 `show-stage` 时动态创建新 canvas 替换旧 canvas，保留穿透状态

**KnowledgePanel UX 重设计**：
- 添加知识入口默认折叠为按钮，点击展开三 tab
- JSON 导入改名为"输入 JSON"，自动预填样例
- 批量选择改为独立模式（"批量管理"按钮进入 + 独立全选按钮）
- 删除保留 2s 倒计时确认
- 编辑界面支持简洁/JSON 双模式切换
- 预览文字溢出修复

---

## 4. Phase 3.5 蓝图验收标准对照

| # | 蓝图验收项 | 状态 | 说明 |
|---|-----------|------|------|
| 1 | 知识库可导入 JSON 格式的角色设定与商品资料 | ✅ 已实现 | JSON 导入 + 手动添加 + drag-and-drop |
| 2 | 给定文本检索请求，返回 Top-K 相关知识片段 | ✅ 已实现 | vector / hybrid / fulltext 三模式 + rerank 可选 |
| 3 | 检索结果可注入到 LLM Prompt 中，不破坏现有调用链路 | ✅ 已实现 | formatRetrievalForPrompt + PromptBuilder 无破坏性改动 |
| 4 | 临时高优先级知识可在运行时热更新，优先级高于长期知识 | ✅ 已实现 | liveContext 保持纯内存注入，排在检索结果之前 |
| 5 | 不破坏现有 Phase 2/3 的 LLM/TTS/控制面板功能 | ✅ 已验证 | 回归测试通过 |

---

## 5. 当前仍存在的已知问题

| 问题 | 性质 | 影响 | 当前方案 |
|------|------|------|----------|
| Run 03 A/B 线未完成手测验收 | 流程 debt | 行为约束效果和知识录入 UX 未经运行时确认 | 代码实现就位，编译通过，待人工验证 |
| Rerank Q4 误排 | 已知缺陷 | 特定 query 下 rerank 排序反而变差 | `rerankEnabled=false` 一键回退 |
| similarity 阈值需校准 | 技术 debt | 语料增长后低阈值 (0.2) 可能引入噪声 | 留到语料积累后调参 |
| i18n 未激活 | 技术 debt | i18next 已安装但未初始化，所有 UI 为中文硬编码 | 后续需要多语言时初始化 |
| 文档上限 200 条 | 设计约束 | 超出时 UI 提示 | 后续可迁移持久化到文件或 SQLite |
| 行为约束是 LLM 指令而非强制 | 固有限制 | LLM 可能偶尔违反，特别是角色卡 RP 倾向强时 | 结合角色卡 sanitization 使用 |

---

## 6. Phase 3.5 是否 Close-out Ready？

**判断：Close-out ready，带已知 debt。**

**理由**：

1. **蓝图验收标准全部满足**：5 项验收标准均已实现，核心链路（导入 → 索引 → 检索 → 注入 → LLM 回复）已完整
2. **Run 01 + Run 02 已 accepted**：核心能力（语义检索 + rerank）经过真实手测验证
3. **Run 03 是增量改善，不是核心能力**：行为约束和 UX 改善是锦上添花，不影响 Phase 4 的前置依赖关系
4. **已知 debt 均有 stopgap**：每个已知问题都有明确的降级或回退方案
5. **Phase 4 的真实前置条件已就位**：
   - `KnowledgeService.query()` 接口可用
   - `ExternalInputService.injectEvent()` 与 `EventMap` 已为外部事件做好接入框架
   - 商品消息已通过 `external:product-message` 自动写入知识库
   - liveContext 临时注入仍可用于直播场景的快速上下文注入

**为什么现在适合进入 Phase 4，而不是继续横向扩张**：
- Phase 3.5 的核心价值是"让 LLM 回复有知识依据"，这个能力已经建立
- 继续横向扩张（本地 embedding、复杂 loader、ChatPanel 引用 UI 等）是优化而非基础
- Phase 4 的弹幕接入是项目的关键里程碑（直播场景可用性），不应因 Phase 3.5 的优化项而推迟
- Phase 3.5 的已知 debt 不阻塞 Phase 4 的任何工作

---

## 7. 本阶段产出物总结

### 代码产出

| 类别 | 新增/修改 | 主要文件 |
|------|----------|----------|
| 知识类型系统 | 新增 | `src/types/knowledge.ts` |
| Embedding 服务 | 新增 | `src/services/knowledge/embedding-service.ts` |
| 文本切块器 | 新增 | `src/services/knowledge/text-chunker.ts` |
| Orama 封装层 | 新增 | `src/services/knowledge/orama-store.ts` |
| 知识持久化 | 新增 | `src/services/knowledge/knowledge-persistence.ts` |
| 检索结果格式化 | 新增 | `src/services/knowledge/knowledge-formatter.ts` |
| Rerank 服务 | 新增 | `src/services/knowledge/rerank-service.ts` |
| 知识服务重构 | 大幅修改 | `src/services/knowledge/knowledge-service.ts` |
| LLM 链路升级 | 修改 | `src/services/llm/llm-service.ts`, `prompt-builder.ts` |
| 行为约束层 | 新增逻辑 | `src/services/llm/prompt-builder.ts`, `config/types.ts` |
| 知识管理 UI | 新增/大幅修改 | `src/features/knowledge/KnowledgePanel.tsx` |
| 设置面板扩展 | 修改 | `src/features/settings/SettingsPanel.tsx` |
| 角色卡清洗 | 新增 | `public/cards/paimon-sanitized-v1.json`, `ganyu-sanitized-v1.json` |

### 文档产出

| 文档 | 位置 |
|------|------|
| 阶段蓝图 | `blueprints/phase3-5/rag-foundation.md` |
| Run 01 实施蓝图 | `blueprints/phase3-5/run01-semantic-knowledge-foundation.md` |
| Run 01 报告 | `dev-reports/phase3-5/run01/report.md` |
| Run 01 过程快照（6 份） | `dev-reports/phase3-5/run01/00N-*.md` |
| Run 02 报告 | `dev-reports/phase3-5/run02/report.md` |
| Run 02 实验记录（2 份） | `dev-reports/phase3-5/run02/baseline-experiment.md`, `rerank-experiment.md` |
| Run 03 报告 | `dev-reports/phase3-5/run03/report.md`, `run03-behavior-constraints-and-knowledge-ux.md` |
| BugFix 报告 | `dev-reports/phase3-5/run-xx-bugfix-l2d-json-template.md` |
| UX 重设计报告 | `dev-reports/phase3-5/run-knowledge-panel-ux-redesign.md` |

---

## 8. 留给后续阶段的事项

| 事项 | 建议归属 |
|------|----------|
| ChatPanel 内联引用 UI | Phase 5 或独立 run |
| 复杂 loader（PDF / Word / 网页） | Phase 5 或独立 run |
| Per-character 知识关联 | Phase 5 |
| 本地 embedding 模型 | Phase 5 |
| Hybrid search 权重调参 | Phase 5（需语料积累） |
| i18n 基础设施激活 | Phase 5 |
| UI 组件瘦身（7 项合并机会） | Phase 5 或独立 run |

---

## 元信息

- 阶段分支: `feature/phase3-5-rag-foundation`
- 阶段蓝图: `blueprints/phase3-5/rag-foundation.md`
- Close-out 日期: 2026-03-31
