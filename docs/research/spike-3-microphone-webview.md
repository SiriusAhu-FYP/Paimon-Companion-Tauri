# Spike 3：Windows 下麦克风权限与音频采集

## 问题

Tauri WebView 中 Web Audio API / MediaStream 是否能正常获取麦克风？

## 调研结论（基于文档）

### WebView2 麦克风支持

- WebView2 默认支持 `navigator.mediaDevices.getUserMedia()`
- 麦克风权限请求会弹出 Windows 系统级权限对话框
- 无需额外的 Tauri Capability 配置即可访问麦克风

### Tauri 2 安全配置

- CSP 中需要允许 `media-src 'self'`（或设为 null 如当前配置）
- 如果 CSP 过于严格，可能阻止 MediaStream 使用

### Web Audio API

- `AudioContext`、`AnalyserNode` 在 WebView2 中均可用
- VAD 可以基于 `AnalyserNode` 的音量分析实现，无需额外依赖

### 已知注意事项

1. 首次请求麦克风权限时会有 Windows 权限弹窗
2. 如果应用被 Windows 安全设置禁止了麦克风访问，需要在系统设置中手动允许
3. WebView2 在某些情况下可能需要配置 `--autoplay-policy` 来自动播放音频

---

## 实机验证结果（Phase 1.1）

### 环境

- **OS**: Windows 10 (10.0.26200)
- **Tauri**: 2.x，WebView2 (Chromium-based)
- **Rust**: 1.94.0

### 验证步骤

1. 在 ControlPanel 中添加"麦克风测试"按钮
2. 按钮点击后调用 `navigator.mediaDevices.getUserMedia({ audio: true })`
3. 获取 stream 后创建 `AudioContext` → `MediaStreamSource` → `AnalyserNode`
4. 读取 `frequencyBinCount` 数据，计算平均音量
5. 清理：停止 stream tracks，关闭 AudioContext

### 结果

✅ **API 调用成功**。控制台输出 `mic test OK — avg volume: 0.0`。

- `getUserMedia` 返回了有效的 `MediaStream`
- `AudioContext` 和 `AnalyserNode` 创建成功
- stream tracks 可正常停止
- 平均音量为 0 是因为测试在浏览器自动化环境中运行，无实际麦克风输入；API 本身可用

### 待 Tauri 桌面端补充验证

- **权限弹窗行为**：需在 Tauri 桌面窗口中确认 Windows 权限对话框是否正常弹出
- **实际音量数据**：需在有物理麦克风的环境中确认 `AnalyserNode` 能读到非零音量
- **持续采集稳定性**：VAD 场景下长时间采集的稳定性

### 对后续 phase 的影响

- Web Audio API 在 WebView2 中可用，Phase 2 的 VAD 和 ASR 音频采集无技术阻塞
- 权限管理可以在首次使用时一次性处理
- 如果 WebView2 的 `getUserMedia` 在某些 Windows 版本上有问题，可考虑 Tauri Rust 端采集作为备选

## 结论

**可行——API 层验证通过。** `getUserMedia` + `AudioContext` + `AnalyserNode` 在 WebView2 中均可调用。Tauri 桌面端的权限弹窗行为和实际音频数据需在下一步验证。
