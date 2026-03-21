# Spike 4：双窗口状态同步

## 问题

两个 Tauri 窗口之间如何同步角色状态？

## 调研结论

### Tauri 2 多窗口通信机制

Tauri 2 提供多种多窗口通信方式：

1. **Tauri Event System**（推荐用于跨窗口通信）
   - `emit_to(label, event, payload)` 从 Rust 端向指定窗口发送事件
   - `window.emit(event, payload)` + `window.listen(event)` 在前端使用
   - 前端也可以通过 `emit` 向特定窗口标签发送事件

2. **共享 Rust 状态**
   - 两个窗口共享同一个 Tauri 进程的 Rust 后端
   - 可以通过 IPC Command 读写共享状态
   - 适合需要原子性和一致性的场景

3. **BroadcastChannel API**（Web 标准）
   - WebView2 支持 `BroadcastChannel`
   - 但 Tauri 2 的多窗口可能不共享 origin，需验证

### 推荐方案

对于 Paimon Live 的角色状态同步，推荐分层方案：

**Phase 1（当前）：单窗口 + service 内存状态**
- 暂时只有主窗口运行
- 所有状态在 TypeScript service 层管理
- StageWindow 组件可在主窗口内作为区域预览

**Phase 4（正式双窗口）：Tauri Event System**
- 主窗口的 character service 状态变化时，通过 Tauri Event API 同步到 stage 窗口
- stage 窗口监听事件并更新本地 Live2D 渲染
- 高频口型数据使用专门的 Tauri Event 通道，避免阻塞普通事件

### spike 验证代码

已在 `src/services/character/` 中实现 `CharacterService` 作为单一状态真源。当正式启用双窗口时，只需增加一层 Tauri Event 转发即可，service 层无需改动。

### 后续验证计划

- Phase 4 创建 stage 窗口时验证 Tauri Event API 的跨窗口通信
- 测试 `BroadcastChannel` 在 Tauri 2 多窗口中是否可用
- 评估高频口型数据的跨窗口延迟

## 状态

**架构层面已准备好（service-first + 事件驱动），待 Phase 4 实机验证跨窗口通信。**
