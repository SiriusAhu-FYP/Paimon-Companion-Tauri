# 2026-03-29 角色卡切换修复 + 知识库搜索优化

## 本次完成了什么

### 1. 角色卡切换不生效修复

**根因**: `prompt-builder.ts` 中 `customPersona`（默认值"你是旅行者的好伙伴派蒙"）与角色卡内的 persona 同时注入 system prompt，导致切换到非派蒙角色后，LLM 仍受 Paimon 人设影响。

**修复**: 当角色卡已有 `persona` 或 `systemPrompt` 时，不再注入 `customPersona`，避免冲突。仅在使用"手动人设"（无角色卡）时才注入 `customPersona`。

### 2. 角色切换 UI 改进

将 ControlPanel 中角色选择的"当前角色"标签替换为"当前读取：xxx"格式，与 LLM/TTS 档案选择的 UI 风格保持一致。移除了冗余的 Chip 显示。

### 3. 知识库向量搜索修复

**根因定位（通过自动化测试验证）**:
- `text-embedding-3-small` 对短查询词（如"派蒙"、"888元"）与文档的 cosine similarity 仅 0.32 左右
- 之前的 Orama similarity 阈值 0.5 过高，导致所有短查询返回 0 结果
- `.com` 域名的 DMXAPI 返回 401，只有 `.cn` 域名可用

**修复措施**:
- similarity 阈值从 0.5 降至 0.2，让 topK 控制返回数量
- 新增 fulltext fallback：当 vector/hybrid 搜索返回 0 结果时，自动退回到全文搜索
- 默认搜索模式从 `vector` 改为 `hybrid`，同时利用文本精确匹配和向量语义匹配

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/services/llm/prompt-builder.ts` | 角色卡有 persona/systemPrompt 时跳过 customPersona |
| `src/features/control-panel/ControlPanel.tsx` | UI：角色选择改为"当前读取：..." |
| `src/services/knowledge/orama-store.ts` | similarity 阈值 0.5→0.2 + fulltext fallback |
| `src/types/knowledge.ts` | 默认搜索模式 vector→hybrid |

## 测试

### 自动化测试（scripts/test-embedding.mjs + test-knowledge-e2e.mjs）

| 查询 | vector(0.5) | vector(0.2) | hybrid(0.2) |
|------|-------------|-------------|-------------|
| "派蒙" | 0 hits ✗ | 2 hits ✓ | 2 hits ✓ |
| "888元" | 0 hits ✗ | 3 hits | 3 hits ✓ (0.976) |
| "玩偶价格" | 1 hit ✓ | 3 hits ✓ | 3 hits ✓ |
| "甘雨" | 1 hit ✓ | 1 hit ✓ | 1 hit ✓ |
| "限量礼盒" | 1 hit ✓ | 3 hits ✓ | 3 hits ✓ |

### 构建验证
- `tsc --noEmit` 通过
- `vite build` 通过

## 风险与注意事项

1. similarity 阈值降至 0.2 后，不相关查询可能返回低分噪声结果（如"今天天气怎么样"→1条低分结果），但不影响 LLM 使用效果
2. 用户需确认 Embedding 档案的 Base URL 使用 `https://www.dmxapi.cn` 而非 `.com`
3. 角色卡切换后需清空 LLM 历史才能完全生效（代码中已自动调用 `llm.clearHistory()`）
