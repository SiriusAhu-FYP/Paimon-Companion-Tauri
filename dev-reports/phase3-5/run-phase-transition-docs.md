# Phase 3.5 Close-out + Phase 4 Kickoff 文档整理

## 本次目标

完成 Phase 3.5 → Phase 4 的阶段切换文档：
1. Phase 3.5 Close-out 总结
2. Phase 4 B 站接入方式技术调研
3. Phase 4 Kickoff Blueprint

## 本次产出文档

| 文档 | 路径 | 说明 |
|------|------|------|
| Phase 3.5 Close-out | `dev-reports/phase3-5/close-out.md` | 阶段总结与交接文档 |
| B 站连接方式研究 | `docs/research/phase4-bilibili-connection-research.md` | B 站 WebSocket 协议、认证方式、npm 库、Tauri 兼容性分析 |
| Phase 4 Blueprint | `blueprints/phase4/bilibili-minimum-integration.md` | Phase 4 正式 Kickoff 文档 |
| Phase 3.5 README 更新 | `blueprints/phase3-5/README.md` | 补齐 Run 03 和 close-out 引用 |

## 关键结论

### Phase 3.5 状态

**Close-out ready，带已知 debt。**

- 蓝图验收标准 5 项全部满足
- Run 01（语义检索）+ Run 02（Rerank）已 accepted
- Run 03（行为约束 + 知识 UX）代码就位，待手测
- 已知 debt 均有降级方案，不阻塞 Phase 4

### Phase 4 建议起步方式

1. 先做一个极小的 Spike（0.5–1 天），验证 Tauri WebView 中 WebSocket 到 B 站的连通性
2. 如通过，进入 Run 01 正式实施（B 站最小弹幕接入，2–3 天）
3. 如不通，转为 Rust 代理方案（增加约 1 天）

### Phase 4 最大的技术未知点

**Tauri WebView 中 WebSocket 到 B 站的连通性。** 这是决定实施路径的关键因素：直接 TS 层连接 vs Rust 代理。

### B 站接入方式总结

- 匿名 WebSocket 连接（`uid: 0`），无需登录或开放平台审核
- protover=2（zlib 压缩），需 `pako` 解压
- 最小消息类型：`DANMU_MSG`（弹幕）+ `SEND_GIFT`（礼物）
- 通过 `ExternalInputService.injectEvent()` 注入，完全复用现有事件链路

## 测试

- 本轮为纯文档产出，无代码改动，无需测试

## 风险 / 待办

- Phase 4 Spike 验证是必做前置步骤
- Phase 3.5 Run 03 仍有手测 debt，不影响 Phase 4 启动

## 元信息

- Branch: `feature/phase3-5-rag-foundation`
- 报告路径: `dev-reports/phase3-5/run-phase-transition-docs.md`
