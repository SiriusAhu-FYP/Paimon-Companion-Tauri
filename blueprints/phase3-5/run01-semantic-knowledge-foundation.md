# Phase 3.5 Run 01 — Semantic Knowledge Base Foundation

---

## 1. 为什么叫 Semantic Knowledge Base Foundation

上一版计划（`run01-knowledge-foundation-plan.md`）将本轮降格为"JSON 导入 + Tauri Store + 关键词检索"——本质上是做了一个知识管理 MVP，而非知识库基础设施。

Phase 3.5 之所以被插入路线图，是因为 **Phase 4 Live Integration 需要的不是关键词匹配，而是语义理解能力**。弹幕问"有没有好看的手办"时，LLM 需要检索到"原神 Q 版摆件套装"——这是关键词匹配无法做到的。

**本轮的正确定位**：建立第一轮真正可测试的语义知识库闭环——embedding + 本地向量持久化 + semantic retrieval + prompt 注入。这个闭环是后续一切 RAG 能力（hybrid search、rerank、多来源 loader）的地基。

---

## 2. 为什么上一版"纯关键词 + Tauri Store"不够

| 维度 | 关键词方案 | 语义方案 |
|------|-----------|---------|
| "好看的手办" → "原神 Q 版摆件" | 匹配失败 | 语义近似可召回 |
| "派蒙是谁" → 角色设定段落 | 需手动打 keywords 标签 | 自动理解语义 |
| 知识库扩展到 100+ 条 | keywords 维护成本激增 | 只需 re-embed |
| Phase 4 弹幕检索 | 弹幕措辞多样，关键词覆盖率低 | 语义匹配天然适应 |
| 后续升级路径 | 从关键词跳到向量 = 重建 | 从简单向量到 hybrid / rerank = 增强 |

上一版方案解决的是"能不能把知识存下来"，本轮要解决的是"能不能语义找到相关知识"。前者是管理问题，后者才是 RAG 问题。

---

## 3. 技术选型

### 3.1 路线分析

#### 路线 A：LlamaIndex.TS + LanceDB

- **LlamaIndex.TS**：全功能 RAG 框架，支持 `VectorStoreIndex`、`SimpleVectorStore`、多种 loader
- **LanceDB**：嵌入式向量数据库，零服务器，数据存本地文件
- **问题**：
  - LanceDB 的 npm 包 `@lancedb/lancedb` 是 **native Node.js 二进制**，不能在 Tauri webview 中直接运行
  - 在 Tauri 中使用 LanceDB 需要 Node.js sidecar（打包 + IPC），引入大量部署复杂度
  - LlamaIndex.TS 的 `SimpleVectorStore` 本身也依赖 Node.js 文件系统 API
  - LlamaIndex.TS 体积庞大（整个框架），引入大量本项目不需要的 loader/agent/workflow 概念
- **结论**：**本轮不推荐**。引入成本远高于收益，且核心能力（向量搜索）有更轻量的替代方案

#### 路线 B：Cherry Studio 风格（LibSQL + 重型 loader 管线）

- Cherry Studio 使用 LibSQL（Turso）作为向量库，支持 PDF/Word/Excel/网页/Sitemap 全格式导入
- **问题**：
  - LibSQL 在 Tauri webview 中同样需要 native binding 或 sidecar
  - 全格式 loader 管线是"知识管理系统"而非本轮目标
- **结论**：**不适合本轮**。过重，且 native 依赖问题与路线 A 相同

#### 路线 C（推荐）：Orama + OpenAI Embeddings + Tauri Store 持久化

- **Orama**（`@orama/orama`）：
  - 纯 TypeScript，**零原生依赖**，<2kb 包体
  - **可直接在浏览器 / Tauri webview 中运行**，无需 sidecar
  - 内置 full-text search + vector search + hybrid search
  - schema 声明 `vector[N]` 字段即可进行向量搜索
  - 支持 BYO（Bring Your Own）embedding：插入时提供预计算的 embedding 向量
  - 支持 metadata filtering
  - 支持通过 `save()` / `load()` 进行 JSON 序列化/反序列化（纯 JS，不需要 persistence plugin 的 Node.js stream）
  - npm 周下载 49.5 万，10k+ stars，活跃维护
- **OpenAI Embeddings**（`text-embedding-3-small`）：
  - 1536 维度（可降至 256），$0.02/1M tokens
  - 项目已有 OpenAI 兼容 LLM provider + `proxyRequest` 安全代理
  - 复用现有密钥管理（`SECRET_KEYS.LLM_API_KEY`）与 Rust 代理链路
- **持久化**：
  - 使用 Tauri Store / localStorage 保存 Orama 数据库的 JSON dump
  - 独立 key（`"knowledge-db"`），与 AppConfig 分离
  - 同时保存 metadata（embedding model、dimension、schema version）用于兼容性校验

### 3.2 为什么推荐路线 C

| 评估维度 | 路线 A (LlamaIndex+LanceDB) | 路线 C (Orama+OpenAI) |
|----------|---------------------------|----------------------|
| Tauri webview 兼容 | 需要 sidecar | 原生兼容 |
| 安装复杂度 | native binary + pkg | `npm i @orama/orama` |
| 包体大小 | 数十 MB | <2kb |
| 向量搜索 | 支持 | 支持 |
| 全文搜索 | 需额外配置 | 内置 |
| 混合搜索 | 需额外配置 | 内置 |
| 持久化 | 文件系统（需 Node.js） | JSON 序列化（纯 JS） |
| 与现有代码集成 | 大量改动 + IPC 层 | 直接 import 使用 |
| 后续升级路径 | 已在终态 | 可升级到 LanceDB（sidecar）或 Orama Cloud |

---

## 4. Embedding 方案

### 4.1 第一轮方案：OpenAI text-embedding-3-small（云 API）

**为什么是云 API 而非本地模型**：
- 本项目已有完整的云 API 代理链路（Rust `proxy_http_request`），复用成本极低
- 本地 embedding 模型（如 ONNX Runtime + MiniLM）需要下载数百 MB 模型文件 + WASM/native binding
- 第一轮目标是验证语义检索闭环，不是解决离线部署问题
- `text-embedding-3-small` 成本极低（$0.02/1M tokens），100 条知识的 embedding 成本可忽略

### 4.2 配置位置

在 `AppConfig` 中新增 `knowledge` 配置节：

```typescript
export interface KnowledgeConfig {
	embeddingModel: string;         // "text-embedding-3-small"
	embeddingDimension: number;     // 1536（或 256 降维）
	retrievalTopK: number;          // 默认 5
	searchMode: "vector" | "hybrid" | "fulltext"; // 默认 "hybrid"
}
```

embedding API 调用通过现有 `proxyRequest` + `SECRET_KEYS.LLM_API_KEY` 走 Rust 代理。

### 4.3 模型更换时的兼容性

Orama 数据库 JSON dump 中保存 metadata：

```typescript
interface KnowledgeDBMetadata {
	schemaVersion: number;          // 1
	embeddingModel: string;         // "text-embedding-3-small"
	embeddingDimension: number;     // 1536
	chunkStrategy: string;          // "fixed-512"
	createdAt: number;
	entryCount: number;
}
```

当检测到 `embeddingModel` 或 `embeddingDimension` 与当前配置不一致时，触发全量 re-embed + re-index（需要用户确认）。

---

## 5. 知识数据模型

### 5.1 导入层文档结构

```typescript
export type KnowledgeCategory = "faq" | "product" | "text";

/** 用户导入时的文档粒度 */
export interface KnowledgeDocument {
	id: string;
	category: KnowledgeCategory;
	title: string;
	content: string;
	tags?: string[];
	source?: string;              // 来源标注（文件名 / 手动 / API）
}
```

三类知识源的映射：
- **FAQ**：`title` = 问题，`content` = 回答
- **商品资料**：`title` = 商品名，`content` = 描述/卖点/价格等
- **普通文本**：`title` = 文档标题，`content` = 全文

### 5.2 Chunk 后的索引结构（Orama schema）

```typescript
export interface KnowledgeChunk {
	docId: string;                // 所属文档 ID
	chunkIndex: number;           // 该文档中的第几个 chunk
	text: string;                 // chunk 文本
	category: KnowledgeCategory;
	title: string;                // 所属文档标题（用于来源引用）
	source: string;               // 来源标注
	embedding: number[];          // vector[1536]
}
```

Orama schema：

```typescript
const KNOWLEDGE_SCHEMA = {
	docId: "string",
	chunkIndex: "number",
	text: "string",
	category: "string",
	title: "string",
	source: "string",
	embedding: "vector[1536]",
} as const;
```

### 5.3 检索结果

```typescript
export interface RetrievalResult {
	chunkText: string;
	docId: string;
	title: string;
	category: KnowledgeCategory;
	source: string;
	score: number;
}
```

---

## 6. 导入与切块

### 6.1 第一轮支持的输入格式

- **JSON 文件**：包含 `KnowledgeDocument[]` 数组
- **手动添加**：UI 表单输入单条文档

第一轮不支持：PDF、Word、网页抓取、YAML（可后续扩展）。

### 6.2 导入流程

```
JSON 文件 / 手动输入
       ↓
  解析为 KnowledgeDocument[]
       ↓
  对每个 document 执行 chunk 切分
       ↓
  对每个 chunk 调用 embedding API
       ↓
  插入 Orama 数据库（text + embedding + metadata）
       ↓
  序列化 Orama DB → JSON → Tauri Store / localStorage
```

### 6.3 Chunk 策略

第一轮使用 **固定长度切块**：
- 目标 chunk 大小：**512 字符**（约 256 tokens for CJK，~400 tokens for English）
- 重叠：**50 字符**
- 在句号/换行处优先切分，避免切断句子
- 短文档（<512 字符）不切，整体作为一个 chunk

为什么这个策略适合当前项目：
- FAQ 回答和商品描述通常在 100-500 字符范围，大部分不需要切分
- 普通文本可能较长，需要切分但不需要复杂的语义感知分段
- 512 字符在 `text-embedding-3-small` 的 8191 token 上限内有充裕余量

---

## 7. 索引与持久化

### 7.1 生命周期

```
应用启动
  ↓
从 Tauri Store / localStorage 加载 JSON dump
  ↓
校验 metadata（embeddingModel / dimension / schemaVersion）
  ├── 一致 → load(db, rawData) 恢复 Orama 实例
  └── 不一致 → 提示用户，可选择重建索引
  ↓
运行时：用户导入 / 删除文档
  ↓
增量更新 Orama DB
  ↓
触发持久化（save → JSON → store）
```

### 7.2 持久化位置

- **Tauri 环境**：Tauri Store `app-config.json`，key = `"knowledge-db"`
- **浏览器开发**：`localStorage`，key = `"paimon-live:knowledge-db"`
- **metadata** 与数据库 dump 一起保存
- 与 AppConfig 完全独立（不在 `AppConfig` 接口中加 knowledge entries）

### 7.3 知识更新 / 删除

- 删除文档：从 Orama 中移除该 docId 的所有 chunks → 触发持久化
- 更新文档：先删旧 chunks → 重新 chunk + embed + 插入 → 触发持久化
- 全量重建：清空 Orama → 对所有原始文档重新 chunk + embed + 插入

### 7.4 必须保存的元数据

| 元数据 | 用途 |
|--------|------|
| `schemaVersion` | 数据结构版本，用于未来迁移 |
| `embeddingModel` | 当前使用的 embedding 模型名 |
| `embeddingDimension` | 向量维度 |
| `chunkStrategy` | 切块策略标识 |
| `entryCount` | 文档总数（用于快速展示） |
| `chunkCount` | chunk 总数 |
| `lastUpdated` | 最后更新时间 |

---

## 8. 检索

### 8.1 Semantic Retrieval

```typescript
async query(queryText: string, options?: KnowledgeQueryOptions): Promise<RetrievalResult[]>
```

流程：
1. 将 `queryText` 调用 embedding API → 获得查询向量
2. 调用 Orama `search(db, { mode: "hybrid", vector: { value: queryVector, property: "embedding" }, term: queryText })`
3. Orama 内部同时做 BM25 全文匹配 + 余弦相似度向量匹配，归并结果
4. 取 topK 结果，映射为 `RetrievalResult[]`

### 8.2 hybrid 还是 vector-only

第一轮**默认使用 Orama 的 hybrid 模式**：
- 短查询（如"派蒙"）从全文匹配获益更大
- 长查询（如"有没有适合送女朋友的周边"）从向量匹配获益更大
- Orama 的 hybrid 模式自动平衡两者，无需手动配权重
- 这等于**内置了最小 hybrid search**，不需要额外实现

### 8.3 Rerank

第一轮不实现 rerank。但 `RetrievalResult` 中的 `score` 字段已预留排序能力，后续可在 `query()` 内部插入 rerank 步骤。

---

## 9. 接入当前 LLM 链路

### 9.1 当前链路

```
LLMService.sendMessage(userText)
  → knowledge.getAssembledContext()    // 全量拼接
  → buildSystemMessage({ knowledgeContext })
  → provider.chat(messages)
```

### 9.2 升级后链路

```
LLMService.sendMessage(userText)
  → knowledge.query(userText, { topK: 5 })     // 语义检索
  → knowledge.getAssembledLiveContext()          // 临时运营上下文（仍全量）
  → formatRetrievalForPrompt(results, liveCtx)  // 格式化
  → buildSystemMessage({ knowledgeContext })     // 接口不变
  → provider.chat(messages)
```

### 9.3 改动点

- **`LLMService.sendMessage()`**：将 `getAssembledContext()` 调用替换为 `query(userText)` + `getAssembledLiveContext()` + 格式化
- **`KnowledgeService`**：新增 `query()`，新增 `getAssembledLiveContext()`（仅返回 liveContext 部分）
- **`PromptBuilder`**：`knowledgeContext` 参数语义不变（仍为 string），`MAX_KNOWLEDGE_CHARS` 调整为 `4000`（精选结果不需要 12000 的全量预算）
- **新增 `knowledge-formatter.ts`**：将 `RetrievalResult[]` 格式化为带来源标注的结构化文本

格式化输出示例：

```
【参考知识 1】[来源: products.json / 原神 Q 版摆件]
高品质 PVC 材质，Q 版设计，包含派蒙、荧、空三个角色，限时8折...

【参考知识 2】[来源: faq.json / 派蒙是谁？]
派蒙是旅行者在提瓦特大陆的旅行伙伴，被旅行者从水中救出...
```

### 9.4 liveContext 与长期知识的共存

- `liveContext`（ControlPanel 临时注入 + 事件驱动注入）：全量拼接，排在前面，优先级最高
- `query()` 检索结果：精选 topK，排在 liveContext 之后
- PromptBuilder 截断时先保证 liveContext 完整，再截断检索结果

---

## 10. Embedding Service 设计

新建 `src/services/knowledge/embedding-service.ts`：

```typescript
export interface IEmbeddingService {
	embed(text: string): Promise<number[]>;
	embedBatch(texts: string[]): Promise<number[][]>;
	getDimension(): number;
	getModelName(): string;
}
```

第一轮实现 `OpenAIEmbeddingService`：
- 调用 OpenAI `/v1/embeddings` API
- 通过现有 `proxyRequest` 走 Rust 代理（密钥不暴露到前端）
- 支持批量 embedding（单次 API 调用可传多条文本）
- 配置从 `AppConfig.knowledge` 读取

接口化设计让后续替换为本地模型只需新建 `LocalEmbeddingService implements IEmbeddingService`。

---

## 11. UI / 验证入口

### 11.1 知识管理入口位置

在 **SettingsPanel** 中新增「知识库」section（位于角色设置之后、操作按钮之前）。

内容：
- **状态栏**：文档数 / chunk 数 / embedding 模型 / 最后更新时间
- **JSON 导入按钮**：选择文件 → 解析 → 显示预览（条数 + 分类统计）→ 确认导入 → 进度反馈
- **手动添加**：表单（category 下拉 + title + content）→ 添加
- **文档列表**：title + category + source + chunk 数，支持删除单条
- **搜索验证框**：输入文本 → 调用 `query()` → 显示检索结果（title + score + 匹配 chunk 片段 + 来源标注）

### 11.2 搜索验证框

这是本轮最关键的验证工具。它直接暴露检索过程，让用户/开发者可以：
- 确认 embedding 是否工作
- 确认语义近似是否能召回
- 确认 score 排序是否合理
- 确认来源标注是否正确

### 11.3 来源引用

第一轮在搜索验证框中展示完整引用。ChatPanel 暂不做内联引用 UI（留到后续 run）。

日志中会输出每次 LLM 请求使用了哪些检索结果（docId + title + score）。

---

## 12. 执行顺序

```
T1: 知识数据模型与类型（knowledge.ts + index.ts 导出）
T2: Embedding Service（IEmbeddingService + OpenAI 实现）
T3: Chunk 切分器（text-chunker.ts）
T4: Orama 集成层（orama-store.ts：create/insert/search/save/load）
T5: KnowledgeService 重构（query/import/remove/persist，接入 Orama + Embedding）
T6: 知识格式化 + LLM 链路升级（formatter + LLMService.sendMessage 改造）
T7: SettingsPanel 知识管理 UI（导入 / 列表 / 搜索验证 / 手动添加）
T8: KnowledgeConfig 配置项 + 默认值
T9: 验证 + 报告 + Git 提交
```

---

## 13. 文件改动清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/types/knowledge.ts` | 共享知识类型：KnowledgeDocument, KnowledgeChunk, RetrievalResult, KnowledgeConfig |
| `src/services/knowledge/embedding-service.ts` | IEmbeddingService 接口 + OpenAI 实现 |
| `src/services/knowledge/text-chunker.ts` | 文本切块器 |
| `src/services/knowledge/orama-store.ts` | Orama 封装层（create/insert/search/save/load） |
| `src/services/knowledge/knowledge-formatter.ts` | 检索结果格式化为 prompt 文本 |
| `public/sample-knowledge.json` | 测试用导入样例 |

### 必改文件

| 文件 | 改动 |
|------|------|
| `src/types/index.ts` | 导出知识类型 |
| `src/services/knowledge/knowledge-service.ts` | 大幅重构：接入 Orama + Embedding + query/import/remove |
| `src/services/knowledge/index.ts` | 新增导出 |
| `src/services/llm/llm-service.ts` | sendMessage() 改用 query() + 格式化 |
| `src/services/llm/prompt-builder.ts` | 调整截断阈值 |
| `src/services/config/types.ts` | 新增 KnowledgeConfig + AppConfig.knowledge |
| `src/services/config/config-service.ts` | deepMerge 增加 knowledge 节 |
| `src/services/index.ts` | initServices() 中初始化 embedding + 加载持久化知识 |
| `src/features/settings/SettingsPanel.tsx` | 新增知识库管理 section |

### 不改文件

Pipeline / CharacterService / Stage / Live2D / TTS / OBS / ControlPanel（临时注入保留原样）

---

## 14. 验收标准

| # | 验收项 | 验证方式 |
|---|--------|----------|
| 1 | JSON 导入 → chunk → embed → 索引完成 | SettingsPanel 导入后显示文档数/chunk 数 |
| 2 | 持久化闭环 | 刷新/重启后知识仍在 |
| 3 | 语义检索 | 搜索验证框输入"好看的手办"能召回"原神 Q 版摆件" |
| 4 | LLM 注入闭环 | 发送消息后日志显示 system prompt 包含检索到的知识片段 |
| 5 | 来源引用 | 搜索验证框显示每条结果的来源标注 |
| 6 | liveContext 兼容 | ControlPanel 临时注入仍正常、优先于长期知识 |
| 7 | 现有链路不破坏 | TTS / Stage / OBS / 角色切换 / Mock LLM 正常 |
| 8 | Embedding 模型变更检测 | 修改 config 中 embeddingModel 后，提示需要重建索引 |
| 9 | 编译通过 | TypeScript + Vite build 无错误 |

---

## 15. 风险与回滚

| 风险 | 等级 | 缓解策略 |
|------|------|----------|
| Orama 序列化 JSON 过大导致 Tauri Store 写入慢 | 中 | 第一轮限制 200 条文档上限；后续可迁移到文件或 SQLite |
| OpenAI Embedding API 不可用 / 配额耗尽 | 中 | 导入时 embed 失败则提示，不 crash；已导入的知识仍可全文检索 |
| Orama `load()` 从 JSON 恢复后搜索结果与导入时不一致 | 低 | 使用 Orama 官方推荐的 `save()`/`load()` 路径；验收时重点测试 |
| embedding dimension 变更导致旧数据不可用 | 低 | metadata 校验 + 用户确认重建 |
| SettingsPanel 过于臃肿 | 低 | 知识管理 section 默认折叠；后续可独立为子页面 |
| **回滚** | — | 每个 T 单独 commit，任何步骤导致主链路崩溃可 revert |

---

## 16. 明确留到后续 Run

| 内容 | 为什么先不做 |
|------|-------------|
| Rerank | 第一轮 Orama hybrid 已提供基础排序，rerank 是优化而非基础 |
| 完整 hybrid search 调参 | Orama 内置默认策略足够，调参需要先积累检索质量数据 |
| ChatPanel 内联引用 UI | 需要设计 UX 交互，第一轮通过搜索验证框 + 日志验证 |
| 复杂 loader（PDF/Word/网页） | 增加大量依赖，当前 JSON + 手动足够验证闭环 |
| Per-character 知识关联 | 全局知识库是正确的第一步，per-character 是后续优化 |
| 自动 query rewrite | 依赖 LLM 能力，增加延迟和成本，先验证直接查询效果 |
| 本地 embedding 模型 | 需要 WASM/ONNX 运行时，增加包体和复杂度，云 API 对第一轮够用 |
| Phase 4 直播接入 | Phase 4 定义不变 |
| Stage / Live2D / TTS / OBS | 不碰 |

---

## 17. 待确认项

1. **Embedding API 复用**：当前 `SECRET_KEYS.LLM_API_KEY` 是 per-profile 的（`(profileId) => "llm-api-key:${profileId}"`）。Embedding 调用是否复用 active LLM profile 的 key，还是需要单独的 embedding API key？（建议：复用 active profile 的 key，因为 OpenAI 的 chat 和 embedding 共用同一个 API key）
2. **Embedding dimension**：`text-embedding-3-small` 默认 1536 维。是否使用降维到 256 或 512 来减小存储体积？（建议：第一轮用 1536 默认值，降维是优化而非必需）
3. **ControlPanel 临时注入保留方式**：当前 ControlPanel 的「上下文注入」区仍通过 `addKnowledge()` / `addLiveContext()` 工作。升级后 `addKnowledge()` 是否改为走 Orama 索引（含 embed），还是保留为临时纯文本注入？（建议：`liveContext` 保持纯内存临时注入不走 Orama，`addKnowledge()` 也保持临时注入语义，知识库走独立的 `importDocuments()` 路径）
4. **Orama 版本锁定**：当前最新 `@orama/orama@3.1.18`。是否在 package.json 中锁定到 `^3.1.0` 以避免 breaking change？（建议：是）
