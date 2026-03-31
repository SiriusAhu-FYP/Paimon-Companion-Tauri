# [Run] BugFix: L2D 加载失败后不清理 + JSON 模式模板自动填充

## 本次目标

1. 修复"关闭模型再启动后 L2D 加载失败"的问题
2. 实现点击 JSON 模式时自动填充可填写模板

## 本次完成内容

### 问题 1：L2D 加载失败后 rendererRef 未清理

**根因**：`StageWindow.tsx` 的 `initRenderer` 函数中，当 `renderer.init()` 抛出异常时，`renderer` 对象已赋值给 `rendererRef.current`，但 catch 块没有清理。

后续 `show-stage` 命令到达时，`if (!rendererRef.current)` 判断为 `false`（坏掉的 renderer 仍存在），导致跳过 `initRenderer` 直接 `win.show()`，Stage 窗口显示但模型加载失败。

**修复**：在 catch 块中添加 `renderer.destroy()` 和 `rendererRef.current = null`，确保失败后状态干净。

### 问题 2：JSON 模式点击后自动填充模板

**改动**：
- 新增 `JSON_TEMPLATE` 常量（包含完整字段的示例 JSON）
- 切换到 JSON 模式时，若输入框为空，自动调用 `validateJsonInput(JSON_TEMPLATE)` 填入模板

## 关键改动

| 文件 | 改动摘要 |
|------|---------|
| `src/features/stage/StageWindow.tsx` | initRenderer 的 catch 块：加载失败时调用 `renderer.destroy()` + 置空 `rendererRef.current` |
| `src/features/knowledge/KnowledgePanel.tsx` | 新增 `JSON_TEMPLATE` 常量；切换到 JSON 模式时自动填充模板 |

## 验证情况

| 层次 | 状态 | 说明 | 证据 |
|------|------|------|------|
| 编译 / lint | ✅ | tsc + vite build 通过，无 lint 错误 | `pnpm run build` exit 0 |
| 浏览器端验证 | ❌ | 需 Tauri 桌面环境手测验证 | 未验证 |
| Tauri 桌面端验证 | ❌ | 需实际关闭/启动模型流程验证 | 未验证 |
| OBS / Stage / Provider 验证 | ❌ | 需真实模型加载路径验证 | 未验证 |
| 尚未验证 | L2D 加载失败修复 + JSON 模板自动填充效果 | — | — |

## 风险 / 限制 / 未完成项

- L2D 加载失败修复依赖 Tauri 运行时验证；目前仅确认了逻辑正确性，未实际触发"关闭→启动"流程确认
- JSON 模板自动填充仅验证了代码逻辑和编译通过，未在浏览器中实测点击效果

## 结论

两个修改均已完成代码实现并通过编译检查。L2D 修复的正确性可在 Tauri 桌面环境中通过"关闭 Stage → 重新启动"流程验证。JSON 模板功能可通过切换到 JSON 模式观察输入框是否自动填充验证。

## 元信息

- Commit: `待获取`
- Branch: `feature/phase3-5-rag-foundation`
- 报告路径: `dev-reports/phase3-5/run-xx-bugfix-l2d-json-template.md`
- 相关文档路径: 无
