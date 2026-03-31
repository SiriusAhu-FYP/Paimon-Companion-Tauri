# Phase 4 Spike 计划

> **文档定位**: Phase 4 Spike 的执行清单与判定标准。
> 本文档从 Blueprint（`blueprints/phase4/bilibili-minimum-integration.md` §6）中提取并细化，
> 独立存在的原因是 Spike 是一次性的验证活动，与 Blueprint（长期存在的阶段设计文档）的生命周期不同。
> Spike 完成后，结论记录到 `docs/research/phase4-spike-results.md`，本文档归档。

---

## 1. Spike 目标

**在正式进入 Phase 4 Run 01 之前，验证最关键的技术未知点，消除实施路径上的最大不确定性。**

不产出正式功能代码，只产出验证结论。

---

## 2. 前置条件

| 条件 | 状态 | 说明 |
|------|------|------|
| `access_key_id` | ✅ 已获取 | 开发者入驻后邮件获取 |
| `access_key_secret` | ✅ 已获取 | 开发者入驻后邮件获取 |
| `app_id` | ⏳ 待确认 | 在开发者后台创建项目时分配 |
| 主播身份码 `code` | ⏳ 待获取 | 主播在直播姬或弹幕姬中获取 |
| 有活跃弹幕的直播间 | ⏳ 需要 | 用于验证弹幕接收 |

---

## 3. Spike 2（匿名路线）— 先做

**为什么先做匿名路线**：无凭证门槛，可在 10 分钟内开始，快速验证 WebSocket 基础能力。如果匿名路线的 WebSocket 都不通，官方路线的 WebSocket 同样会受影响。

### S2.1 WebSocket 连通性

| 项 | 值 |
|----|---|
| **验证目标** | Tauri WebView 中能否建立到 B 站弹幕服务器的 WebSocket 连接 |
| **操作** | 在 Tauri 桌面端的 DevTools console 中执行 `new WebSocket("wss://broadcastlv.chat.bilibili.com/sub")` |
| **成功标准** | `ws.readyState` 变为 `1`（OPEN），`ws.onopen` 被触发 |
| **失败后果** | 如果连不上：需要走 Rust 代理方案（tokio-tungstenite），两条路线的 WebSocket 层都受影响 |
| **预估时间** | 10–15 分钟 |

### S2.2 认证 + 弹幕接收

| 项 | 值 |
|----|---|
| **验证目标** | 匿名认证后能否接收到弹幕消息 |
| **操作** | 发送认证包 `{ uid: 0, roomid: <某个活跃直播间长号>, protover: 2, platform: "web" }`，等待弹幕 |
| **成功标准** | 收到 operation=8 的认证成功响应；随后收到 operation=5 的消息包 |
| **预估时间** | 20–30 分钟 |

### S2.3 zlib 解压

| 项 | 值 |
|----|---|
| **验证目标** | `pako.inflate` 在 WebView 中是否能正确解压 B 站的 zlib 压缩包 |
| **操作** | 先 `pnpm add pako`，然后在收到 protover=2 的消息包后，用 `pako.inflate` 解压 body |
| **成功标准** | 解压后能得到有效的 JSON 消息（`cmd: "DANMU_MSG"` 等） |
| **预估时间** | 20–30 分钟 |

### S2 总计：约 1–1.5 小时

---

## 4. Spike 1（官方 Open Live 路线）— 后做

**前置**：如果 Spike 2 验证 WebSocket 不通，则 Spike 1 的 WebSocket 部分跳过，只验证 HTTP 层。

### S1.1 Rust 侧 HMAC-SHA256 签名

| 项 | 值 |
|----|---|
| **验证目标** | Rust 中能否计算出与 B 站一致的 HMAC-SHA256 签名 |
| **操作** | 编写一个最小 Tauri command，输入固定的 header 字段和 `access_key_secret`，输出签名字符串。对照 B 站官方 C# Demo 或签名验证工具的结果 |
| **成功标准** | Rust 输出的签名与官方工具一致 |
| **Rust 依赖** | `hmac = "0.12"`, `sha2 = "0.10"`, `md-5 = "0.10"`, `hex = "0.4"` |
| **预估时间** | 1–2 小时 |

### S1.2 `/v2/app/start` 调用

| 项 | 值 |
|----|---|
| **验证目标** | 使用真实凭证能否成功调用 `/v2/app/start`，拿到 `game_id` 和 `websocket_info` |
| **前置** | 需要 `app_id` 和主播身份码 `code` |
| **操作** | 通过 S1.1 的签名 command 构造请求头，用 `reqwest` 发送 POST 请求 |
| **成功标准** | 返回 `code: 0`，`data.game_id` 非空，`data.websocket_info.wss_link` 和 `auth_body` 非空 |
| **如果 `code` 不为 0** | 记录错误码和消息，排查凭证/权限问题 |
| **预估时间** | 1 小时 |

### S1.3 官方 WebSocket 连接 + 弹幕接收

| 项 | 值 |
|----|---|
| **验证目标** | 用返回的 `wss_link` 和 `auth_body` 能否建立连接并收到弹幕 |
| **操作** | TS 侧 `new WebSocket(wss_link[0])`，发送 auth_body 认证包，等待弹幕 |
| **成功标准** | 收到 operation=8 认证成功；收到 `LIVE_OPEN_PLATFORM_DM` 消息 |
| **预估时间** | 30 分钟 |

### S1.4 HTTP 心跳 + 场次关闭

| 项 | 值 |
|----|---|
| **验证目标** | `/v2/app/heartbeat` 和 `/v2/app/end` 是否正常工作 |
| **操作** | 连接保持 1 分钟，期间每 20 秒调一次 heartbeat；然后调 end 关闭场次 |
| **成功标准** | heartbeat 返回 `code: 0`；end 返回 `code: 0` |
| **预估时间** | 30 分钟 |

### S1 总计：约 3–4 小时（含 Rust 开发）

---

## 5. 执行顺序

```
Day 1（前半天）
  └→ Spike 2：匿名路线（~1.5h）
       ├→ S2.1 WebSocket 连通性
       ├→ S2.2 认证 + 弹幕
       └→ S2.3 zlib 解压

Day 1（后半天）— 如果 Spike 2 通过
  └→ Spike 1 前半：Rust 签名（~2h）
       └→ S1.1 HMAC-SHA256 签名

Day 2（前半天）— 如果有 app_id 和 code
  └→ Spike 1 后半：官方 API 验证（~2h）
       ├→ S1.2 /v2/app/start
       ├→ S1.3 WebSocket + 弹幕
       └→ S1.4 心跳 + 关闭
```

**如果没有 app_id 或 code**：先完成 S1.1（签名验证），其余推迟到凭证就绪后再做。此时可先用匿名路线进入 Run 01 的 TS 层开发（adapter 框架、DanmakuConsumer、UI），Rust 签名和官方 API 并行推进。

---

## 6. 判定标准

| 场景 | 后续动作 |
|------|----------|
| Spike 1 + Spike 2 均通过 | 进入 Run 01，走官方路线实施 |
| Spike 1 通过，Spike 2 不通 | 理论上不应发生（官方路线的 WebSocket 也依赖 WebView），排查 |
| Spike 1 不通（签名/API 问题），Spike 2 通过 | Run 01 先用匿名路线实施，平行排查官方路线问题 |
| Spike 1 不通（WebSocket），Spike 2 也不通 | 走 Rust 代理方案：Rust 侧建 WebSocket，通过 Tauri Event 转发 |

---

## 7. Spike 不产出的东西

- 不写正式的 BilibiliAdapter
- 不写 DanmakuConsumer
- 不改 ControlPanel UI
- 不改 ExternalInputService
- 不改 AppConfig

所有验证代码都是临时性的（console 脚本 / 最小 Tauri command），不合入主代码。

---

## 元信息

- 计划日期：2026-03-31
- 预估总时间：1–1.5 天
- 产出物：`docs/research/phase4-spike-results.md`
- 文档路径：`docs/research/phase4-spike-plan.md`
