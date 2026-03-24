# Phase 3 Run 03 — M1: 真实 LLM 接入

## 概要

实现了 OpenAI 兼容的真实 LLM provider（`OpenAILLMService`），替换 `MockLLMService`，通过 Rust SSE 代理实现流式响应，保留 mock 回退。

## 改动文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/services/llm/openai-llm-service.ts` | 新建 | OpenAI 兼容 LLM provider 实现，含 SSE 帧解析、tool calling、浏览器 dev 降级 |
| `src/services/llm/index.ts` | 修改 | 导出 `OpenAILLMService` |
| `src/services/index.ts` | 修改 | `resolveLLMProvider` 注册 `openai-compatible` 分支，缺配置时降级到 mock |
| `src/features/chat/ChatPanel.tsx` | 修改 | 新增 `llm:error` 事件监听，错误时恢复 UI 输入状态并显示错误消息 |

## 未改动的文件（边界承诺）

- `src/services/llm/llm-service.ts` — 门面层不变
- `src/services/llm/types.ts` — ILLMService 接口不变
- `src/services/pipeline/pipeline-service.ts` — 编排逻辑不变
- `src/services/config/http-proxy.ts` — 已有 proxySSERequest 能力足够
- `src-tauri/src/commands/http_proxy.rs` — Rust 代理不变
- `src/features/settings/*` — 设置 UI 不变
- `src/features/stage/*` — Stage 不动

## 当前支持的 LLM 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `provider` | `"mock"` 或 `"openai-compatible"` | `"mock"` |
| `baseUrl` | OpenAI 兼容 API 的 base URL | `""` |
| `model` | 模型名称（如 `gpt-4o`） | `""` |
| `temperature` | 生成温度 | `0.7` |
| `maxTokens` | 最大 token 数 | `2048` |
| API Key | 存储在系统 keyring 中（key: `llm-api-key`） | - |

## 核心设计

### SSE 流式链路

```
用户输入 → PipelineService → LLMService门面 → OpenAILLMService
  → proxySSERequest (Tauri) / directSSEFetch (浏览器 dev)
  → SSE 帧解析（buffer + \n 切分 + data: 前缀解析）
  → yield LLMChunk { delta | tool-call | done }
```

### 环境适配

- **Tauri 环境**：通过 Rust SSE 代理（`proxy_sse_request`），API Key 从 keyring 注入，不进入前端 JS
- **浏览器 dev 环境**：降级到 `fetch + ReadableStream`，不注入密钥，30s 超时

### 错误处理

- API 错误 → `LLMService` catch → emit `llm:error` → ChatPanel 显示 `[错误] xxx` 并恢复输入状态
- JSON 解析失败 → 跳过该帧，记日志
- 网络超时 → abort + 错误提示
- 配置缺失（无 baseUrl/model）→ 自动降级到 mock

## 验证结果

| 场景 | 结果 |
|------|------|
| mock provider 正常工作 | ✅ 发送消息收到 mock 回复，情绪正确变化 |
| openai-compatible 配置后 provider 正确初始化 | ✅ 日志显示 `using OpenAI-compatible LLM provider` |
| 配置持久化后重启恢复 | ✅ 刷新后 OpenAILLMService 被正确实例化 |
| baseUrl/model 缺失时降级到 mock | ✅ 日志确认降级 |
| TypeScript 编译 | ✅ 零错误 |
| Lint 检查 | ✅ 零错误 |
| 控制面板/Stage 行为无变化 | ✅ 无影响 |

### 待 Tauri 环境验证

- 真实 API Key → keyring → Rust 代理 → OpenAI API 的完整流式链路
- Rust 侧超时和错误处理

## 额外修复

### ChatPanel 错误恢复

发现 ChatPanel 未监听 `llm:error` 事件，导致 LLM 请求失败时 UI 会卡在"等待回复中..."状态。新增了 `llm:error` 监听器：
- 清空 streaming buffer
- 在对话中显示 `[错误] {error message}`
- 将 status 重置为 `idle`

### directSSEFetch 超时

在浏览器 dev 环境的 `directSSEFetch` 中添加了 30s `AbortController` 超时，防止对无效 API 的请求无限等待。

## 下一步建议

建议先做 **M2（GPT-SoVITS 真实 TTS）**，因为：
1. TTS 方向已在 blueprint 中明确收敛为 GPT-SoVITS 优先
2. LLM + TTS 联通后可以形成完整的 "输入→思考→说话" 主链路
3. M3（知识注入）依赖 LLM 能力已就位，但不急于在 TTS 之前做
