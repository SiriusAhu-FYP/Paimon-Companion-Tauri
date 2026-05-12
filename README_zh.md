# Paimon Companion Tauri

`paimon-companion-tauri` 是 PAIMON 项目（FYP）的主实现仓库。它是一个基于 Tauri 的多模态桌面 companion-agent，将屏幕观察、语音交互、Live2D 表达，以及有边界的任务托管能力整合在同一个桌面宿主中。

这个项目的核心思路，是把“持续陪伴的 Companion Mode”和“执行有限任务的 Delegation Mode”放在同一套系统里，并通过可见的运行时界面让两者都保持可检查、可解释。

## 项目在做什么

在当前已接受的范围内，这个项目支持：

- 一个能够看屏幕、回应、说话并驱动 Live2D 表达的 `Companion Mode`
- 一个通过结构化多角色循环执行有限任务的 `Delegation Mode`
- 面向浏览器流程与保留验证游戏（如 `2048` 与 `Sokoban`）的语义化任务处理
- 通过 Tauri / Rust 边界实现的桌面宿主控制
- 面向记忆、调试捕获与证据导出的运行时检查能力

当前接受的整体方向是：以陪伴为主，以明确委托为边界，而不是追求无约束的自主操作。

系统采用双模式设计：`Companion Mode` 与 `Delegation Mode` 建立在同一套技术基础上，但分别激活、分别运行。

## 为什么仓库会长成这样

这个仓库整合了三条早期工作线中的能力：

- [`LLMPlay-MVP`](https://github.com/SiriusAhu-FYP/LLMPlay-Play)
- [`VoiceL2D-MVP`](https://github.com/SiriusAhu-FYP/VoiceL2D-MVP)
- [`Video-Understanding-MVP`](https://github.com/SiriusAhu-FYP/Video-Understanding-MVP)

最终形成的是一个统一的桌面运行时，而不是三个彼此分离的演示工程。这也是为什么你会在同一个代码库里看到 companion 行为、语音、Live2D 控制、语义任务执行、记忆系统，以及运行时检查界面。

这套共享系统基础主要建立在三点之上：

- 基于 `GCC`（General Computer Control）的屏幕感知与桌面交互
  - `GCC` 可以理解为一种“像人一样操作电脑”的控制方式：先通过视觉观察屏幕，再通过键盘和鼠标完成操作。
- 面向工具编排与控制的 `MCP` 边界
- 在需要时结合本地观察与云端推理的混合感知策略

## 主要能力

当前主线实现包括：

- Windows 宿主的基本能力，如窗口发现、截图、聚焦、键鼠输入
- 带语音播放与 Live2D 表情联动的 companion runtime
- 基于 `Mission Analyst -> Operations Planner -> Progress Evaluator` 的三角色有边界托管流程
- 面向保留验证任务的语义动作层
- 短期与长期记忆支持
- 调试捕获、时间线检查与证据导出能力

## 仓库结构

当前最重要的几个顶层区域是：

- `src/`：React UI 与 TypeScript 运行时
- `src-tauri/`：Rust / Tauri 宿主后端与原生命令边界
- `prompts/`：共享提示词与保留文案材料
- `docs/`：用于理解系统结构与工程实现的项目文档

你也会看到一些本地或分支相关的支持性材料，例如 `.workbench/` 或 `.private/`。这些是围绕项目存在的真实工作界面，但不属于主线实现的核心部分。

## 开发

前置环境：

- Node.js 18+
- `pnpm`
- Rust
- Windows 下的 Tauri 依赖环境

安装并启动：

```bash
pnpm install
pnpm tauri dev
```

Rust 侧检查：

```bash
pnpm setup:local-asr
cargo check --manifest-path src-tauri/Cargo.toml
```

## 运行时说明

- 该项目以 Tauri 桌面宿主为中心。
- 外部 AI 服务可以通过 HTTP 或 SSE 运行在应用外部。
- 本地 TTS 保留 `VoiceL2D-MVP` 继承下来的 GPT-SoVITS 路线。
- 当前支持的 ASR 家族包括 `local-sherpa`、`volcengine`、`aliyun`。
- 默认打包的本地 ASR 基线为 `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16`。
- 宿主输入是前台导向的，不保证与用户手动输入或输入法编辑过程安全共存。

## 边界说明

这个仓库的目标，是清晰呈现主实现本身，而不是保证所有本地运行条件都能一键复现。

部分本地资源、sidecar 依赖和评估环境天然带有机器相关性。这里最核心的内容，仍然是这个被跟踪的代码库，以及它所表达出来的运行时架构与系统边界。

## 其他文档

- `ROADMAP.md`：阶段历史与已接受里程碑记录
- `docs/architecture.md`：系统结构说明
