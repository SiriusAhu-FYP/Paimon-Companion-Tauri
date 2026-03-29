# Rerank 实验记录 (rerankEnabled=true)

> 日期：待手测时填写
> 配置：rerankEnabled=true，searchMode=hybrid，recallTopK=20 → rerank topN=10 → finalTopK=5
> 知识数据：sample-knowledge.json（5 条文档）— 与 baseline 使用同一批数据
> Embedding 模型：待填写（与 baseline 相同）
> Rerank 模型：待填写（如 qwen3-reranker-8b 或 bge-reranker-v2-m3-free）

## 标准 Query 样本

使用与 baseline 完全相同的 Q1-Q8 样本。

| # | Query | Top1 命中 | Recall@5 | top5 scores | 噪声结果数 | 检索延迟(ms) | rerank 延迟(ms) |
|---|-------|----------|----------|-------------|-----------|-------------|----------------|
| Q1 | "有什么好看的手办推荐吗？" | | | | | | |
| Q2 | "退货怎么退？" | | | | | | |
| Q3 | "直播今天晚上几点开始？" | | | | | | |
| Q4 | "派蒙喜欢吃什么？" | | | | | | |
| Q5 | "当前主推什么商品？价格多少？" | | | | | | |
| Q6 | "原神摆件有什么款式可选？" | | | | | | |
| Q7 | "商品支持定制吗？" | | | | | | |
| Q8 | "怎么联系客服？" | | | | | | |

## 对比总结

| 指标 | Baseline | Rerank | 变化 |
|------|----------|--------|------|
| Top1 命中率 | /8 | /8 | |
| Recall@5 命中率 | /8 | /8 | |
| 平均噪声结果数 | | | |
| 平均检索延迟(ms) | | | |
| 平均 rerank 延迟(ms) | N/A | | |
| 总平均延迟(ms) | | | |

## 定性观察

- 排序质量变化：
- 噪声过滤效果：
- 延迟影响：
- 是否值得默认启用：

## 备注

- 使用与 baseline 完全相同的知识数据、相同的 query 样本、相同的记录字段
- rerank 延迟单独记录（从 console 日志中 "rerank done: ... Xms" 获取）
- 检索延迟 = 总延迟（含 embedding + recall + rerank）
- score 取 rerank relevanceScore（rerank 后的分数，非 Orama 原始分数）
