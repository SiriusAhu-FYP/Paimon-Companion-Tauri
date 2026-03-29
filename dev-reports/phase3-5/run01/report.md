# Phase 3.5 Run 01 — 正式实施报告

## 本轮目标

按一级蓝图 `blueprints/phase3-5/run01-semantic-knowledge-foundation.md` 实施 **Semantic Knowledge Base Foundation**——建立第一轮可测试的语义知识库闭环：

1. 文本切块 + OpenAI Embedding 向量化
2. Orama 内存向量数据库（纯 TS，浏览器 / Tauri webview 原生运行）
3. 原始文档与索引快照的双层持久化
4. 语义检索 → 格式化 → LLM system prompt 注入
5. SettingsPanel 知识管理 UI + 搜索验证框
6. ControlPanel liveContext 临时注入保持原样

---

## 本轮实际完成内容

全部 11 个实施任务（T1–T11）的代码编写已完成，覆盖蓝图 §12 列出的完整执行顺序。

| 任务 | 内容 | 状态 |
|------|------|------|
| T1 | 知识数据模型与共享类型 | 完成 |
| T2 | IEmbeddingService 接口 + OpenAI 实现 | 完成 |
| T3 | 固定长度文本切块器（512 字符 + 50 重叠） | 完成 |
| T4 | Orama 向量数据库封装层 | 完成 |
| T5 | 知识持久化封装（Tauri Store / localStorage） | 完成 |
| T6 | KnowledgeService 重构（import / query / remove / rebuild / persist） | 完成 |
| T7 | 检索结果格式化 + LLMService.sendMessage() 链路升级 | 完成 |
| T8 | AppConfig.knowledge 配置节 + 默认值 + deepMerge | 完成 |
| T9 | SettingsPanel KnowledgeSection UI | 完成 |
| T10 | initServices() 初始化 Embedding + 知识库异步加载 | 完成 |
| T11 | 示例知识 JSON + 编译验证 | 完成 |

---

## 关键实现点

### 向量数据库选型

采用 **Orama** (`@orama/orama@3.1.18`)——纯 TypeScript 实现，< 2 KB 包体，零原生依赖，可直接在 Tauri webview 中运行。内置 full-text / vector / hybrid 三种搜索模式，通过 `save()` / `load()` 进行 JSON 序列化。

### Embedding 链路

`OpenAIEmbeddingService` 调用 OpenAI `/v1/embeddings` 端点（默认 `text-embedding-3-small`，1536 维），通过已有 Rust `proxyRequest` 代理发送请求。API Key 来源支持两种模式：
- `apiKeySource: "llm"` — 复用当前活跃 LLM profile 的 key（默认）
- `apiKeySource: "dedicated"` — 使用独立的 embedding key（存入 `SECRET_KEYS.EMBEDDING_API_KEY`）

Embedding 配置在架构上独立于 LLM provider，不挂在 LLM profile 下。

### 知识服务核心流程

```
导入：KnowledgeDocument[] → chunkText() → embedBatch() → insertChunks(orama) → persistAll()
检索：query(text) → embed(text) → searchKnowledge(orama, vector, mode, topK) → RetrievalResult[]
注入：query() + getAssembledLiveContext() → formatRetrievalForPrompt() → buildSystemMessage()
```

Embedding 失败时自动 fallback 到 Orama fulltext 搜索，不中断主链路。

### 持久化双层设计

| 层 | 存储内容 | Tauri key | localStorage key |
|----|----------|-----------|------------------|
| 原始文档 | `KnowledgeDocument[]` 原文 | `knowledge-documents` | `paimon-live:knowledge-documents` |
| 索引快照 | Orama JSON dump + metadata | `knowledge-index` | `paimon-live:knowledge-index` |

启动时加载索引快照，校验 `schemaVersion` / `embeddingModel` / `embeddingDimension`——不兼容时阻断加载，原始文档不受影响，可触发全量重建。

### LLM 链路改造

`LLMService.sendMessage()` 中原先 `this.knowledge.getAssembledContext()`（全量拼接）替换为：

1. `this.knowledge.query(userText)` — 语义检索 topK
2. `this.knowledge.getAssembledLiveContext()` — liveContext 全量
3. `formatRetrievalForPrompt(results, liveContext)` — 合并格式化

`PromptBuilder.MAX_KNOWLEDGE_CHARS` 从 12000 调至 4000（精选结果不需要全量预算）。

### liveContext 兼容

ControlPanel 的临时注入（`addLiveContext()` / `removeLiveContext()`）保持原有纯内存行为，不走 Orama，不走 embedding。旧的 `addKnowledge()` 方法标记为 deprecated，降级为 liveContext。`external:product-message` 事件订阅保留。

---

## 改动文件清单

### 新增文件（8 个）

| 文件 | 职责 |
|------|------|
| `src/types/knowledge.ts` | 所有知识类型定义、常量、默认配置 |
| `src/services/knowledge/embedding-service.ts` | IEmbeddingService 接口 + OpenAIEmbeddingService |
| `src/services/knowledge/text-chunker.ts` | 固定长度文本切块器 |
| `src/services/knowledge/orama-store.ts` | Orama 向量数据库 CRUD + 序列化封装 |
| `src/services/knowledge/knowledge-persistence.ts` | Tauri Store / localStorage 持久化层 |
| `src/services/knowledge/knowledge-formatter.ts` | RetrievalResult → prompt 文本格式化 |
| `public/sample-knowledge.json` | 5 条示例知识（FAQ + 商品 + 文本） |
| `dev-reports/phase3-5/run01/001-semantic-knowledge-foundation.md` | 实施过程快照简报 |

### 修改文件（12 个）

| 文件 | 改动摘要 |
|------|----------|
| `package.json` | 新增 `@orama/orama@^3.1.0` |
| `pnpm-lock.yaml` | 锁文件更新 |
| `src/types/index.ts` | 导出知识类型 + 常量 |
| `src/services/knowledge/knowledge-service.ts` | 大幅重构：接入 Orama + Embedding + query / import / remove / rebuild / persist |
| `src/services/knowledge/index.ts` | 新增 OpenAIEmbeddingService / chunkText 导出 |
| `src/services/llm/llm-service.ts` | sendMessage() 改用 query() + formatRetrievalForPrompt() |
| `src/services/llm/prompt-builder.ts` | MAX_KNOWLEDGE_CHARS 12000 → 4000 |
| `src/services/config/types.ts` | AppConfig 新增 knowledge 节 + SECRET_KEYS.EMBEDDING_API_KEY |
| `src/services/config/config-service.ts` | deepMerge 支持 knowledge 节 |
| `src/services/config/index.ts` | 导出 KnowledgeConfig / EmbeddingProviderConfig 类型 |
| `src/services/index.ts` | initServices() 初始化 embedding service + 异步知识库加载 |
| `src/features/settings/SettingsPanel.tsx` | 新增 KnowledgeSection 组件（~240 行） |

### 明确未改动的模块

- `src/services/pipeline/` — Pipeline 编排不动
- `src/services/character/` — 角色卡解析不动
- `src/features/stage/` — Stage / Live2D 不动
- `src/services/tts/` — TTS 主链路不动
- `src/services/audio/` — 音频播放不动
- `src/services/external-input/` — 外部事件适配器不动
- `src/services/event-bus/` — 事件定义不动
- `src/services/runtime/` — 运行时控制不动
- `src/features/control-panel/` — ControlPanel 不动（liveContext 接口向后兼容）

---

## 验证状态

### 已通过

| 验证层 | 结果 | 说明 |
|--------|------|------|
| TypeScript 编译 | ✅ 通过 | `npx tsc --noEmit` 零错误 |
| Vite 生产构建 | ✅ 通过 | `npx vite build` 成功，bundle 正常产出 |
| Lint | ✅ 通过 | ReadLints 零错误 |

### 待手测

以下验收项对应蓝图 §14 的验收标准，**全部需要运行时手动验证**：

| # | 验收项（蓝图 §14） | 当前状态 | 需要的验证操作 |
|---|---------------------|----------|----------------|
| 1 | JSON 导入 → chunk → embed → 索引完成 | 待验证 | 在 SettingsPanel 导入 `sample-knowledge.json`，观察文档数 / chunk 数 |
| 2 | 持久化闭环 | 待验证 | 导入后刷新页面，确认知识仍在 |
| 3 | 语义检索 | 待验证 | 搜索验证框输入"好看的手办"，期望召回"原神 Q 版摆件" |
| 4 | LLM 注入闭环 | 待验证 | 发送消息后查看 console 日志中 system prompt 是否包含检索片段 |
| 5 | 来源引用 | 待验证 | 搜索验证框结果是否显示来源标注 |
| 6 | liveContext 兼容 | 待验证 | ControlPanel 临时注入是否仍正常工作 |
| 7 | 现有链路不破坏 | 待验证 | TTS / Stage / OBS / 角色切换 / Mock LLM 是否正常 |
| 8 | Embedding 模型变更检测 | 待验证 | 修改 config 中 embeddingModel 后是否提示需重建索引 |
| 9 | 编译通过 | ✅ 已通过 | — |

---

## 当前已知限制

| 限制 | 说明 |
|------|------|
| 必须有可用的 Embedding API | 导入需要调用 OpenAI `/v1/embeddings`（或兼容端点），无 key 则导入失败 |
| Embedding 失败时降级为 fulltext | 检索仍可工作但失去语义能力 |
| 文档上限 200 条 | 硬限制，超出时 UI 提示；后续可迁移持久化到文件或 SQLite |
| localStorage 容量约束 | 浏览器 dev 下 localStorage 通常 5–10 MB，索引快照可能接近上限 |
| 未做 Orama load() 一致性测试 | 需手测确认持久化 → 恢复后搜索结果与导入时一致 |
| ControlPanel addKnowledge() 已 deprecated | 旧调用降级为 liveContext，不走 Orama；不影响现有功能但语义变更 |

---

## 明确留到后续 Run

| 内容 | 原因 |
|------|------|
| Rerank | 优化而非基础，先验证 Orama 原生排序效果 |
| Hybrid search 调参 | Orama 内置默认策略足够，调参需先积累质量数据 |
| ChatPanel 内联引用 UI | 需要设计 UX，第一轮通过搜索验证框 + 日志验证 |
| 复杂 loader（PDF / Word / 网页） | 大量依赖，JSON + 手动足够验证闭环 |
| Per-character 知识关联 | 全局知识库是正确的第一步 |
| 本地 embedding 模型 | 需要 WASM / ONNX，增加包体和复杂度 |
| Phase 4 直播接入 | Phase 4 定义不变 |

---

## 阶段判断

### 实现完成？

**是。** T1–T11 全部任务的代码已编写、编译通过、构建通过。蓝图 §13 列出的所有新增文件和必改文件均已覆盖。

### 验收完成？

**否。** 蓝图 §14 的 9 项验收标准中，仅第 9 项（编译通过）已确认。其余 8 项均依赖运行时手测，尚未执行。

### 本轮状态

**`implemented but not yet accepted`**

代码实现已就位，需要人工配置真实 API Key 后进行运行时手测，完成验收后方可视为 close-out。

---

## 下一步：人工验证操作

### 前置准备

1. 确保有可用的 OpenAI API Key（或兼容的 embedding 端点）
2. 在 SettingsPanel → LLM 配置中创建 / 选择一个包含有效 API Key 的档案
3. 启动应用：`pnpm dev`（浏览器端）或 `pnpm tauri dev`（桌面端）

### 建议手测步骤

1. **JSON 导入**
   - 打开 SettingsPanel → 知识库管理
   - 点击「导入 JSON」，选择 `public/sample-knowledge.json`
   - 确认状态栏显示「5 文档 / N chunks / 索引就绪」
   - 若导入失败（API Key 无效），查看 console 日志确认错误信息

2. **搜索验证**
   - 在搜索验证框输入「好看的手办」
   - 期望结果：「原神 Q 版摆件套装」被召回，score 最高
   - 确认每条结果显示来源标注

3. **持久化闭环**
   - 刷新页面（F5）
   - 重新打开 SettingsPanel → 知识库管理
   - 确认文档数 / chunk 数与导入时一致

4. **LLM 注入闭环**
   - 在 ChatPanel 输入一句与知识相关的问题（如「你们有什么手办卖？」）
   - 查看 console 日志，确认 `knowledge retrieval results` 日志中包含检索结果
   - 确认 `LLM system prompt assembled` 日志中 `knowledgeLen > 0`

5. **手动添加**
   - 在知识库管理中点击「手动添加」
   - 填入一条知识后确认文档列表更新

6. **删除文档**
   - 在文档列表中删除一条文档，确认列表更新

7. **liveContext 兼容**
   - 在 ControlPanel 中注入临时上下文
   - 确认 LLM 回复中包含注入内容

8. **现有链路回归**
   - 角色切换、Mock LLM、TTS 播放、Stage 窗口 — 确认不受影响

### 建议验收 Checklist

```
- [ ] JSON 导入后文档数 / chunk 数正确
- [ ] 搜索验证框语义检索召回正确
- [ ] 搜索结果显示来源标注
- [ ] 刷新后知识持久化不丢失
- [ ] LLM 日志中出现检索结果
- [ ] 手动添加 / 删除文档正常
- [ ] liveContext 临时注入仍正常
- [ ] 现有链路（Mock LLM / TTS / Stage / 角色切换）不破坏
- [ ] 索引重建功能可用
```

---

## Patch 历史

| Patch | Commit | 内容 |
|-------|--------|------|
| 初版 | `1061207` | T1-T11 基础实现 |
| Patch A | — | similarity 0.5→0.2, hybrid 默认, fulltext fallback, persona 冲突修复 |
| Patch B | — | title 纳入 embedding 输入, 索引生命周期 revision 门控, schema v3, 搜索按钮去图标 |

## 过程快照

| 文件 | 内容 |
|------|------|
| `000-plan-rewrite.md` | 计划重写报告 |
| `001-semantic-knowledge-foundation.md` | 首次实施过程快照 |
| `002-title-embedding-and-search-behavior.md` | Title Embedding 对照实验 |
| `003-knowledge-panel-refactor.md` | Knowledge Panel 重构 + Embedding Profile 体系 |
| `004-character-switch-and-knowledge-search-fix.md` | 角色卡切换修复 + 搜索阈值修正 |

## 元信息

- Initial Commit: `1061207`
- Branch: `feature/phase3-5-rag-foundation`
- 报告路径: `dev-reports/phase3-5/run01/report.md`
- 实施蓝图: `blueprints/phase3-5/run01-semantic-knowledge-foundation.md`
