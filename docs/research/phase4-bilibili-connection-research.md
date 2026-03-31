# Phase 4 B 站接入方式研究

> **文档定位**: Phase 4 启动前的技术调研文档，记录 B 站直播弹幕 WebSocket 接入方式的关键约束与方案选型。
> 与 `phase4-round1-observation.md` 的区别：上一份是对仓库现有架构的能力审计，本文档聚焦于 B 站侧的技术约束和具体接入方案。

---

## 1. B 站直播弹幕 WebSocket 协议摘要

### 1.1 连接地址

```
wss://broadcastlv.chat.bilibili.com/sub
```

### 1.2 连接流程

```
1. 获取真实房间号：GET https://api.live.bilibili.com/room/v1/Room/room_init?id={短号或长号}
   └→ 响应中 data.room_id 为真实房间号（短号与长号不同）

2. 建立 WebSocket 连接到 wss://broadcastlv.chat.bilibili.com/sub

3. 5 秒内发送认证包（二进制）
   └→ 包含：uid, roomid, protover, platform, clientver

4. 收到服务端认证成功响应（operation=8）

5. 每 30 秒发送心跳包（operation=2）

6. 持续接收弹幕/礼物/SC 等消息
```

### 1.3 数据包格式

所有通信使用**二进制包**，16 字节定长头部（big-endian）：

| 偏移 | 长度 | 含义 |
|------|------|------|
| 0 | 4 bytes | 总包长度 |
| 4 | 2 bytes | 头部长度（固定 16） |
| 6 | 2 bytes | 协议版本（protover） |
| 8 | 4 bytes | 操作码（operation） |
| 12 | 4 bytes | 序列号（通常为 1） |

操作码：

| 操作码 | 方向 | 含义 |
|--------|------|------|
| 2 | 客户端→服务端 | 心跳 |
| 3 | 服务端→客户端 | 心跳响应（在线人数） |
| 5 | 服务端→客户端 | 消息通知（弹幕/礼物等） |
| 7 | 客户端→服务端 | 认证 |
| 8 | 服务端→客户端 | 认证响应 |

### 1.4 协议版本与压缩

| protover | 压缩方式 | 说明 |
|----------|----------|------|
| 0 | 无压缩 | 纯 JSON |
| 1 | 无压缩 | 含心跳人数 |
| 2 | zlib deflate | 常用，需解压后逐包解析 |
| 3 | brotli | 较新，需 brotli 解压 |

### 1.5 认证方式

**关键发现：匿名连接可行。**

认证包内容（JSON，encode 为二进制体）：
```json
{
  "uid": 0,
  "roomid": 12345,
  "protover": 2,
  "platform": "web",
  "clientver": "1.4.0"
}
```

- `uid: 0` 表示匿名用户，**不需要 Cookie、Token 或登录态**
- 仅能接收弹幕/礼物等消息，不能发送弹幕
- 对于本项目需求（接收弹幕作为 LLM 输入），匿名连接完全够用

### 1.6 关键消息类型（Phase 4 最小版所需）

| cmd | 含义 | Phase 4 需要？ |
|-----|------|----------------|
| `DANMU_MSG` | 普通弹幕 | ✅ 必须 |
| `SEND_GIFT` | 礼物 | ✅ 建议 |
| `SUPER_CHAT_MESSAGE` | 醒目留言（SC） | 可选（优先级高于普通弹幕） |
| `INTERACT_WORD` | 进入房间 | ❌ 不做 |
| `ENTRY_EFFECT` | 入场特效 | ❌ 不做 |
| `GUARD_BUY` | 大航海 | ❌ 不做 |

---

## 2. 可用的 npm 库

### 2.1 bilibili-live-ws

| 维度 | 信息 |
|------|------|
| 包名 | `bilibili-live-ws` |
| 版本 | 6.3.1 |
| 作者 | simon300000 |
| Stars | 325 |
| 浏览器支持 | **实验性**，有 `bilibili-live-ws/browser` 入口 |
| 功能 | LiveWS（WebSocket）+ LiveTCP（TCP）+ KeepLive（自动重连） |
| 心跳 | 自动管理 |

### 2.2 bilibili-live-danmaku

| 维度 | 信息 |
|------|------|
| 包名 | `bilibili-live-danmaku` |
| 版本 | 0.7.15（2026-02-14） |
| 浏览器支持 | **支持浏览器和服务端 JS** |
| 功能 | WebSocket API，多 protover 支持 |
| 心跳 | 自动管理 |
| 更新频率 | 活跃（2026 年仍在更新） |

### 2.3 自行实现

考虑到协议相对简单（认证 + 心跳 + 消息解析），且现有库的浏览器兼容性标注为"实验性"，存在以下选择：

| 方案 | 优势 | 劣势 |
|------|------|------|
| 用 `bilibili-live-danmaku` | 最新版，声明支持浏览器 | 依赖三方包，可能有隐含 Node.js 依赖 |
| 用 `bilibili-live-ws` | 较成熟，API 设计好 | 浏览器支持标注"实验性" |
| 自行实现 | 完全控制，零额外依赖 | 需处理二进制协议 + 压缩解码 |

**建议**：先尝试 `bilibili-live-danmaku`（最新、声明浏览器兼容），如果在 Tauri WebView 中遇到兼容问题则回退自行实现核心协议。

---

## 3. Tauri WebView 中 WebSocket 的可行性分析

### 3.1 标准 WebSocket

Tauri WebView 基于系统 WebView2（Windows）/ WKWebView（macOS），**原生支持标准 WebSocket API**（`new WebSocket(url)`）。这与浏览器中的行为一致。

### 3.2 潜在问题

| 问题 | 风险 | 分析 |
|------|------|------|
| CSP 限制 | 低 | Tauri 2.x 的 CSP 默认允许 `wss://` 连接；如被阻止，可在 `tauri.conf.json` 的 `security.csp` 中添加 |
| 二进制 WebSocket 帧 | 低 | WebView2 的 WebSocket 支持 `ArrayBuffer` 二进制帧，B 站协议所需的二进制包可正常收发 |
| zlib 解压 | 中 | 浏览器中没有原生 `zlib` 模块；需使用 `pako`（纯 JS zlib）或 `DecompressionStream` API |
| brotli 解压 | 中 | 如果使用 protover=3，需要 brotli 解压；浏览器中可用 `DecompressionStream('deflate')` 但不一定支持 brotli |
| 跨域 | 极低 | WebSocket 不受同源策略限制 |

### 3.3 压缩方案选择

**建议使用 protover=2（zlib deflate）**：
- `pako` 库（纯 JS，零原生依赖，17KB gzipped）可在 WebView 中直接运行
- 浏览器原生 `DecompressionStream` API 在 Chromium 80+ / WebView2 中可用
- 避免 brotli（protover=3）的额外依赖

### 3.4 是否需要走 Rust 代理

**结论：不需要，除非遇到兼容问题。**

B 站弹幕 WebSocket 是标准 `wss://` 连接，不涉及需要隐藏的 API Key，也不涉及跨域问题。直接在 TypeScript 层连接是最简单的方案。

只有在以下情况下才需要走 Rust 代理：
1. Tauri WebView 的 CSP 策略确实阻止了 `wss://broadcastlv.chat.bilibili.com`
2. 需要在 Rust 侧做更底层的网络控制（如 TCP 连接）

**建议**：Phase 4 Run 01 先做一个 spike 验证 WebSocket 在 Tauri WebView 中的连通性。如果通，全部在 TS 层实现；如果不通，再考虑 Rust 代理。

---

## 4. 当前仓库的接入点（与 Round 1 观察对照）

### 4.1 Round 1 观察结论是否仍成立

Round 1 观察报告（`phase4-round1-observation.md`）的核心结论：

> 当前仓库已具备 Phase 4 B 站最小接入的大部分基础设施。`ExternalInputService` + `EventBus` + `EventMap` 三件套已经形成了完整的"外部事件注入 → 总线分发 → 各服务消费"链路。

**验证结果：仍然成立。** Phase 3.5 的所有改动都未触碰 `ExternalInputService`、`EventBus`、`EventMap`。

### 4.2 具体接入点确认

| 组件 | 现状 | Phase 4 动作 |
|------|------|-------------|
| `ExternalInputService` | 有 `injectEvent` + `registerSource` + runtime 门控，无真实适配器 | 挂载 `BilibiliAdapter`，adapter 的 `onEvent` 指向 `injectEvent` |
| `EventMap` | 已定义 `external:danmaku` / `external:gift` / `external:product-message` | 无需修改（可能扩展 payload 字段） |
| `EventLog` | 已订阅三种外部事件 | 无需修改，弹幕会自动出现在事件日志中 |
| `KnowledgeService` | 已订阅 `external:product-message` | 无需修改 |
| `PipelineService` | 未消费 `external:danmaku` | **需新增弹幕消费者**，将选中的弹幕送入 `pipeline.run()` |
| `ControlPanel` | 有 Mock 测试区块 | 新增 B 站连接 UI（房间号 + 开关） |

### 4.3 建议的接入层级

```
BilibiliAdapter（新增）
  ├→ WebSocket 连接 + 心跳 + 协议解析
  ├→ 解析 DANMU_MSG → RawExternalEvent { source: "bilibili", type: "danmaku", data: {...} }
  ├→ 解析 SEND_GIFT → RawExternalEvent { source: "bilibili", type: "gift", data: {...} }
  └→ 调用 ExternalInputService.injectEvent(raw)
       ├→ runtime.isAllowed() 门控
       └→ bus.emit("external:danmaku" | "external:gift", payload)
            ├→ EventLog 展示（已有）
            ├→ KnowledgeService 消费 product-message（已有）
            └→ DanmakuConsumer（新增）→ pipeline.run(text)
```

---

## 5. 最大的技术未知点

按风险/影响排序：

### 5.1 Tauri WebView 中 WebSocket 连通性（风险：中）

**未知**：B 站弹幕 WebSocket 在 Tauri WebView2 中是否能直接连接。

**验证方式**：一个最小 spike——在 Tauri 应用中 `new WebSocket("wss://broadcastlv.chat.bilibili.com/sub")`，发送认证包，确认能收到弹幕。

**预估验证时间**：1–2 小时。

**如果不通**：
- 方案 B：Rust 侧起 WebSocket 连接，通过 Tauri Event 转发到前端（增加约 1 天工作量）
- 方案 C：使用 Tauri HTTP 代理（`tauri-plugin-http`）做 fetch，但 WebSocket 需要独立处理

### 5.2 弹幕到 LLM 的节流策略（风险：中）

**未知**：热门直播间弹幕可达每秒数十条，如何选取弹幕送入 LLM。

**当前 Pipeline 约束**：`PipelineService.run()` 有 `processing` 锁，不允许并发。弹幕频率高于 LLM 响应速度时，后续弹幕会被阻断。

**建议的最小策略**：
1. 固定冷却时间（如 10–15 秒），冷却期间丢弃新弹幕
2. 弹幕文本长度限制（太短的无意义，太长的可能是 spam）
3. 不做 AI 评分 / 关键词过滤（留后续优化）

### 5.3 zlib 解压在 WebView 中的性能（风险：低）

**未知**：高频弹幕场景下 `pako` 解压的性能开销。

**预计不是问题**：每个压缩包通常只有几 KB，`pako.inflate` 在现代 JS 引擎中是毫秒级操作。

### 5.4 短号 → 长号的 room_init API（风险：低）

需要先调 `https://api.live.bilibili.com/room/v1/Room/room_init` 获取真实房间号。这是一个简单的 HTTP GET 请求，可通过现有的 `proxyRequest`（Rust 代理）完成。

---

## 6. B 站开放平台 vs 非官方 WebSocket

| 维度 | B 站开放平台 | 非官方 WebSocket |
|------|-------------|-----------------|
| 认证 | 需要开发者账号 + 审核 + HMAC-SHA256 签名 | 匿名连接，`uid: 0` |
| 功能 | 完整 API（弹幕、礼物、SC、大航海、互动） | 同样完整的消息类型 |
| 稳定性 | 官方保障 | 协议可能变更，但多年来较稳定 |
| 适用场景 | 商业应用、公开发布 | 个人/小团队项目、FYP |
| 限制 | 需要审核 | 无发送能力，仅接收 |

**本项目建议：Phase 4 最小版使用非官方 WebSocket（匿名连接）。**

理由：
- 本项目是 FYP 项目，不需要商业级稳定性保障
- 匿名连接的功能完全满足需求（只需接收弹幕和礼物）
- 避免开放平台审核流程的时间成本
- 如果后续需要发布或商用，可迁移到开放平台

---

## 7. 现在该不该直接进入实现

**建议：先做一个极小的 spike，再进入正式实现。**

### 需要验证的内容

| Spike 项 | 验证目标 | 方式 |
|----------|---------|------|
| WebSocket 连通性 | Tauri WebView 中 `new WebSocket("wss://broadcastlv.chat.bilibili.com/sub")` 能否建立连接 | 在现有应用的 console 中直接执行 |
| 认证 + 心跳 | 发送认证包后能否收到认证成功响应；心跳能否保持连接 | 在 console 中写最小脚本 |
| 弹幕接收 | 能否接收到 `DANMU_MSG` 并解析出用户名和弹幕文本 | 连接一个有活跃弹幕的房间观察 |
| zlib 解压 | `pako.inflate` 能否在 WebView 中正常工作 | 安装 pako，解压实际收到的包 |

### Spike 的形式

不需要创建正式文件。在 Tauri 桌面端的 DevTools console 中执行以下操作即可：

1. `pnpm add pako`（如果需要 zlib）
2. 在 console 中手动 `new WebSocket(...)` → 发认证包 → 等待弹幕
3. 记录结果到 `docs/research/` 中

**预估时间：0.5–1 天。**

如果 spike 验证通过，可直接进入 Phase 4 Run 01 正式实施。

---

## 8. 本文档与其他文档的关系

| 文档 | 定位 | 关系 |
|------|------|------|
| `phase4-round1-observation.md` | 仓库架构审计——当前代码能接什么、缺什么 | 本文档的前序 |
| 本文档 | B 站侧的技术约束——协议、认证、库、兼容性 | 为 Blueprint 提供技术决策依据 |
| `blueprints/phase4/bilibili-minimum-integration.md` | Phase 4 正式 Kickoff Blueprint | 基于本文档和 Round 1 观察产出的实施计划 |

---

## 元信息

- 调研日期：2026-03-31
- 参考来源：
  - [BiliBili Live Danmaku WebSocket Protocol Analysis](https://www.oreateai.com/blog/technical-analysis-of-bilibili-live-danmaku-websocket-protocol/)
  - [bilibili-live-danmaku npm](https://www.npmjs.com/package/bilibili-live-danmaku)
  - [bilibili-live-ws GitHub](https://github.com/simon300000/bilibili-live-ws)
  - [B 站直播 WebSocket 协议（CSDN）](https://blog.csdn.net/xfgryujk/article/details/80306776)
- 文档路径：`docs/research/phase4-bilibili-connection-research.md`
