# Dev Report — Joy UI 配色迁移

## 本次完成

在 `feature/theme-joy-ui` 分支上完成了 Joy UI 配色迁移的基础设施搭建。

## 改动文件

| 文件 | 变更 |
|------|------|
| `src/theme.ts` | 重构为 Joy UI `extendTheme` + MUI `createAppTheme` 双轨制。Joy UI 处理 CSS 变量，MUI 处理实际组件渲染 |
| `src/contexts/JoyThemeProvider.tsx` | 新建。封装 `CssVarsProvider` + `useColorScheme` + `ThemeProvider` 联动，Joy UI 为驱动源，MUI 为渲染层 |
| `src/main.tsx` | 移除旧的 `ThemeProvider`，替换为 `JoyThemeProvider` |

## 架构说明

```
JoyThemeProvider
└── CssVarsProvider (Joy UI)
    ├── data-joy-color-scheme="light|dark"  ← 驱动源
    ├── setMode() 控制 HTML 属性变化
    └── palette 通过 CSS 变量暴露
        └── ThemeProvider (MUI)
            └── createAppTheme(mode)  ← 读取同一 mode
                └── 所有 MUI 组件使用统一 palette
```

## 配色方案（待完善）

当前使用硬编码的专业蓝灰调，后续可在 `JoyThemeProvider` 的 `colorSchemes` 配置中切换为 Joy UI 预设调色板（如 `joy.palette`）。

## 验证

- `pnpm tsc --noEmit` ✓
- `pnpm build` ✓

## 待办

- 将主题切换按钮（目前缺失）接入 `useThemeMode()` hook
- 在 JoyThemeProvider 中完善 `colorSchemes` 配置，接入 Joy UI 预设调色板
- 将 `App.css` 中的硬编码颜色迁移为 CSS 变量
