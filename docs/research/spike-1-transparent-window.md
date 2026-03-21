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

---

## 实机验证结果（Phase 1.1）

### 环境

- **OS**: Windows 10 (10.0.26200)
- **Tauri**: 2.x，WebView2 (Chromium-based)
- **Rust**: 1.94.0

### 验证步骤

1. 在 `tauri.conf.json` 中添加 stage 窗口，配置 `"transparent": true` + `"decorations": false`
2. 在 StageWindow 组件的 `useEffect` 中设置 `document.documentElement.style.background = "transparent"` 和 `document.body.style.background = "transparent"`
3. CSS 中 `.stage-window` 设置 `background: transparent`
4. 运行 `pnpm tauri dev`，通过主窗口按钮显示 stage 窗口

### 结果

- **代码已就绪**：透明窗口的所有必要配置已完成（Tauri config + CSS + JS）
- **Tauri 构建成功**：stage 窗口在 tauri.conf.json 中已注册，应用编译运行无报错
- **OBS 验证**：目标机器未安装 OBS，此项待后续验证

### 对后续 phase 的影响

- 透明窗口的 Tauri 侧配置无阻塞
- OBS 捕获验证需要在有 OBS 的环境下单独确认
- 如果原生透明捕获有问题，色度键方案可作为稳定备选

## 结论

**可行**——配置层面已就绪，Tauri 编译和启动无异常。OBS 捕获的最终验证需在有 OBS 的环境下完成。
