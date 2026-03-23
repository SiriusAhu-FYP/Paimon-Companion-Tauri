# Phase 3 Run 02: M4 配置管理 + M6 网络能力

## 完成内容

### M4: 配置管理基础

**分层存储架构已建立：**

| 类别 | 内容 | 存储方案 | 安全级别 |
|------|------|---------|---------|
| 普通配置 | provider 类型、base URL、model、temperature、speaker | `tauri-plugin-store` (明文 JSON) | 低 |
| 敏感配置 | API Key、Token | `tauri-plugin-keyring` (Windows Credential Locker) | 高 |
| 开发 fallback | 普通 → localStorage / 敏感 → sessionStorage | 非 Tauri 环境降级 | 临时 |

**设置界面已实现：**
- Settings 面板作为右栏可切换视图（齿轮按钮入口）
- 分区：LLM 设置、TTS 设置、角色设置
- API Key 带遮罩输入，保存后写入系统钥匙串
- 缺少必要配置时显示警告提示
- 保存/恢复默认功能
- provider 选择 mock 时不显示详细配置字段

**配置驱动框架已建立：**
- `services/index.ts` 中 `resolveLLMProvider()` / `resolveTTSProvider()` 根据配置选择实现
- 当前非 mock provider 降级到 mock 并输出警告
- `main.tsx` 改为 async bootstrap，在 React 渲染前加载配置

### M6: 网络能力

**Rust 侧 HTTP 代理已实现：**
- `proxy_http_request`：通用 HTTP 代理，支持从 keyring 自动注入 Bearer token
- `proxy_sse_request`：SSE 流式代理，通过 Tauri event channel 推送 chunks
- 前端 `proxyRequest()` / `proxySSERequest()` 封装，非 Tauri 环境降级到 `fetch`

**网络分层策略：**

| 场景 | 调用路径 | 密钥位置 |
|------|---------|---------|
| 云端 API（带 API Key） | invoke → Rust reqwest | 仅 Rust 进程内 |
| 本地/局域网服务 | 前端直接 fetch | 无密钥 |

**连接测试：**
- Settings 面板中 LLM/TTS 区域各有"测试连接"按钮
- DevTools `__paimon.testProxy(url)` / `__paimon.testSecretProxy(url, secretKey)`

## 新增/修改文件

### Rust 侧

| 文件 | 类型 | 说明 |
|------|------|------|
| `src-tauri/Cargo.toml` | 修改 | 新增 tauri-plugin-store、tauri-plugin-keyring、reqwest、tokio、futures-util |
| `src-tauri/src/lib.rs` | 修改 | 注册 store/keyring 插件 + invoke handler |
| `src-tauri/src/commands/mod.rs` | 修改 | 导出 secret、http_proxy 模块 |
| `src-tauri/src/commands/secret.rs` | 新建 | keyring CRUD 命令 |
| `src-tauri/src/commands/http_proxy.rs` | 新建 | HTTP 代理 + SSE 流式代理 |
| `src-tauri/capabilities/default.json` | 修改 | 添加 store:default、keyring:default |

### 前端

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/services/config/types.ts` | 新建 | 配置类型定义 + 默认值 |
| `src/services/config/config-service.ts` | 新建 | Store / localStorage 配置读写 |
| `src/services/config/secret-store.ts` | 新建 | keyring / sessionStorage 敏感配置封装 |
| `src/services/config/http-proxy.ts` | 新建 | HTTP 代理 / fetch 封装 |
| `src/services/config/index.ts` | 新建 | 模块导出 |
| `src/features/settings/SettingsPanel.tsx` | 新建 | 设置界面 + 连接测试 |
| `src/features/settings/index.ts` | 新建 | 模块导出 |
| `src/services/index.ts` | 修改 | 配置驱动 provider 选择 |
| `src/main.tsx` | 修改 | async bootstrap，loadConfig 前置 |
| `src/app/MainWindow.tsx` | 修改 | 右栏设置/控制面板切换 |
| `src/utils/mock.ts` | 修改 | 暴露 testProxy/testSecretProxy |
| `package.json` | 修改 | 新增 @tauri-apps/plugin-store、tauri-plugin-keyring-api |

## 配置策略与安全边界说明

### 安全原则
1. **API Key 不进前端 JS 运行时**（云端场景）：云端 API 调用走 Rust invoke 代理，Rust 从系统钥匙串读取密钥，注入 Authorization header 后发起请求
2. **本地服务可直连**：localhost/局域网地址走前端 fetch，无密钥泄露风险
3. **SecretStore 接口抽象**：当前实现为 keyring 后端，后续可替换为 Stronghold 或其他方案
4. **开发期 fallback**：非 Tauri 环境（浏览器 dev server）降级到 sessionStorage / 直接 fetch

### Mock 保留策略
- 配置中 `provider: "mock"` 时使用 Mock 实现
- 缺少配置时自动降级到 mock，不 crash
- 真实 provider 尚未实现时，降级到 mock 并输出控制台警告

## 验证结果

- TypeScript 编译零错误
- Rust 编译零错误零警告
- 所有新增/修改文件 lint 通过
- 不改变 Pipeline、LLM 门面、TTS 接口、Stage、Live2D 等现有模块

## 下一步建议

M4/M6 基础设施已就绪，**建议进入 M1（真实 LLM 接入）**：
1. 配置管理和安全存储已建立
2. HTTP 代理（含 SSE 流式）已可用
3. `services/index.ts` 的 `resolveLLMProvider` 已预留 switch 分支
4. 只需实现 `OpenAILLMService`（遵循 `ILLMService` 接口）并在 switch 中注册
