# Spike 2：Live2D 在 Tauri + React 下的加载

## 问题

pixi.js + pixi-live2d-display 在 Tauri WebView 中是否能正常工作？

## 调研结论（基于旧项目和文档）

### 旧项目 VoiceL2D 的实现

旧项目已验证 pixi.js + pixi-live2d-display 可以在浏览器环境中正常工作：
- 使用 `pixi.js@6.5.10` + `pixi-live2d-display@0.4.0`
- Cubism Core SDK 通过 `<script>` 标签在 `index.html` 中加载
- 模型文件放在 `public/Resources/` 目录下

### Tauri WebView 环境

- Tauri 2 的 WebView2 本质上是 Chromium 内核，兼容标准 Web API
- pixi.js 使用 WebGL/Canvas 2D 渲染，WebView2 支持这两种后端
- Cubism Core SDK 是一个 JS 库，不依赖 Node.js，可以在 WebView 中运行

### 集成方式推荐

1. **Cubism Core SDK**：在 `index.html` 中通过 `<script>` 标签加载（与旧项目一致），放在 `public/Core/` 目录
2. **pixi.js 版本**：锁定 `pixi.js@6.x`（v7+ 的 API 变化较大，pixi-live2d-display 尚未完全适配）
3. **模型文件**：放在 `public/Resources/` 目录，通过相对路径加载
4. **React 集成**：使用 `useRef` + `useEffect` 管理 PIXI.Application 生命周期

### 依赖版本锁定

```
pixi.js@6.5.10
pixi-live2d-display@0.4.0
```

### 后续验证计划

- 从旧项目复制 Cubism Core SDK 和测试模型
- 安装 pixi.js + pixi-live2d-display
- 创建最小渲染组件，验证模型加载和表情/动作切换
- 确认 WebView2 中 WebGL 渲染无异常

## 状态

**基于旧项目经验高度可行，待实际集成验证。**
