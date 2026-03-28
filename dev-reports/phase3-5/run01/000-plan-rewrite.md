# Phase 3.5 Run 01 — 计划重写报告

## 本次完成了什么

重写了 Phase 3.5 Run 01 的正式实施计划文档，替代上一版偏保守的"纯关键词 + Tauri Store"方案。

## 新文档路径

`blueprints/phase3-5/run01-semantic-knowledge-foundation.md`

## 旧文档处理

`blueprints/phase3-5/rag-foundation.md` — **保留为历史草稿**。它仍是 Phase 3.5 的阶段总览（定位、与其他 Phase 的边界），但其技术方案已被新文档取代。路线图中的引用已更新为同时指向两份文档。

## 推荐技术路线

**路线 C：Orama + OpenAI Embeddings + Tauri Store 持久化**

| 组件 | 选型 | 理由 |
|------|------|------|
| 向量数据库 | Orama (`@orama/orama`) | 纯 TS、零原生依赖、<2kb、可在 Tauri webview 直接运行、内置 hybrid search |
| Embedding | OpenAI `text-embedding-3-small` | 项目已有安全代理链路、成本极低、复用现有 API key |
| 持久化 | Orama JSON dump → Tauri Store / localStorage | 无需 Node.js 文件系统、与 AppConfig 独立 |

**不推荐 LlamaIndex.TS + LanceDB** 的原因：LanceDB 是 native Node.js 二进制，在 Tauri webview 中需要 sidecar，部署复杂度过高。LlamaIndex.TS 体量庞大，引入大量本项目不需要的概念。

**不推荐 Cherry Studio 风格** 的原因：LibSQL 同样有 native binding 问题，全格式 loader 管线过重。

## 为什么不再建议"纯关键词检索第一轮"

- Phase 4 弹幕场景要求语义理解能力，关键词匹配无法覆盖措辞多样性
- 关键词方案是管理问题的解法，不是 RAG 问题的解法
- 从关键词到向量是"推倒重来"，从简单向量到 hybrid/rerank 是"渐进增强"

## 本轮边界

**做**：embedding + 本地 Orama 向量索引 + hybrid 检索 + prompt 注入 + 知识管理 UI + 搜索验证 + 来源引用基础

**不做**：rerank、完整 hybrid 调参、ChatPanel 内联引用、PDF/Word/网页 loader、per-character 知识、query rewrite、本地 embedding 模型

## 任务拆分（9 个 Task）

T1: 知识数据模型与类型 → T2: Embedding Service → T3: Chunk 切分器 → T4: Orama 集成层 → T5: KnowledgeService 重构 → T6: LLM 链路升级 → T7: 知识管理 UI → T8: KnowledgeConfig 配置项 → T9: 验证+报告+Git

## 预计改动的核心文件

新增 6 个文件，修改 9 个文件，详见计划文档 §13。

## 验收标准

9 项，包含：JSON 导入闭环、持久化闭环、语义检索验证、LLM 注入验证、来源引用、liveContext 兼容、现有链路不破坏、embedding 模型变更检测、编译通过。详见计划文档 §14。

## 待确认项

1. Embedding API key 复用策略（建议复用 active LLM profile key）
2. 维度选择（建议第一轮用 1536 默认值）
3. ControlPanel 临时注入保留方式（建议独立于 Orama）
4. Orama 版本锁定（建议 `^3.1.0`）
