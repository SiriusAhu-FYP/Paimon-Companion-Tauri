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

### 后续验证计划（Phase 2 准备）

- 在 Tauri 窗口中调用 `getUserMedia({ audio: true })`
- 确认权限对话框行为
- 测试 `AudioContext` + `AnalyserNode` 获取实时音量数据
- 记录是否需要额外的系统权限配置

## 状态

**此 spike 为 Phase 2 做准备。基于文档判断可行，无已知阻塞风险。**
