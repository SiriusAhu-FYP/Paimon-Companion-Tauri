# Phase 3.5 Run 03 — Behavior Constraints & Knowledge Input UX

## 本轮目标

1. **Behavior Constraints Layer**：在 system prompt 最前面注入全局行为约束，防止角色卡诱发不适合直播的输出模式
2. **Knowledge Input UX**：将知识录入从"能用但不友好"推进到"可理解、可测试、可导入"

---

## 本轮实际完成内容

| 任务 | 内容 | 状态 |
|------|------|------|
| T1 | Config 扩展：`BehaviorConstraintsConfig` 类型 + 默认值 + deepMerge | ✅ |
| T2 | prompt-builder 改造：位置 0 插入【直播行为约束】段落 | ✅ |
| T3 | llm-service 传参：读取 `behaviorConstraints` 并传入 `PromptContext` | ✅ |
| T4 | SettingsPanel UI：「直播行为约束」配置区（启用开关 + 字数上限 + 自定义规则） | ✅ |
| T5 | KnowledgePanel：drag-and-drop 文件导入区域 | ✅ |
| T6 | KnowledgePanel：dual-mode input（简洁模式 / JSON 模式切换） | ✅ |
| T7 | KnowledgePanel：可展开示例模板 + 复制到剪贴板 | ✅ |
| T8 | KnowledgePanel：字段引导（helperText）+ JSON 实时验证 + 索引文本说明 | ✅ |
| T9 | 编译验证 + 本报告 | ✅ |

---

## 关键实现点

### A 线：Behavior Constraints Layer

#### 组装位置与优先级

system prompt 组装顺序变为：

```
0. 【直播行为约束】   ← 新增，最高优先级
1. 【角色系统指令】
2. 【角色设定】
3. 【场景与世界观】
4. 【附加人设】
5. 【当前商品与直播上下文】
6.  结尾指令
```

位置 0 确保 LLM 对行为约束的遵从度最高。约束只管格式/风格/长度，不覆盖角色性格。

#### 约束内容（默认启用）

1. 回复字数上限（默认 150，可配置 20~500）
2. 禁止 `*...*` / `(...)` 括号动作描写
3. 禁止场景描述/旁白叙述/舞台说明
4. 口语化风格，适合 TTS 播报
5. 用户可追加自定义规则

#### 配置结构

```typescript
interface BehaviorConstraintsConfig {
  enabled: boolean;        // 默认 true
  maxReplyLength: number;  // 默认 150
  customRules: string;     // 用户追加规则
}
```

存放于 `AppConfig.character.behaviorConstraints`，通过 `updateConfig` 持久化。

### B 线：Knowledge Input UX

#### Drop Zone

- 虚线边框区域，支持拖拽 `.json` 文件
- 点击区域等同于 file picker
- 1MB 文件大小保护
- 拖拽时视觉反馈（边框高亮 + 背景变色）

#### Dual-mode Input

| 模式 | 用途 | 特点 |
|------|------|------|
| 简洁模式 | 单条知识添加 | title + content 两个 TextField，带 helperText 解释索引关系 |
| JSON 模式 | 批量导入 | monospace 编辑框，实时验证，解析成功显示文档数 |

两个模式通过 Tab 切换，状态独立。

#### JSON 模式收紧（用户要求）

- 编辑框默认为空（不预填带注释的模板）
- 字段说明放在可展开的模板说明区
- 模板内容是合法 JSON，可一键复制

#### 索引文本说明

在导入区下方增加统一说明：

> **title** 和 **content** 均参与语义检索。title 作为前缀拼入每个文本块的 embedding 输入，同时也作为 Orama 全文索引的独立字段。id / source / category 不参与检索，仅用于标识和展示。

#### title/content 索引文本组织方式（收紧确认）

当前实现中 title 参与检索的方式：

| 路径 | 构造方式 | 说明 |
|------|----------|------|
| Embedding 输入 | `buildEmbeddingInput(title, chunk)` → `title + "\n" + chunk` | 统一函数，title 作为前缀 |
| Orama `text` 字段 | 存纯 chunk 正文 | Orama 全文搜索时 `text` 和 `title` 分别作为独立 string 字段被索引 |
| Orama `title` 字段 | 存原始 title | Orama 默认对所有 string 字段建全文索引 |

两条路径的设计是有意的：embedding 需要 title 提供文档级语义上下文，Orama fulltext 则通过独立字段索引。`buildEmbeddingInput()` 是唯一的 embedding 文本构造函数，无漂移风险。

---

## 改动文件清单

### A 线

| 文件 | 改动 |
|------|------|
| `src/services/config/types.ts` | 新增 `BehaviorConstraintsConfig` 接口 + `CharacterSettingsConfig` 扩展 + 默认值 |
| `src/services/config/config-service.ts` | `deepMerge` 深合并 `behaviorConstraints` + `normalizeCharacterSettings` 兼容 |
| `src/services/config/index.ts` | 导出 `BehaviorConstraintsConfig` 类型 |
| `src/services/llm/prompt-builder.ts` | `PromptContext` 扩展 + `buildBehaviorConstraintsSection()` + 位置 0 插入 |
| `src/services/llm/llm-service.ts` | `sendMessage()` 读取 `behaviorConstraints` 传入 |
| `src/features/settings/SettingsPanel.tsx` | 新增「直播行为约束」配置 UI section |

### B 线

| 文件 | 改动 |
|------|------|
| `src/features/knowledge/KnowledgePanel.tsx` | drop zone + dual-mode + 模板 + 验证 + 字段引导 |

### 明确未动的文件

Pipeline / CharacterService / Stage / Live2D / TTS / OBS / ControlPanel / EventBus — 全部未动。

---

## 验证状态

| 层次 | 状态 |
|------|------|
| TypeScript 编译 | ✅ 零错误 |
| Vite build | ✅ 零错误 |
| Lint | ✅ 零错误 |
| A 线手测 | ⏳ 待验证：约束是否有效压住角色卡的动作描写 |
| B 线手测 | ⏳ 待验证：拖拽导入、JSON 模式验证、简洁模式添加 |

---

## 验收 Checklist

### A 线

| # | 验收项 | 状态 |
|---|--------|------|
| A1 | 行为约束在 system prompt 最前面 | ⏳ 查 console 日志 |
| A2 | sanitized paimon 卡回复无 `*...*` 动作 | ⏳ 手测 |
| A3 | 回复不超过约束字数 | ⏳ 手测 |
| A4 | 禁用约束后恢复原始行为 | ⏳ 手测 |
| A5 | maxReplyLength 修改后生效 | ⏳ 手测 |
| A6 | customRules 追加规则生效 | ⏳ 手测 |
| A7 | 不破坏现有链路 | ⏳ 回归 |

### B 线

| # | 验收项 | 状态 |
|---|--------|------|
| B1 | 拖拽 JSON 文件成功导入 | ⏳ 手测 |
| B2 | 点击 drop zone 文件选择器导入 | ⏳ 手测 |
| B3 | 简洁模式 helperText 正确显示 | ⏳ 手测 |
| B4 | JSON 模式粘贴合法 JSON 成功导入 | ⏳ 手测 |
| B5 | JSON 模式非法 JSON 报错提示 | ⏳ 手测 |
| B6 | 示例模板展开 + 复制 | ⏳ 手测 |
| B7 | 编译通过 | ✅ |

---

## 已知限制

| 限制 | 说明 |
|------|------|
| 行为约束是 LLM 指令，非强制 | LLM 可能偶尔违反，特别是角色卡中有很强的 RP 倾向时 |
| maxReplyLength 是建议值 | LLM 不一定精确遵守字数上限，但会明显缩短回复 |
| Tauri webview 拖拽兼容性 | 部分 Tauri 版本可能需要额外 allowlist 配置；file picker 作为 fallback |

---

## 本轮状态

**`implemented but not yet accepted`**

代码实现已就位，编译验证通过。需要人工手测行为约束效果和知识录入 UX。

---

## 元信息

- Commits: `2b0dbf9` (A 线), `a04951d` (B 线)
- Branch: `feature/phase3-5-rag-foundation`
- 报告路径: `dev-reports/phase3-5/run03/run03-behavior-constraints-and-knowledge-ux.md`
