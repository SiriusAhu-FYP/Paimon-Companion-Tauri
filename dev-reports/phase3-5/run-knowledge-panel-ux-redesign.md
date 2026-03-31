# KnowledgePanel UX 重设计

## 完成内容

### 1. 添加知识入口
- 默认状态：仅显示一个"添加知识"按钮，不占用额外屏幕空间
- 点击展开后，显示三个 tab（拖放文件 / 单条添加 / 输入 JSON）
- 可通过"收起"按钮折叠回去

### 2. JSON 输入模式
- "JSON 导入"改名为"输入 JSON"
- 切换到 JSON 模式时自动预填样例文本（包含完整的字段示例）
- 用户可直接修改样例中的关键字段后点击"导入"
- 移除了旧的"查看模板"折叠按钮

### 3. 批量选择 UX
- 默认不显示 Checkbox，改为"批量管理"按钮进入批量模式
- 进入批量模式后：
  - 每个文档条目前显示 Checkbox
  - 提供独立的"全选/取消全选"按钮（不自动全选）
  - 选中后出现"删除"按钮
  - 点击"完成"退出批量模式并清空选择
- 删除操作保留 2s 倒计时二次确认

### 4. 文档编辑模式
- 编辑界面增加"简洁/JSON"双模式切换（ButtonGroup）
- JSON 模式下直接编辑完整的 JSON 对象

### 5. 预览文字溢出
- 标题和内容预览均使用 MUI `noWrap` 属性确保截断
- 列表项容器设置 `minWidth: 0` 保证 flex 子项正确缩小

### 6. 代码清理
- 移除 `Accordion`、`AccordionSummary`、`ExpandMoreIcon`、`KeyboardArrowDownIcon` 导入
- 移除 `addExpanded`、`showTemplate`、`selectAllDocs` 等废弃状态

## 改动文件
- `src/features/knowledge/KnowledgePanel.tsx`

## i18n 检查结果
- 项目已安装 `i18next` + `react-i18next` 但**未初始化**，无翻译调用
- 所有 UI 文案均为中文硬编码
- 核查了 KnowledgePanel 及 SettingsPanel 的中文用语，确认一致性无问题

## 全项目 UI 瘦身评估

| 机会 | 主要文件 | 难度 | 预估省行 |
|------|---------|------|---------|
| LLM/TTS 档案 Section 合并 | SettingsPanel | 难 | 180-280 |
| 连接测试卡片组件化 | Settings + Knowledge | 易 | 80-120 |
| Embedding/Rerank Popover 合并 | KnowledgePanel | 中 | 50-70 |
| 倒计时删除确认条 | Settings + Knowledge | 中 | 50-80 |
| 档案 Select 工具条 | 多文件 | 中 | 60-90 |
| 统一 InsetCard sx | 多文件 | 易 | 40-70 |
| 顶栏 + SectionTitle 共享 | Knowledge + Settings | 易 | 25-40 |

建议按「易 → 中 → 难」顺序落地，先抽连接测试卡片和删除确认条。

## 测试
- 构建通过 (`pnpm run build`)
- Linter 无错误

## 风险与待办
- i18n 基础设施未激活，若后续需要多语言支持需初始化 i18next
- UI 瘦身评估仅为方案，未实际执行，可作为后续优化 run 的依据
