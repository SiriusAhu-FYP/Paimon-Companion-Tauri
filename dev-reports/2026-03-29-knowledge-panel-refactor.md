# Knowledge Panel 重构 & Embedding Profile 体系

## 本次目标
1. Embedding 配置改为独立 profile 体系（多档案 + 独立 key/url），与 LLM Profile 对等
2. 知识条目去掉分类（KnowledgeCategory），统一为标题+内容
3. 知识库管理从 SettingsPanel 中拆出，成为独立面板，入口为顶栏图书图标

## 本次完成内容
- 新增 `EmbeddingProfile` 类型，支持多档案 CRUD + 独立 API Key
- 移除 `KnowledgeCategory` / `EmbeddingApiKeySource` 类型及所有相关引用
- `SECRET_KEYS.EMBEDDING_API_KEY` 改为 per-profile 函数签名 `(profileId) => string`
- `OpenAIEmbeddingService` 接收 profileId，使用对应的 keyring key
- `services/index.ts` 新增 `resolveEmbeddingProfile()` 从活跃档案解析配置
- 新增 `features/knowledge/KnowledgePanel.tsx` — 完整独立知识库管理面板
- `MainWindow.tsx` 顶栏新增图书图标（AutoStories），点击在右栏打开知识库面板
- 从 `SettingsPanel.tsx` 移除全部知识库相关代码（300+ 行）
- `config-service.ts` deepMerge 新增 `embeddingProfiles` / `activeEmbeddingProfileId` 字段
- `orama-store.ts` 和 `knowledge-service.ts` 中移除所有 `category` 字段

## 关键改动

| 文件 | 改动摘要 |
|------|---------|
| `src/types/knowledge.ts` | 移除 KnowledgeCategory；新增 EmbeddingProfile；KnowledgeConfig 新增 embeddingProfiles/activeEmbeddingProfileId |
| `src/services/config/types.ts` | re-export 更新；SECRET_KEYS.EMBEDDING_API_KEY 改为函数；DEFAULT_CONFIG 更新 |
| `src/services/config/config-service.ts` | deepMerge 新增 embeddingProfiles/activeEmbeddingProfileId |
| `src/services/knowledge/embedding-service.ts` | 构造函数接收 profileId；移除 apiKeySource/resolveSecretKey；自动补 /v1 |
| `src/services/knowledge/orama-store.ts` | schema/insert/search 移除 category 字段 |
| `src/services/knowledge/knowledge-service.ts` | processDocument 移除 category |
| `src/services/index.ts` | 新增 resolveEmbeddingProfile()；initServices/refreshEmbeddingService 使用 profile |
| `src/features/knowledge/KnowledgePanel.tsx` | 新建：完整知识库管理面板 |
| `src/features/knowledge/index.ts` | 新建：barrel export |
| `src/app/MainWindow.tsx` | 新增 AutoStories 图标 + showKnowledge 状态 + 右栏渲染 KnowledgePanel |
| `src/features/settings/SettingsPanel.tsx` | 移除 KnowledgeSection（~320 行）+ 清理无用 import |
| `src/types/index.ts` | 移除 KnowledgeCategory/EmbeddingApiKeySource re-export；新增 EmbeddingProfile |

## 验证情况

| 层次 | 状态 | 说明 | 证据 |
|------|------|------|------|
| TypeScript 编译 | ✅ | `npx tsc --noEmit` 零错误 | 命令输出 |
| Vite 构建 | ✅ | `npx vite build` 成功 | 命令输出 |
| Linter | ✅ | ReadLints 零错误 | IDE linter |
| 全链路代码审查 | ✅ | 模拟用户创建档案→保存key→切换→添加知识→搜索的完整路径 | 代码走读 |
| Tauri 桌面端 | 未验证 | 需用户手测 | — |

## 风险 / 限制 / 未完成项
- 已有的 knowledge 持久化数据中旧文档如果包含 `category` 字段，加载时不会报错（TypeScript 只是不再要求该字段），但 Orama 索引 schema 已移除 `category`，**旧索引快照会因 schema 不兼容被跳过**，需用户手动"重建索引"
- i18n 翻译未覆盖 KnowledgePanel（当前仅中文硬编码），后续 i18n run 可统一补上
- 面板宽度固定在右栏 280px，复杂操作（如 JSON 预览）空间有限，后续可考虑 Drawer

## 结论
- 本轮三项核心需求均已完成
- 全链路代码审查确认无"配置未应用"漏洞
- 建议用户手测后确认，再推进后续 Phase 3.5 工作

## 元信息
- Commit: 待提交
- Branch: `feature/phase3-5-rag-foundation`
- 报告路径: `dev-reports/2026-03-29-knowledge-panel-refactor.md`
- 相关文档路径: `blueprints/phase3-5/rag-foundation.md`
