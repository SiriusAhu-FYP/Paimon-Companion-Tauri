# features/live2d/

Live2D 角色渲染与状态管理模块。

## 职责

- Cubism SDK / pixi-live2d-display 初始化与渲染
- 角色模型加载与切换
- 表情（Expression）与动作（Motion）触发
- 角色状态同步（与事件总线对接）
- 渲染画布管理（单一渲染真源，供监控预览和 OBS 输出共用）
