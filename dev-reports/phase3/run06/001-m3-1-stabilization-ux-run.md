# M3.1 Stabilization / UX Run 报告

## 本次目标

完成小的稳定化与 UX 修正 run，使 M3 的真实手测条件真正具备。

## 本次完成内容

### 1. 角色卡切换入口可见性提升
- ControlPanel 中角色区域标题改为"当前角色"，更明确
- 当前激活角色以 `Chip` + `primary` 样式显示在 Select 上方，形成视觉锚点
- 下拉列表保留"默认角色（手动人设）"和所有已加载角色卡

### 2. 旧"自定义人设"链路收口
- Settings → 角色设置中的字段名从"自定义人设（附加）"改为"自定义人设（无角色卡时生效）"
- 说明文字明确：仅在"当前角色"未选择任何角色卡时生效，优先级最低
- `prompt-builder.ts` 中的优先级不变：`卡内 system_prompt > persona > scenario > customPersona > 知识`

### 3. Settings 按钮位置调整
- Settings 小齿轮从右栏底部移到顶部栏右侧（Header 右上角）
- 更符合桌面应用常见操作方式：设置入口始终可见且位于顶部

### 4. 表情栏整理
- StageHost 中的表情区从无容器改为带 `maxHeight: 80` + `overflowY: auto` 的 Box 容器
- 避免表情过多时撑爆布局，提供滚动能力

### 5. 多配置档案（Profiles）
实现最小可用的 LLM/TTS 配置档案管理：
- 类型定义：`LLMProfile`、`TTSProfile`（`src/services/config/types.ts`）
- `AppConfig` 新增 `llmProfiles[]`、`ttsProfiles[]`、`activeLlmProfileId`、`activeTtsProfileId`
- Settings 面板中两个独立区域分别管理 LLM 和 TTS 档案
- 每个区域支持：列出、新增（含内联编辑表单）、删除、选择激活项
- TTS 档案泛化（provider 可以是 `gpt-sovits` 或 `mock`），不把 TTS 等同于 GPT-SoVITS

## 关键改动

| 文件 | 改动摘要 |
|------|---------|
| `src/app/MainWindow.tsx` | Settings 齿轮移到顶部栏右上角 |
| `src/features/control-panel/ControlPanel.tsx` | 角色切换区标题改为"当前角色"，当前角色 Chip 突出显示 |
| `src/features/stage/StageHost.tsx` | 表情区加滚动容器 |
| `src/features/settings/SettingsPanel.tsx` | 自定义人设说明文字更新；新增 LLM/TTS Profiles 管理 UI |
| `src/services/config/types.ts` | 新增 `LLMProfile`、`TTSProfile` 类型；`AppConfig` 新增 profiles 字段 |
| `src/services/config/config-service.ts` | `deepMerge` 和 `resetConfig` 支持 profiles 字段 |
| `src/services/config/index.ts` | 导出 `LLMProfile`、`TTSProfile` 类型 |

## 验证情况

| 层次 | 状态 | 说明 |
|------|------|------|
| 编译 / lint | ✅ | `pnpm tsc --noEmit` 通过，无 lint 错误 |
| 浏览器端验证 | 未手测 | 需启动 `pnpm tauri dev` 亲自验证 |
| Tauri 桌面端验证 | 未手测 | 同上 |
| 角色卡切换 | 未手测 | 代码逻辑存在，需验证实际切换效果 |
| Profile 增删改查 | 未手测 | 需验证保存后重启仍保留 |

> 证据：`pnpm tsc --noEmit` 通过 / 尚未进行 `pnpm tauri dev` 手测

## 风险 / 限制 / 未完成项

- Profiles 选择后暂未联动到实际 LLM/TTS 服务实例（仅存储配置），下一步需在 `pipeline-service.ts` 或 provider 初始化链路中消费 `activeLlmProfileId`/`activeTtsProfileId`
- 角色卡切换后 LLM 对话历史清理逻辑存在（`llm.clearHistory()`），但需手测验证是否按预期工作
- TTS Profile 激活后同理，需要在 TTS 服务初始化时读取

## 结论

- 本轮代码改动就绪，TypeScript 编译通过，架构上满足最小可用要求
- 建议尽快进行 `pnpm tauri dev` 手测，验证：角色切换、Profile 增删改查、表情栏滚动、Settings 入口位置
- Profiles 联动（激活后真实切换 LLM/TTS provider）属于下一 run 的任务

## 元信息

- Commit: `e8fe58c`
- Branch: `feature/phase3-integration`
- 报告路径: `dev-reports/phase3/m3-1-stabilization-ux-run.md`
- 相关文档路径: `blueprints/phase3/phase3-blueprint.md` / 无
