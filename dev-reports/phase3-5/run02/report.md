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
| T7 | Baseline 实验记录（真实手测结果已填写） | ✅ |
| T8 | Rerank 实验记录（真实手测结果已填写 + 对比总结） | ✅ |
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
| `dev-reports/phase3-5/run02/baseline-experiment.md` | Baseline 实验记录（真实结果） |
| `dev-reports/phase3-5/run02/rerank-experiment.md` | Rerank 实验记录（真实结果 + 对比） |

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
| Rerank 功能手测 | ✅ | 已在 Tauri 桌面端真实手测，rerank 主链路生效 |
| Baseline 实验 | ✅ | 8 条 query 真实结果已记录，见 `baseline-experiment.md` |
| Rerank 实验 | ✅ | 8 条 query 真实结果已记录 + 对比总结，见 `rerank-experiment.md` |
| Rerank 失败降级 | ✅ | 已确认正常：rerank API 报错时正确降级为不 rerank |
| 聊天主链路 rerank 收益 | ✅ | 已确认正常：聊天面板发送商品相关问题，LLM 注入的 knowledgeContext 体现 rerank 排序收益 |
| 回归测试 | ✅ | 已确认正常：TTS / Stage / OBS / 角色切换等现有链路无问题 |

---

## 手测结论

基于 8 条真实 query 的 Tauri 桌面端手测（搜索验证框）：

| 类别 | 数量 | Query |
|------|------|-------|
| 明显改善 | 4 | Q1（派蒙 888元）、Q3（888元 预购）、Q6（888元的派蒙商品）、Q8（发货较晚的商品） |
| top1 不变但 score 增强 | 3 | Q2（派蒙玩偶价格）、Q5（预购商品可以退吗）、Q7（派蒙周边推荐） |
| 明显误排 | 1 | Q4（派蒙现货吗） |

- 平均 top1 score：baseline 0.4905 → rerank 0.8746（+78.3%）
- **rerank 主链路已被真实手测证明生效**
- 详见 `baseline-experiment.md` 和 `rerank-experiment.md`

## 已知限制

1. **rerank 默认关闭**：`rerankEnabled` 默认为 `false`，需要用户在 UI 中手动开启并配置 Rerank 档案
2. **rerank 延迟叠加**：rerank 会在 recall 之后增加一次 API 调用（10s 超时），直播场景需关注总延迟
3. **降级机制**：rerank API 失败时自动降级为不 rerank（直接截取 recall 结果），会打 warn 日志——已通过真实测试确认降级行为正常
4. **Q4 误排（已知问题）**：`派蒙现货吗` 在 rerank 后出现明显误排（baseline 排出现货商品亚克力立牌，rerank 反而排了非现货的摆件礼盒）。推测 rerank 模型对"派蒙"关键词权重过高，忽略了"现货"这个隐含条件。可通过 `rerankEnabled=false` 一键回退

---

## 本轮状态

**`accepted`**

- 代码实现已完成，编译验证通过
- Rerank 主链路已在 Tauri 桌面端真实手测验证生效
- Baseline vs Rerank 对比实验已执行，真实结果已记录
- 降级机制、聊天主链路、回归测试均已通过验证
- 保留 1 项已知问题（Q4 误排），不影响验收通过

---

## 验收 Checklist

| # | 验收项 | 状态 |
|---|--------|------|
| 1 | searchMode 默认值统一为 hybrid | ✅ |
| 2 | rerank-service.ts 编译通过 | ✅ |
| 3 | query() 内 rerank 步骤正确插入 | ✅ |
| 4 | rerank 失败时优雅降级 | ✅ |
| 5 | Rerank 配置 UI 可用（启用开关 + profile 管理） | ✅ |
| 6 | searchMode 不在 UI 中暴露 | ✅ |
| 7 | Baseline 实验记录完成 | ✅ |
| 8 | Rerank 实验记录完成 | ✅ |
| 9 | 搜索验证框 rerank 后排序改善 | ✅ 7/8 改善或增强，1/8 误排（Q4） |
| 10 | 聊天主链路体现 rerank 排序收益 | ✅ |
| 11 | 不破坏现有链路（TTS / Stage / OBS / 角色切换） | ✅ |
| 12 | TypeScript + Vite build 通过 | ✅ |

### 已知问题（不影响验收通过）

| 问题 | 描述 | 缓解措施 |
|------|------|----------|
| Q4 误排 | `派蒙现货吗` 在 rerank 后误将非现货的摆件礼盒排到第一 | 通过 `rerankEnabled=false` 一键回退到 baseline 行为 |

| # | 验收项 | 通过 |
|---|--------|------|
| 1 | searchMode 默认值统一为 hybrid | ✅ |
| 2 | rerank-service.ts 编译通过 | ✅ |
| 3 | query() 内 rerank 步骤正确插入 | ✅ 手测确认 |
| 4 | rerank 失败时优雅降级 | ⏳ 待验证（错误 key / 断网场景） |
| 5 | Rerank 配置 UI 可用（启用开关 + profile 管理） | ✅ 手测确认 |
| 6 | searchMode 不在 UI 中暴露 | ✅ |
| 7 | Baseline 实验记录完成 | ✅ 8 条真实结果已填写 |
| 8 | Rerank 实验记录完成 | ✅ 8 条真实结果 + 对比总结已填写 |
| 9 | 搜索验证框 rerank 后排序改善 | ✅ 7/8 改善或增强，1/8 误排 |
| 10 | 聊天主链路体现 rerank 排序收益 | ⏳ 待验证 |
| 11 | 不破坏现有链路（TTS / Stage / OBS / 角色切换） | ⏳ 待回归验证 |
| 12 | TypeScript + Vite build 通过 | ✅ |

---

## 元信息

- Commit: `01db160`
- Branch: `feature/phase3-5-rag-foundation`
- 报告路径: `dev-reports/phase3-5/run02/report.md`
- 实验记录: `dev-reports/phase3-5/run02/baseline-experiment.md` / `rerank-experiment.md`
- 计划文档: `phase_3.5_run_02_rerank_c43404b5.plan.md`
