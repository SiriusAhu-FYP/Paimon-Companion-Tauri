# Phase 2 实现报告 — Run 01

## 本次完成内容

按照 `blueprints/phase2/stage-and-pipeline.md` 规划，完成了 Phase 2 的全部 7 个模块。

### M1: Live2D 渲染层重构

- 从 `Live2DPreview.tsx` 中提取渲染核心为独立的 `Live2DRenderer` 类
- `Live2DRenderer` 不依赖 React，可被主窗口和 Stage 窗口独立实例化
- 支持：情绪参数覆盖、口型驱动（`setMouthOpenY`）、resize、motion 播放
- 文件：`src/features/live2d/live2d-renderer.ts`

### M2+M3: Stage 窗口 Live2D 渲染 + 同步通道增强

- **Stage 窗口现在渲染真实的 Live2D 模型**，不再是文字占位
- Stage 窗口内嵌独立的 `Live2DRenderer` 实例
- `window-sync.ts` 增强：
  - `SyncPayload` 新增 `expressionEmotion`、`motionTrigger` 字段
  - 新增独立的 `MOUTH_CHANNEL`（高频口型数据通道），避免口型数据刷满状态通道
  - 新增 `broadcastMouth()` / `onMouthSync()` API
- Stage 窗口监听状态同步和口型同步，驱动本地 Live2D 渲染

### M4: 服务接口层

- **ILLMService 接口** + `MockLLMService`（模拟流式回复 + 工具调用）
  - 支持 `AsyncGenerator<LLMChunk>` 流式输出
  - Mock 实现从预设回复中随机选取，逐字输出模拟打字效果
- **ITTSService 接口** + `MockTTSService`（生成正弦波 WAV 测试音）
  - 音频时长与文本长度相关，带音量包络模拟说话节奏
- **IASRService 接口**占位
- **LLMService 门面类**：协调 ILLMService 与事件总线，管理对话历史、runtime 门控

### M5: 音频播放 + 口型数据通道

- `AudioPlayer` 类：播放 ArrayBuffer 格式音频
- 通过 `AnalyserNode` 实时提取低频段音量，非线性映射为口型数据（0–1）
- 口型数据通过回调分发，接入 BroadcastChannel 实现跨窗口口型同步

### M6: 主链路串联

- `PipelineService`：编排完整链路 文本→LLM→TTS→播放→口型→角色反馈
- 集成 runtime 门控（pipeline 过程中持续检查）
- 播放期间自动 `character.setSpeaking(true/false)`
- 口型数据自动广播到 Stage 窗口
- devtools 工具：`window.__paimon.pipeline("你的文本")`

### M7: 对话面板增强

- 输入框 + 发送按钮（Enter 发送，Shift+Enter 换行）
- 流式消息显示（逐字追加 + 闪烁光标 `▌`）
- 状态指示：「AI 正在思考...」/「正在播放语音...」
- 输入禁用控制：pipeline 运行时禁用输入
- 兼容旧的 `audio:asr-result` 事件

## 改动文件列表

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/features/live2d/live2d-renderer.ts` | Live2D 渲染核心（可复用） |
| `src/services/llm/types.ts` | LLM 接口类型定义 |
| `src/services/llm/mock-llm-service.ts` | Mock LLM 实现 |
| `src/services/llm/llm-service.ts` | LLM 门面服务 |
| `src/services/llm/index.ts` | LLM 模块导出 |
| `src/services/tts/types.ts` | TTS 接口类型定义 |
| `src/services/tts/mock-tts-service.ts` | Mock TTS 实现 |
| `src/services/tts/index.ts` | TTS 模块导出 |
| `src/services/audio/types.ts` | ASR 接口类型定义 |
| `src/services/audio/audio-player.ts` | 音频播放器 + 口型提取 |
| `src/services/audio/index.ts` | Audio 模块导出 |
| `src/services/pipeline/pipeline-service.ts` | 主链路编排服务 |
| `src/services/pipeline/index.ts` | Pipeline 模块导出 |

### 修改文件

| 文件 | 改动内容 |
|------|----------|
| `src/features/live2d/Live2DPreview.tsx` | 使用 Live2DRenderer + 订阅口型数据 |
| `src/features/live2d/index.ts` | 导出 Live2DRenderer |
| `src/features/stage/StageWindow.tsx` | 内嵌独立 Live2D 渲染 + 监听同步 |
| `src/features/chat/ChatPanel.tsx` | 输入框 + 流式显示 + pipeline 集成 |
| `src/utils/window-sync.ts` | 新增口型通道 + SyncPayload 扩展 |
| `src/services/index.ts` | ServiceContainer 新增 llm/player/pipeline |
| `src/main.tsx` | 广播 expression 事件 + 挂载 pipeline devtools |
| `src/utils/mock.ts` | 无实质改动（pipeline 挂载移至 main.tsx） |
| `src/App.css` | ChatPanel 样式增强 |

## 测试结果

### 自动化验证

- **TypeScript 编译**：`npx tsc --noEmit` 通过，零错误
- **Linter**：ReadLints 检查所有核心文件，零错误
- **Vite 开发服务器**：启动成功（228ms）

### 浏览器端对端验证

1. **主窗口加载**：✅ Live2D 模型加载成功，UI 正常渲染
2. **完整 Pipeline 测试**：
   - 输入 "你好派蒙，推荐好吃的！"，点击发送
   - ✅ 输入框立即禁用显示「等待回复中...」
   - ✅ LLM 流式回复逐字显示
   - ✅ 工具调用触发表情切换（→ happy）
   - ✅ TTS 合成 1.7 秒测试音
   - ✅ 音频成功播放
   - ✅ 播放结束后输入框恢复可用
   - ✅ 角色状态正确更新（emotion: happy, isSpeaking 状态切换正常）
3. **Stage 窗口 Live2D**：
   - ✅ `?window=stage` 页面成功加载独立 Live2D 模型
   - ✅ BroadcastChannel 状态同步已建立
   - ✅ 口型同步通道已建立

### 完整链路日志（按时间顺序）

```
pipeline start → mock-llm reply selected → expression: happy →
character emotion → happy → llm response complete (21 chars) →
mock-tts synthesized 1.7s audio → audio-player playing 1.7s →
playback finished → pipeline complete
```

## 未测试 / 待验证

1. **OBS 回归验证**（⚠️ 重要提醒）：
   - Stage 窗口现在渲染真实 Live2D（之前只有文字占位）
   - **需要在 OBS 中重新验证 Stage 窗口捕获是否仍然正常**
   - 特别关注：WebGL canvas 在窗口捕获模式下的透明度表现
2. **Tauri 双窗口真实环境**：本次验证基于浏览器模拟（`?window=stage`）
3. **高频口型同步性能**：BroadcastChannel 在高频（60fps）口型数据下的延迟表现
4. **多轮对话**：对话历史积累后的内存占用

## 风险

- Mock TTS 生成的正弦波测试音用于验证通道可用性，不代表真实 TTS 质量
- `Live2DRenderer` 初始化中 `pixi-live2d-display/cubism4` 的 `registerTicker` 调用在多实例场景下的行为需关注（Stage 窗口独立 JS context 时不是问题）
- React.StrictMode 开发模式下 Stage 窗口会双重初始化渲染器（仅开发环境）

## 下一步

- Phase 2 技术实现已全部完成
- **需要执行 OBS 回归验证**，确认 Stage 窗口 Live2D 渲染在 OBS 捕获下正常
- 准备 Phase 2 close-out 判定
