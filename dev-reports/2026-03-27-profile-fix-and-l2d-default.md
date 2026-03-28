# 2026-03-27 修复 isTauriEnvironment 误改 + L2D 默认启用 + 缩放持久化

## 本次完成了什么

### 1. 修复 isTauriEnvironment 误改（核心修复）

**根因分析**：commit `14f3b9a` 中将 `isTauriEnvironment()` 从 `__TAURI_INTERNALS__` 改为 `__TAURI__`，意图是适配 Tauri 2.x。但经查证：

- `__TAURI__` 需要 `tauri.conf.json` 中配置 `app.withGlobalTauri: true` 才会注入
- `__TAURI_INTERNALS__` 在 Tauri 2.x 中始终存在（无需额外配置）
- 项目未配置 `withGlobalTauri`，因此 `__TAURI__` 不存在

这导致 `isTauriEnvironment()` 在 Tauri 环境中返回 `false`，引发以下级联故障：
- HTTP 请求走 `directFetch` 而非 Rust 代理 → CORS 阻止 → 所有连接测试失败
- 配置读写走 localStorage 而非 Tauri Store → profile 看似丢失（实际存在但读不到）
- 密钥走 sessionStorage 而非 keyring → API Key 丢失
- Stage 窗口显示逻辑被跳过 → L2D 无法加载
- 跨窗口通信走 BroadcastChannel 而非 Tauri IPC → 表情控制消失

**解决方案**：改回 `__TAURI_INTERNALS__`。

### 2. Rust 端 keyring miss 防御性改进

即使 keyring 中找不到密钥，也不阻断 HTTP 请求——改为继续发送（不注入 Authorization header），由远端 API 返回适当错误码。这避免了因密钥缺失导致整个请求流程中断。

修改了三个命令：`proxy_http_request`、`proxy_binary_request`、`proxy_sse_request`。

### 3. L2D 默认启用

`MainWindow` 的 `stageVisible` 初始值从 `false` 改为 `true`。

### 4. 缩放锁定状态持久化

- `stage-storage.ts` 新增 `saveScaleLock()` / `loadScaleLock()`
- `StageHost` 初始化时从 localStorage 读取缩放锁定状态，切换时自动保存

## 改动了哪些关键文件

| 文件 | 改动内容 |
|------|----------|
| `src/utils/window-sync.ts` | `__TAURI__` 改回 `__TAURI_INTERNALS__` |
| `src-tauri/src/commands/http_proxy.rs` | 三个代理命令的 keyring miss 不再阻断请求 |
| `src/app/MainWindow.tsx` | stageVisible 默认 true |
| `src/utils/stage-storage.ts` | 新增 saveScaleLock/loadScaleLock |
| `src/features/stage/StageHost.tsx` | 使用 loadScaleLock 初始化 + 切换时 saveScaleLock |

## 测试

- TypeScript 类型检查通过 (`pnpm tsc --noEmit`)
- 前端生产构建通过 (`pnpm build`)
- Rust cargo check 通过
- 需要用户在 Tauri 环境中验证：profile 恢复、连接测试、L2D 加载

## 关键教训

`__TAURI__` 和 `__TAURI_INTERNALS__` 是不同的全局变量：
- `__TAURI_INTERNALS__`：始终存在，用于内部 IPC
- `__TAURI__`：仅在 `withGlobalTauri: true` 时存在，用于暴露 JS API
