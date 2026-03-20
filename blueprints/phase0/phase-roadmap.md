# Paimon Live — 分阶段路线图

---

## 总览

项目按 phase 推进，每个 phase 有明确的边界和交付物。后一个 phase 严格依赖前一个 phase 的完成。

**文档生成策略**：每次最多只详细生成下一阶段文档。Phase 1 的详细施工文档见 `blueprints/phase1/foundation.md`，Phase 2 及之后仅保留高层目标描述，在前一阶段完成后再详细展开。

| Phase | 名称 | 核心目标 |
|-------|------|----------|
| 0 | Bootstrap | 项目骨架 + 审计 + 规划文档 |
| 1 | Foundation | Live2D 渲染 + 基础 UI + 事件总线 + runtime |
| 2 | Voice Pipeline | ASR + LLM + TTS 语音链路 |
| 3 | Control & Monitor | 控制面板 + 状态监控 + 急停 |
| 4 | Live Integration | OBS 输出 + 弹幕/礼物接入 |
| 5 | Polish & Package | 配置管理 + 打包分发 + 体验打磨 |

---

## Phase 0 — Bootstrap（当前阶段）

**目标：** 搭建项目骨架，完成旧项目审计与架构规划。

**交付物：**
- Tauri + React + TypeScript 项目骨架
- 前端目录结构（features / services / hooks / types 等）
- VoiceL2D 审计报告
- 架构设计文档
- 模块设计文档（含 runtime、knowledge、external-input）
- 数据流与事件流设计文档
- 产品需求文档
- 分阶段路线图
- Phase 1 详细施工文档

**不做的事：**
- 不接入真实服务
- 不迁移旧代码
- 不编写业务逻辑

---

## Phase 1 — Foundation

> 详细施工文档：`blueprints/phase1/foundation.md`

**目标：** 搭建可运行的基础框架——Live2D 角色能在窗口中渲染、事件总线能工作、runtime 最小可用、基础 UI 结构就位。

**关键交付物：**
- 事件总线核心实现
- 运行时控制器最小可行形态
- Live2D 渲染模块（模型加载、表情/动作播放）
- 角色状态管理基础实现（权威真源）
- 基础 UI 布局（主窗口分区）
- 日志服务基础实现
- 配置加载能力

**技术验证任务（spike）：**
- Tauri 透明窗口 + OBS 窗口捕获可行性
- Live2D 在 Tauri + React 下的加载与渲染方式
- Windows 下麦克风权限与音频采集路径
- 主控窗口与舞台窗口的同步机制
- 基础事件总线与 runtime 的最小可行形态

---

## Phase 2 — Voice Pipeline

> 详细施工文档在 Phase 1 完成后生成。

**目标：** 打通语音主链路，实现从用户说话到 AI 角色回复的完整闭环。

**高层交付物：**
- 音频采集 + VAD
- ASR 云端调用
- LLM 对接（流式响应、工具调用）
- TTS 调用 + 音频播放 + 口型同步
- 锁麦策略
- 对话面板基础 UI

---

## Phase 3 — Control & Monitor

> 详细施工文档在 Phase 2 完成后生成。

**目标：** 提供完整的操作员控制台。

**高层交付物：**
- 控制面板完整 UI
- 急停与恢复
- 人工接管模式
- 日志查看面板
- 全局快捷键

---

## Phase 4 — Live Integration

> 详细施工文档在 Phase 3 完成后生成。

**目标：** 实现直播场景集成。

**高层交付物：**
- OBS 舞台窗口（透明背景、角色同源渲染）
- 直播平台弹幕/礼物事件接入
- 商品消息与知识上下文注入
- external-input 适配器框架

---

## Phase 5 — Polish & Package

> 详细施工文档在 Phase 4 完成后生成。

**目标：** 体验打磨与 Windows 安装包分发。

**高层交付物：**
- 首次启动引导
- 错误恢复与稳定性
- Windows 安装包（.msi / .exe）
- 用户文档

---

## 风险与待定事项

| 事项 | 风险等级 | 说明 |
|------|----------|------|
| Tauri 透明窗口 + OBS 捕获 | 中 | Phase 1 spike 验证 |
| VAD 方案选型 | 中 | 需在 Phase 2 前确定 TS/WASM 方案 |
| Live2D 在 Tauri WebView 下的性能 | 中 | Phase 1 spike 验证 |
| 直播平台接口差异 | 中 | Phase 4 前调研，各平台 API 差异大 |
| Live2D 商业模型授权 | 中 | 需确认模型使用授权范围 |
| 本地 ASR（faster-whisper） | 低 | 暂不纳入路线图，作为未来可选功能 |
| GPT-SoVITS 部署 | 低 | 外部服务，不在 Paimon Live 进程边界内 |
