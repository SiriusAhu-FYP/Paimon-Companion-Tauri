# 右栏 UI 重构优化

## 本次目标

重构右栏 UI 结构，解决设置/知识库面板布局混乱、角色设置位置不当、知识库 UI 风格不统一、文档管理缺失批量操作和删除确认等问题。同时修复模型切换竞态 bug，增强事件日志功能，新增 Stage 窗口透明穿透模式。

## 本次完成内容

### Run A：设置面板分层重组 + 角色设置迁移
- 设置面板改为两级布局：第一级为配置档案（LLM/TTS），第二级为连接测试
- 移除角色设置、直播行为约束，迁移到控制面板
- 控制面板中新增角色设置（自定义人设）和直播行为约束，紧跟角色卡切换区域

### Run B：知识库面板 UI 统一
- 知识库面板改为与设置面板相同的两级布局：配置档案在上、连接测试在下
- SectionTitle 样式统一为与 SettingsPanel 相同的 caption 风格
- Embedding/Rerank 的 Select 改为与 LLM/TTS 相同的 Select+Edit+Add 布局
- Popover 编辑区域统一为与 SettingsPanel 相同的锚定弹出样式
- 新增知识库管理分级标题

### Run C：知识库增强
- 索引说明大段文字收入 HelpTooltip（multiline 模式）
- HelpTooltip 组件增强：支持 `multiline` prop，多行内容宽度更大、换行友好
- 文档列表新增批量管理：Checkbox 全选/单选 + 批量删除按钮
- 删除操作新增内联二次确认（带 2s 倒计时），与 SettingsPanel 档案删除样式一致
- 所有确认框均在右栏内显示，不使用浏览器 confirm

### Run D：模型切换竞态 bug 修复
- `KnowledgeService.initialize()` 引入 `initializePromise` 互斥，防止并发初始化交叉写入
- `reinitialize()` 改为先 await 进行中的 initialize 完成后再重置状态
- `setEmbeddingService` 支持 `null` 参数，与 `refreshEmbeddingService` 无档案场景一致
- `refreshEmbeddingService` 在无 Embedding 档案时正确清理旧 service
- `handleToggleRerank` / `handleSelectEmbProfile` 增加 try/catch + UI 错误提示

### Run E：事件日志增强 + Stage 透明穿透
- 事件日志：增加分类着色（系统/角色/语音/LLM/外部）
- 事件日志：增加按类别筛选（Chip 过滤器）
- 事件日志：增加"清空"按钮
- 事件日志：列表上限提升到 100 条
- Stage 窗口：新增"穿透"模式（`set-passthrough` 命令）
- 穿透模式：`setIgnoreCursorEvents(true)` + canvas opacity 0，窗口不可被点击但 Live2D 保持渲染
- 穿透模式通过主窗口 StageHost 按钮控制，可随时恢复

## 关键改动

| 文件 | 改动 |
|------|------|
| `src/features/settings/SettingsPanel.tsx` | 两级分层、移除角色设置/行为约束、清理 FieldLabel |
| `src/features/control-panel/ControlPanel.tsx` | 新增 config state、角色设置、直播行为约束 UI |
| `src/features/knowledge/KnowledgePanel.tsx` | 两级分层、统一 SectionTitle/Select 样式、批量管理、删除确认、说明收入 HelpTooltip |
| `src/components/HelpTooltip.tsx` | 支持 ReactNode title + multiline prop |
| `src/services/knowledge/knowledge-service.ts` | initialize 互斥、reinitialize 安全等待、setEmbeddingService 支持 null |
| `src/services/index.ts` | refreshEmbeddingService 无档案时清理 service |
| `src/app/EventLog.tsx` | 分类着色、筛选、清空 |
| `src/App.css` | 事件日志新样式 |
| `src/features/stage/StageHost.tsx` | 穿透模式按钮 |
| `src/features/stage/StageWindow.tsx` | set-passthrough 命令处理 |
| `src/utils/window-sync.ts` | 新增 set-passthrough ControlCommand |

## 验证情况

| 层次 | 状态 | 说明 | 证据 |
|------|------|------|------|
| 编译 / TypeScript | ✅ | `npx tsc --noEmit` 通过 | 0 errors |
| Lint | ✅ | ReadLints 无错误 | 全部修改文件已检查 |
| 浏览器端验证 | ❌ 未验证 | 需手动测试 | — |
| Tauri 桌面端验证 | ❌ 未验证 | 需手动测试 Stage 穿透 | — |
| OBS / Stage 验证 | ❌ 未验证 | 穿透模式需 OBS 验证 | — |

## 风险 / 限制 / 未完成项

- **竞态修复需手测验证**：initialize 互斥在理论上解决了并发问题，但需要实际复现场景验证
- **穿透模式透明度**：使用 canvas opacity 0 实现，OBS 窗口捕获模式下是否仍能捕获需验证
- **事件日志颜色**：使用硬编码颜色，暗色主题下应可读但未精细调整
- **知识库 Popover 测试按钮**：简化后 Popover 内移除了测试连接按钮，只保留主面板测试区域

## 结论

- 所有 5 个 Run 已完成，编译和 lint 均通过
- 建议手动验证后再提交
- 穿透模式为新能力，建议重点测试

## 元信息
- Commit: `49b4223`
- Branch: `feature/phase3-5-rag-foundation`
- 报告路径: `dev-reports/right-panel-refactor/report.md`
