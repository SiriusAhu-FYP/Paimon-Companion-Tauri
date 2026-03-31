# Phase 4 B 站接入方式研究（双路方案）

> **文档定位**: Phase 4 启动前的技术调研文档，覆盖 B 站直播弹幕接入的两条路线。
> 与 `phase4-round1-observation.md` 的区别：上一份是对仓库现有架构的能力审计，本文档聚焦于 B 站侧的技术约束和方案选型。

---

## 0. 路线总览与推荐

| 维度 | 路线 A：官方 Open Live（推荐） | 路线 B：匿名 WebSocket（fallback） |
|------|-------------------------------|-----------------------------------|
| **定位** | **默认主方案** | 备用 / 对照 / 原型验证 |
| 认证 | HMAC-SHA256 签名，开发者凭证 | `uid: 0` 匿名连接 |
| 凭证需求 | `access_key_id` + `access_key_secret` + `app_id` + 主播身份码 | 无 |
| 消息 cmd 格式 | `LIVE_OPEN_PLATFORM_DM` 等（开放平台专用） | `DANMU_MSG` 等（非官方格式） |
| 稳定性 | 官方保障，有 SLA | 非官方协议，可能随时变更 |
| 安全性 | 签名在 Rust 受信任侧完成，密钥不暴露 | 无密钥，无安全顾虑 |
| 项目适用性 | FYP 正式提交、演示、答辩 | 开发初期快速验证、调试对照 |

**推荐结论：Phase 4 默认优先走官方 Open Live 路线。**

理由：
1. 用户已申请到 `access_key_id` 和 `access_key_secret`，官方凭证已就绪
2. 官方路线的消息格式更规范、字段更丰富，适合正式实现
3. 对于 FYP 项目的答辩和演示，使用官方接口更具说服力
4. 签名逻辑放在 Rust 层，与本项目的 Tauri 架构天然契合
5. 匿名路线作为 fallback 保留，在官方路线受阻时可快速切换

---

## 1. 路线 A：官方 Open Live

### 1.1 平台定位

B 站直播开放平台分为两套独立系统：

| 系统 | 地址 | 用途 | 鉴权 |
|------|------|------|------|
| **直播创作者服务中心** | `open-live.bilibili.com` | 互动玩法接入（弹幕/礼物/SC） | HMAC-SHA256 签名 |
| 开放平台（通用） | `openhome.bilibili.com` | 通用 OAuth 2.0 能力 | OAuth 2.0 |

**本项目走的是"直播创作者服务中心"路线**（互动玩法），不是通用开放平台的 OAuth 路线。两者的接口和鉴权完全独立。

### 1.2 关键凭证与参数

| 凭证 / 参数 | 来源 | 用途 | 安全等级 |
|-------------|------|------|----------|
| `access_key_id` | 开发者入驻后邮件获取 | HTTP 请求头 `x-bili-accesskeyid` | 可公开（等同 client_id） |
| `access_key_secret` | 开发者入驻后邮件获取 | HMAC-SHA256 签名密钥 | **绝不能暴露到前端** |
| `app_id` | 开发者后台创建项目时分配 | `/v2/app/start` 请求体参数 | 可公开 |
| 主播身份码 `code` | 主播在直播姬或弹幕姬中获取 | `/v2/app/start` 请求体参数 | 运行时由主播提供 |

### 1.3 连接生命周期

```
Phase 1: 鉴权 + 开启场次
──────────────────────────
POST https://live-open.biliapi.com/v2/app/start
  Headers:
    x-bili-accesskeyid: {access_key_id}
    x-bili-content-md5: {body 的 MD5}
    x-bili-signature-method: HMAC-SHA256
    x-bili-signature-nonce: {随机字符串}
    x-bili-signature-version: 2.0
    x-bili-timestamp: {Unix 时间戳(秒)}
    Authorization: {HMAC-SHA256 签名结果}
    Content-Type: application/json
    Accept: application/json
  Body:
    { "code": "{主播身份码}", "app_id": {app_id} }
  Response:
    {
      "code": 0,
      "data": {
        "game_id": "xxx",              // 场次 ID，后续心跳/关闭使用
        "anchor_info": {
          "room_id": 12345,
          "uname": "主播昵称",
          "uface": "https://..."
        },
        "websocket_info": {
          "auth_body": "...",           // WebSocket 认证包体
          "wss_link": ["wss://..."]     // WebSocket 连接地址列表
        }
      }
    }

Phase 2: 建立长连接
──────────────────────────
1. 连接 websocket_info.wss_link[0]
2. 5 秒内发送 AUTH 包（Operation=7），Body = websocket_info.auth_body
3. 收到 AUTH_REPLY（Operation=8），code=0 表示成功

Phase 3: 保活
──────────────────────────
A. WebSocket 心跳：每 30 秒发送 Heartbeat 包（Operation=2）
B. HTTP 项目心跳：每 20 秒 POST /v2/app/heartbeat
   Body: { "game_id": "{game_id}" }
   （也需要 HMAC-SHA256 签名 Headers）

Phase 4: 消息接收
──────────────────────────
消息格式同标准弹幕 WebSocket 协议（16 字节头 + body）
但 cmd 使用开放平台专用名称：
  - LIVE_OPEN_PLATFORM_DM       → 弹幕
  - LIVE_OPEN_PLATFORM_SEND_GIFT → 礼物
  - LIVE_OPEN_PLATFORM_SUPER_CHAT → SC
  - LIVE_OPEN_PLATFORM_GUARD     → 大航海
  - LIVE_OPEN_PLATFORM_LIKE      → 点赞

Phase 5: 关闭
──────────────────────────
POST /v2/app/end
  Body: { "game_id": "{game_id}", "app_id": {app_id} }
  （需要签名）
关闭 WebSocket 连接
```

### 1.4 HMAC-SHA256 签名算法

```
步骤 1: 计算请求体的 MD5（全小写）
  content_md5 = md5(request_body).toLowerCase()

步骤 2: 构造待签名字符串
  将所有 x-bili-* header 按字典序排列，每行格式为 key:value\n
  待签名字符串 =
    "x-bili-accesskeyid:{access_key_id}\n" +
    "x-bili-content-md5:{content_md5}\n" +
    "x-bili-signature-method:HMAC-SHA256\n" +
    "x-bili-signature-nonce:{nonce}\n" +
    "x-bili-signature-version:2.0\n" +
    "x-bili-timestamp:{timestamp}"

步骤 3: HMAC-SHA256 签名
  signature = hmac_sha256(access_key_secret, 待签名字符串)
  Authorization header = signature（十六进制字符串）
```

### 1.5 敏感信息与安全边界

**绝不能放在前端 TS 层的信息：**

| 信息 | 原因 |
|------|------|
| `access_key_secret` | 签名密钥，泄漏等于账号被盗用 |
| 完整的签名计算过程 | 暴露了 secret 的使用方式 |

**可以放在前端 TS 层的信息：**

| 信息 | 原因 |
|------|------|
| `access_key_id` | 等同 client_id，公开信息 |
| `app_id` | 应用标识，公开信息 |
| 主播身份码 `code` | 由主播手动输入，运行时数据 |
| `websocket_info`（auth_body / wss_link） | 已签名的产物，有效期短 |
| WebSocket 连接 + 消息接收 | 标准浏览器 API，无密钥参与 |

### 1.6 Rust 与 TS 的职责边界

| 层 | 职责 | 原因 |
|----|------|------|
| **Rust（Tauri command）** | HMAC-SHA256 签名计算 | `access_key_secret` 必须留在 Rust 侧 |
| **Rust（Tauri command）** | `/v2/app/start`、`/heartbeat`、`/end` 的 HTTP 调用 | 签名 + HTTP 请求打包在一起更自然 |
| **Rust（Tauri command）** | `access_key_secret` 的安全存储 | 用 Tauri Store 或 keyring，不暴露到 WebView |
| **TS（前端）** | 调用 Tauri command 获取 `websocket_info` | 通过 IPC 获取 auth_body + wss_link |
| **TS（前端）** | WebSocket 连接 + 消息解析 | 标准浏览器 WebSocket API，无密钥参与 |
| **TS（前端）** | WebSocket 心跳（30 秒） | 简单定时器 |
| **TS（前端）** | 消息分发到 `ExternalInputService` | 复用现有事件链路 |
| **TS（前端）** | 定时触发 Rust 侧的 HTTP 心跳（20 秒） | 通过 Tauri command 调用 |

### 1.7 官方消息格式（与非官方的对比）

| 维度 | 官方 Open Live | 非官方匿名 |
|------|---------------|-----------|
| 弹幕 cmd | `LIVE_OPEN_PLATFORM_DM` | `DANMU_MSG` |
| 礼物 cmd | `LIVE_OPEN_PLATFORM_SEND_GIFT` | `SEND_GIFT` |
| SC cmd | `LIVE_OPEN_PLATFORM_SUPER_CHAT` | `SUPER_CHAT_MESSAGE` |
| 消息体结构 | 规范化 JSON，字段命名统一 | 非标准化，部分字段在数组中 |
| 用户信息 | data 中有 `uname`, `uid`, `uface` 等 | 部分在 `info` 数组的固定位置 |

**影响**：BilibiliAdapter 需要根据走哪条路线解析不同的 cmd 格式。建议在 adapter 内部做解析，输出统一的 `RawExternalEvent`，下游无感知。

---

## 2. 路线 B：匿名 WebSocket（fallback）

### 2.1 连接方式

```
wss://broadcastlv.chat.bilibili.com/sub
```

匿名连接，`uid: 0`，不需要任何凭证。

### 2.2 连接流程

```
1. 获取真实房间号：GET https://api.live.bilibili.com/room/v1/Room/room_init?id={房间号}
2. 建立 WebSocket 连接
3. 5 秒内发送认证包：{ "uid": 0, "roomid": 真实房间号, "protover": 2, "platform": "web" }
4. 每 30 秒发送心跳包
5. 接收弹幕/礼物等消息
```

### 2.3 数据包格式

16 字节定长头部（big-endian）：

| 偏移 | 长度 | 含义 |
|------|------|------|
| 0 | 4 bytes | 总包长度 |
| 4 | 2 bytes | 头部长度（固定 16） |
| 6 | 2 bytes | 协议版本（protover） |
| 8 | 4 bytes | 操作码（operation） |
| 12 | 4 bytes | 序列号 |

操作码与官方路线一致（2=心跳, 5=消息, 7=认证, 8=认证响应）。

### 2.4 压缩方案

建议使用 protover=2（zlib deflate），使用 `pako` 库解压。

### 2.5 适用场景

- Spike 初期快速验证 WebSocket 连通性（无需任何凭证）
- 官方路线 Rust 签名开发期间的对照测试
- 官方路线受阻（审核问题、API 变更等）时的临时替代
- 开发调试：可直接在 DevTools console 中测试

### 2.6 限制

- 非官方协议，随时可能变更
- 无法发送弹幕（只能接收）
- 消息格式非标准化，解析更复杂
- 不适合正式发布或 FYP 答辩演示

---

## 3. 可用的 npm 库

### 3.1 匿名路线适用

| 包名 | 版本 | 浏览器支持 | 说明 |
|------|------|----------|------|
| `bilibili-live-danmaku` | 0.7.15（2026-02） | ✅ 支持 | 最新、声明浏览器兼容 |
| `bilibili-live-ws` | 6.3.1 | 实验性 | 较成熟，API 设计好 |

### 3.2 官方路线

官方路线的 HTTP 签名和 WebSocket 连接逻辑较为特殊，现有 npm 库主要针对匿名协议。

**建议**：官方路线的 HTTP 签名在 Rust 侧自行实现（HMAC-SHA256 + MD5，Rust 生态有成熟的 crate：`hmac`, `sha2`, `md-5`）；WebSocket 部分可复用前端标准 API，协议格式与匿名路线相同（16 字节头 + zlib 压缩）。

---

## 4. Tauri WebView 中 WebSocket 的可行性分析

以下分析对两条路线均适用，因为两条路线的 WebSocket 连接阶段均使用标准 `wss://` 协议。

| 问题 | 风险 | 分析 |
|------|------|------|
| CSP 限制 | 低 | Tauri 2.x 默认允许 `wss://`；如被阻止，可在 `tauri.conf.json` 中调整 |
| 二进制 WebSocket 帧 | 低 | WebView2 支持 `ArrayBuffer` |
| zlib 解压 | 中 | 需 `pako`（纯 JS）或 `DecompressionStream` API |
| 跨域 | 极低 | WebSocket 不受同源策略限制 |

**关键区别**：官方路线的 `/v2/app/start` 等 HTTP 请求走 Rust 侧（Tauri command），不经过 WebView 的 CSP。因此**即使 WebView 对某些 HTTPS 域有限制，也不影响官方路线的 HTTP 调用**。

---

## 5. 当前仓库的接入点

Round 1 观察报告的核心结论仍然成立：`ExternalInputService` + `EventBus` + `EventMap` 三件套可直接复用。

| 组件 | 现状 | 两条路线共用 |
|------|------|-------------|
| `ExternalInputService.injectEvent()` | 已有，runtime 门控 | ✅ 两条路线最终都汇入此处 |
| `EventMap` | 已定义 `external:danmaku` / `external:gift` | ✅ 下游无感知路线差异 |
| `EventLog` | 已订阅外部事件 | ✅ 自动展示 |
| `PipelineService` | 未消费 `external:danmaku` | 需新增 DanmakuConsumer（两条路线共用） |

**架构关键点**：无论走哪条路线，BilibiliAdapter 内部处理路线差异，输出统一的 `RawExternalEvent`。下游的 `ExternalInputService` / `EventBus` / `DanmakuConsumer` 完全不关心弹幕是从官方还是匿名路线来的。

---

## 6. 两条路线的实施差异

| 维度 | 官方 Open Live | 匿名 WebSocket |
|------|---------------|----------------|
| Rust 侧工作量 | 需要新增 Tauri commands（签名 + HTTP 调用） | 无 |
| TS 侧工作量 | WebSocket + 消息解析 + Tauri command 调用 | WebSocket + 消息解析 |
| 新增依赖 | Rust: `hmac`, `sha2`, `md-5`, `reqwest`；TS: `pako` | TS: `pako` |
| 配置项 | `access_key_id`, `access_key_secret`(Rust), `app_id`, `code` | `roomId` |
| UI 需求 | 主播身份码输入 + 连接按钮 | 房间号输入 + 连接按钮 |
| 预估总工作量 | 3–4 天（含 Rust 签名） | 2–3 天 |

---

## 7. 本文档与其他文档的关系

| 文档 | 定位 |
|------|------|
| `phase4-round1-observation.md` | 仓库架构审计——当前代码能接什么、缺什么 |
| **本文档** | B 站侧技术约束——两条路线的协议、认证、库、兼容性、安全边界 |
| `blueprints/phase4/bilibili-minimum-integration.md` | Phase 4 正式 Kickoff Blueprint——基于本文档的实施计划 |

---

## 元信息

- 初始调研日期：2026-03-31
- 路线修正日期：2026-03-31
- 参考来源：
  - [B 站直播创作者服务中心](https://open-live.bilibili.com/)
  - [B 站 Open Live 接口签名标准](https://bilibili.apifox.cn/doc-885734)
  - [B 站 Open Live WebSocket 协议](https://bilibili.apifox.cn/doc-7499638)
  - [B 站 Open Live 接入指南](https://bilibili.apifox.cn/doc-7499516)
  - [bilibili-live-danmaku npm](https://www.npmjs.com/package/bilibili-live-danmaku)
  - [bilibili-live-ws GitHub](https://github.com/simon300000/bilibili-live-ws)
  - [BiliBili Live Danmaku WebSocket Protocol Analysis](https://www.oreateai.com/blog/technical-analysis-of-bilibili-live-danmaku-websocket-protocol/)
- 文档路径：`docs/research/phase4-bilibili-connection-research.md`
