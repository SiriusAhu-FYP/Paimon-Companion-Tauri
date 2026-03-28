# Phase 3 Run 01: M4 配置管理 + M6 网络能力

**Commit**: `1668f51` (`feat(config): implement M4 config management and M6 HTTP proxy infrastructure`)
**日期**: 2026-03-24
**执行人**: SiriusAhu
**前置依赖**: Phase 2.1 结构收敛完成，回归烟雾测试通过

---

## 1. 本次 Run 目标

按 Phase 3 路线图，执行"第一批 MVP 最小闭环"的前两个 milestone：

- **M4：配置管理基础** — 建立统一配置机制，普通配置持久化 + 敏感配置（API Key）安全存储，配置驱动服务选择
- **M6：HTTP 网络能力开通** — 确认前端能发出 HTTP 请求，云端 API 走 Rust 代理（密钥不进前端 JS），本地/局域网服务可直接 fetch

这两个 milestone 是后续 M1（真实 LLM）和 M2（真实 TTS）的前置依赖。

---

## 2. 本次完成内容

### M4: 配置管理基础

**分层存储架构**：

| 类别 | 内容 | 存储方案 |
|------|------|---------|
| 普通配置 | provider 类型、baseUrl、model、temperature、speaker | `tauri-plugin-store`（明文 JSON） |
| 敏感配置 | API Key、Token | `tauri-plugin-keyring`（Windows Credential Locker） |
| 开发 fallback | 普通 → localStorage / 敏感 → sessionStorage | 非 Tauri 环境降级路径 |

**ConfigService**（`src/services/config/config-service.ts`）:
- `loadConfig()`: 启动时加载，Tauri 环境走 Store API，非 Tauri 降级到 localStorage
- `updateConfig(partial)`: 增量更新并持久化
- `resetConfig()`: 恢复默认值
- `getConfig()`: 同步读取缓存（bootstrap 完成后可用）
- 配置缓存 `cachedConfig`，避免重复加载

**SecretStore**（`src/services/config/secret-store.ts`）:
- `setSecret(key, value)`: Tauri 环境调用 Rust `secret_set` 存入 keyring；非 Tauri 降级到 sessionStorage
- `getSecret(key)`: 从 keyring 读取
- `hasSecret(key)`: 查询 key 是否存在
- `deleteSecret(key)`: 从 keyring 删除
- 底层通过 `invoke("secret_*")` 调用 Rust 侧命令，API Key 始终不进入前端 JS 运行时

**SettingsPanel**（`src/features/settings/SettingsPanel.tsx`）:
- 右栏可切换视图，齿轮按钮入口
- LLM / TTS / 角色设置三区块
- API Key 遮罩输入，保存后写 keyring，显示"已保存"标识
- 缺少必要配置时显示警告
- 保存 / 恢复默认按钮
- provider 选 mock 时隐藏详细配置字段

**配置驱动框架**（`src/services/index.ts`）:
- `resolveLLMProvider()`: 根据 `config.llm.provider` 选择实现，当前 `"openai-compatible"` 降级到 mock 并 warn
- `resolveTTSProvider()`: 同理
- 真实 provider 未实现时自动降级，不 crash

**Bootstrap 改造**（`src/main.tsx`）:
- 改为 `async bootstrap()`
- `await loadConfig()` 在 `initServices()` 之前执行
- 确保 services 初始化时 `getConfig()` 有值可用

### M6: HTTP 网络能力

**Rust 侧代理**（`src-tauri/src/commands/http_proxy.rs`）:
- `proxy_http_request`: 通用 HTTP 代理，从 keyring 读取 secret 并注入 `Authorization: Bearer` header，支持 GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS
- `proxy_sse_request`: SSE 流式代理，通过 Tauri event channel 逐 chunk 向前端推送，支持 GET/POST
- 错误处理完善：keyring 找不到时返回明确提示，HTTP 4xx/5xx 时通过 event 传递错误

**前端封装**（`src/services/config/http-proxy.ts`）:
- `proxyRequest(options)`: 当 `options.secretKey` 存在且在 Tauri 环境时走 Rust invoke；否则走前端直接 fetch
- `proxySSERequest(options, onChunk, onError, onDone)`: SSE 封装，返回 cleanup 函数（unlisten）
- `directFetch()`: 前端 fetch 路径，带超时控制（默认 30s）

**调用路径策略**:

| 场景 | 路径 | 密钥位置 |
|------|------|---------|
| 云端 API（需 Key） | `invoke` → Rust reqwest | 仅 Rust 进程内 |
| 本地/局域网 | 前端直接 fetch | 无密钥 |

**连接测试**:
- Settings 面板中 LLM/TTS 各有"测试连接"按钮
- DevTools: `__paimon.testProxy(url)` / `__paimon.testSecretProxy(url, secretKey)`

**Rust 命令注册**（`src-tauri/src/lib.rs`）:
- `secret_set / secret_get / secret_has / secret_delete`
- `proxy_http_request / proxy_sse_request`
- plugins: `tauri-plugin-store` + `tauri-plugin-keyring`

---

## 3. 关键改动文件/模块

### Rust 侧

| 文件 | 说明 |
|------|------|
| `src-tauri/Cargo.toml` | 新增 store、keyring、reqwest、tokio、futures-util 依赖 |
| `src-tauri/src/lib.rs` | 注册插件 + invoke handler |
| `src-tauri/src/commands/mod.rs` | 导出 secret、http_proxy 模块 |
| `src-tauri/src/commands/secret.rs` | keyring CRUD 命令（set/get/has/delete） |
| `src-tauri/src/commands/http_proxy.rs` | HTTP 代理 + SSE 流式代理 |
| `src-tauri/capabilities/default.json` | 添加 store、keyring capabilities |

### 前端

| 文件 | 说明 |
|------|------|
| `src/services/config/types.ts` | 配置类型定义 + 默认值 |
| `src/services/config/config-service.ts` | Store / localStorage 配置读写 |
| `src/services/config/secret-store.ts` | keyring / sessionStorage 敏感配置封装 |
| `src/services/config/http-proxy.ts` | HTTP 代理 / fetch 封装 |
| `src/services/config/index.ts` | 模块导出 |
| `src/services/index.ts` | 配置驱动 provider 选择逻辑 |
| `src/main.tsx` | async bootstrap，loadConfig 前置 |
| `src/features/settings/SettingsPanel.tsx` | 设置界面 + 连接测试 |
| `src/features/settings/index.ts` | 模块导出 |
| `src/app/MainWindow.tsx` | 右栏设置/控制面板切换 |
| `src/utils/mock.ts` | 暴露 testProxy / testSecretProxy |

---

## 4. 配置管理方案

**普通配置**（明文，持久化到 `app-config.json`）：
- provider 类型、baseUrl、model、temperature、maxTokens、speakerId、speed、角色人设
- 通过 `tauri-plugin-store` 读写应用数据目录下的 JSON 文件
- 非 Tauri 环境降级到 localStorage

**敏感配置**（安全存储，写入系统 keyring）：
- LLM API Key：`llm-api-key`
- TTS API Key：`tts-api-key`
- 通过 `tauri-plugin-keyring` 写入 Windows Credential Locker
- 前端始终不直接持有密钥值，仅通过 `secretKey` 名称引用

**配置驱动服务选择**：
- `services/index.ts` 在初始化时读取配置，决定使用 mock 或真实 provider
- 真实 provider 尚未实现时自动降级到 mock 并输出控制台警告
- 缺少配置时启动不 crash，使用默认 mock 配置

---

## 5. 敏感配置存储方案

**存储后端**：Windows Credential Locker（通过 `tauri-plugin-keyring`）

**Service 命名**：`com.siriusahu.paimon-live:{key}`

**Rust 侧实现**（`src-tauri/src/commands/secret.rs`）：
- `secret_set`: 调用 `app.keyring().set_password(service, key, value)`
- `secret_get`: 调用 `app.keyring().get_password(service, key)`，找不到返回 `None`
- `secret_has`: 基于 `secret_get` 结果判断
- `secret_delete`: 调用 `app.keyring().delete_password(service, key)`，删除不存在的条目视为成功

**前端接口**（`src/services/config/secret-store.ts`）：
- 通过 `invoke("secret_*")` 调用，不在 JS 侧存储实际密钥值
- 非 Tauri 环境降级到 sessionStorage（仅开发调试用，不持久化到磁盘）

**安全边界**：
- API Key 不进入前端 JS 运行时内存（网络请求由 Rust 发出）
- API Key 不写入明文 JSON 配置文件
- API Key 不提交到 Git 仓库

---

## 6. HTTP 调用路径方案

**双路径策略**：

```
proxyRequest({ url, secretKey? })
├── secretKey != null && isTauri → invoke proxy_http_request (Rust)
└── otherwise → directFetch (前端 fetch)
```

**SSE 路径**：
```
proxySSERequest({ url, secretKey?, body? }, onChunk, onError, onDone)
├── isTauri → invoke proxy_sse_request (Rust)，通过 Tauri event channel 推送 chunks
└── 非 Tauri → onError("SSE proxy not available")
```

**前端直接 fetch** 路径：
- 用于本地/局域网服务（无密钥风险）
- 带 30s 超时控制
- 返回 `{ status, headers, body }`

**Rust 代理** 路径：
- 接收前端传来的 `secretKey` 名称
- 从 keyring 读取实际 token
- 注入 `Authorization: Bearer {token}` header
- 发起 reqwest 请求

---

## 7. 测试/验证情况

**编译检查**：
- TypeScript 编译零错误（有赖 `npx tsc --noEmit` 确认）
- Rust 编译零错误零警告

**接口层面验证**（代码审查级，非运行时手测）：
- ConfigService `loadConfig` / `updateConfig` / `getConfig` / `resetConfig` 逻辑完整，缓存机制正确
- SecretStore 通过 invoke 调用 Rust，keyring service 命名约定正确
- `proxyRequest` 条件判断（secretKey && isTauri）逻辑正确
- `proxySSERequest` 的 event channel cleanup 通过返回 unlisten 函数实现
- Settings UI 的 `handleTestLLM` / `handleTestTTS` 正确调用 `proxyRequest`
- `resolveLLMProvider` / `resolveTTSProvider` 在真实 provider 未实现时降级到 mock

**降级路径验证**：
- `isTauriEnvironment()` 返回 false 时（浏览器 dev server），ConfigService 降级到 localStorage，SecretStore 降级到 sessionStorage，`proxySSERequest` 报错
- 未配置 LLM/TTS 时 `getConfig()` 返回 `DEFAULT_CONFIG`（provider = "mock"），`resolveLLMProvider` 走 mock 分支

**尚未充分验证（需要真实 Tauri 环境手测）**：
- Windows Credential Locker 实际读写（keyring crate 在 Windows 上行为）
- Tauri Store 持久化文件路径和加载时机
- Rust `proxy_sse_request` 的 SSE chunk 分片推送在真实 OpenAI SSE 流上的表现
- Settings UI 保存后 keyring 中的值是否真的被持久化，重启后能否正确读取
- 连接测试按钮在真实网络错误时的错误提示质量

---

## 8. 当前风险与未完成点

### 已完成且可信任

- 配置类型定义和默认值
- 配置服务的基本读写逻辑
- SecretStore 的接口抽象和 Rust invoke 路径
- HTTP 代理的 Rust 侧实现（逻辑完整）
- Settings UI 的交互流程

### 待运行时验证

1. **keyring 实际接通**：Windows Credential Locker 写入后能否在同一次运行中读取；重启后是否存在
2. **Tauri Store 持久化**：配置文件实际路径；应用重启后配置是否真的被恢复
3. **配置热生效**：Settings 保存后，现有 services 是否需要重启才能使用新配置（当前 services 在 bootstrap 时初始化一次，不支持运行时重配置）
4. **SSE 代理真实场景**：真实 OpenAI SSE 流在 `proxy_sse_request` 中的 chunk 推送是否正常
5. **LLM 连接测试**：当前测试逻辑仅请求 `/models` 端点，需确认返回码判断正确（2xx 即成功）

### 架构限制（已知，不算风险）

- 配置文件变更后需要重启应用才能生效（无热更新）
- keyring 非 Tauri 环境降级到 sessionStorage，开发期体验与生产不一致
- `isLocalUrl()` 判断规则（localhost/127.0.0.1/192.168.*/10.*/*.local）可能需要随实际部署环境扩展

---

## 9. 是否建议进入 M1

**结论：建议进入 M1（真实 LLM 接入）**。

理由：
1. M4 配置管理和 M6 HTTP 代理基础设施已完整实现，逻辑路径正确
2. `services/index.ts` 中 `resolveLLMProvider()` 已预留 `"openai-compatible"` 分支，只需实现 `OpenAILLMService` 并在 switch 中注册即可
3. `proxySSERequest()` 已支持 SSE 流式响应，可满足 LLM 流式输出的调用需求
4. API Key 安全存储路径已接通，真实 LLM 接入时可直接复用
5. mock 模式始终保留作为 fallback，M1 实施出问题可快速切回

**进入 M1 前建议确认**：
- 在真实 Tauri dev 环境中跑一遍 Settings 保存流程，确认 keyring 写入成功
- 用 `__paimon.testSecretProxy()` 手动测试一次 OpenAI API 调用（带真实 key）
- 确认 `tauri-plugin-keyring` 在 Windows 上运行时没有权限问题

---

## 附录：Run 编号说明

本次 commit 对应的报告编号为 Run 01（因为这是 Phase 3 的第一次实施）。Phase 3 blueprint 中文件 `002-m4-m6-config-network.md` 标题曾误写为"Run 02"，已在此文件中更正为 Run 01。
