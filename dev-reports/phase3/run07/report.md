# Run 07 — TTS 合成静默失败诊断与错误信息透传（续）

## 本次目标
- 上轮修复后，用户测试仍报 502 错误：`GPT 权重加载失败 (HTTP 502)`
- 参考 `VoiceL2D-MVP` 中的正确实现进行修复

## 本次完成内容

### 1. 根因定位

通过对比 `VoiceL2D-MVP/client/utils/tts_controller.py`（Python `requests`）和当前实现，发现 502 错误的根因：

**Windows 系统代理问题**。reqwest 在 Windows 上使用 WinHTTP，默认会读取系统代理设置。如果用户系统配置了代理（VPN、Charles 等），HTTP 请求会被发到代理，代理转发到 `api.siriusahu.online` 时失败返回 502。

VoiceL2D-MVP 的 Python `requests` 库在 Windows 上同样受系统代理影响，但可能 VoiceL2D-MVP 运行时没有开启代理，或者用户的使用场景不同。

### 2. 修复方案

**Rust 端：禁用 reqwest 的系统代理**

修改 `src-tauri/src/commands/http_proxy.rs`，三个 proxy 函数全部改用：

```rust
let client = Client::builder()
    .no_proxy()
    .build()
    .map_err(|e| format!("failed to create HTTP client: {e}"))?;
```

原来使用的是 `Client::new()`，现在改为 `.builder().no_proxy().build()`。

**TypeScript 端：移除 encodeURIComponent**

修改 `src/services/tts/gptsovits-tts-service.ts`，移除权重路径参数的手动 `encodeURIComponent` 编码，和 VoiceL2D-MVP 保持一致——让路径中的 `/` 保持原样，由 HTTP 库自动处理。

### 3. SpeechQueue 错误透传（上轮已完成）

`SpeechQueue.speakAll()` 返回 `SpeakAllResult`，暴露错误信息给 UI。

## 关键改动

| 文件 | 改动 |
|------|------|
| `src-tauri/src/commands/http_proxy.rs` | `Client::new()` → `Client::builder().no_proxy().build()`，禁用系统代理 |
| `src/services/tts/gptsovits-tts-service.ts` | 移除权重路径的 `encodeURIComponent`，路径原样传递 |
| `src/services/tts/speech-queue.ts` | 新增 `SpeakAllResult` 接口，`speakAll()` 返回错误统计 |
| `src/features/settings/SettingsPanel.tsx` | `handleTestTTSDirect` 精确显示合成结果状态 |
| `src-tauri/Cargo.toml` | reqwest 显式添加 `native-tls` |

## 验证情况

| 层次 | 状态 | 说明 | 证据 |
|------|------|------|------|
| 编译 / lint | ✅ | Rust + TypeScript 编译均通过 | `cargo build` / `tsc --noEmit` |
| curl 验证远端服务 | ✅ | `%2F` 编码权重路径返回 HTTP 200, 0.32s | curl 测试 |
| Tauri 桌面端验证 | ⏳ | 需用户手动测试 | — |

## 风险 / 限制 / 待办

1. **需要用户重新测试**：禁用系统代理后，502 问题应该解决
2. **测试步骤**：
   - 启动 Tauri 应用
   - 编辑 TTS Profile，确认配置：
     - 服务地址：`http://api.siriusahu.online`
     - GPT 权重：`/home/ahu/fyp-tts/GPT-SoVITS-Inference/daikenja/daikenja-e15.ckpt`
     - SoVITS 权重：`/home/ahu/fyp-tts/GPT-SoVITS-Inference/daikenja/daikenja_e8_s104.pth`
     - 参考音频：`/home/ahu/fyp-tts/GPT-SoVITS-Inference/daikenja/ユニークスキル捕食者の胃袋に収納されています .wav`
     - 参考文本：`ユニークスキル捕食者の胃袋に収納されています`
     - 参考语言：`ja`
   - 点击"合成并播放"
3. **如果仍有问题**：请提供 Alert 中显示的具体错误信息

## 结论
- 根因：Windows 系统代理导致 reqwest 请求被转发到代理服务器，代理无法访问 `api.siriusahu.online` 返回 502
- 修复：Rust 端禁用 `no_proxy()`，TypeScript 端移除手动 `encodeURIComponent`
- 等待用户验证

## 元信息
- Commit: 待提交
- Branch: `feature/phase3-integration`
- 报告路径: `dev-reports/phase3/run07/report.md`
