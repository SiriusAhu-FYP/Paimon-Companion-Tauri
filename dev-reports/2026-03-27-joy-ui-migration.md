# Dev Report — Joy UI 配色迁移（完成）

## 分支

`feature/theme-joy-ui`（从 `feature/phase3-integration` 检出）

## 完成内容

### 1. 基础设施
- 安装 `@mui/joy`
- 新建 `src/contexts/JoyThemeProvider.tsx`
- 重构 `src/theme.ts`：Joy UI `extendTheme` + MUI `createAppTheme` 双轨

### 2. 主题切换按钮
- 在 `MainWindow` header 加入太阳/月亮图标切换按钮
- `useThemeMode()` hook 暴露 `mode` 和 `setMode`

### 3. 专业调色板
- 蓝灰色系（桌面应用友好）
- Light: primary `#0B6EF5` / background `#F5F7FA` / text `#1A1A1A`
- Dark: primary `#4D9FFF` / background `#0F1117` / text `#E8EAF0`
- 完整的 50-900 色阶 + mainChannel/lightChannel/darkChannel

### 4. CSS 变量渗透
- `App.css` 中的硬编码颜色迁移为 `var(--joy-palette-*)`
- 事件日志现在随主题自动变化

## 架构

```
JoyThemeProvider
└── CssVarsProvider (Joy UI)
    ├── data-joy-color-scheme="light|dark"  ← HTML 属性驱动
    ├── colorSchemes.light → palette
    └── colorSchemes.dark → palette
        └── InnerThemeProvider
            └── ColorSchemeContext.Provider
                └── ThemeProvider (MUI)
                    └── createAppTheme(mode)  ← 同一 mode，MUI palette
                        └── 所有 MUI 组件
```

## 提交记录

| 提交 | 内容 |
|------|------|
| `de90f62` | feat(theme): introduce Joy UI CssVarsProvider... |
| `afa84d9` | feat(ui): add theme toggle button... |
| `e5a51a3` | feat(theme): upgrade JoyThemeProvider with professional palette... |
| `1c28bf4` | refactor(css): migrate event-log hardcoded colors... |

## 验证

- `pnpm tsc --noEmit` ✓
- `pnpm build` ✓

## 待后续完善

- 亮色模式下按钮 hover/active 状态视觉反馈
- StageSlot 等组件中仍有部分硬编码背景色
