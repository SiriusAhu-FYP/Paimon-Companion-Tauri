# M3.1 UX / Settings 收尾 Run 报告

## 本次目标

将 profiles、settings 入口和表情区整理到真正可用的状态，针对上一轮反馈的问题进行 UX 收尾。

## 本次完成内容

### 1. Profile UI 交互重构为"下拉选择 + 编辑 Dialog"模式

**LLM / TTS 均采用相同交互模型：**

- Settings 面板中只显示一行：`[下拉选择] [✏️编辑] [➕新增]`
- 下拉框默认选项："无（使用手动配置）"
- 编辑按钮：打开 Dialog 进行编辑（disabled 状态当无档案时）
- 新增按钮：打开 Dialog 创建新档案

**Dialog 编辑视图支持：**
- 新增 / 编辑 / 删除 / 选择激活项
- 不点击 Dialog 内"保存"或外部"设置保存"则不持久化
- 删除仅在有多于 1 个档案时显示（避免误删最后一个个档案）

**TTS Dialog 特别处理：**
- 根据选择的 `provider` 类型动态显示字段
- 当前只有 GPT-SoVITS 和 Mock 两个选项
- GPT-SoVITS 专属字段（gptWeightsPath、sovitsWeightsPath 等）仅在选择 GPT-SoVITS 时显示
- 保持 provider-agnostic 扩展性

### 2. Settings 齿轮位置（已在上一轮完成）

Settings 小齿轮已移至顶部栏右上角，符合桌面应用常见操作方式。

### 3. 表情栏收口（已在上一轮完成）

表情区已改为带 `maxHeight: 80` + `overflowY: auto` 的滚动容器。

### 4. 旧"自定义人设"收口（已在上一轮完成）

说明文字已更新为"自定义人设（无角色卡时生效）"，明确优先级和生效条件。

## 关键改动

| 文件 | 改动摘要 |
|------|---------|
| `src/features/settings/SettingsPanel.tsx` | 重构 LLM/TTS Profile 区为"下拉选择 + 编辑 Dialog"交互；TTS Dialog 根据 provider 类型动态显示字段 |

## 验证情况

| 层次 | 状态 | 说明 |
|------|------|------|
| 编译 / lint | ✅ | `pnpm tsc --noEmit` 通过，无 lint 错误 |
| 浏览器端验证 | 未手测 | 需启动 `pnpm tauri dev` 亲自验证 |
| Tauri 桌面端验证 | 未手测 | 同上 |
| Profile 下拉 + Dialog 交互 | 未手测 | 代码逻辑存在，需验证 Dialog 打开/关闭行为 |
| TTS provider 动态字段切换 | 未手测 | 需要选择 GPT-SoVITS 后验证字段是否隐藏/显示 |

> 证据：`pnpm tsc --noEmit` 通过 / 尚未进行 `pnpm tauri dev` 手测

## 风险 / 限制 / 未完成项

- Profile 选择后尚未联动到实际 LLM/TTS 服务实例（仅存储配置在 AppConfig 中），下一 run 需在 pipeline-service.ts 或 provider 初始化链路中消费 `activeLlmProfileId`/`activeTtsProfileId`
- Dialog 取消操作是否正确还原状态（未点击保存时应不改变 config）需手测验证

## 结论

- 本轮代码改动就绪，TypeScript 编译通过，Profile UI 交互更紧凑
- 建议尽快进行 `pnpm tauri dev` 手测
- Profile 联动（激活后真实切换 provider）属于下一 run 的任务

## 元信息

- Commit: `9d14c3f`
- Branch: `feature/phase3-integration`
- 报告路径: `dev-reports/phase3/m3-1-ux-settings-run.md`
- 相关文档路径: `blueprints/phase3/phase3-blueprint.md`
