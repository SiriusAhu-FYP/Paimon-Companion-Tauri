# Paimon Live

由大模型驱动的虚拟 AI 主播桌面系统。

## 项目简介

Paimon Live 是一个基于 Tauri 的桌面应用，目标是将 Live2D 虚拟角色与 AI 对话能力整合为一个可用于直播场景的桌面系统。

核心能力包括：

- Live2D 角色显示与表情 / 动作状态反馈
- 语音链路（ASR → LLM → TTS）
- 监控与控制面板
- 外部事件输入（弹幕、礼物、商品消息）
- 日志与调试
- 紧急停止与人工接管
- 透明背景角色输出（供 OBS 捕获）

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面宿主 | Tauri 2 |
| 前端 | React 19 + TypeScript |
| 构建工具 | Vite 7 |
| 包管理器 | pnpm |
| Rust 职责 | 宿主层、IPC 桥接、窗口管理、打包 |
| TypeScript 职责 | 核心业务逻辑、状态管理、事件编排 |

## 目录结构

```
paimon-live/
├── blueprints/              # 分阶段规划文档
│   └── phase0/              # Phase 0: 项目启动与规划
├── docs/                    # 长期参考文档
│   ├── migrations/          # 旧项目迁移分析
│   └── research/            # 外部调研与技术选型
├── dev-reports/             # 开发阶段汇报
├── public/                  # 静态资源
├── src/                     # 前端源码
│   ├── app/                 # 应用入口与布局
│   ├── components/          # 共享 UI 组件
│   ├── features/            # 功能模块
│   │   ├── live2d/          # Live2D 角色渲染
│   │   ├── chat/            # 对话面板
│   │   ├── control-panel/   # 控制台与监控
│   │   └── stage/           # OBS 输出窗口
│   ├── services/            # 核心业务服务
│   │   ├── audio/           # 音频管线 (ASR/TTS)
│   │   ├── llm/             # LLM 对接
│   │   ├── event-bus/       # 事件总线
│   │   ├── character/       # 角色状态管理
│   │   └── logger/          # 日志与调试
│   ├── hooks/               # 自定义 React Hooks
│   ├── types/               # 共享类型定义
│   ├── utils/               # 工具函数
│   └── assets/              # 静态资源 (图片等)
└── src-tauri/               # Tauri / Rust 后端
    ├── src/
    │   ├── commands/        # IPC 命令
    │   ├── lib.rs
    │   └── main.rs
    └── tauri.conf.json
```

## 开发

### 前置条件

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install)
- Tauri 系统依赖（参考 [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)）

### 启动开发环境

```bash
pnpm install
pnpm tauri dev
```

## 当前阶段

**Phase 0 — Bootstrap**：项目骨架搭建与规划文档编写。详见 `blueprints/phase0/bootstrap.md`。
