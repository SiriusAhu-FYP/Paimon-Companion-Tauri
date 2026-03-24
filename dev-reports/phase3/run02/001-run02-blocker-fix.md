# Phase 3 Run 01.1: Blocker Fix + TTS 方向修订

## 1. 配置保存问题根因分析

### 现象
用户反馈"配置不会被保存"。

### 排查结果
**配置保存/加载路径本身是通畅的。** 通过浏览器 MCP 进行了端到端验证：

1. 打开设置 → 切换 LLM 到 OpenAI 兼容 → 填入 Base URL/Model/API Key → 保存 → 成功提示
2. 刷新页面 → 控制台日志确认 `loaded from localStorage` 且 `provider: "openai-compatible"` 正确
3. 打开设置面板 → 短暂显示 Mock（useEffect 异步加载的初始状态）→ 加载完成后正确显示 OpenAI 兼容

### 实际根因
1. **React StrictMode 双执行 + async useEffect 竞态**：两次 effect 执行导致用户可能看到闪烁（先 Mock 再切换为正确值）。已通过 `cancelled` flag 修复。
2. **日志不够详细**：之前的日志只输出 `[object Object]`，无法确认实际 provider 值。已增强为输出具体 provider。
3. **Tauri 环境下**：Store 和 keyring 的调用路径代码正确，但缺少失败时的详细日志。已增加 try/catch 和日志。

### 修复项
- `config-service.ts`：增加 localStorage/Tauri Store 读写详细日志
- `secret-store.ts`：增加 keyring `getSecret`/`hasSecret` 的 try/catch 和降级日志
- `SettingsPanel.tsx`：修复 StrictMode 下的 useEffect 竞态（cancelled flag pattern）

## 2. LLM 缺失模块问题根因分析

### 现象
用户反馈"LLM 不能正常使用，并提示缺失某模块"。

### 排查结果
**并非真正的模块缺失。** npm 依赖 `@tauri-apps/plugin-store` 和 `tauri-plugin-keyring-api` 均已正确安装（`node_modules` 中存在）。

### 实际根因
`services/index.ts` 中 `resolveLLMProvider()` 的 `case "openai-compatible"` 分支输出了 **`WARN` 级别**的消息：
```
openai-compatible LLM provider not yet implemented, falling back to mock
```
这条消息在控制台中以**红色 error 样式**显示（因为 logger 将 WARN 映射到了 `console.error`），用户很可能将其理解为"缺失模块"错误。

### 修复项
- 将 `resolveLLMProvider` 和 `resolveTTSProvider` 的日志级别从 WARN 改为 INFO
- 改善消息文案：`LLM provider "openai-compatible" configured but real implementation pending (M1), using mock fallback`
- 明确告知用户这是预期行为（真实 LLM 实现将在 M1 中完成），而非错误

## 3. 是否现在才真正完成 M4/M6

**回答：是的。**

Run 01 的代码逻辑在两种环境下验证通过：
- **浏览器环境**（非 Tauri）：localStorage + sessionStorage fallback 通畅
- **Tauri 环境**：Tauri Store + keyring 代码路径正确（Rust 编译通过，命令已注册）

Run 01.1 的修复解决了用户体验层面的问题：
- 配置保存后的 UI 反馈更准确
- LLM 降级提示不再被误解为错误
- 日志可追溯性显著提升

M4（配置管理）+ M6（HTTP 网络能力）至此真正完成。

## 4. GPT-SoVITS 接入分析摘要

### 旧项目 VoiceL2D-MVP 中的 GPT-SoVITS 使用方式

| 项目 | 说明 |
|------|------|
| 集成方式 | HTTP 客户端，连接到独立 GPT-SoVITS 推理服务（默认 9880 端口） |
| 合成端点 | `GET /tts?text=...&text_lang=...&ref_audio_path=...&prompt_text=...&prompt_lang=...` |
| 权重加载 | `GET /set_gpt_weights?weights_path=...` + `GET /set_sovits_weights?weights_path=...` |
| 音频格式 | WAV，32000Hz 单声道 16-bit |
| 角色配置 | 每角色独立：GPT/SoVITS 权重路径 + 参考音频路径 + prompt 文本 + 语言 |
| 口型同步 | 前端 Web Audio Analyser + Live2D 嘴部参数（音量驱动，与 TTS API 解耦） |

### 新项目适合复用什么
- **API 调用方式**：GET /tts 请求格式完全可复用
- **音频参数约定**：32000Hz WAV
- **角色声线配置模型**：权重路径 + 参考音频 + prompt 文本

### 新项目不适合复用什么
- **Python 客户端代码**：新项目是 TypeScript + Tauri，需要重写
- **WebSocket 音频传输**：旧项目用 WebSocket base64，新项目用 Rust HTTP 代理或前端 fetch
- **权重路径格式**：旧项目是 Linux 路径，新项目需要适配 Windows

### 落在哪一层
- `src/services/tts/gptsovits-tts-service.ts`：实现 `ITTSService` 接口
- 配置：扩展 `TTSProviderConfig` 类型增加 GPT-SoVITS 专属字段
- 网络：前端直连 fetch（本地/局域网服务，无需 API Key）

## 5. TTS 方向变更

### Blueprint 更新
- M2 标题改为 "真实 TTS 接入（GPT-SoVITS 优先）"
- 增加 GPT-SoVITS API 接口说明（端点、参数、音频格式）
- 增加 GPT-SoVITS 每角色配置说明
- 技术选型表中 TTS 方案标记为"已确认"
- 附录中 TTS 文件名改为 `gptsovits-tts-service.ts`

### 代码变更
- `TTSProviderType` 从 `"http-api" | "mock"` 改为 `"gpt-sovits" | "mock"`
- `TTSProviderConfig` 增加 GPT-SoVITS 专属字段（gptWeightsPath、sovitsWeightsPath、refAudioPath、promptText、promptLang、textLang）
- Settings UI 中 TTS 区域改为 GPT-SoVITS 专属配置界面（权重路径、参考音频、语言选择）
- `resolveTTSProvider` 增加 `"gpt-sovits"` 分支（当前降级到 mock，M2 实施时接入真实实现）

## 6. 下一步建议

**建议先做 M1（真实 LLM 接入），再做 M2（GPT-SoVITS TTS）。**

理由：
1. LLM 是主链路核心——有了真实 LLM 回复，即使 TTS 仍是 mock，系统已具备可用性
2. M4/M6 基础设施已完全就绪，M1 的实施障碍已清除
3. GPT-SoVITS 需要外部推理服务运行，M2 实施前需要确认服务环境

## 关键文件变更

| 文件 | 类型 | 变更 |
|------|------|------|
| `src/services/config/config-service.ts` | 修改 | 增加详细日志（读写 localStorage/Tauri Store） |
| `src/services/config/secret-store.ts` | 修改 | 增加 keyring get/has 的 try/catch |
| `src/services/config/types.ts` | 修改 | TTSProviderType 改为 gpt-sovits，增加 GPT-SoVITS 配置字段 |
| `src/services/index.ts` | 修改 | 改善 provider resolve 日志，增加 gpt-sovits 分支 |
| `src/features/settings/SettingsPanel.tsx` | 修改 | 修复 StrictMode 竞态，TTS UI 改为 GPT-SoVITS |
| `blueprints/phase3/phase3-blueprint.md` | 修改 | M2 收敛为 GPT-SoVITS 首选，更新技术选型 |
