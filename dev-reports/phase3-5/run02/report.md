# Phase 3.5 Run 02 — Rerank Integration 实施报告

## 本轮目标

在不重写知识库架构的前提下，将检索链路升级为：

**hybrid recall (topK=20) → rerank (topN=10) → final topK=5 → prompt 注入**

同时完成 config/type drift 修正、Rerank 配置 UI、最小实验模板搭建。

参考文档：`c:\Users\PlayerAhu\.cursor\plans\phase_3.5_run_02_rerank_c43404b5.plan.md`

---

## 本轮实际完成内容

| 任务 | 内容 | 状态 |
|------|------|------|
| T1 | Config / type drift 修正：searchMode 默认值统一为 hybrid，新增 rerank 类型 | ✅ |
| T2 | 新建 rerank-service.ts：IRerankService 接口 + CompatibleRerankService 实现 | ✅ |
| T3 | KnowledgeService 改造：setRerankService() 注入 + query() 内 recall→rerank→final 三段式 | ✅ |
| T4 | initServices / refreshProviders 扩展：resolveRerankProfile() + rerank 初始化 + 热刷新 | ✅ |
| T5 | KnowledgePanel Rerank 配置 UI（启用开关 + 档案管理）+ searchMode 收口（UI 中不暴露） | ✅ |
| T6 | 编译验证：tsc --noEmit + vite build 零错误 | ✅ |
| T7 | Baseline 实验记录模板创建 | ✅ |
| T8 | Rerank 实验记录模板创建 | ✅ |
| T9 | 本报告 | ✅ |

---

## 关键实现点

### 1. Config / Type Drift 修正

- `DEFAULT_CONFIG.knowledge.searchMode` 从 `"vector"` 统一为 `"hybrid"`（与 `DEFAULT_KNOWLEDGE_CONFIG` 对齐）
- 新增 `RerankProviderConfig`、`RerankProfile`、`RerankResult` 三个类型到 `types/knowledge.ts`
- `KnowledgeConfig` 扩展 `rerank` / `rerankProfiles` / `activeRerankProfileId` / `rerankEnabled` 四个字段
- `SECRET_KEYS` 新增 `RERANK_API_KEY(profileId)` 支持 per-profile 隔离
- `deepMerge` 扩展 rerank 节的合并逻辑

### 2. CompatibleRerankService

- 兼容 `/v1/rerank` 端点（Cohere / Jina / DMXAPI 等）
- `POST {baseUrl}/v1/rerank`，请求体 `{ model, query, documents, top_n, return_documents: true }`
- 通过 `proxyRequest` 走 Rust 代理，10s 超时
- 密钥使用 `SECRET_KEYS.RERANK_API_KEY(profileId)`

### 3. KnowledgeService 三段式检索

- recall 阶段：`searchKnowledge(db, ..., recallTopK=20)` — rerank 启用时取较大候选集
- rerank 阶段：`rerankService.rerank(queryText, documents, RERANK_TOP_N=10)` — 精排
- final 阶段：`results.slice(0, finalTopK=5)` — 截取送入 formatter/prompt
- rerank 失败时：降级为不 rerank，直接从 recall 结果截取前 finalTopK，打 warn 日志
- 当 `rerankEnabled=false` 或无 rerankService 时：直接取 finalTopK，行为与 Run 01 一致

### 4. searchMode 收口

- `searchMode` 字段在 `KnowledgeConfig` 中保留（不删），默认值锁定为 `"hybrid"`
- UI 中不暴露 `searchMode` 选择器
- 调试途径：通过 devtools 直接修改 config store

### 5. Rerank 配置 UI

- KnowledgePanel 新增 Rerank 配置区：启用开关 + Profile 管理（baseUrl / model / API Key）
- 沿用 EmbeddingProfile 体系一致的 Popover 编辑体验
- 启用/禁用 rerank 后自动调用 `refreshEmbeddingService()` 刷新服务实例

---

## 改动文件清单

### 新建文件

| 文件 | 说明 |
|------|------|
| `src/services/knowledge/rerank-service.ts` | IRerankService 接口 + CompatibleRerankService 实现 |
| `dev-reports/phase3-5/run02/baseline-experiment.md` | Baseline 实验记录模板 |
| `dev-reports/phase3-5/run02/rerank-experiment.md` | Rerank 实验记录模板 |

### 修改文件

| 文件 | 说明 |
|------|------|
| `src/types/knowledge.ts` | 新增 RerankProviderConfig / RerankProfile / RerankResult；KnowledgeConfig 扩展 rerank 字段；DEFAULT_KNOWLEDGE_CONFIG 新增 rerank 默认值 |
| `src/types/index.ts` | 导出新增的 rerank 类型 |
| `src/services/config/types.ts` | searchMode 默认值修为 hybrid；SECRET_KEYS 新增 RERANK_API_KEY；re-export rerank 类型；DEFAULT_CONFIG 新增 rerank 默认值 |
| `src/services/config/config-service.ts` | deepMerge 扩展 rerank 节 |
| `src/services/config/index.ts` | 导出 RerankProviderConfig / RerankProfile 类型 |
| `src/services/knowledge/knowledge-service.ts` | 新增 rerankService 字段 + setRerankService()；query() 重写为三段式（recall→rerank→final）；新增 RECALL_TOP_K / RERANK_TOP_N 常量 |
| `src/services/knowledge/index.ts` | 导出 CompatibleRerankService + IRerankService |
| `src/services/index.ts` | 导入 CompatibleRerankService；新增 resolveRerankProfile()；initServices() 中初始化 rerank service；refreshEmbeddingService() 扩展为同时刷新 rerank |
| `src/features/knowledge/KnowledgePanel.tsx` | 新增 Rerank 配置区（启用开关 + 档案 CRUD + Popover 编辑） |

### 明确未动的文件

- `src/services/llm/llm-service.ts` — 调用点不变
- `src/services/llm/prompt-builder.ts` — 截断逻辑不变
- `src/services/knowledge/knowledge-formatter.ts` — 格式化逻辑不变
- `src/services/knowledge/orama-store.ts` — 召回层不变
- `src/services/knowledge/embedding-service.ts` — embedding 逻辑不变
- `src/services/knowledge/text-chunker.ts` — 切块不变
- Pipeline / CharacterService / Stage / Live2D / TTS / OBS / ControlPanel / EventBus — 全部不动

---

## 验证情况

| 层次 | 状态 | 说明 |
|------|------|------|
| TypeScript 编译 | ✅ | `npx tsc --noEmit` 零错误 |
| Vite build | ✅ | `npx vite build` 零错误 |
| Lint | ✅ | 零错误 |
| Rerank 功能手测 | ⏳ 待验证 | 需要配置 Rerank API Key + 真实 API 端点 |
| Baseline 实验 | ⏳ 待填写 | 模板已创建，需手测填写 |
| Rerank 实验 | ⏳ 待填写 | 模板已创建，需手测填写 |
| 回归测试 | ⏳ 待验证 | TTS / Stage / OBS / 角色切换等不应受影响 |

---

## 已知限制

1. **rerank 默认关闭**：`rerankEnabled` 默认为 `false`，需要用户在 UI 中手动开启并配置 Rerank 档案
2. **rerank 延迟叠加**：rerank 会在 recall 之后增加一次 API 调用（10s 超时），直播场景需关注总延迟
3. **降级机制**：rerank API 失败时自动降级为不 rerank（直接截取 recall 结果），会打 warn 日志
4. **实验数据待填写**：baseline 和 rerank 实验模板已创建，但需要手测才能填写实际数据

---

## 本轮状态

**`implemented but not yet accepted`**

- 代码实现已完成，编译验证通过
- 运行时功能验证待手测
- Baseline vs Rerank 对比实验待执行

---

## 建议手测步骤

### 前置条件

- 已配置好 Embedding 档案并成功导入 `sample-knowledge.json`
- 有可用的 Rerank API 端点和 Key

### 步骤

1. **Baseline 记录**（rerankEnabled=false）
   - 确保 Rerank 未启用
   - 在搜索验证框中依次执行 Q1-Q8，记录结果到 `baseline-experiment.md`

2. **配置 Rerank**
   - 打开知识库面板 → Rerank 配置 → 点击"未启用"切换为"已启用"
   - 新增 Rerank 档案：
     - 名称：如 `DMXAPI Qwen3 Rerank`
     - Base URL：`https://www.dmxapi.cn`
     - 模型：`qwen3-reranker-8b`（或 `bge-reranker-v2-m3-free`）
     - API Key：填入有效 key
   - 保存

3. **Rerank 记录**（rerankEnabled=true）
   - 使用同一批知识数据，依次执行 Q1-Q8，记录结果到 `rerank-experiment.md`
   - 对比 baseline，填写对比总结

4. **回归验证**
   - 确认 TTS / Stage / OBS / 角色切换等功能不受影响

### 验收 Checklist

| # | 验收项 | 通过 |
|---|--------|------|
| 1 | searchMode 默认值统一为 hybrid | ⏳ |
| 2 | rerank-service.ts 编译通过 | ✅ |
| 3 | query() 内 rerank 步骤正确插入 | ⏳ |
| 4 | rerank 失败时优雅降级 | ⏳ |
| 5 | Rerank 配置 UI 可用（启用开关 + profile 管理） | ⏳ |
| 6 | searchMode 不在 UI 中暴露 | ✅ |
| 7 | Baseline 实验记录完成 | ⏳ |
| 8 | Rerank 实验记录完成 | ⏳ |
| 9 | 搜索验证框 rerank 后排序改善 | ⏳ |
| 10 | 不破坏现有链路 | ⏳ |
| 11 | TypeScript + Vite build 通过 | ✅ |

---

## 元信息

- Commit: `01db160`
- Branch: `feature/phase3-5-rag-foundation`
- 报告路径: `dev-reports/phase3-5/run02/report.md`
- 实验记录: `dev-reports/phase3-5/run02/baseline-experiment.md` / `rerank-experiment.md`
- 计划文档: `phase_3.5_run_02_rerank_c43404b5.plan.md`
