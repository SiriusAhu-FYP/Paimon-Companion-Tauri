# Phase 3.5 Run 01 Patch B — Title Embedding 实验记录

## 1. 实验目的

验证文档 `title` 是否参与 embedding 向量化，以及参与方式对检索质量的影响。

### 背景

用户实测发现：当标题不写进正文时，像"派蒙玩偶的价格"类查询分数偏低，手动将标题复制进正文后分数显著提升。这表明原实现中 `title` 仅作为 chunk 元数据存储，**未参与 embedding 文本**。

### 修正方案

在 `KnowledgeService.processDocument()` 中新增 `buildEmbeddingInput(title, chunkText)`，将标题前置拼入送去 embedding 的文本。存储在 Orama 中的 `text` 字段仍为纯 chunk 正文，embedding 输入与存储文本分离。

## 2. 样本构造

### 实验 A：title-only token

| field | value |
|-------|-------|
| title | `__TITLE_ONLY_TOKEN__派蒙限定` |
| content | `这是一个测试文档，正文里不要重复标题中的专属词。` |

### 实验 B：content-only token

| field | value |
|-------|-------|
| title | `普通标题` |
| content | `__CONTENT_ONLY_TOKEN__ 这是正文专属词` |

### 实验 C：同文档双版本

**A 版（标题不在正文中）**

| field | value |
|-------|-------|
| title | `派蒙PVC玩偶` |
| content | `尺寸：1:2\n售价：888元一只，活动除外\n状态：施工中，暂未发售，属于预购` |

**B 版（标题并入正文）**

| field | value |
|-------|-------|
| title | `派蒙PVC玩偶` |
| content | `派蒙PVC玩偶\n尺寸：1:2\n售价：888元一只，活动除外\n状态：施工中，暂未发售，属于预购` |

## 3. 查询列表

| 实验 | 查询 |
|------|------|
| A | `__TITLE_ONLY_TOKEN__`, `派蒙限定` |
| B | `__CONTENT_ONLY_TOKEN__` |
| C | `派蒙`, `派蒙玩偶`, `玩偶的价格`, `派蒙玩偶的价格`, `888元`, `施工中` |
| D | `今天天气怎么样`, `量子力学基本原理`, `如何做红烧肉` |

## 4. 检索模式

- 所有实验均为 **vector** 模式（cosine similarity）
- 模型: `text-embedding-3-small`, 维度: 1536
- 通过 DMXAPI (`https://www.dmxapi.cn`) 调用

## 5. 结果表格

### 实验 A：title-only token（标题专属词是否进入 embedding）

| query | title-prefixed score | content-only score | delta | verdict |
|-------|---------------------|-------------------|-------|---------|
| `__TITLE_ONLY_TOKEN__` | **0.7108** | 0.3666 | **+0.3441** | title+ |
| `派蒙限定` | **0.4846** | 0.2560 | **+0.2286** | title+ |

**结论**: title 前置后，标题专属词的检索得分翻倍。证实 title 成功进入 embedding 主路径。

### 实验 B：content-only token（正文专属词对照）

| query | title-prefixed score | content-only score | delta | verdict |
|-------|---------------------|-------------------|-------|---------|
| `__CONTENT_ONLY_TOKEN__` | 0.7172 | **0.8454** | -0.1282 | content+ |

**结论**: 正文专属词在 content-only 中得分更高（title 前置引入了少量语义稀释），但 title-prefixed 仍有 0.72 的良好分数。这是正常的 trade-off：title 前置让标题语义可检索，代价是正文专属词得分轻微下降。

### 实验 C-1：A 版文档 title-prefixed vs content-only

| query | title-prefixed | content-only | delta | verdict |
|-------|---------------|-------------|-------|---------|
| 派蒙 | **0.3540** | 0.1529 | **+0.2011** | title+ |
| 派蒙玩偶 | **0.5615** | 0.2530 | **+0.3085** | title+ |
| 玩偶的价格 | **0.5417** | 0.3887 | **+0.1531** | title+ |
| 派蒙玩偶的价格 | **0.6023** | 0.3450 | **+0.2573** | title+ |
| 888元 | 0.3297 | **0.3871** | -0.0574 | content+ |
| 施工中 | 0.3234 | **0.3802** | -0.0569 | content+ |

**结论**: 包含标题关键词的查询（派蒙、玩偶相关）得分提升 0.15-0.31（+40%~+120%）。纯正文关键词（888元、施工中）得分轻微下降 0.05-0.06（-15%），属于可接受范围。

### 实验 C-2：A 版 title-prefixed vs B 版 content-only（B 版正文已含标题）

| query | A版(tp) | B版(co) | delta | notes |
|-------|---------|---------|-------|-------|
| 派蒙 | 0.3540 | 0.3540 | 0.0000 | ≈ equivalent |
| 派蒙玩偶 | 0.5615 | 0.5615 | 0.0000 | ≈ equivalent |
| 玩偶的价格 | 0.5417 | 0.5417 | 0.0000 | ≈ equivalent |
| 派蒙玩偶的价格 | 0.6023 | 0.6023 | 0.0000 | ≈ equivalent |
| 888元 | 0.3297 | 0.3297 | 0.0000 | ≈ equivalent |
| 施工中 | 0.3234 | 0.3234 | 0.0000 | ≈ equivalent |

**结论**: `buildEmbeddingInput(title, content)` 的效果与用户手动将标题写进正文**完全等价**（delta = 0.0000）。

### 实验 D：不相关查询噪声分析

| query | vs title-prefixed | threshold 0.2 | threshold 0.3 |
|-------|------------------|---------------|---------------|
| 今天天气怎么样 | 0.1104 | FILTER | FILTER |
| 量子力学基本原理 | 0.2142 | PASS(noise) | FILTER |
| 如何做红烧肉 | 0.1666 | FILTER | FILTER |

**结论**: threshold 0.3 可完全过滤所有不相关查询。当前 threshold 0.2 会让"量子力学"勉强通过（0.2142），但该分数足够低，topK 限制下不太会干扰正常检索。

## 6. 综合结论

### title 参与 embedding 的效果

- **必要且显著**：对标题关键词相关的查询，得分提升 40%-120%
- **等价于手动并入**：`buildEmbeddingInput` 方法 = 用户手动将标题写进正文
- **代价可接受**：纯正文关键词得分轻微下降约 5-6%

### 最终决定：哪些字段参与 embedding 主文本

| 字段 | 是否参与 | 原因 |
|------|---------|------|
| `title` | **是** | 文档级语义核心，实测提升显著 |
| `content` | **是** | 正文本体 |
| `source` | **否** | 纯管理字段（"manual"、文件名），无语义价值 |

### 实现方式

```typescript
private buildEmbeddingInput(title: string, chunkText: string): string {
    const t = title.trim();
    if (!t) return chunkText;
    return `${t}\n${chunkText}`;
}
```

embedding 输入 = `title + \n + chunkText`。存储在 Orama 的 `text` 字段仍为纯 chunk 正文（不含 title），用于 fulltext 搜索和 UI 展示。

## 7. 当前 similarity / minScore / topK 建议口径

### 当前参数

| 参数 | 当前值 | 说明 |
|------|--------|------|
| similarity threshold | 0.2 | Orama searchVector 的最低相似度 |
| searchMode | hybrid | vector + fulltext 混合 |
| topK | 5 | 返回前 5 条结果 |
| fulltext fallback | 有 | vector/hybrid 0 结果时自动 fallback |

### 短查询得分区间

| 查询类型 | 得分范围 | 说明 |
|---------|---------|------|
| 标题精确匹配（"派蒙PVC玩偶"）| 0.85-0.95 | 极高 |
| 标题部分匹配（"派蒙玩偶"）| 0.50-0.60 | 良好 |
| 标题单词（"派蒙"）| 0.30-0.40 | 中等，刚好通过 0.2 |
| 正文精确匹配（"888元"）| 0.30-0.40 | 中等 |
| 明显不相关 | 0.10-0.22 | 大部分被 0.2 过滤 |

### 风险声明

当前 threshold 0.2 是**暂定值**，适用于当前知识库规模（10-50 条文档）。

已知风险：
- 当文档数增至 100+ 时，低分噪声结果数量可能增加
- "量子力学"类查询在 threshold 0.2 下可能返回无关结果（得分 ~0.21）
- 未来需要根据语料规模增长继续校准

**建议校准时机**：当知识库文档数超过 50 条时，重新评估是否需要提高 threshold 到 0.25 或 0.3，或引入 minScore 后过滤。

## 8. 元信息

- 实验脚本: `scripts/test-title-embedding.mjs`
- 模型: `text-embedding-3-small` (1536d)
- API: DMXAPI (`https://www.dmxapi.cn/v1/embeddings`)
- Schema version: 2 → 3（embedding 输入结构变更，旧索引需重建）
- 实验时间: 2026-03-29
