# Phase 3 Blueprint 编写报告

## 本次完成了什么

编写了 Phase 3 blueprint 文档：`blueprints/phase3/phase3-blueprint.md`。

## 文档核心内容

### 路线图对齐

原定 Phase 3（Control & Monitor）和 Phase 4（Live Integration）的部分能力已在 Phase 1–2 提前落地（控制面板、急停/恢复、OBS 透明捕获等）。本 Phase 3 重新定义为"真实服务接入与直播能力接线"，覆盖原路线图中尚未落地的核心能力。

### 6 个 Milestone

| Milestone | 内容 | 风险 |
|-----------|------|------|
| M4 | 配置管理基础（.env + config 模块） | 低 |
| M6 | HTTP 网络能力开通 | 低 |
| M1 | 真实 LLM 接入（OpenAI 兼容） | 中 |
| M3 | 知识层与 LLM 串联（prompt 注入） | 低-中 |
| M2 | 真实 TTS 接入 | 中 |
| M5 | 弹幕 / 外部输入适配器 | 中-高 |

### 分批策略

- **第一批（MVP 最小闭环）**：M4 → M6 → M1 → M3 → M2
- **第二批（直播能力扩展）**：M5

### 关键设计决策

1. **mock 永远保留**：通过配置切换而非删除代码，保证回滚和新开发者体验
2. **接口不变**：`ILLMService`、`ITTSService` 接口不修改，新实现遵守相同契约
3. **Pipeline 不动**：`PipelineService` 编排逻辑不改，只替换底层 provider
4. **Stage / OBS / Live2D 不动**：渲染和播出层完全不受影响
5. **技术选型延后**：LLM/TTS/弹幕平台的具体方案在各 M 实施前确认

### 明确不做

- ASR / 语音输入 / VAD / 锁麦
- RAG / 向量检索
- 知识管理 UI / 配置 UI
- Windows 安装包
- Stage / OBS 方案变更

## 改动文件

| 文件 | 类型 |
|------|------|
| `blueprints/phase3/phase3-blueprint.md` | 新建 |
| `dev-reports/phase3/001-phase3-blueprint.md` | 新建 |

## 测试

- 纯文档输出，无代码改动，无需运行测试
