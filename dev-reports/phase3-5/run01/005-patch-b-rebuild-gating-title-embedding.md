# Phase 3.5 Run 01 Patch B — Rebuild Gating + Title Embedding Validation

## 本次目标

在不重写知识库架构的前提下，完成：
1. 索引生命周期修正（revision 门控）
2. 标题参与 embedding 的实现与实验取证
3. Phase 3.5 活文档与实验文档整合

## 本次完成内容

### 1. 索引生命周期 revision 门控

- 新增 `documentsRevision` / `indexedRevision` 计数器，替代模糊的布尔状态
- 索引状态统一为 `ready` / `needs_rebuild` / `rebuilding` / `error` 四态
- 文档 CRUD 操作（导入/添加/编辑/删除）只更新文档列表 + 持久化，不触发 embedding 或 Orama 更新
- 文档变动后自动标记 `needs_rebuild`

### 2. 强制确认型门控 UI（RebuildGate）

- 新建 `RebuildGate.tsx` 组件：强制二选一面板（重建索引 / 取消）
- 集成到 `KnowledgePanel`：搜索验证前检查索引状态，stale 时弹出门控
- 集成到 `ChatPanel`：消息发送前检查索引状态，stale 时弹出门控
- 重建完成后自动继续被拦截的原动作（搜索/发送），用户输入不丢失
- 状态栏动态显示当前索引状态（需要重建索引 / 重建中 / 索引异常 / 索引就绪）

### 3. Title 纳入 embedding 输入

- 新增 `buildEmbeddingInput(title, chunkText)` 方法
- embedding 输入 = `title + \n + chunkText`，存储的 `text` 字段仍为纯 chunk 正文
- `CURRENT_SCHEMA_VERSION` 2→3，旧索引自动失效需重建

### 4. Title Embedding 实验取证

四组 A/B/C/D 对照实验，结果记录在 `002-title-embedding-and-search-behavior.md`。
核心结论：
- title-prefixed 方式让标题相关查询得分提升 40%-120%
- 与用户手动将标题写进正文效果完全等价（delta = 0.0000）
- 纯正文关键词得分轻微下降 ~5%，可接受

### 5. 搜索验证按钮图标移除

`KnowledgePanel` 搜索按钮的 `SearchIcon` 已移除。

### 6. 文档整合

- `blueprints/phase3-5/README.md`：新增文档索引
- `rag-foundation.md`：标注定位，更新风险表
- `run01-semantic-knowledge-foundation.md`：标注 canonical，添加 Patch 历史
- `dev-reports` 中归类错误的文件移入 `run01/`

### 7. URL 职责边界审查

确认代码中无自动修正用户 URL 的逻辑。`embedding-service.ts` 中的 URL 处理仅做格式正规化（防止 `/v1/v1` 重复），不替换域名。

## 关键改动

| 文件 | 改动 |
|------|------|
| `src/services/knowledge/knowledge-service.ts` | revision 机制 + 索引状态管理 + 文档 CRUD 不触发索引 + buildEmbeddingInput |
| `src/features/knowledge/RebuildGate.tsx` | **新建** — 强制确认型门控面板 |
| `src/features/knowledge/KnowledgePanel.tsx` | 门控集成 + 状态显示 + 搜索按钮去图标 |
| `src/features/chat/ChatPanel.tsx` | 门控集成（消息发送前检查） |
| `src/types/knowledge.ts` | schema version 2→3 |
| `src/services/knowledge/index.ts` | 导出 IndexStatus 类型 |
| `blueprints/phase3-5/README.md` | **新建** — 文档索引 |
| `blueprints/phase3-5/rag-foundation.md` | 添加定位说明 + 风险表更新 |
| `blueprints/phase3-5/run01-*.md` | 添加 Patch 历史 |
| `dev-reports/phase3-5/run01/report.md` | 更新 Patch 历史和过程快照索引 |
| `scripts/test-title-embedding.mjs` | **新建** — 实验脚本 |

### 未改动（确认）

- Stage / Live2D / TTS / OBS / Pipeline / Runtime — 未动
- ControlPanel liveContext — 未动
- 角色卡解析主结构 — 未动
- `docs/research/*` — 未动

### 保留的修复基线（未回退）

- similarity threshold 0.2
- 默认 searchMode hybrid
- fulltext fallback
- persona/customPersona 冲突修复

## 验证情况

| 层次 | 状态 | 说明 | 证据 |
|------|------|------|------|
| TypeScript 编译 | ✅ | `npx tsc --noEmit` 零错误 | 编译输出 |
| Vite 生产构建 | ✅ | `npx vite build` 成功 | 构建输出 |
| Lint | ✅ | 零 lint 错误 | ReadLints |
| Title embedding 实验 | ✅ | A/B/C/D 四组对照完成 | `002-title-embedding-and-search-behavior.md` |
| 门控逻辑 | 代码审查通过 | 需 Tauri 手测 | — |
| Tauri 桌面端 | 未验证 | 需 `pnpm tauri dev` 手测 | — |

### 待手测项

1. 导入知识后，状态栏是否显示"需要重建索引"
2. 搜索验证时是否弹出 RebuildGate
3. 点击"重建索引"后是否自动继续搜索
4. ChatPanel 发送消息时是否弹出 RebuildGate
5. 点击"取消"后用户输入是否保留
6. 重建成功后状态是否回到"索引就绪"

## 当前 similarity / minScore / topK 建议口径

| 参数 | 值 | 说明 |
|------|-----|------|
| similarity threshold | 0.2 | 暂定值，适用于 10-50 条文档 |
| searchMode | hybrid | vector + fulltext 混合 |
| topK | 5 | 默认返回前 5 条 |
| fulltext fallback | 有 | vector/hybrid 0 结果时自动 fallback |

> **风险声明**: 当文档数超过 50 条时，建议重新评估 threshold 是否需要提高到 0.25-0.3。

## 结论

Patch B 的三类工作（门控、title embedding、文档整合）全部完成，编译和构建通过，实验数据记录完整。

**本轮状态**: `implemented but not yet accepted`（需 Tauri 手测门控交互）

## 元信息

- Commit 1: `0e4fbf2` — fix(knowledge): gate stale index usage with explicit rebuild confirmation
- Commit 2: `4213e49` — docs(phase3-5): add title embedding experiment record
- Commit 3: `79bd738` — docs(phase3-5): consolidate canonical run and phase documents
- Branch: `feature/phase3-5-rag-foundation`
- 报告路径: `dev-reports/phase3-5/run01/005-patch-b-rebuild-gating-title-embedding.md`
- 实验文档: `dev-reports/phase3-5/run01/002-title-embedding-and-search-behavior.md`
- 实施蓝图: `blueprints/phase3-5/run01-semantic-knowledge-foundation.md`
