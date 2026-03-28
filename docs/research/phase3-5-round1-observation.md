# Phase 3.5 第一轮观察报告

---

## 1. 结论摘要

当前仓库已存在 `KnowledgeService` 的雏形，位于 `src/services/knowledge/knowledge-service.ts`，但它是一个**纯内存态**的薄封装——只有 `addKnowledge()`、`addLiveContext()` 和 `getAssembledContext()` 三个核心方法，没有任何持久化、检索或结构化能力。

**最自然的 Phase 3.5 主插口有两处**：
1. **知识导入**：通过扩展 `KnowledgeService` 的导入方法，在 `eventBus` 的 `external:product-message` 已有路由上增加文件驱动的知识灌入能力。
2. **检索注入**：通过扩展 `PromptBuilder` 的 `knowledgeContext` 组装逻辑，将简单拼接升级为可检索的上下文字符串。

**第一轮最小实现应落在**：
- 知识导入（JSON/YAML 文件 + 内存持久化）
- 内存级检索（关键词匹配，暂不引入向量 embedding）
- 检索结果结构化注入 LLM Prompt

**Phase 3.5 不应触碰的区域已明确**：Stage/Live2D、TTS 主链路、Pipeline、Runtime、角色卡解析体系。

---

## 2. 当前已有基础

### 2.1 KnowledgeService 现状

**文件**：`src/services/knowledge/knowledge-service.ts`

**核心数据结构**（定义在 service 内部，非共享类型）：

```typescript
interface KnowledgeEntry {
	id: string;
	content: string;
}

interface LiveContextEntry {
	id: string;
	content: string;
	priority: number;
	expiresAt: number | null;
}
```

**已有能力**：
- `addKnowledge(entry)` → 推入 `longTermKnowledge[]`（纯内存）
- `addLiveContext(entry)` → 推入 `liveContext[]`（纯内存，支持 priority + TTL）
- `removeLiveContext(id)` → 按 id 过滤删除
- `getAssembledContext()` → 优先拼接 liveContext（按 priority 降序），再拼接 longTermKnowledge
- `pruneExpired()` → 清除过期 liveContext（私有方法）

**已知限制**：
- 无持久化，App 重启即清空
- 无检索能力，只有线性拼接
- `KnowledgeEntry` / `LiveContextEntry` 定义在 service 内部，未提升为 `src/types/` 中的共享类型
- 无编辑能力，只能增删

**事件订阅**：构造函数订阅 `external:product-message`：
- `payload.type === "priority"` → `addLiveContext(priority=10, ttl=...)`
- 其他 → `addKnowledge()`

### 2.2 LLM Prompt 组装链路

**文件**：`src/services/llm/prompt-builder.ts`

`buildSystemMessage()` 按以下优先级拼接 system prompt：

1. `systemPrompt` from character card → `【角色系统指令】`
2. `persona` from character card → `【角色设定】`
3. `scenario` from character card → `【场景与世界观】`
4. `customPersona` from config → `【附加人设】`
5. `knowledgeContext` from KnowledgeService → `【当前商品与直播上下文】`

**硬限制**：
- `MAX_KNOWLEDGE_CHARS = 12000`：首次截断点
- 二次截断：总 content 超过约 16000 字符时再次截断

**调用位置**：`src/services/llm/llm-service.ts` 第 66-71 行，`sendMessage()` 中每次构建 system message：

```typescript
const systemMsg = buildSystemMessage({
	characterProfile: this.character.getProfile(),
	knowledgeContext: this.knowledge.getAssembledContext(),
	customPersona: appCharacter.customPersona,
});
```

### 2.3 角色卡体系

**文件**：`src/services/character/card-parser.ts`

当前只解析 SillyTavern V2 的标准字段（name、persona、scenario、firstMessage、systemPrompt），**明确忽略** `character_book` / `lorebook` 字段。

角色卡数据来源：`public/cards/cards-manifest.json` → 加载 `public/cards/*.json` → 解析为 `CharacterProfile`。

角色卡与知识库**完全解耦**——角色卡提供 persona/scenario/systemPrompt，知识服务提供外部上下文，无关联机制。

### 2.4 事件总线

**文件**：`src/services/event-bus/event-bus.ts`

全局单例 `eventBus`，订阅/发布机制，无异步处理，事件历史上限 200 条。

当前与知识相关的 ingress 事件仅有 `external:product-message`，无知识变更通知事件。

### 2.5 配置系统

**文件**：`src/services/config/types.ts`

`AppConfig` 中**没有任何知识库相关配置项**——无存储位置、无 RAG 设置、无知识条目管理。

### 2.6 服务初始化链

**文件**：`src/services/index.ts`

`initServices()` 第 110 行创建 `KnowledgeService`，第 115 行将其注入 `LLMService` 构造函数。

**关键**：`refreshProviders()` 仅热更新 LLM/TTS provider，不重建 `KnowledgeService`。

---

## 3. 建议主插口

### 3.1 知识导入入口

**最适合落在 `KnowledgeService` 本身**，而非新建独立模块。

理由：
- 已有 `external:product-message` 的事件订阅路由，继续沿用事件驱动风格最自然
- `KnowledgeService` 已是 `ServiceContainer` 成员，LLMService 已持有其引用
- 在 service 内部增加 `importFromJSON()` / `importFromYAML()` 方法，职责内聚

**不适合放在**：
- `PipelineService`（Pipeline 应保持"编排"定位，不承载知识管理）
- `CharacterService`（角色卡解析体系不应被知识库逻辑侵入）
- `config-service`（知识不是配置）

### 3.2 检索入口

**最适合落在 `KnowledgeService` 内部**，新增 `query(text): KnowledgeResult` 方法。

理由：
- 检索是知识服务的核心能力之一，放在 service 外会破坏封装
- PromptBuilder 通过 `knowledge.getAssembledContext()` 获取上下文，升级为 `knowledge.query(userText)` 是最小改动

**第一轮检索策略**：关键词 BM25 或简单倒排索引（in-memory），暂不引入向量 embedding。

### 3.3 检索结果注入 LLM 链路

**最适合插在 `PromptBuilder.buildSystemMessage()`**。

当前 `knowledgeContext` 参数是 `getAssembledContext()` 的全量拼接结果。第一轮改为 `query(userText)` 的检索结果注入：

```typescript
// 在 LLMService.sendMessage() 中
const knowledgeContext = this.knowledge.query(userText); // 新方法
const systemMsg = buildSystemMessage({
	knowledgeContext, // 检索结果而非全量拼接
	...
});
```

**不需要改动 `buildSystemMessage` 签名**，只需改变传入的字符串内容。

### 3.4 最值得复用的模块

| 模块 | 复用价值 | 理由 |
|------|----------|------|
| `KnowledgeService` | 直接扩展 | 已有正确架构位置，扩展成本最低 |
| `eventBus` | 继续作为 ingress 路由 | `external:product-message` 机制已验证 |
| `PromptBuilder` | 扩展 `knowledgeContext` 组装逻辑 | 改动极小，接口不变 |
| `config-service` | 复用存储基础设施 | 知识配置可复用 Tauri Store |
| `CharacterService` | 不侵入 | 角色卡体系已稳定，不应绑 RAG |

---

## 4. 第一轮最小实现建议

### 必须做（第一轮）

| 能力 | 说明 |
|------|------|
| **知识条目类型共享化** | 将 `KnowledgeEntry` / `LiveContextEntry` 从 service 内部提升到 `src/types/` 作为共享接口 |
| **YAML/JSON 导入** | 在 `KnowledgeService` 新增 `importEntries(entries[])` 方法，支持批量导入 |
| **内存持久化** | 知识条目随 AppConfig 通过 Tauri Store 持久化（作为 `knowledge` 配置节） |
| **检索方法** | 新增 `query(text): RetrievalResult[]`，第一轮使用简单关键词匹配（包含即召回，无需向量） |
| **检索参数 topK** | `query(text, { topK?: number })` 控制召回条数 |
| **注入链路升级** | `LLMService.sendMessage()` 中改为 `knowledge.query(userText)` 而非 `getAssembledContext()` |
| **最小管理 UI** | 在 SettingsPanel 中新增知识管理 section（查看列表 + 导入 + 删除），复用现有 Popover 结构 |
| **长期/临时知识区分** | 复用现有 `longTermKnowledge` / `liveContext` 区分，持久化两者 |

### 预留但先不做

| 能力 | 理由 |
|------|------|
| 向量 embedding | 依赖外部 embedding API，第一轮用关键词召回足够验证流程 |
| Rerank / scoring | 增加复杂度，第一轮不需要 |
| 商品消息优先队列 | Phase 4 事件接入时才需要，当前只做接口预留 |
| 知识变更事件 | UI 更新可直接读 `KnowledgeService` 状态，暂不需要事件通知 |
| 向量数据库 | 初期内存索引足够，持久化走 Tauri Store 即可 |
| Per-character 知识关联 | Phase 4 或 Phase 5 再做，当前知识库是全局的 |

---

## 5. 文件与模块定位

### 5.1 必改文件清单

| 文件 | 改动内容 |
|------|----------|
| `src/services/knowledge/knowledge-service.ts` | 新增 `query()`、`importEntries()`、`saveToStorage()`、`loadFromStorage()` 方法；重构为支持持久化 |
| `src/services/knowledge/index.ts` | 导出新增方法对应的类型 |
| `src/services/llm/llm-service.ts` | `sendMessage()` 中改用 `knowledge.query(userText)` |
| `src/services/llm/prompt-builder.ts` | 调整 `knowledgeContext` 截断逻辑（如果检索结果已是精选片段，可调低截断阈值） |
| `src/services/config/types.ts` | 新增 `KnowledgeConfig` 接口，包含 `entries: KnowledgeEntry[]`；添加到 `AppConfig` |
| `src/services/config/config-service.ts` | `loadConfig()` / `updateConfig()` 支持 `knowledge` 节 |
| `src/services/index.ts` | `KnowledgeService` 初始化时从 config 加载已有条目 |
| `src/types/index.ts` + 新建 `src/types/knowledge.ts` | 将 `KnowledgeEntry`、`LiveContextEntry`、`RetrievalResult` 提升为共享类型 |
| `src/features/settings/SettingsPanel.tsx` | 新增知识管理 section（导入 JSON/YAML、查看列表、删除条目） |
| `src/features/chat/ChatPanel.tsx` | 预留引用来源展示的 UI 位置（可先留注释或 placeholder） |

### 5.2 建议新增文件清单

| 文件 | 职责 |
|------|------|
| `src/types/knowledge.ts` | 存放 `KnowledgeEntry`、`LiveContextEntry`、`RetrievalResult`、`KnowledgeConfig` 等共享类型 |
| `src/services/knowledge/keyword-search.ts` | 第一轮关键词检索实现（BM25 或简单包含匹配），独立于 knowledge-service 便于后续替换为向量检索 |
| `src/services/knowledge/storage.ts` | 知识持久化抽象层，封装对 config-service 的读写（可延迟加载，避免循环依赖） |
| `src/features/knowledge/` (目录) | 未来知识管理 UI 独立目录，当前可先放在 settings 内，后续迁移 |

### 5.3 观察到但不建议改的文件

| 文件 | 理由 |
|------|------|
| `src/services/pipeline/pipeline-service.ts` | Pipeline 职责是编排，不应承载知识管理逻辑 |
| `src/services/event-bus/event-bus.ts` | 事件总线已稳定，第一轮不引入新的知识变更事件 |
| `src/services/character/card-parser.ts` | 角色卡解析不碰，避免破坏已有稳定模块 |
| `src/services/character/character-service.ts` | 同上 |
| `src/features/stage/*` | Stage / Live2D 完全不碰 |
| `src/services/tts/*` | TTS 主链路不碰 |
| `src/app/MainWindow.tsx` | 布局不改动，知识 UI 放在 Settings 内即可 |
| `src/services/external-input/*` | Phase 4 的外部输入适配器框架，第一轮不改动 |

---

## 6. 风险点

### 6.1 最容易做过头的点

**引入完整的向量检索系统**（embedding API + 向量数据库）。这会引入外部依赖、增加部署复杂度、与当前"最小可用"目标冲突。第一轮应严格限定在内存关键词检索。

### 6.2 最容易把 RAG 做成黑箱的点

**不暴露检索过程**。当前 `buildSystemMessage()` 直接将检索结果拼接进 prompt，如果 LLM 的回复引用了某条知识，用户/开发者无法知道是哪条。第一轮应在 ChatPanel 中至少显示"参考了 N 条知识"的数量指示，为后续完整引用来源展示留好 UI 位置。

### 6.3 最容易和现有角色/上下文系统打架的点

**修改 `buildSystemMessage()` 的截断逻辑**。当前 `MAX_KNOWLEDGE_CHARS = 12000` 是针对全量拼接设计的。第一轮改为精选检索结果后，截断策略需要重新校准——精选片段数量少但每条更精准，不能简单沿用旧的字符数阈值。需要在 `PromptBuilder` 中增加对"已检索上下文"与"原始全量上下文"的区别处理。

### 6.4 最容易导致后续返工的错误方向

**将知识库强绑定到角色卡上**（per-character knowledge）。当前仓库中角色卡与知识库是完全解耦的，这是正确的架构选择。如果第一轮就做 per-character 知识关联，会增加数据模型复杂度（需要管理"全局知识库"与"角色专属知识库"的关系），且 Phase 4 的外部事件接入（弹幕/商品消息）并不依赖 per-character 关联。第一轮应保持全局知识库，让每个角色卡都访问同一个知识库。

---

## 7. 当前最值得继续追问的问题

1. **Embedding 方案选型**：Phase 3.5 结束后（第一轮关键词检索验证完成后），第二阶段是否引入 OpenAI Embedding API？还是等待本地 embedding 模型（如 Nomic Embed Text）？这会影响第一轮的数据模型设计（是否需要预留向量字段）。

2. **知识库与 Phase 4 外部事件的边界**：当前 `external:product-message` 同时触发 `addKnowledge()` 和 `addLiveContext()`。Phase 4 接入弹幕/礼物后，外部事件是否会扩展出更多类型（如 `external:danmaku`、`external:gift`）？这些新类型是否也需要进知识库？如果需要，`KnowledgeService` 的事件订阅模型是否需要重构为更通用的"外部事件 → 知识条目"管道。

3. **商品消息的实时优先注入**：Phase 4 需要"临时高优先级商品消息优先于长期知识"，当前 `liveContext` 已支持 priority + TTL。Phase 4 前的 RAG Foundation 是否需要提前设计好"商品消息 TTL 策略"（多久过期、谁来触发清理），还是保持现状等 Phase 4 再细化？

4. **持久化粒度**：`KnowledgeConfig` 是存成 `entries[]` 整体持久化，还是每条单独存储（方便后续热更新单条）？这影响 `config-service.ts` 的写入策略。

5. **Prompt 截断重校准**：`buildSystemMessage()` 的截断逻辑（`MAX_KNOWLEDGE_CHARS = 12000`）在第一轮升级为检索结果注入后，需要重新确定阈值。需要与 LLM API 的 context window 大小（GPT-4o mini 128k，GPT-4o 128k）配合考虑。
