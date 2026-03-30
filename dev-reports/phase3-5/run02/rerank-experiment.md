# Rerank 实验记录 (rerankEnabled=true)

> 日期：2026-03-30
> 配置：rerankEnabled=true，searchMode=hybrid，recallTopK=20 → rerank topN=10 → finalTopK=5
> 知识数据：与 baseline 完全相同的商品知识
> Embedding 模型：DMXAPI text-embedding-3-small（与 baseline 相同）
> Rerank 模型：DMXAPI（具体模型待确认，qwen3-reranker-8b 或 bge-reranker-v2-m3-free）
> 环境：Tauri 桌面端（pnpm tauri dev）

## 实验结果

| # | Query | Top1 结果 | Score | 备注 |
|---|-------|----------|-------|------|
| Q1 | `派蒙 888元` | 派蒙PVC玩偶 | 0.9440 | 明显改善：baseline 排第一的是摆件礼盒 |
| Q2 | `派蒙玩偶价格` | 派蒙PVC玩偶 | 0.9638 | top1 不变，score 从 0.5888 → 0.9638，明显更稳 |
| Q3 | `888元 预购` | 派蒙PVC玩偶 | 0.9387 | 有改善：baseline 排摆件礼盒，两条都相关但 PVC 玩偶更匹配 888 元预购 |
| Q4 | `派蒙现货吗` | 原神Q版摆件礼盒 | 0.7404 | **明显误排**：baseline 排的是亚克力立牌（现货商品），rerank 反而排了摆件礼盒 |
| Q5 | `预购商品可以退吗` | 预购与售后说明 | 0.8876 | top1 不变，score 从 0.6522 → 0.8876，明显更稳 |
| Q6 | `888元的派蒙商品` | 派蒙PVC玩偶 | 0.9482 | 明显改善：baseline 排第一的是摆件礼盒 |
| Q7 | `派蒙周边推荐` | 派蒙PVC玩偶 | 0.8162 | top1 不变，score 从 0.2680 → 0.8162，明显更稳 |
| Q8 | `发货较晚的商品` | 原神Q版摆件礼盒 | 0.7619 | 明显改善：预购类商品发货较晚，摆件礼盒比售后说明更贴切 |

## 对比总结

| 指标 | Baseline | Rerank | 变化 |
|------|----------|--------|------|
| 明显改善 | — | 4/8 | Q1, Q3, Q6, Q8 |
| top1 不变但 score 增强 | — | 3/8 | Q2, Q5, Q7 |
| 明显误排 | — | 1/8 | Q4 |
| 平均 top1 score | 0.4905 | 0.8746 | +78.3% |

## 定性观察

- **排序质量变化**：rerank 显著提升了 score 区分度，baseline 的 score 集中在 0.27~0.65，rerank 后拉升到 0.74~0.96
- **噪声过滤效果**：涉及具体价格（888元）的 query，rerank 能更准确地把 PVC 玩偶（888元）排到第一
- **已知问题**：Q4（`派蒙现货吗`）出现明显误排——baseline 排的亚克力立牌（现货商品）反而比 rerank 排的摆件礼盒更合理
- **是否值得默认启用**：总体收益明显（7/8 条有改善或增强），但 Q4 的误排表明 rerank 模型在"现货"这类隐含属性匹配上存在盲区，建议保持默认关闭、用户手动启用

## 已知问题

### Q4 `派蒙现货吗` 误排

- Baseline top1：派蒙亚克力立牌（score 0.4090）— 该商品确实是现货
- Rerank top1：原神Q版摆件礼盒（score 0.7404）— 该商品不是现货（预购）
- 原因推测：rerank 模型对"派蒙"关键词的权重过高，导致"派蒙"相关但非现货的摆件礼盒被提前，而忽略了"现货"这个隐含条件
- 影响：单条 query 的排序退化，不影响整体链路可用性
- 缓解：可通过 `rerankEnabled=false` 一键关闭回退到 baseline 行为
