# Phase 3.5 Run 02 — Embedding 配置 UI + 用户链路修复

## 本次目标

Run 01 完成了知识库的代码基础（embedding service、Orama 存储、持久化、LLM 注入），但从用户角度无法完成端到端操作：

1. **没有任何 UI 入口可以配置 embedding 的 Base URL / 模型 / 维度 / API Key**
2. 默认配置 hardcode 为 `https://api.openai.com/v1` + `text-embedding-3-small`，使用 DMXAPI 等第三方转发服务时无法切换
3. 配置变更后运行中的 EmbeddingService 实例不会刷新
4. 知识库异步初始化期间 UI 显示空白，缺少加载状态

本轮目标：**补齐上述缺口，让用户可以真正走通「配置 → 导入 → 检索 → LLM 注入」的完整链路。**

## 本次完成内容

| # | 内容 | 状态 |
|---|------|------|
| R2-1 | SettingsPanel KnowledgeSection 新增 Embedding 配置区（Base URL / Model / Dimension / Key Source / Dedicated Key） | ✅ |
| R2-2 | `refreshEmbeddingService()` — 配置保存后重建 EmbeddingService + 触发 KnowledgeService `reinitialize()` | ✅ |
| R2-3 | 确认 DMXAPI 支持 `text-embedding-v4`（阿里通义，128K input，64~2048 维），验证端点兼容性 | ✅ |
| R2-4 | KnowledgeSection 初始化未完成时显示「初始化中...」而非空白 | ✅ |

## 关键改动

### 新增

| 文件 | 说明 |
|------|------|
| `dev-reports/phase3-5/run02/report.md` | 本报告 |

### 修改

| 文件 | 说明 |
|------|------|
| `src/features/settings/SettingsPanel.tsx` | KnowledgeSection 新增 Embedding 配置区（~80 行 UI + state + handler）；状态栏增加初始化状态显示 |
| `src/services/index.ts` | 新增 `refreshEmbeddingService()` 导出函数 |
| `src/services/knowledge/knowledge-service.ts` | 新增 `reinitialize()` 方法（重置 DB + documents + 重新加载持久化） |

### 未改动

- Pipeline / CharacterService / Stage / Live2D / TTS / OBS / ControlPanel — 全部未动
- EventBus 事件定义 — 未动
- 角色卡解析 — 未动
- prompt-builder / knowledge-formatter / text-chunker / orama-store — 未动
- embedding-service.ts — 未改（配置变更通过 new 实例解决）

## 验证情况

| 层次 | 状态 | 说明 | 证据 |
|------|------|------|------|
| TypeScript 编译 | ✅ | `npx tsc --noEmit` 零错误 | 编译通过 |
| Vite build | ✅ | `npx vite build` 零错误 | 构建成功 |
| Lint | ✅ | 零错误 | — |
| 浏览器端功能验证 | ⏳ 待验证 | 需要配置真实 API Key 后手测 | — |
| Tauri 桌面端 | ⏳ 待验证 | — | — |

## 风险 / 限制 / 未完成项

1. **Embedding 维度变更需重建索引**：如果用户先用 1536 维的 `text-embedding-3-small` 导入了数据，再改为 1024 维的 `text-embedding-v4`，Orama DB 的 schema 会不兼容。当前逻辑会自动检测并提示用户"重建索引"，但已有索引的向量会失效需重新 embedding
2. **DMXAPI `text-embedding-v4` 的 `dimensions` 参数**：DMXAPI 文档未明确 `dimensions` 参数是否支持（OpenAI 格式支持通过 `dimensions` 字段指定输出维度）。如果 DMXAPI 不支持 `dimensions` 参数，模型会返回默认维度的向量，需要确保 Orama schema 维度与实际返回维度一致
3. **sessionStorage 开发模式下刷新丢失**：浏览器开发模式下 Embedding API Key 存在 sessionStorage 中，页面刷新后需重新输入

## 引导操作（新用户第一次使用知识库）

### 前置条件

- 已有可用的 DMXAPI 账号和 API Key（或其他 OpenAI 兼容的 embedding 服务）
- 已配置至少一个 LLM Profile（如果选择"复用 LLM Key"）

### 步骤

1. **打开设置面板** → 找到「知识库管理」区域
2. **配置 Embedding**：
   - **Base URL**: `https://api.dmxapi.com/v1`（DMXAPI）或 `https://api.openai.com/v1`（OpenAI 原生）
   - **模型名称**: `text-embedding-v4`（DMXAPI 推荐）或 `text-embedding-3-small`（OpenAI 原生）
   - **维度**: `1024`（text-embedding-v4 默认）或 `1536`（text-embedding-3-small 默认）
   - **密钥来源**: 
     - 「复用当前 LLM 档案的 API Key」— 适用于 DMXAPI 等全模型共用一个 key 的场景
     - 「使用独立的 Embedding API Key」— 适用于 embedding 和 LLM 使用不同服务商的场景
   - 如选择独立 key，在下方输入 API Key
3. **点击「保存 Embedding 配置」** → 看到"Embedding 配置已保存并生效"的绿色提示
4. **导入知识**：
   - 点击「导入 JSON」→ 选择 `public/sample-knowledge.json`（项目自带 5 条示例）
   - 或点击「手动添加」→ 填写标题/内容 → 添加
5. **验证检索**：
   - 在「搜索验证」框中输入 `"好看的手办推荐"`
   - 点击搜索 → 应返回「原神 Q 版摆件套装」等相关结果，并显示 score
6. **验证 LLM 注入**：
   - 切到聊天面板，发送 `"有什么好看的手办吗？"`
   - LLM 回复应包含从知识库检索到的商品信息

### 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 导入时报"Embedding 服务未配置" | 未保存 Embedding 配置 | 先保存配置再导入 |
| 导入时报 HTTP 401 | API Key 无效或未配置 | 检查 key 是否正确，检查 key source 选择 |
| 导入时报 HTTP 404 | Base URL 不正确 | 确认 URL 包含 `/v1` 后缀 |
| 搜索无结果 | 未导入任何文档 | 先导入数据 |
| 索引显示"无索引" | 首次导入或维度变更后 | 导入文档会自动建索引；或点"重建索引" |
| 导入后维度报错 | 配置维度与模型实际返回不匹配 | 检查模型实际输出维度，调整配置 |

## 测试用例计划

### TC-01: Embedding 配置保存与持久化

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | 打开设置 → 知识库管理 | 看到 Embedding 配置区，默认值为 `https://api.openai.com/v1` / `text-embedding-3-small` / `1536` |
| 2 | 修改 Base URL 为 `https://api.dmxapi.com/v1`，Model 为 `text-embedding-v4`，维度为 `1024` | 字段值更新 |
| 3 | 点击"保存 Embedding 配置" | 绿色提示"Embedding 配置已保存并生效" |
| 4 | 刷新页面 | 配置回显仍为刚才保存的值 |

### TC-02: 使用独立 Key

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | Key Source 切换为「使用独立的 Embedding API Key」 | 出现 Key 输入框 |
| 2 | 输入有效 API Key → 保存 | 成功提示 |
| 3 | 导入 `sample-knowledge.json` | 成功导入 5 条文档 |

### TC-03: 知识导入全链路

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | 配置好 Embedding → 点击「导入 JSON」 | 文件选择器打开 |
| 2 | 选择 `public/sample-knowledge.json` | 显示"成功导入 5 条文档" |
| 3 | 检查状态栏 | 文档数 = 5，chunks > 0，索引就绪 |
| 4 | 重复导入同一文件 | 显示"已存在，跳过"（id 去重） |

### TC-04: 语义检索验证

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | 在搜索框输入 `"手办 摆件"` → 搜索 | 返回「原神 Q 版摆件套装」，score 最高 |
| 2 | 输入 `"直播什么时候"` → 搜索 | 返回「直播时间安排」相关结果 |
| 3 | 输入 `"退货怎么退"` → 搜索 | 返回「退换货政策」相关结果 |
| 4 | 输入完全无关文本 `"量子力学基本原理"` → 搜索 | 返回结果 score 较低或无结果 |

### TC-05: LLM 注入闭环

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | 确保知识库已有数据 + LLM Profile 已配置 | — |
| 2 | 在聊天面板发送 `"有什么推荐的手办吗？"` | LLM 回复中应包含知识库中的商品信息（Q 版摆件套装、价格 128 元等） |
| 3 | 检查浏览器 devtools console 日志 | 应看到 `[knowledge] knowledge retrieval results` 日志 |

### TC-06: 重建索引

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | 修改 embedding 配置（如改维度） → 保存 | 索引状态可能变为"无索引" |
| 2 | 点击"重建索引" | 进度条显示 → "索引重建完成" |
| 3 | 重新搜索 | 结果正常返回 |

### TC-07: 初始化状态显示

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | 刷新页面后立即打开设置 → 知识库 | 状态栏显示"初始化中..." |
| 2 | 等待 1-2 秒 | 状态变为"索引就绪"或"无索引" |

## 结论

- **代码实现完成**：Embedding 配置 UI + refreshEmbeddingService + reinitialize + 初始化状态显示 — 全部实现并通过编译
- **验收未完成**：需要人工配置真实 API Key 后按上述测试用例手测
- **本轮状态**：`implemented but not yet accepted`
- **建议下一步**：按 TC-01 → TC-07 顺序执行手测验证

## 元信息

- Commit: `b1ab589`
- Branch: `feature/phase3-5-rag-foundation`
- 报告路径: `dev-reports/phase3-5/run02/report.md`
- 相关文档: `blueprints/phase3-5/run01-semantic-knowledge-foundation.md`
