# Phase 2 Run06 — 模型控制重写 + 多模型支持 + DPI + 边框修复

## 问题 1: 模型完全不受控制（表情/口型/motion）

### 根因（深层）

之前的 `Live2DRenderer` 实现有三个根本性错误：

1. **表情驱动方式错误**：手动在每帧 ticker 中用 `rawModel.parameters.values[i]` 直接写入参数值。这与 Cubism 内部的 motion 系统、physics 系统冲突。motion 系统在同一帧也会写入同名参数，导致参数值每帧被覆盖两次，视觉表现混乱。

2. **口型驱动方式错误**：同样通过直接写 `rawModel.parameters.values` 实现，但 Cubism 4 的 motion 系统在 `updateParam` 阶段会重置所有由 motion 管理的参数（包括 LipSync 组中的参数），导致口型值被覆盖。

3. **表情/motion 混用**：`setEmotion()` 同时修改参数表和触发 motion 播放，两套逻辑互相冲突。

### 修复方案（参照 VoiceL2D-MVP 的正确实现）

完全重写 `Live2DRenderer`，采用 pixi-live2d-display 的正确 API：

| 功能 | 旧实现（错误） | 新实现（正确） |
|------|---------------|---------------|
| 表情 | 手动每帧写 rawModel.parameters | `model.expression(name)` — 使用模型 .exp3.json |
| 口型 | ticker 中写 rawModel.parameters | `beforeModelUpdate` 钩子 + `coreModel.setParameterValueById()` |
| Motion | 在 setEmotion 中硬编码触发 | `model.motion(group, index)` 独立入口 |
| DPI | 未考虑 devicePixelRatio | `resolution: dpr` + `autoDensity: true` |

口型关键改变：使用 `internalModel.on("beforeModelUpdate", handler)` 钩子，在 motion 系统处理之前写入 `ParamMouthOpenY`，通过 `setParameterValueById` 正确 API 设置参数值并带 weight=1.0。

## 问题 2: 多模型支持

### 实现
- 从 `E:\FYP-PROJECT\core\VoiceL2D-MVP\frontend\public\Resources` 复制所有模型到 `public/Resources/`
- 创建 `src/features/live2d/model-registry.ts`，包含 8 个模型
- 默认模型：英伦兔兔
- 控制面板增加 MUI Select 下拉框切换模型
- 通过 `set-model` 控制命令通知 Stage 窗口切换

### 动态表情按钮
- Stage 加载模型后，读取 `model3.json` 中的 Expressions 列表
- 通过 `report-expressions` 控制命令汇报给主窗口
- ControlPanel 动态渲染表情按钮
- 点击通过 `set-expression` 命令发送到 Stage

## 问题 3: 清晰度/DPI

### 修复
- PIXI Application 创建时传入 `resolution: devicePixelRatio` + `autoDensity: true`
- Canvas CSS 保持逻辑像素，WebGL backing store 按物理像素渲染
- resize 时重新读取 DPR

## 问题 4: clean 模式边框

### 根因
`StageSlot` 在 `isActive && !isClean` 为 false 时仍设置 `border: "1px dashed"`，透过透明的 Stage 窗口可见。

### 修复
clean 模式下 `border: "none"`。

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/features/live2d/live2d-renderer.ts` | 完全重写：expression API、beforeModelUpdate 口型、DPI |
| `src/features/live2d/model-registry.ts` | 新增：模型注册表 |
| `src/features/live2d/index.ts` | 导出 MODEL_REGISTRY、DEFAULT_MODEL |
| `src/features/live2d/Live2DPreview.tsx` | 适配新 API |
| `src/features/stage/StageWindow.tsx` | 重写：模型切换、表情命令、移除旧 stateSync |
| `src/features/stage/StageSlot.tsx` | clean 模式 border:none |
| `src/features/control-panel/ControlPanel.tsx` | 模型切换下拉框、动态表情按钮 |
| `src/utils/window-sync.ts` | 新增 set-model、set-expression、report-expressions 命令 |
| `src/utils/mock.ts` | mockVoicePipeline 走完整 pipeline |
| `src/main.tsx` | character:expression → broadcastControl set-expression |
| `public/Resources/` | 复制全部模型资源 |

## 验证

- `npx tsc --noEmit` 通过
- 0 个 lint 错误

## 还需手测确认

1. 英伦兔兔的表情 .exp3.json 是否能正确切换
2. mock pipeline 口型是否在 Stage 中可见变化
3. OBS 放大后清晰度是否改善
4. clean 模式边框是否消失
5. 模型切换后 Stage 是否正确重新加载

## Commit

待提交后补充 hash。
