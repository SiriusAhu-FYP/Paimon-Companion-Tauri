# Phase 3 Run 05 — M3 角色与上下文层建立

## 概要

本次 run 完成了 M3 的全部核心任务：内部角色档案定义、SillyTavern V2 角色卡导入、LLM system prompt 动态组装、角色切换 UI、纯文本上下文注入 UI。完成后虚拟主播具备可切换的角色身份与基于上下文的回复能力。

## 完成的任务

### T1: CharacterProfile 类型定义 + 命名冲突清理
- 在 `src/types/character.ts` 中定义了新的 `CharacterProfile` 接口，包含 id、name、persona、scenario、firstMessage、messageExamples、systemPrompt、defaultEmotion、expressionMap、source 等字段
- 消除了两个同名 `CharacterConfig` 的冲突：
  - `@/types` 中的旧 `CharacterConfig` → 被 `CharacterProfile` 取代
  - `config/types.ts` 中的 → 重命名为 `CharacterSettingsConfig`（字段改为 `activeProfileId` + `customPersona`）
- 在 `config-service.ts` 中增加了旧版 `{ persona }` 格式到新版 `{ activeProfileId, customPersona }` 的向下兼容迁移逻辑

### T2: SillyTavern V2 JSON 卡解析器
- 新建 `src/services/character/card-parser.ts`
- 输入：SillyTavern `chara_card_v2` JSON 对象
- 输出：内部 `CharacterProfile`
- 映射策略：`description + personality → persona`，`scenario → scenario`，`first_mes → firstMessage`，`mes_example → messageExamples`，`system_prompt → systemPrompt`
- 不处理 `character_book`（lorebook）、`extensions`、`avatar` 等非核心字段

### T3: CharacterService 扩展 + 角色卡加载
- `CharacterService` 新增方法：`loadFromProfile()`、`getProfile()`、`getAvailableProfiles()`、`findProfileById()`、`refreshCatalogFromPublic()`
- 新建 `src/services/character/character-cards.ts`：从 `public/cards/cards-manifest.json` 拉取角色卡列表，逐个 fetch + 解析为 `CharacterProfile`
- 将 `cards/` 下两张测试角色卡复制到 `public/cards/`，并创建了 `cards-manifest.json`
- `main.tsx` 启动时自动扫描角色卡目录，如有持久化的 `activeProfileId` 则自动恢复对应角色

### T4: PromptBuilder 组装器
- 新建 `src/services/llm/prompt-builder.ts`
- `buildSystemMessage()` 按优先级拼装 system prompt：
  1. 角色卡自带 system_prompt
  2. 角色人设 (persona)
  3. 场景/世界观 (scenario)
  4. 设置面板自定义附加人设 (customPersona)
  5. 商品资料 + 运营/直播上下文 (knowledgeContext)
- 知识上下文超过 12000 字符时自动截断
- `summarizePromptContext()` 输出调试摘要

### T5: LLMService 接入 system prompt
- `LLMService` 构造函数新增 `CharacterService` 和 `KnowledgeService` 依赖
- `sendMessage()` 在每次请求前动态生成 system 消息并前置到 `messages` 数组
- system 消息不进入 `this.history`，确保角色/上下文变更后历史不失效
- `services/index.ts` 中的 `initServices()` 已同步传入新依赖

### T6: 角色切换 UI
- 在 `ControlPanel` 中增加 MUI `Select` 下拉选择器
- 列出 `public/cards/` 中解析到的所有角色卡 + 一个"默认（手动人设）"选项
- 切换角色时：加载新档案到 `CharacterService`、清空 LLM 历史、持久化 `activeProfileId`
- 重启后自动恢复上次选中的角色

### T7: 上下文注入 UI
- 在 `ControlPanel` 中增加两个文本输入区：
  - **商品/资料**：注入后调用 `KnowledgeService.addKnowledge()`
  - **运营口径/直播上下文**：注入后调用 `KnowledgeService.addLiveContext()`
- 提供「清空全部注入」按钮
- `KnowledgeService` 新增 `clearLongTermKnowledge()` 和 `clearLiveContext()` 方法
- 注入的内容通过 `getAssembledContext()` 在每次 LLM 请求时自动进入 system prompt

## 关键改动文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/types/character.ts` | 重写 | 定义 `CharacterProfile`，移除旧 `CharacterConfig` |
| `src/types/index.ts` | 修改 | 导出 `CharacterProfile` 替代 `CharacterConfig` |
| `src/services/config/types.ts` | 修改 | `CharacterConfig` → `CharacterSettingsConfig` |
| `src/services/config/config-service.ts` | 修改 | 增加旧版配置兼容迁移 |
| `src/services/config/index.ts` | 修改 | 导出名更新 |
| `src/services/character/card-parser.ts` | 新增 | SillyTavern V2 JSON 解析器 |
| `src/services/character/character-cards.ts` | 新增 | 角色卡扫描与加载 |
| `src/services/character/character-service.ts` | 重写 | 扩展为完整角色管理服务 |
| `src/services/character/index.ts` | 修改 | 新增导出 |
| `src/services/llm/prompt-builder.ts` | 新增 | System prompt 动态组装器 |
| `src/services/llm/llm-service.ts` | 修改 | 接入 system prompt 注入 |
| `src/services/llm/index.ts` | 修改 | 新增导出 |
| `src/services/knowledge/knowledge-service.ts` | 修改 | 新增 clear 方法 |
| `src/services/index.ts` | 修改 | LLMService 构造函数增加依赖 |
| `src/main.tsx` | 修改 | 启动时扫描角色卡、恢复选中角色 |
| `src/utils/mock.ts` | 重写 | `CharacterConfig` → `CharacterProfile` |
| `src/features/control-panel/ControlPanel.tsx` | 重写 | 角色切换 + 上下文注入 UI |
| `src/features/settings/SettingsPanel.tsx` | 修改 | `persona` → `customPersona` |
| `public/cards/` | 新增 | 角色卡目录 + manifest |

## 验证结果

| 项目 | 结果 |
|------|------|
| TypeScript 编译 | 通过，无错误 |
| Vite 构建 | 通过，无错误 |
| 两张角色卡解析 | 代码路径完整（Paimon + Ganyu） |
| System prompt 注入 | LLMService 动态组装并前置 system 消息 |
| Mock LLM 兼容 | Mock provider 忽略 messages 参数，不受影响 |
| 角色切换持久化 | `activeProfileId` 通过 `updateConfig` 持久化 |
| 命名冲突消除 | 无重复的 `CharacterConfig` |

## 当前限制

- 角色卡中的 `character_book`（lorebook）不解析
- 角色卡中的 `avatar` 不渲染
- 上下文注入为纯内存、不持久化
- 知识上下文截断策略为简单字符数截断（非 token 精确计算）
- Mock LLM 不感知 system prompt 内容，无法验证风格差异（需真实 LLM 验证）

## 分支

`feature/phase3-integration`
