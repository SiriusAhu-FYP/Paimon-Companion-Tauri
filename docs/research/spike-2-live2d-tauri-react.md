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

---

## 实机验证结果（Phase 1.1）

### 环境

- **OS**: Windows 10 (10.0.26200)
- **Tauri**: 2.x，WebView2 (Chromium-based)
- **Rust**: 1.94.0
- **Node**: pnpm 管理
- **Cubism Core SDK**: v5.1.0 (从旧项目 `VoiceL2D-MVP` 复制)
- **测试模型**: Hiyori (Cubism 4 moc3 格式)

### 验证步骤

1. 复制 Cubism Core SDK 到 `public/Core/`
2. 复制 Hiyori 模型到 `public/Resources/Hiyori/`
3. 在 `index.html` 中添加 `<script src="/Core/live2dcubismcore.min.js"></script>`
4. 安装 `pixi.js@6.5.10` 和 `pixi-live2d-display@0.4.0`
5. 修改 `Live2DPreview` 组件，使用 `useRef` + `useEffect` + PIXI.Application 动态加载模型
6. 运行 `pnpm tauri dev`

### 关键发现

- **导入路径很重要**：必须使用 `import { Live2DModel } from "pixi-live2d-display/cubism4"` 而非默认导入。默认导入会尝试加载 Cubism 2 运行时（`live2d.min.js`），导致报错 "Could not find Cubism 2 runtime"。
- **PixiJS 6 + WebGL 2**：控制台确认 `PixiJS 6.5.10 - ✰ WebGL 2 ✰`，WebView2 完全支持 WebGL 2。
- **Cubism Core 加载**：控制台输出 `Live2D Cubism Core version: 05.01.0000`，`CubismFramework.startUp() is complete`，`CubismFramework.initialize() is complete`。
- **模型渲染成功**：Hiyori 角色在主窗口的角色预览区完整渲染，包括纹理、物理效果、待机动画。

### 结果

✅ **完全成功**。Live2D Cubism 4 模型在 Tauri WebView2 中通过 pixi.js + pixi-live2d-display 正常渲染。

### 对后续 phase 的影响

- Live2D 渲染路径已打通，后续 Phase 可以直接在此基础上集成表情切换、口型同步
- 模型切换（加载不同 model3.json）的逻辑可在 CharacterService 中实现
- 需要注意 `pixi-live2d-display` 仍使用 pixi.js v6 API，如果未来升级 pixi.js 需关注兼容性

---

## 表情驱动验证结果（Phase 1 Close-out）

### 验证内容

将 `character:expression` 事件真正接到 Live2D 渲染层，验证参数覆盖能否驱动模型表情变化。

### 关键发现

- **Hiyori 模型没有 Expressions 文件**，只有 Motions（Idle × 9, TapBody × 1）
- 解决方案：直接操作 Cubism Core 参数（`rawModel.parameters.values[i]`），每帧在 PIXI ticker 中施加覆盖
- 参数覆盖必须持续施加，因为 idle 动画会在每帧重置参数

### 情绪 → 参数映射

| 情绪 | 关键参数 | 视觉效果 |
|------|---------|---------|
| neutral | 无覆盖 | 自然表情 |
| happy | ParamMouthForm=1, ParamEyeLSmile=1 | 嘴角上扬 + 眯眼笑 |
| sad | ParamEyeL/ROpen=0.35, ParamMouthForm=-0.6 | 半闭眼 + 嘴角下垂 |
| angry | ParamBrowL/RY=-1, ParamAngleZ=-5 | 皱眉 + 微侧头 |
| surprised | ParamEyeL/ROpen=1.3, ParamMouthOpenY=0.6 | 瞪大眼 + 张嘴 |

### 结果

✅ **表情切换已真正生效**。从截图对比可以清晰看到不同情绪之间的视觉差异。事件总线 → CharacterService → character:expression → Live2DPreview 的完整链路已打通。

## 结论

**可行——已实机验证通过。** Live2D + PIXI + Cubism 4 在 Tauri WebView2 中渲染正常，表情参数驱动已验证。无阻塞风险。
