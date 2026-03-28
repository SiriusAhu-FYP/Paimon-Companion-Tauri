# Phase 3.5 Run 01 — Semantic Knowledge Base Foundation 实施报告

## 本次目标

按一级文档 `blueprints/phase3-5/run01-semantic-knowledge-foundation.md` 实施语义知识库基础设施的完整闭环：embedding + 本地向量持久化 + semantic retrieval + prompt 注入。

## 本次完成内容

### T1: 知识数据模型与类型
- 新建 `src/types/knowledge.ts`：定义 KnowledgeDocument, KnowledgeChunk, RetrievalResult, KnowledgeConfig, KnowledgeDBMetadata 等所有共享类型与常量
- 更新 `src/types/index.ts`：导出所有知识类型

### T2: Embedding Service
- 新建 `src/services/knowledge/embedding-service.ts`：IEmbeddingService 接口 + OpenAIEmbeddingService 实现
- 通过 `proxyRequest` 走 Rust 代理调用 OpenAI `/v1/embeddings`
- 支持 `apiKeySource: "llm" | "dedicated"` 密钥来源切换

### T3: Chunk 切分器
- 新建 `src/services/knowledge/text-chunker.ts`：固定长度切块（512 字符 + 50 字符重叠）
- 在句号/换行处优先切分，短文档不切

### T4: Orama 集成层
- 新建 `src/services/knowledge/orama-store.ts`：封装 Orama create/insert/search/remove/save/load
- 支持 vector / hybrid / fulltext 三种检索模式
- 安装 `@orama/orama@^3.1.0`（纯 TS，零原生依赖）

### T5: KnowledgePersistence 持久化封装
- 新建 `src/services/knowledge/knowledge-persistence.ts`
- 原始文档存储 + 索引快照存储分离
- Tauri Store / localStorage 双后端

### T6: KnowledgeService 重构
- 重写 `src/services/knowledge/knowledge-service.ts`
- 核心能力：importDocuments → chunk → embed → Orama 索引 → 持久化
- query() 语义检索（embedding 失败时 fallback 到 fulltext）
- rebuildIndex() 全量重建
- 不兼容检测（schemaVersion / embeddingModel / dimension）
- liveContext 保留原有接口不走 Orama
- addKnowledge() 标记为 deprecated，降级为 liveContext

### T7: 知识格式化 + LLM 链路升级
- 新建 `src/services/knowledge/knowledge-formatter.ts`：RetrievalResult[] 格式化为带来源标注的 prompt 文本
- 改造 `src/services/llm/llm-service.ts` 的 sendMessage()：用 query() + liveContext 替代 getAssembledContext()
- 调整 `src/services/llm/prompt-builder.ts` MAX_KNOWLEDGE_CHARS = 4000

### T8: KnowledgeConfig 配置项
- 在 `src/services/config/types.ts` 中 AppConfig 新增 knowledge 节
- EmbeddingProviderConfig 独立于 LLM provider
- SECRET_KEYS 新增 EMBEDDING_API_KEY
- deepMerge 支持 knowledge 节

### T9: SettingsPanel 知识管理 UI
- 在 SettingsPanel 角色设置之后新增 KnowledgeSection 组件
- 功能：JSON 导入、手动添加、文档列表（含删除）、搜索验证框、索引重建
- 状态栏：文档数 / chunk 数 / 索引状态

### T10: 服务初始化链升级
- 在 `src/services/index.ts` initServices() 中初始化 OpenAIEmbeddingService + 异步初始化知识库

### T11: 示例知识文件
- 新建 `public/sample-knowledge.json`：5 条示例（FAQ + 商品 + 文本）

## 关键改动

| 文件 | 改动 |
|------|------|
| `src/types/knowledge.ts` | **新建** — 所有知识类型定义 |
| `src/types/index.ts` | 新增知识类型导出 |
| `src/services/knowledge/embedding-service.ts` | **新建** — Embedding 接口 + OpenAI 实现 |
| `src/services/knowledge/text-chunker.ts` | **新建** — 文本切块器 |
| `src/services/knowledge/orama-store.ts` | **新建** — Orama 向量数据库封装 |
| `src/services/knowledge/knowledge-persistence.ts` | **新建** — 持久化封装层 |
| `src/services/knowledge/knowledge-formatter.ts` | **新建** — 检索结果格式化 |
| `src/services/knowledge/knowledge-service.ts` | **大幅重构** — 接入 Orama + Embedding |
| `src/services/knowledge/index.ts` | 新增导出 |
| `src/services/llm/llm-service.ts` | sendMessage() 改用 query() + 格式化 |
| `src/services/llm/prompt-builder.ts` | MAX_KNOWLEDGE_CHARS 12000 → 4000 |
| `src/services/config/types.ts` | AppConfig 新增 knowledge 节 |
| `src/services/config/config-service.ts` | deepMerge 支持 knowledge |
| `src/services/config/index.ts` | 新增 knowledge 类型导出 |
| `src/services/index.ts` | initServices() 初始化 embedding + knowledge |
| `src/features/settings/SettingsPanel.tsx` | 新增 KnowledgeSection 组件 |
| `public/sample-knowledge.json` | **新建** — 示例知识文件 |
| `package.json` | 新增依赖 `@orama/orama@^3.1.0` |

## 不碰的文件（确认）
- Pipeline / CharacterService / Stage / Live2D / TTS / OBS / ControlPanel — 均未改动
- EventBus 事件定义 — 未改动
- 角色卡解析 — 未改动

## 验证情况

| 层次 | 状态 | 说明 | 证据 |
|------|------|------|------|
| TypeScript 编译 | ✅ | `tsc --noEmit` 零错误 | 编译输出 |
| Vite build | ✅ | `vite build` 成功 | 构建输出 |
| Lint | ✅ | 零 lint 错误 | ReadLints |
| 浏览器端功能验证 | 未验证 | 需手动测试 JSON 导入 + 搜索验证 | — |
| Tauri 桌面端验证 | 未验证 | 需 `pnpm tauri dev` 手测 | — |
| Embedding API 调用 | 未验证 | 需配置真实 OpenAI API Key 后测试 | — |
| 持久化闭环 | 未验证 | 需导入后刷新验证 | — |
| LLM 注入闭环 | 未验证 | 需发消息后查看日志 | — |

## 风险 / 限制 / 未完成项

| 项目 | 说明 |
|------|------|
| Embedding API 依赖 | 需要有效的 OpenAI API Key（或兼容端点）才能完成 embedding |
| 文档上限 200 条 | 第一轮硬限制，超出需迁移持久化方案 |
| Orama `load()` 恢复一致性 | 需手测验证持久化→恢复后搜索结果是否一致 |
| ChatPanel 内联引用 UI | 留到后续 run |
| Hybrid search 调参 | 本轮只验证 vector 主线 |
| Rerank | 不实现，留后续 |
| 复杂 loader (PDF/Word) | 不实现 |

## 结论

本轮实施完成了 Phase 3.5 Run 01 的全部代码任务（T1-T11），TypeScript + Vite build 通过。核心的语义知识库闭环（embedding → Orama → semantic retrieval → prompt 注入）代码已就位。

**需要手动验证**：配置真实 API Key 后测试 JSON 导入 → 搜索验证 → LLM 注入闭环。

建议下一步：浏览器端 `pnpm dev` 手测，确认功能正常后可进入 close-out。

## 元信息
- Commit: `37ba7e8`
- Branch: `feature/phase3-5-rag-foundation`
- 报告路径: `dev-reports/phase3-5/run01/001-semantic-knowledge-foundation.md`
- 相关文档: `blueprints/phase3-5/run01-semantic-knowledge-foundation.md`
