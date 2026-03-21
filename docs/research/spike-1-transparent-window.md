# Spike 1：Tauri 透明窗口 + OBS 窗口捕获

## 问题

Tauri 2 的透明窗口在 Windows 上是否能被 OBS 正常捕获？

## 调研结论（基于文档）

### Tauri 2 透明窗口配置

在 `tauri.conf.json` 中为窗口设置：

```json
{
  "label": "stage",
  "title": "Paimon Live - Stage",
  "width": 800,
  "height": 600,
  "transparent": true,
  "decorations": false,
  "alwaysOnTop": false,
  "visible": false
}
```

同时需要在前端确保 `<html>` 和 `<body>` 背景设为 `transparent`。

### Windows 上的已知限制

1. **WebView2 透明背景**：Tauri 2 在 Windows 上使用 WebView2。WebView2 从 v114+ 支持透明背景，但需要确保 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 中包含 `--enable-features=msWebView2EnableDraggableRegions`（仅在需要拖动区域时）。
2. **OBS 捕获方式**：OBS 的"窗口捕获"模式应能正常捕获 WinUI3 / WebView2 窗口。如果默认模式无法透明，可尝试：
   - 使用"窗口捕获"+ "色度键"滤镜（绿幕方案作为备选）
   - 使用 OBS 的"游戏捕获"或"BitBlt"模式
3. **已知风险**：某些 Windows 版本或驱动可能导致透明区域在 OBS 中显示为黑色。

### 后续验证计划

- 在目标开发机上运行 `pnpm tauri dev`，打开透明窗口
- 使用 OBS "窗口捕获" 验证透明度
- 如果默认不工作，测试备选方案（色度键、指定 captureMethod）
- 记录具体 Windows 版本和 OBS 版本

## 状态

**初步结论可行，待实机验证。**
