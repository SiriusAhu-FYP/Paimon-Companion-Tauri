# Baseline 实验记录 (rerankEnabled=false)

> 日期：待手测时填写
> 配置：rerankEnabled=false，searchMode=hybrid，recallTopK=5（无 rerank 时直接取 finalTopK）
> 知识数据：sample-knowledge.json（5 条文档）
> Embedding 模型：待填写（如 text-embedding-3-small）

## 标准 Query 样本

| # | Query | Top1 命中 | Recall@5 | top5 scores | 噪声结果数 | 检索延迟(ms) | rerank 延迟(ms) |
|---|-------|----------|----------|-------------|-----------|-------------|----------------|
| Q1 | "有什么好看的手办推荐吗？" | | | | | | N/A |
| Q2 | "退货怎么退？" | | | | | | N/A |
| Q3 | "直播今天晚上几点开始？" | | | | | | N/A |
| Q4 | "派蒙喜欢吃什么？" | | | | | | N/A |
| Q5 | "当前主推什么商品？价格多少？" | | | | | | N/A |
| Q6 | "原神摆件有什么款式可选？" | | | | | | N/A |
| Q7 | "商品支持定制吗？" | | | | | | N/A |
| Q8 | "怎么联系客服？" | | | | | | N/A |

## 预期命中文档参考

| Query | 预期最佳匹配文档 |
|-------|-----------------|
| Q1 | product-genshin-figure |
| Q2 | text-return-policy |
| Q3 | faq-livestream-schedule |
| Q4 | faq-paimon-who（间接相关）|
| Q5 | product-genshin-figure 或 product-genshin-keychain |
| Q6 | product-genshin-figure |
| Q7 | text-return-policy（部分匹配）|
| Q8 | 无精确匹配（噪声测试）|

## 备注

- 每个 query 在搜索验证框中执行，记录返回的 top5 结果
- score 取 Orama 原始 score（4 位小数）
- 检索延迟通过 console 日志中的 knowledge 模块 log 获取
- Q4 和 Q8 是噪声测试：知识库中不包含直接答案
