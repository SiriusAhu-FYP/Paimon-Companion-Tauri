# Phase 3.5 Round 2 — 检索策略观察报告

## 一、当前检索链路真实结构

### 数据流

```
用户输入 (userText)
    ↓
LLMService.sendMessage()            ← src/services/llm/llm-service.ts:53
    ↓ Promise.race([knowledge.query(), 10s超时])
knowledge.query(userText)           ← src/services/knowledge/knowledge-service.ts:245
    ↓
embeddingService.embed(userText)    ← OpenAIEmbeddingService.embed()
    ↓
searchKnowledge(db, vector+term, mode, topK)  ← src/services/knowledge/orama-store.ts:68
    ↓ Orama vector similarity / fulltext / hybrid
RetrievalResult[] (chunkText, docId, title, score)
    ↓
formatRetrievalForPrompt()         ← src/services/knowledge/knowledge-formatter.ts:9
    + liveContext (ControlPanel注入，高优先级)
    ↓
buildSystemMessage()                ← src/services/llm/prompt-builder.ts:23
    ↓ 4000字符截断（字符级，非token级）
system prompt — 【当前商品与直播上下文】
    ↓
LLM chat(messages)
```

### 各环节位置

| 环节 | 文件 | 备注 |
|------|------|------|
| query 入口 | `llm-service.ts:72` | 10s 超时保护，独立于 LLM 流 |
| embedding | `embedding-service.ts:37` | `OpenAIEmbeddingService.embed()` |
| 向量检索 | `orama-store.ts:68` | `searchKnowledge()`，支持 vector/hybrid/fulltext |
| 无结果退退 | `orama-store.ts:102-109` | vector/hybrid 返回 0 时自动触发的 fulltext fallback |
| 结果格式化 | `knowledge-formatter.ts:9` | `formatRetrievalForPrompt()`，liveContext 优先 |
| prompt 截断 | `prompt-builder.ts:11` | `MAX_KNOWLEDGE_CHARS = 4000`，字符级截断 |
| title 语义 | `knowledge-service.ts:400` | `buildEmbeddingInput(title, chunkText)`，title 参与 embedding |

---

## 二、当前类型系统与实现层的 drift（重要）

审查代码发现多处不一致，报告于此供决策参考：

### 2.1 `EmbeddingProviderConfig` vs `EmbeddingProfile`

- `src/types/knowledge.ts`：定义了 `EmbeddingProfile`（含 id/name/url/model/dimension）和 `EmbeddingProviderConfig`（url/model/dimension），`KnowledgeConfig` 包含 `embeddingProfiles[]` + `activeEmbeddingProfileId`
- `src/services/knowledge/embedding-service.ts`：已完全移除 `apiKeySource` 逻辑，改为构造函数接收 `(config, profileId)`，用 `SECRET_KEYS.EMBEDDING_API_KEY(profileId)` 解析 key
- `src/services/config/types.ts`：仍引用旧的 `apiKeySource` 类型输出，但 `DEFAULT_CONFIG` 中无 `embeddingProfiles` 字段

**结论**：类型系统定义了 `EmbeddingProfile` 多 profile 机制，但 `initServices` 中 `OpenAIEmbeddingService` 初始化时传入 `profileId = null`。实际用的是"单 embedding 配置"模式，与类型定义不符。

### 2.2 `CURRENT_SCHEMA_VERSION` drift

- `src/types/knowledge.ts`：`CURRENT_SCHEMA_VERSION = 3`
- `src/services/knowledge/knowledge-persistence.ts`（loadDocuments/loadIndex）：使用 `DOCS_KEY = "knowledge-documents"` 和 `INDEX_KEY = "knowledge-index"` 作为 Tauri Store 的 key，schema version 检查在 `knowledge-service.ts:checkCompatibility()`

### 2.3 `searchMode` 默认值不一致

- `DEFAULT_CONFIG`（config/types.ts）：`searchMode: "vector"`
- `DEFAULT_KNOWLEDGE_CONFIG`（types/knowledge.ts）：`searchMode: "hybrid"`
- `knowledge-service.ts:252`：`topK` / `mode` 从 `getConfig().knowledge` 读取，会取到 `"vector"` 但代码逻辑中 `mode !== "fulltext"` 时走 embedding 路径

---

## 三、Rerank 插入点分析

### 3.1 自然插入位置

当前链路最自然的插入点在 `knowledge-service.ts:245` 的 `query()` 方法内部，在 Orama 召回之后、formatter 之前：

```
knowledge.query(userText)
    → embeddingService.embed()          [已有]
    → searchKnowledge()                 [已有，召回 topK=5~20]
    → [NEW] rerankService.rerank()    ← 插入点
    → return RetrievalResult[]
    → formatRetrievalForPrompt()        [已有]
```

具体实现位置：`src/services/knowledge/knowledge-service.ts` 的 `query()` 方法（约 line 245-274），在 `const results = await searchKnowledge(...)` 之后加入 rerank 步骤。

### 3.2 候选数量建议

| 场景 | 召回候选 | 说明 |
|------|---------|------|
| 当前 topK=5 | 实际召回 5 | rerank 无意义，需先扩大召回 |
| 建议最小 rerank 候选 | **topK=20** | 足够 rerank 模型区分，不浪费 |
| 建议最大 rerank 候选 | **topK=50** | 超过后 rerank 成本上升，收益递减 |

**推荐起点**：召回 **topK=20**，rerank 后取 **topK=5** 送 formatter。

### 3.3 改动范围

| 文件 | 改动 | 理由 |
|------|------|------|
| `src/types/knowledge.ts` | 新增 `RerankResult` 类型 | 与 `RetrievalResult` 区分 |
| `src/services/knowledge/rerank-service.ts`（新建） | `IRerankService` 接口 + `OpenAIRerankService` 实现 | DMXAPI jina-reranker / bge-reranker-v2-m3-free |
| `src/services/knowledge/knowledge-service.ts` | `query()` 加入 rerank 步骤 | 核心逻辑 |
| `src/services/config/types.ts` | 新增 `rerankProfiles[]` + `activeRerankProfileId` 到 `KnowledgeConfig` | 配置扩展 |
| `src/services/index.ts` | 初始化 rerank service，注入到 knowledge | init 链 |
| `src/features/settings/SettingsPanel.tsx` | 新增 Rerank 配置 UI | 管理界面 |
| `prompt-builder.ts` | 不改 | rerank 在此之前 |
| `knowledge-formatter.ts` | 不改 | 结果格式不变 |
| `llm-service.ts` | 不改 | 调用点不变 |
| `orama-store.ts` | 不改 | 召回层不变 |

**不动**：Stage / Live2D / TTS / OBS / Pipeline / CharacterService / EventBus 定义。

---

## 四、长上下文直读 / 大上下文保守模式

### 4.1 形态分析

三种形态对比如下：

| 形态 | 描述 | 适用场景 | 对链路影响 |
|------|------|---------|-----------|
| **A. 默认主链路** | 所有 query 均走召回+rerank → 短 prompt | 小知识库 / 高频实时 | 无结构变化 |
| **B. Admin/Debug 模式** | 开关切换，整包文档送 LLM（无召回） | 调试 / 知识库<20条时 | formatter 行为变 |
| **C. 二段式 Reader** | 少量召回（topK=3~5）→ 整包 chunk 原文再送 LLM 精读 | 大文档 / 多 chunk 需综合理解 | 新增一次 LLM 调用 |

**本项目实际情况**：
- `MAX_KNOWLEDGE_CHARS = 4000`（字符级，约 1500-2000 tokens），已做截断
- 知识库上限 200 文档，每文档 512 字符切块，chunks 数量可能很多
- 当前 512 固定切块，中文语义边界切分质量有限

### 4.2 推荐形态

**形态 C（二段式 Reader）最适合本项目**，理由：
1. 派蒙用于直播场景，商品信息需要准确性优先
2. 固定 512 切块容易切断句子，导致召回 chunk 语义不完整
3. 二段式可以让 LLM 自己判断哪些 chunks 与问题最相关，减少切块噪声
4. 形态 B（整包送）对于 200 文档知识库成本过高，形态 A 则丢失了跨 chunk 综合理解能力

### 4.3 二段式 Reader 插入点

在 `knowledge-service.ts:query()` 之后、新增一个 `queryWithReader()` 方法，或在 `llm-service.ts` 中增加一个可选路径：

```
query (召回 topK=3~5 的相关 chunks)
    ↓
[NEW] readerLLM.ask(userText, retrievedChunks)
    → 将 userText + retrievedChunks 整包发给 LLM
    → LLM 返回精炼后的答案 + 引用的 chunk IDs
    ↓
RetrievalResult[] (精炼后) 或纯文本答案
    ↓ formatRetrievalForPrompt()
```

### 4.4 改动范围

| 文件 | 改动 |
|------|------|
| `src/services/knowledge/knowledge-service.ts` | 新增 `queryWithReader()` 方法 |
| `src/services/llm/llm-service.ts` | 新增 `sendMessageWithKnowledgeReader()` 变体，或通过选项触发 |
| `src/types/knowledge.ts` | 新增 `ReaderModeConfig` 类型 |
| `src/services/config/types.ts` | 新增 `knowledge.readerMode` 配置节 |
| `src/features/settings/SettingsPanel.tsx` | 新增长上下文模式开关 |

---

## 五、配置归属：系统策略 vs 用户配置

| 配置项 | 归属 | 理由 |
|--------|------|------|
| `embedding.baseUrl` | **用户配置** | 取决于用户用哪个服务商 |
| `embedding.model` | **用户配置** | 同上 |
| `embedding.dimension` | **系统策略 + 用户可调** | 由模型决定，但 Orama schema 绑定后可调 |
| `embeddingProfiles[]` | **用户配置** | 多服务商切换 |
| `rerank.baseUrl` | **用户配置** | 通常与 embedding 服务一致（DMXAPI） |
| `rerank.model` | **用户配置** | 如 jina-reranker-v2 |
| `rerankProfiles[]` | **用户配置** | 多 rerank 模型切换 |
| `retrievalTopK` | **系统策略** | 召回候选数，影响 rerank 成本，建议 hardcode = 20 |
| `minScoreThreshold` | **系统策略** | 低于某分数的 chunk 直接过滤 |
| `searchMode` | **用户配置** | vector/hybrid/fulltext |
| `readerMode.enabled` | **用户配置** | 是否启用二段式 reader |
| `readerMode.topK` | **系统策略** | reader 召回数，建议 hardcode = 3~5 |
| `readerMode.model` | **用户配置** | 用于精读的模型（可与主 LLM 不同） |
| `MAX_KNOWLEDGE_CHARS` | **系统策略** | 4000 字符截断，应改为 token 估算 |

**关键原则**：
- **系统策略**：通过代码 hardcode，不暴露在 UI，避免普通用户踩坑
- **用户配置**：通过 SettingsPanel UI 暴露，支持 profile 切换

---

## 六、最小实验设计

### 6.1 三种方案定义

| 方案 | 描述 | 实现要点 |
|------|------|---------|
| **Baseline** | 当前 hybrid 检索 | topK=5, 无 rerank, 4000字符截断 |
| **A: Hybrid+Rerank** | Baseline + jina-reranker-v2 | 召回 topK=20, rerank → topK=5 |
| **B: 二段式 Reader** | 召回 topK=3 → 整包 chunk 原文 → LLM 精读 → 精炼结果 | 需要额外 LLM 调用 |

### 6.2 测试 Query 样本（建议）

```
Q1: "有什么好看的手办推荐吗？"          ← 商品检索，强语义
Q2: "退货怎么退？"                      ← FAQ 精确匹配
Q3: "直播今天晚上几点开始？"            ← 直播安排，时间敏感
Q4: "派蒙喜欢吃什么？"                  ← 角色设定，非知识库内容（噪声测试）
Q5: "当前主推什么商品？价格多少？"      ← 高优先级 liveContext + 商品检索
Q6: "原神摆件有什么款式可选？"          ← 商品属性检索
Q7: "商品支持定制吗？"                  ← 政策类，跨 chunk
Q8: "怎么联系客服？"                    ← FAQ
```

### 6.3 记录指标

| 指标 | 测量方式 | 意义 |
|------|---------|------|
| **Top1 召回率** | Q1-Q8 中第一个结果是否命中相关文档 | 精确度 |
| **Recall@5** | top5 中是否包含正确答案 chunk | 召回质量 |
| **NDCG / MRR** | 整体排序质量 | 排序质量 |
| **Chunk 噪声率** | 召回结果中不相关 chunk 占比 | 精确度 |
| **Input Tokens** | 每次 LLM 调用的 prompt token 数 | 成本 |
| **LLM 延迟** | 从发请求到收到首个 token 的时间 | 体验 |
| **Embedding+Rerank 延迟** | query 到 rerank 完成的时间 | 链路开销 |
| **总 Cost/Query** | embedding + rerank + LLM 调用成本 | 运营成本 |

### 6.4 实验步骤建议

```
Week 1: Baseline 记录
  → 运行 Q1-Q8，记录上述指标到表格

Week 2: 实现 A (Hybrid+Rerank)
  → 同一批 Q1-Q8，记录指标
  → 对比 Baseline 差值

Week 3: 实现 B (二段式 Reader)
  → 同一批 Q1-Q8，记录指标
  → 对比 A 和 Baseline

周会决定：选 A 或 B 或 A+B 作为主方案
```

---

## 七、文件级改动地图

### 路线 A：Hybrid + Rerank

```
新建:
  src/services/knowledge/rerank-service.ts     IRerankService + OpenAIRerankService

修改:
  src/types/knowledge.ts                      +RerankResult, +RerankConfig
  src/services/knowledge/knowledge-service.ts  query() 内插 rerank 步骤
  src/services/config/types.ts                 +rerankProfiles[], +activeRerankProfileId
  src/services/index.ts                       初始化 rerank service
  src/features/settings/SettingsPanel.tsx     Rerank 配置 UI

不动:
  prompt-builder.ts / knowledge-formatter.ts / orama-store.ts
  llm-service.ts / embedding-service.ts
```

### 路线 B：二段式 Reader

```
新建:
  src/services/knowledge/reader-service.ts     IReaderService + ReaderService

修改:
  src/types/knowledge.ts                      +ReaderConfig, +ReaderModeConfig
  src/services/knowledge/knowledge-service.ts  +queryWithReader()
  src/services/llm/llm-service.ts              +sendMessageWithKnowledgeReader()
  src/services/config/types.ts                 +knowledge.readerMode
  src/features/settings/SettingsPanel.tsx     长上下文模式开关 UI

共享改动（两条路线都涉及）:
  src/services/config/types.ts                 配置扩展
  src/features/settings/SettingsPanel.tsx     UI
```

### 路线 A+B：同时实现

```
改动为 A + B 的合集
新增 readerMode 与 rerank 的正交组合
  - "rerank优先"：hybrid+rerank → formatter → prompt（当前 Baseline 升级）
  - "reader优先"：召回少量 → reader LLM 精读 → formatter
  - 用户通过配置选择模式
```

---

## 八、最终判断

### 现阶段优先做什么

**优先做 Rerank（路线 A），理由如下：**

1. **成本最低，效果可预期**：jina-reranker-v2 在 DMXAPI 有明确支持，调用成本低。Rerank 在知识库小规模时（<50 文档）提升明显，在本项目 200 文档上限内效果稳定。

2. **链路侵入最小**：只需在 `knowledge-service.ts:query()` 中插入 rerank 步骤，不新增 LLM 调用，不改变 `llm-service.ts` 主流程，不影响现有流式输出体验。

3. **当前链路的主要瓶颈是排序质量**：从实际检索场景看，召回的 top5 中常有语义相关但不是最优的结果，rerank 直接解决这一问题。而二段式 Reader 引入了额外的 LLM 调用和延迟，在直播场景中需要慎重评估。

4. **类型系统已有 EmbeddingProfile**：`src/types/knowledge.ts` 中已定义 `rerankProfiles[]` 和 `activeRerankProfileId` 的扩展槽位，配置层设计支持良好，实施成本低。

5. **二段式 Reader 适合后续优化**：在 Rerank 链路稳定后，如果发现某些跨 chunk 的复杂问题（如"退货政策的例外情况有哪些"）仍回答不好，再启用 Reader 模式作为补充。

### 实施顺序建议

```
Phase 3.5 Run 03: Rerank 路线
  - 新建 rerank-service.ts
  - 改动 knowledge-service.ts query()
  - 扩展 config types + SettingsPanel UI
  - 验证 Q1-Q8 指标对比

Phase 3.5 Run 04（或 Run 05）: 二段式 Reader
  - 仅在 Rerank 验证后启动
  - 评估对直播实时性的影响
  - 决策：作为 debug 模式还是默认模式
```

### 额外发现：需优先修复的类型 drift

在审查代码时发现 `EmbeddingProviderConfig` 中的 `apiKeySource` 已被移除（embedding-service.ts），但 `config/types.ts` 中 `SECRET_KEYS` 仍引用旧逻辑，`SettingsPanel` UI 可能与实际行为不一致。建议在 Run 03 之前先审计并对齐这部分类型 drift。
